import Foundation

/// 没有完成的导入：关闭导入窗口时保存，回来可以直接继续，不必重新识别。
///
/// 存在数据文件夹的 `.pending-import.json`（隐藏文件）。文件位置是这台 Mac 上的，
/// 所以记下设备 ID，另一台 Mac 通过 iCloud 看到它时忽略。
/// 每个文件同时保存路径和书签（bookmark）：文件被改名或移动后，书签仍能找到它。
/// 应用没有启用沙盒，不需要 security-scoped 书签；普通书签即可。
struct PendingImport: Codable {
    struct Row: Codable {
        var item: ImportItem
        var path: String
        var bookmark: Data?
    }

    var deviceID: String
    var savedAt: Date
    var context: Router.ImportContext?
    var rows: [Row]
    var drafts: [CompanyDraft]

    /// 还要处理的文件数：勾选了、尚未归档的。
    var remaining: Int { rows.filter { $0.item.include }.count }

    static func == (a: PendingImport, b: PendingImport) -> Bool {
        a.savedAt == b.savedAt && a.rows.map(\.path) == b.rows.map(\.path)
    }

    init(deviceID: String, context: Router.ImportContext?, items: [ImportItem], drafts: [CompanyDraft]) {
        self.deviceID = deviceID
        self.savedAt = Date()
        self.context = context
        self.drafts = drafts
        self.rows = items.map { item in
            Row(item: item, path: item.url.path,
                bookmark: try? item.url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil))
        }
    }

    /// 找回文件：先用书签，再用原路径。找不到的文件取消勾选，并在依据里说明。
    func resolvedItems() -> [ImportItem] {
        rows.map { row in
            var item = row.item
            var url: URL?
            if let data = row.bookmark {
                var stale = false
                url = try? URL(resolvingBookmarkData: data, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale)
            }
            if url == nil || !FileManager.default.fileExists(atPath: url!.path) {
                url = FileManager.default.fileExists(atPath: row.path) ? URL(fileURLWithPath: row.path) : nil
            }
            if let url {
                item.url = url
            } else {
                item.url = URL(fileURLWithPath: row.path)
                item.include = false
                item.missing = true
            }
            return item
        }
    }
}

extension AppStore {

    private var pendingImportURL: URL { store.root.appendingPathComponent(".pending-import.json") }

    func loadPendingImport() {
        guard let data = try? Data(contentsOf: pendingImportURL) else { pendingImport = nil; return }
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        guard let draft = try? d.decode(PendingImport.self, from: data), draft.deviceID == deviceID, !draft.rows.isEmpty else {
            pendingImport = nil
            return
        }
        pendingImport = draft
    }

    /// 保存草稿；没有可继续的行时删除草稿。
    func savePendingImport(_ draft: PendingImport?) {
        guard let draft, draft.rows.contains(where: { $0.item.recognized }) else {
            try? FileManager.default.removeItem(at: pendingImportURL)
            pendingImport = nil
            return
        }
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        do {
            try e.encode(draft).write(to: pendingImportURL, options: .atomic)
            pendingImport = draft
        } catch {
            // 写不进去也不打断用户：草稿只留在内存里，本次运行期间仍可继续
            pendingImport = draft
        }
    }

    /// 放弃上次的导入，提示条可撤销（把草稿写回去）。
    func discardPendingImport() {
        guard let draft = pendingImport else { return }
        savePendingImport(nil)
        showToast("已放弃上次的导入，原文件没有改动。") { [weak self] in self?.savePendingImport(draft) }
    }
}
