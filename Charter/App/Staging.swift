import Foundation

/// 待确认的文件。文件先复制到临时区并识别，只有在确认面板点“确认归档”后才写入档案；取消则删除临时副本，档案不受影响。
struct StagedFile: Identifiable {
    let id: String
    let url: URL                      // 临时副本
    let originalName: String
    var recognition: Recognition
    var typeID: String?
    var owner: NodeRef?
    /// 替换哪份旧文件（仅用于展示对比）
    var replaces: Document?
    var form: String = "扫描件"
    /// 确认归档后的回调（回执、证据等）。
    var onArchived: ((Document) -> Void)?
}

extension AppStore {

    /// 复制到临时区并识别。不触碰档案目录。
    func stage(url: URL, typeID: String?, owner: NodeRef?, replaces: Document? = nil, form: String = "扫描件",
               onArchived: ((Document) -> Void)? = nil) async throws -> StagedFile {
        let id = UUID().uuidString
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("CharterStaging/\(id)", isDirectory: true)
        let copy = dir.appendingPathComponent(url.lastPathComponent)
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            try await StorageWorker.perform {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try FileManager.default.copyItem(at: url, to: copy)
            }
        } catch {
            try? FileManager.default.removeItem(at: dir)
            throw error
        }
        let r = await Recognizer.recognize(file: copy, context: recognitionContext)
        let s = StagedFile(id: id, url: copy, originalName: url.lastPathComponent, recognition: r,
                           typeID: typeID ?? r.typeID, owner: owner, replaces: replaces, form: form, onArchived: onArchived)
        staged[id] = s
        return s
    }

    /// 用户明确确认后才写入档案。旧版同类文件会自动标为“旧版”，不删除。
    @discardableResult
    func commitStaged(_ id: String, typeID: String, owner: NodeRef, issued: Day?, expiry: Day?, form: String, note: String = "",
                      keepBoth: Bool = false) async throws -> Document {
        guard let s = staged[id] else { throw CocoaError(.fileNoSuchFile) }
        let requests = [ArchiveRequest(url: s.url, typeID: typeID, owner: owner, issued: issued, expiry: expiry, form: form, note: note,
                                       keepBoth: keepBoth)]
        let before = captureState()
        guard let doc = try await archiveBatch(requests).first else { throw CocoaError(.fileWriteUnknown) }
        discardStaged(id)
        // 这份文件正好是某个补发请求在等的：关闭请求，提示条可撤销整次归档（请求随之回到等回件）
        let received = closeRequests(receiving: [doc])
        if !received.isEmpty {
            let undoID = recordUndo("归档文件", before: before, createdFiles: [doc.filePath])
            showToast("已归档\(docType(doc.typeID)?.name ?? "文件")" + received + "。") { [weak self] in
                if let undoID { self?.undo(undoID) }
            }
        }
        s.onArchived?(doc)
        return doc
    }

    /// 取消：删除临时副本，不改档案。
    func discardStaged(_ id: String) {
        guard let s = staged.removeValue(forKey: id) else { return }
        try? FileManager.default.removeItem(at: s.url.deletingLastPathComponent())
    }
}
