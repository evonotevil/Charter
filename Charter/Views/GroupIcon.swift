import SwiftUI
import AppKit

/// 集团图标：上传过图片的显示图片（圆角方形），否则显示名称首字。
/// groupID 为 nil 表示“全部公司”，为 Router.ungrouped 表示“未归入集团”。
struct GroupIcon: View {
    var groupID: String?
    var size: CGFloat = 22
    /// 没有图片时的底色（放在浅灰底上时可改成白色）。
    var fill: Color = Theme.band
    @Environment(AppStore.self) private var store

    var body: some View {
        if let image = uploadedImage {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fill)
                .frame(width: size, height: size)
                .clipShape(.rect(cornerRadius: size * 0.28))
                .accessibilityHidden(true)
        } else if groupID == nil {
            GroupMonogram(text: nil, systemImage: "square.stack.3d.up", size: size, fill: fill)
        } else if groupID == Router.ungrouped {
            GroupMonogram(text: "独", size: size, fill: fill)
        } else {
            GroupMonogram(text: String((store.group(groupID)?.name ?? "").trimmingCharacters(in: .whitespaces).prefix(1)).ifEmpty("集"),
                          size: size, fill: fill)
        }
    }

    private var uploadedImage: NSImage? {
        guard let id = groupID, id != Router.ungrouped,
              let file = store.group(id)?.iconFileName, !file.isEmpty else { return nil }
        return GroupIconStore.image(at: GroupIconStore.url(root: store.store.root, fileName: file))
    }
}

/// 没有图片时的集团图标：圆角方形里放首字或符号。
struct GroupMonogram: View {
    var text: String?
    var systemImage: String? = nil
    var size: CGFloat = 22
    var fill: Color = Theme.band

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28)
            .fill(fill)
            .overlay(RoundedRectangle(cornerRadius: size * 0.28).strokeBorder(Theme.hairline, lineWidth: 1))
            .overlay {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: size * 0.44, weight: .medium))
                } else if let text {
                    Text(text)
                        .font(.system(size: size * 0.46, weight: .semibold))
                }
            }
            .foregroundStyle(Theme.ink)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// 集团图标文件：数据文件夹/集团图标/<集团 ID>.png，256×256。
enum GroupIconStore {
    static let folderName = "集团图标"

    static func folder(root: URL) -> URL {
        root.appendingPathComponent(folderName, isDirectory: true)
    }

    static func url(root: URL, fileName: String) -> URL {
        folder(root: root).appendingPathComponent(fileName)
    }

    /// 按“路径 + 修改时间”缓存，换了图片会自动重新读取。
    private static let cache = NSCache<NSString, NSImage>()

    static func image(at url: URL) -> NSImage? {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let modified = attrs[.modificationDate] as? Date else { return nil }
        let key = "\(url.path)#\(modified.timeIntervalSince1970)" as NSString
        if let cached = cache.object(forKey: key) { return cached }
        guard let image = NSImage(contentsOf: url) else { return nil }
        cache.setObject(image, forKey: key)
        return image
    }

    /// 居中裁成正方形，缩放到 side × side，编码为 PNG。
    static func squarePNG(from source: NSImage, side: Int = 256) -> Data? {
        guard let cg = source.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let w = cg.width
        let h = cg.height
        let s = min(w, h)
        guard s > 0 else { return nil }
        let crop = CGRect(x: (w - s) / 2, y: (h - s) / 2, width: s, height: s)
        guard let square = cg.cropping(to: crop) else { return nil }
        let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(square, in: CGRect(x: 0, y: 0, width: side, height: side))
        guard let out = ctx.makeImage() else { return nil }
        return NSBitmapImageRep(cgImage: out).representation(using: .png, properties: [:])
    }

    /// 写入图标文件，返回文件名（存进 CorporateGroup.iconFileName）。
    static func write(_ png: Data, groupID: String, root: URL) throws -> String {
        let dir = folder(root: root)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let name = FolderStore.safe(groupID) + ".png"
        try png.write(to: dir.appendingPathComponent(name), options: .atomic)
        return name
    }

    static func remove(fileName: String, root: URL) {
        try? FileManager.default.removeItem(at: url(root: root, fileName: fileName))
    }
}
