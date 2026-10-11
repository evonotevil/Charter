import Foundation
import Observation

/// 数据文件夹的真实同步状态：读取 iCloud 给每个文件标记的上传、下载、错误和冲突信息，
/// 而不是只看路径。每 15 秒、以及每次保存后检查一次。
@MainActor @Observable
final class SyncMonitor {
    static let shared = SyncMonitor()

    enum State: Equatable {
        case checking
        case synced(Date)
        case syncing(Int)
        case conflict([String])
        case failed(String)
        case signedOut
        case local

        var title: String {
            switch self {
            case .checking: "正在检查同步"
            case .synced: "已同步"
            case .syncing(let n): n > 0 ? "正在同步 \(n) 个文件" : "正在同步"
            case .conflict: "有冲突需要处理"
            case .failed: "无法同步"
            case .signedOut: "未登录 iCloud"
            case .local: "仅保存在本机"
            }
        }

        var symbol: String {
            switch self {
            case .checking, .syncing: "arrow.triangle.2.circlepath.icloud"
            case .synced: "checkmark.icloud"
            case .conflict: "exclamationmark.icloud"
            case .failed, .signedOut: "xmark.icloud"
            case .local: "internaldrive"
            }
        }

        var needsAttention: Bool {
            switch self {
            case .conflict, .failed, .signedOut: true
            default: false
            }
        }

        /// 一句说明：发生了什么、该怎么做。
        var detail: String {
            switch self {
            case .checking: "正在读取 iCloud 的同步信息。"
            case .synced(let d): "所有档案记录都已上传到 iCloud。最后检查：\(d.formatted(date: .omitted, time: .shortened))。"
            case .syncing: "iCloud 正在上传或下载文件，完成前另一台 Mac 可能看不到最新内容。"
            case .conflict(let names): "两台 Mac 同时修改了 \(names.prefix(3).joined(separator: "、"))\(names.count > 3 ? " 等 \(names.count) 个文件" : "")。Charter 使用最新的版本；在访达中可以找到其他版本。"
            case .failed(let msg): "\(msg) 请检查网络和 iCloud 云盘空间。"
            case .signedOut: "数据文件夹在 iCloud 云盘里，但这台 Mac 没有登录 iCloud，修改不会同步。请在系统设置中登录 Apple 账户。"
            case .local: "数据文件夹不在 iCloud 云盘中，修改只保存在这台 Mac 上。要在两台 Mac 之间同步，请把数据文件夹换到 iCloud 云盘里。"
            }
        }
    }

    private(set) var state: State = .checking
    private var root: URL?
    private var timer: Timer?
    private var task: Task<Void, Never>?

    func start(root: URL) {
        if self.root != root {
            self.root = root
            state = .checking
        }
        refresh()
        if timer == nil {
            timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { _ in
                Task { @MainActor in SyncMonitor.shared.refresh() }
            }
        }
    }

    /// 保存后先显示“正在同步”，稍后再读真实状态。
    func refreshSoon() {
        guard root != nil, state != .local, state != .signedOut else { return }
        if case .synced = state { state = .syncing(0) }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            refresh()
        }
    }

    func refresh() {
        guard let root else { return }
        task?.cancel()
        task = Task.detached(priority: .utility) {
            let s = SyncMonitor.inspect(root)
            await MainActor.run {
                guard !Task.isCancelled else { return }
                if SyncMonitor.shared.state != s { SyncMonitor.shared.state = s }
            }
        }
    }

    nonisolated static func inspect(_ root: URL) -> State {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.isUbiquitousItemKey]
        let isUbiquitous = (try? root.resourceValues(forKeys: Set(keys)))?.isUbiquitousItem
            ?? root.path.contains("Mobile Documents")
        guard isUbiquitous else { return .local }
        guard fm.ubiquityIdentityToken != nil else { return .signedOut }

        let itemKeys: Set<URLResourceKey> = [
            .ubiquitousItemIsUploadedKey, .ubiquitousItemIsUploadingKey, .ubiquitousItemIsDownloadingKey,
            .ubiquitousItemUploadingErrorKey, .ubiquitousItemHasUnresolvedConflictsKey, .isDirectoryKey,
        ]
        let dirs = ["数据", "模板"].map { root.appendingPathComponent($0, isDirectory: true) }
        var pending = 0
        var conflicts: [String] = []
        var error: String?
        for dir in dirs {
            guard let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: Array(itemKeys)) else { continue }
            for url in items {
                guard let v = try? url.resourceValues(forKeys: itemKeys), v.isDirectory != true else { continue }
                if v.ubiquitousItemHasUnresolvedConflicts == true { conflicts.append(url.lastPathComponent) }
                if let e = v.ubiquitousItemUploadingError { error = e.localizedDescription }
                if v.ubiquitousItemIsUploading == true || v.ubiquitousItemIsDownloading == true || v.ubiquitousItemIsUploaded == false {
                    pending += 1
                }
            }
        }
        if !conflicts.isEmpty { return .conflict(conflicts) }
        if let error { return .failed(error) }
        if pending > 0 { return .syncing(pending) }
        return .synced(Date())
    }
}
