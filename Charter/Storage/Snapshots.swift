import Foundation
import AppKit

/// 一份本地快照：数据文件夹里 `.snapshots/<yyyy-MM-dd HHmmss>/` 下的 JSON 副本（不含 PDF）。
///
///     .snapshots/2026-10-11 143205/
///       info.json                 ← 原因、时间、公司数、文件数
///       数据/*.json
///       模板/templates.json
///
/// 用点开头的隐藏文件夹，iCloud 和访达里默认看不到，不会被误删或误当成档案。
struct DataSnapshot: Identifiable, Hashable {
    var id: String { folder.lastPathComponent }
    var folder: URL
    var date: Date
    var reason: String
    var companies: Int?
    var documents: Int?
}

enum Snapshots {
    static let keep = 20
    static let folderName = ".snapshots"

    private struct Info: Codable {
        var reason: String
        var date: Date
        var companies: Int?
        var documents: Int?
    }

    static func directory(_ folder: FolderStore) -> URL {
        folder.root.appendingPathComponent(folderName, isDirectory: true)
    }

    private static var nameFormatter: DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HHmmss"
        return f
    }

    /// 复制所有 JSON 数据文件，写入说明，然后只保留最近 20 份。
    @discardableResult
    static func make(_ folder: FolderStore, reason: String) throws -> DataSnapshot {
        let fm = FileManager.default
        let now = Date()
        var target = directory(folder).appendingPathComponent(nameFormatter.string(from: now), isDirectory: true)
        var n = 2
        while fm.fileExists(atPath: target.path) {
            target = directory(folder).appendingPathComponent(nameFormatter.string(from: now) + "-\(n)", isDirectory: true)
            n += 1
        }
        let dataTarget = target.appendingPathComponent("数据", isDirectory: true)
        let templateTarget = target.appendingPathComponent("模板", isDirectory: true)
        try fm.createDirectory(at: dataTarget, withIntermediateDirectories: true)
        try fm.createDirectory(at: templateTarget, withIntermediateDirectories: true)
        do {
            for file in (try? fm.contentsOfDirectory(at: folder.dataDir, includingPropertiesForKeys: nil)) ?? []
            where file.pathExtension.lowercased() == "json" {
                try fm.copyItem(at: file, to: dataTarget.appendingPathComponent(file.lastPathComponent))
            }
            if fm.fileExists(atPath: folder.templatesFile.path) {
                try fm.copyItem(at: folder.templatesFile, to: templateTarget.appendingPathComponent(folder.templatesFile.lastPathComponent))
            }
            let info = Info(reason: reason, date: now,
                            companies: count(dataTarget.appendingPathComponent("companies.json")),
                            documents: count(dataTarget.appendingPathComponent("documents.json")))
            let e = JSONEncoder()
            e.dateEncodingStrategy = .iso8601
            try e.encode(info).write(to: target.appendingPathComponent("info.json"), options: .atomic)
            prune(folder)
            return DataSnapshot(folder: target, date: now, reason: reason, companies: info.companies, documents: info.documents)
        } catch {
            try? fm.removeItem(at: target)
            throw error
        }
    }

    private static func count(_ url: URL) -> Int? {
        guard let data = try? Data(contentsOf: url),
              let array = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return nil }
        return array.count
    }

    /// 最新的在前。
    static func list(_ folder: FolderStore) -> [DataSnapshot] {
        let fm = FileManager.default
        let dirs = (try? fm.contentsOfDirectory(at: directory(folder), includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])) ?? []
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return dirs.compactMap { dir -> DataSnapshot? in
            guard let data = try? Data(contentsOf: dir.appendingPathComponent("info.json")),
                  let info = try? d.decode(Info.self, from: data) else { return nil }
            return DataSnapshot(folder: dir, date: info.date, reason: info.reason, companies: info.companies, documents: info.documents)
        }
        .sorted { $0.date > $1.date }
    }

    static func prune(_ folder: FolderStore) {
        for old in list(folder).dropFirst(keep) { try? FileManager.default.removeItem(at: old.folder) }
        // 没有 info.json 的残留目录（写到一半中断）也清掉，但只清 1 天以前的
        let fm = FileManager.default
        let cutoff = Date().addingTimeInterval(-24 * 3600)
        for dir in (try? fm.contentsOfDirectory(at: directory(folder), includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles])) ?? []
        where !fm.fileExists(atPath: dir.appendingPathComponent("info.json").path) {
            let date = (try? dir.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            if date < cutoff { try? fm.removeItem(at: dir) }
        }
    }

    /// 今天还没有快照。
    static func needsDaily(_ folder: FolderStore) -> Bool {
        guard let latest = list(folder).first else { return true }
        return !Calendar.current.isDateInToday(latest.date)
    }

    /// 把快照里的 JSON 写回数据文件夹。快照里没有的集合文件会被移除（回到当时“还没有这份文件”的状态）。
    /// 调用方负责先给当前状态做一份快照，并在之后重新载入。
    static func restore(_ snapshot: DataSnapshot, into folder: FolderStore) throws {
        let fm = FileManager.default
        let source = snapshot.folder.appendingPathComponent("数据", isDirectory: true)
        let files = try fm.contentsOfDirectory(at: source, includingPropertiesForKeys: nil).filter { $0.pathExtension.lowercased() == "json" }
        guard !files.isEmpty else { throw CocoaError(.fileReadCorruptFile) }
        try folder.prepare()
        let names = Set(files.map(\.lastPathComponent))
        for file in files {
            try Data(contentsOf: file).write(to: folder.dataDir.appendingPathComponent(file.lastPathComponent), options: .atomic)
        }
        for existing in (try? fm.contentsOfDirectory(at: folder.dataDir, includingPropertiesForKeys: nil)) ?? []
        where existing.pathExtension.lowercased() == "json" && !names.contains(existing.lastPathComponent) {
            try fm.removeItem(at: existing)
        }
        let template = snapshot.folder.appendingPathComponent("模板", isDirectory: true)
            .appendingPathComponent(folder.templatesFile.lastPathComponent)
        if fm.fileExists(atPath: template.path) {
            try Data(contentsOf: template).write(to: folder.templatesFile, options: .atomic)
        }
    }
}

