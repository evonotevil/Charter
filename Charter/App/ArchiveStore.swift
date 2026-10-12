import Foundation

extension AppStore {

    /// 文件类型里不算“档案条目”的：回执、规则确认函这类流程附件。
    static let nonArchiveTypeIDs: Set<String> = ["common.receipt", "common.confirmation"]

    // MARK: 法域模板

    /// 某法域的档案条目（按显示顺序）。没有自定义过时，用该法域专属的内置公司类文件。
    func templateItems(for jurisdiction: String) -> [String] {
        if let custom = library.archiveItems?[jurisdiction] {
            return custom.filter { docType($0) != nil }
        }
        return library.documentTypes
            .filter { $0.builtIn && $0.owner == .company && $0.jurisdictions == [jurisdiction] }
            .map(\.id)
    }

    func setTemplateItems(_ ids: [String], for jurisdiction: String) {
        var map = library.archiveItems ?? [:]
        map[jurisdiction] = ids
        library.archiveItems = map
        saveLibrary()
    }

    /// 新建一个条目（文件类型），并加进某法域的模板。
    @discardableResult
    /// - jurisdiction: 要加进哪个法域的通用条目（nil 表示不加进模板）。
    /// - scope: 这个类型适用的法域（nil 时同 jurisdiction；都为 nil 表示所有法域）。
    func createItem(name: String, category: String, jurisdiction: String?, validity: ValidityKind, months: Int?, scope: String? = nil) -> DocumentType {
        let j = scope ?? jurisdiction
        let t = DocumentType(id: "custom.\(UUID().uuidString.prefix(8).lowercased())", name: name,
                             category: category.isEmpty ? name : category, localNames: [],
                             jurisdictions: j.map { [$0] } ?? [], owner: .company,
                             validity: validity, validityMonths: months, hints: [], builtIn: false)
        library.documentTypes.append(t)
        if let j = jurisdiction {
            var ids = templateItems(for: j)
            ids.append(t.id)
            var map = library.archiveItems ?? [:]
            map[j] = ids
            library.archiveItems = map
        }
        saveLibrary()
        return t
    }

    // MARK: 公司档案

    /// 这家公司要管理的条目：法域模板 − 去掉的 + 单独加的。
    func itemIDs(for c: Company) -> [String] {
        let a = c.archive ?? CompanyArchive()
        // 法域模板里只保留适用于这家公司实体类型的条目；手动加入的不受限制
        var ids = templateItems(for: c.jurisdiction).filter {
            !a.removed.contains($0) && (docType($0).map { itemApplies($0, to: c) } ?? true)
        }
        for id in a.added where !ids.contains(id) && docType(id) != nil { ids.append(id) }
        return ids
    }

    /// 因实体类型不适用而没有出现在清单里的法域条目。
    func hiddenByEntityForm(_ c: Company) -> [DocumentType] {
        templateItems(for: c.jurisdiction).compactMap(docType).filter { !itemApplies($0, to: c) }
    }

    /// 档案清单：每个条目一行；已有文件但不在条目里的，附在最后，不会被藏起来。
    func archive(of c: Company) -> [ArchiveItem] {
        // 先读一遍依赖，保证命中缓存时视图仍然订阅这些属性的变化。
        _ = (documents.count, library.documentTypes.count, today, companies.count)
        if let hit = archiveCache[c.id] { return hit }
        let result = computeArchive(of: c)
        archiveCache[c.id] = result
        return result
    }

