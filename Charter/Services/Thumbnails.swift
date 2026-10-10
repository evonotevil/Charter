import AppKit
import QuickLookThumbnailing

/// QuickLook 缩略图，带内存缓存。
@MainActor
final class Thumbnails {
    static let shared = Thumbnails()
    private let cache = NSCache<NSString, NSImage>()
    private var inFlight: [NSString: Task<NSImage?, Never>] = [:]

    private init() {
        cache.countLimit = 160
        cache.totalCostLimit = 96 * 1_024 * 1_024
    }

    func image(for url: URL, size: CGSize) async -> NSImage? {
        let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        let modified = values?.contentModificationDate?.timeIntervalSinceReferenceDate ?? 0
        let scale = NSScreen.main?.backingScaleFactor ?? 2
        let key = "\(url.path)|\(modified)|\(Int(size.width))x\(Int(size.height))@\(scale)" as NSString
        if let hit = cache.object(forKey: key) { return hit }
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        if let task = inFlight[key] {
            let image = await task.value
            return Task.isCancelled ? nil : image
        }

        let task = Task<NSImage?, Never> {
            await ThumbnailGate.shared.acquire()
            guard !Task.isCancelled else {
                await ThumbnailGate.shared.release()
                return nil
            }
            let request = QLThumbnailGenerator.Request(fileAt: url, size: size, scale: scale, representationTypes: .thumbnail)
            let image = try? await QLThumbnailGenerator.shared.generateBestRepresentation(for: request).nsImage
            await ThumbnailGate.shared.release()
            return image
        }
        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil
        if let image {
            let pixelWidth = max(Int(size.width * scale), 1)
            let pixelHeight = max(Int(size.height * scale), 1)
            cache.setObject(image, forKey: key, cost: pixelWidth * pixelHeight * 4)
        }
        return Task.isCancelled ? nil : image
    }
}

/// Keep QuickLook work bounded even when scrolling quickly through a large grid.
private actor ThumbnailGate {
    static let shared = ThumbnailGate()
    private var available = 6
    private var waiting: [CheckedContinuation<Void, Never>] = []

    func acquire() async {
        if available > 0 { available -= 1; return }
        await withCheckedContinuation { waiting.append($0) }
    }

    func release() {
        if waiting.isEmpty { available += 1 }
        else { waiting.removeFirst().resume() }
    }
}