extension AppStore {

    /// 读取成功之后：清理撤销区、每天一次的自动快照、刷新快照列表、读取未完成的导入。
    func afterLoad() {
        let folder = store
        let root = folder.root
        loadPendingImport()
        Task { [weak self] in
            let list = try? await StorageWorker.perform { () -> [DataSnapshot] in
                AppStore.pruneUndoArea(root: root)
                if Snapshots.needsDaily(folder) { try? Snapshots.make(folder, reason: "每日自动备份") }
                return Snapshots.list(folder)
            }
            guard let self, self.store.root == root else { return }
            self.snapshots = list ?? []
        }
    }

    func refreshSnapshots() {
        snapshots = Snapshots.list(store)
    }

    /// 批量或不可逆操作之前调用：同步写一份快照。失败只提示，不阻止操作。
    @discardableResult
    func snapshotBeforeChange(_ reason: String) -> Bool {
        guard !loadFailed, !isLoading else { return false }
        do {
            try Snapshots.make(store, reason: reason)
            refreshSnapshots()
            return true
        } catch {
            errorMessage = "自动备份没有写成：\(error.localizedDescription)。操作仍会继续；可以在设置的“备份与恢复”里手动备份。"
            return false
        }
    }

    func backUpNow() {
        guard !loadFailed, !isLoading else { errorMessage = "数据还没有正常载入，暂不能备份。"; return }
        do {
            try Snapshots.make(store, reason: "手动备份")
            refreshSnapshots()
            showToast("已备份当前数据。")
        } catch {
            showToast("备份没有写成：\(error.localizedDescription)", kind: .failure, actionTitle: "重试") { [weak self] in self?.backUpNow() }
        }
    }

    func revealSnapshots() {
        let dir = Snapshots.directory(store)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        NSWorkspace.shared.activateFileViewerSelecting([snapshots.first?.folder ?? dir])
    }

    /// 恢复：先把当前状态存一份快照，再写回快照里的 JSON，然后重新载入。
    func restore(snapshot: DataSnapshot) {
        guard !isImporting else { errorMessage = "文件正在归档，请完成后再恢复。"; return }
        guard !isLoading else { return }
        do {
            if !loadFailed { try Snapshots.make(store, reason: "恢复到 \(Self.snapshotTitle(snapshot.date)) 之前") }
            try Snapshots.restore(snapshot, into: store)
        } catch {
            errorMessage = "恢复失败：\(error.localizedDescription)。当前数据没有被覆盖，或已在“备份与恢复”里留有恢复前的快照。"
            refreshSnapshots()
            return
        }
        refreshSnapshots()
        load()
        NotificationCenter.default.post(name: .charterDataCleared, object: nil)
        showToast("已恢复到 \(Self.snapshotTitle(snapshot.date)) 的状态。")
    }

    /// “10 月 11 日 14:32”；不是今年时带年份。
    static func snapshotTitle(_ date: Date) -> String {
        let cal = Calendar.current
        let c = cal.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let time = String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
        let thisYear = cal.component(.year, from: Date())
        let year = c.year == thisYear ? "" : "\(c.year ?? thisYear) 年 "
        return "\(year)\(c.month ?? 1) 月 \(c.day ?? 1) 日 \(time)"
    }
}