    private func computeArchive(of c: Company) -> [ArchiveItem] {
        let ref = NodeRef(kind: .company, id: c.id)
        let mine = documents.filter { $0.owner == ref }
        let a = c.archive ?? CompanyArchive()
        let templ = Set(templateItems(for: c.jurisdiction))
        var ids = itemIDs(for: c)
        for d in mine where d.supersededBy == nil && !ids.contains(d.typeID) && !Self.nonArchiveTypeIDs.contains(d.typeID) {
            ids.append(d.typeID)
        }
        return ids.map { id in
            let versions = mine.filter { $0.typeID == id }
            let current = versions.filter { $0.supersededBy == nil }
                .max { ($0.issueDate ?? $0.addedOn) < ($1.issueDate ?? $1.addedOn) }
            let state: ArchiveItem.State
            if let d = current {
                switch freshness(d) {
                case .valid: state = .valid
                case .expiring(let n): state = .expiring(n)
                case .expired(let n): state = .expired(n)
                case .needsUpdate: state = .needsUpdate
                default: state = .noDate
                }
            } else if let m = a.marks[id] {
                state = .marked(m)
            } else {
                state = .missing
            }
            return ArchiveItem(typeID: id, type: docType(id), document: current,
                               olderVersions: versions.count - (current == nil ? 0 : 1),
                               state: state, note: a.notes[id] ?? "", isExtra: !templ.contains(id))
        }
    }

    /// 档案完整度：已归档 / 应有（不适用的不算）。
    func archiveProgress(of c: Company) -> (have: Int, total: Int) {
        // 设立中的公司成立后才开始统计
        if c.isForming { return (0, 0) }
        let items = archive(of: c).filter { $0.state != .marked(.notApplicable) }
        return (items.filter { $0.state.hasFile }.count, items.count)
    }

    private func editArchive(_ companyID: String, _ change: (inout CompanyArchive) -> Void) {
        guard let i = companies.firstIndex(where: { $0.id == companyID }) else { return }
        var a = companies[i].archive ?? CompanyArchive()
        change(&a)
        companies[i].archive = a
        saveCompanies()
    }

    /// 标记原因：直接生效，提示条可撤销，也可以 ⌘Z。
    func setMark(_ mark: ItemMark?, item: String, company: String) {
        let name = docType(item)?.name ?? "条目"
        performUndoable(mark == nil ? "清除标记" : "标记原因",
                        toast: mark.map { "已把“\(name)”标记为\($0.label)" } ?? "已清除“\(name)”的标记") {
            editArchive(company) { $0.marks[item] = mark }
        }
    }

    func setNote(_ note: String, item: String, company: String) {
        editArchive(company) { $0.notes[item] = note.isEmpty ? nil : note }
    }

    /// 只给这家公司加一个条目。
    func addItem(_ typeID: String, to company: String) {
        editArchive(company) { a in
            a.removed.removeAll { $0 == typeID }
            if !a.added.contains(typeID) { a.added.append(typeID) }
        }
    }

    /// 从公司档案清单里去掉一个条目：直接生效，提示条可撤销。
    func dropItem(_ typeID: String, from company: String) {
        let name = docType(typeID)?.name ?? "条目"
        performUndoable("移除条目", toast: "已从这家公司的清单移除“\(name)”") {
            removeItem(typeID, from: company)
        }
    }

    /// 只对这家公司去掉一个条目（已有文件仍保留在“其他文件”里）。
    func removeItem(_ typeID: String, from company: String) {
        editArchive(company) { a in
            a.added.removeAll { $0 == typeID }
            if !a.removed.contains(typeID) { a.removed.append(typeID) }
        }
    }

    // MARK: 总览

    /// 总览表的列：所有公司条目里出现过的类别，按出现次数排序。
    func overviewCategories(for list: [Company]) -> [String] {
        var count: [String: Int] = [:]
        var first: [String: Int] = [:]
        var n = 0
        for c in list {
            for id in itemIDs(for: c) {
                let cat = docType(id)?.category ?? "其他"
                count[cat, default: 0] += 1
                if first[cat] == nil { first[cat] = n; n += 1 }
            }
        }
        return count.keys.sorted { (count[$0]!, -first[$0]!) > (count[$1]!, -first[$1]!) }
    }

    /// 某公司在某类别下的条目（通常一个）。
    func items(of c: Company, category: String, in all: [ArchiveItem]) -> [ArchiveItem] {
        all.filter { ($0.type?.category ?? "其他") == category }
    }

    /// 合规模块是否打开（默认关闭）。
    var complianceOn: Bool { settings.complianceEnabled ?? false }
}
