import Foundation
import AppKit

/// 撤销：每次用户级的数据修改前后各取一份值拷贝（模型都是值类型），只记下真正改动过的集合。
/// 撤销时只写回这些集合，不会把之后对其他集合的修改一起退回。
struct DataState {
    enum Part: String, CaseIterable {
        case companies, people, holdings, appointments, parties, documents, records, changes, groups, settings, library, requests
    }

    var companies: [Company]
    var people: [Person]
    var holdings: [Holding]
    var appointments: [Appointment]
    var parties: [Party]
    var documents: [Document]
    var records: [ObligationRecord]
    var changes: [ChangeRecord]
    var groups: [CorporateGroup]
    var settings: SharedSettings
    var library: TemplateLibrary
    var requests: [DocumentRequest]

    /// 两份状态之间改动过的集合。模板库不是 Equatable，用编码后的数据比较。
    func changedParts(comparedTo other: DataState) -> Set<Part> {
        var out = Set<Part>()
        if companies != other.companies { out.insert(.companies) }
        if people != other.people { out.insert(.people) }
        if holdings != other.holdings { out.insert(.holdings) }
        if appointments != other.appointments { out.insert(.appointments) }
        if parties != other.parties { out.insert(.parties) }
        if documents != other.documents { out.insert(.documents) }
        if records != other.records { out.insert(.records) }
        if changes != other.changes { out.insert(.changes) }
        if groups != other.groups { out.insert(.groups) }
        if settings != other.settings { out.insert(.settings) }
        if requests != other.requests { out.insert(.requests) }
        let e = FolderStore.encoder
        if (try? e.encode(library)) != (try? e.encode(other.library)) { out.insert(.library) }
        return out
    }
}

/// 撤销栈里的一步。
struct UndoEntry: Identifiable {
    let id = UUID()
    var label: String
    var before: DataState
    var after: DataState
    var parts: Set<DataState.Part>
    /// 这一步新复制进数据文件夹的文件（相对路径）。撤销时移到 `.charter-undo/<id>/`，重做时移回。
    var createdFiles: [String] = []
}

extension AppStore {

    static let undoLimit = 20

    func captureState() -> DataState {
        DataState(companies: companies, people: people, holdings: holdings, appointments: appointments,
                  parties: parties, documents: documents, records: records, changes: changes,
                  groups: corporateGroups, settings: settings, library: library, requests: requests)
    }

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }
    var undoLabel: String? { undoStack.last?.label }
    var redoLabel: String? { redoStack.last?.label }

    /// 修改完成后登记一步撤销。没有任何改动（例如保存失败）时不登记，返回 nil。
    @discardableResult
    func recordUndo(_ label: String, before: DataState, createdFiles: [String] = []) -> UUID? {
        let after = captureState()
        let parts = after.changedParts(comparedTo: before)
        guard !parts.isEmpty || !createdFiles.isEmpty else { return nil }
        let entry = UndoEntry(label: label, before: before, after: after, parts: parts, createdFiles: createdFiles)
        undoStack.append(entry)
        if undoStack.count > Self.undoLimit { undoStack.removeFirst(undoStack.count - Self.undoLimit) }
        redoStack.removeAll()
        return entry.id
    }

    /// 执行一段修改并登记撤销。抛错时不登记。
    @discardableResult
    func undoable(_ label: String, _ body: () throws -> Void) rethrows -> UUID? {
        let before = captureState()
        try body()
        return recordUndo(label, before: before)
    }

    /// 直接执行，提示条带“撤销”（10 秒），同时可以 ⌘Z。修改没有生效时不显示提示（原方法自己会报错）。
    func performUndoable(_ label: String, toast: String, _ body: () -> Void) {
        guard let id = undoable(label, body) else { return }
        showToast(toast) { [weak self] in self?.undo(id) }
    }

    // MARK: 撤销与重做

    func undo() {
        guard !isImporting, !isLoading, let entry = undoStack.popLast() else { return }
        apply(entry.before, parts: entry.parts)
        moveCreatedFiles(of: entry, toTrash: true)
        redoStack.append(entry)
        showToast("已撤销\(entry.label)。", kind: .success, actionTitle: "重做") { [weak self] in self?.redo() }
    }

    func redo() {
        guard !isImporting, !isLoading, let entry = redoStack.popLast() else { return }
        moveCreatedFiles(of: entry, toTrash: false)
        apply(entry.after, parts: entry.parts)
        undoStack.append(entry)
        showToast("已重做\(entry.label)。")
    }

    /// 提示条上的“撤销”：只撤销那一步。若它之后还有改动碰过同样的数据，请用户用 ⌘Z 逐步撤销，免得把后面的修改一起退回。
    func undo(_ id: UUID) {
        guard let index = undoStack.firstIndex(where: { $0.id == id }) else {
            showToast("这一步已经无法撤销。", kind: .failure, actionTitle: "撤销", action: nil)
            return
        }
        if index == undoStack.count - 1 { undo(); return }
        let entry = undoStack[index]
        let later = undoStack[(index + 1)...]
        guard later.allSatisfy({ $0.parts.isDisjoint(with: entry.parts) }) else {
            showToast("之后还有相关改动，请用 ⌘Z 逐步撤销。", kind: .failure, actionTitle: "撤销", action: nil)
            return
        }
        guard !isImporting, !isLoading else { return }
        undoStack.remove(at: index)
        apply(entry.before, parts: entry.parts)
        moveCreatedFiles(of: entry, toTrash: true)
        showToast("已撤销\(entry.label)。")
    }

    /// 重新载入（另一台 Mac 改过数据、恢复快照、换数据文件夹）后，旧的撤销步骤不再适用。
    func clearUndoHistory() {
        undoStack.removeAll()
        redoStack.removeAll()
    }

    private func apply(_ state: DataState, parts: Set<DataState.Part>) {
        for part in parts {
            switch part {
            case .companies: companies = state.companies; persist(companies, "companies")
            case .people: people = state.people; persist(people, "people")
            case .holdings: holdings = state.holdings; persist(holdings, "holdings")
            case .appointments: appointments = state.appointments; persist(appointments, "appointments")
            case .parties: parties = state.parties; persist(parties, "parties")
            case .documents: documents = state.documents; persist(documents, "documents")
            case .records: records = state.records; persist(records, "obligations")
            case .changes: changes = state.changes; persist(changes, "changes")
            case .groups: corporateGroups = state.groups; persist(corporateGroups, "groups")
            case .settings: settings = state.settings; persist(settings, "settings")
            case .library: library = state.library; saveLibrary()
            case .requests: requests = state.requests; persist(requests, "requests")
            }
        }
        refreshDerived()
    }

    // MARK: 导入复制的文件

    /// 撤销归档时，把这次复制进来的文件移到数据文件夹里隐藏的 `.charter-undo/<步骤>/`（不直接删除），重做时移回。
    /// 只动这一步自己创建的文件；原始文件从未被改动。超过 30 天的撤销区在启动时清理。
    private func moveCreatedFiles(of entry: UndoEntry, toTrash: Bool) {
        guard !entry.createdFiles.isEmpty else { return }
        let fm = FileManager.default
        let trash = store.root.appendingPathComponent(".charter-undo", isDirectory: true)
            .appendingPathComponent(entry.id.uuidString, isDirectory: true)
        var failed = 0
        for rel in entry.createdFiles {
            let live = store.absoluteURL(for: rel)
            let parked = trash.appendingPathComponent(rel)
            let (from, to) = toTrash ? (live, parked) : (parked, live)
            guard fm.fileExists(atPath: from.path), !fm.fileExists(atPath: to.path) else { continue }
            do {
                try fm.createDirectory(at: to.deletingLastPathComponent(), withIntermediateDirectories: true)
                try fm.moveItem(at: from, to: to)
            } catch { failed += 1 }
        }
        if failed > 0 {
            errorMessage = "有 \(failed) 个文件没能移动，档案记录已\(toTrash ? "撤销" : "恢复")。可以在访达中检查数据文件夹。"
        }
    }

    /// 启动时清理 30 天前的撤销区。
    nonisolated static func pruneUndoArea(root: URL) {
        let fm = FileManager.default
        let dir = root.appendingPathComponent(".charter-undo", isDirectory: true)
        guard let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let cutoff = Date().addingTimeInterval(-30 * 24 * 3600)
        for item in items {
            let date = (try? item.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            if date < cutoff { try? fm.removeItem(at: item) }
        }
    }
}

/// 编辑菜单的 ⌘Z / ⇧⌘Z。替换了系统的撤销菜单项，所以先看文本框：
/// 正在输入文字时把 undo:/redo: 交给响应链（文本框自己的撤销），否则撤销 Charter 的数据修改。
@MainActor
enum EditUndo {
    static var isEditingText: Bool {
        guard let responder = NSApp.keyWindow?.firstResponder as? NSTextView else { return false }
        return responder.isEditable
    }

    static func undo(_ store: AppStore) {
        if isEditingText, NSApp.sendAction(Selector(("undo:")), to: nil, from: nil) { return }
        if store.canUndo { store.undo() } else { NSSound.beep() }
    }

    static func redo(_ store: AppStore) {
        if isEditingText, NSApp.sendAction(Selector(("redo:")), to: nil, from: nil) { return }
        if store.canRedo { store.redo() } else { NSSound.beep() }
    }
}
