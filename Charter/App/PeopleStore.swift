import Foundation

extension AppStore {

    /// 这个人被多少记录引用（任职、持股、代持、文件、集团顶层）。
    func referenceCount(person id: String) -> Int {
        let ref = NodeRef(kind: .person, id: id)
        return appointments.filter { $0.personID == id }.count
            + holdings.filter { $0.holder == ref || $0.beneficialOwner == ref }.count
            + documents.filter { $0.owner == ref }.count
            + corporateGroups.filter { $0.tops.contains(ref) }.count
    }

    /// 不能删除这个人的原因，逐条写成人能读懂的话；与 referenceCount 统计同样几类引用。空数组表示可以删除。
    func deletionBlockers(person id: String) -> [String] {
        let ref = NodeRef(kind: .person, id: id)
        var out: [String] = []
        for g in corporateGroups where g.tops.contains(ref) {
            out.append("是“\(g.name)”的顶层")
        }
        let mine = appointments.filter { $0.personID == id }
        let currentCompanies = Set(mine.filter { $0.isActive(on: today) }.map(\.companyID))
        let pastCompanies = Set(mine.map(\.companyID)).subtracting(currentCompanies)
        if !currentCompanies.isEmpty { out.append("任职 \(currentCompanies.count) 家公司") }
        if !pastCompanies.isEmpty { out.append("曾在 \(pastCompanies.count) 家公司任职") }
        let held = Set(holdings.filter { $0.holder == ref }.map(\.companyID))
        if !held.isEmpty { out.append("直接持有 \(held.count) 家公司") }
        let beneficial = holdings.filter { $0.beneficialOwner == ref && $0.holder != ref }.count
        if beneficial > 0 { out.append("是 \(beneficial) 笔代持的实际受益人") }
        let docs = documents.filter { $0.owner == ref }.count
        if docs > 0 { out.append("是 \(docs) 份文件的归属人") }
        return out
    }

    /// 合并时会搬到目标人员名下的内容，逐条列出。
    func mergeEffects(person id: String) -> [String] {
        let ref = NodeRef(kind: .person, id: id)
        var out: [String] = []
        let roles = appointments.filter { $0.personID == id }.count
        if roles > 0 { out.append("\(roles) 条任职记录") }
        let held = holdings.filter { $0.holder == ref }.count
        if held > 0 { out.append("\(held) 条持股记录") }
        let beneficial = holdings.filter { $0.beneficialOwner == ref && $0.holder != ref }.count
        if beneficial > 0 { out.append("\(beneficial) 笔代持的实际受益人") }
        let docs = documents.filter { $0.owner == ref }.count
        if docs > 0 { out.append("\(docs) 份文件") }
        for g in corporateGroups where g.tops.contains(ref) {
            out.append("“\(g.name)”的顶层")
        }
        return out
    }

    /// 用来区分同名人员的一家公司：优先现任职务的公司，其次直接持股的公司；都没有时为 nil。
    func anchorCompanyName(person id: String) -> String? {
        let ref = NodeRef(kind: .person, id: id)
        let roleNames = appointments.filter { $0.personID == id && $0.isActive(on: today) }
            .map { name(of: NodeRef(kind: .company, id: $0.companyID)) }.sorted()
        if let first = roleNames.first { return first }
        let heldNames = holdings.filter { $0.holder == ref && $0.isActive(on: today) }
            .map { name(of: NodeRef(kind: .company, id: $0.companyID)) }.sorted()
        return heldNames.first
    }

    /// 选择人员时的区分提示：“任职 1 家”“持股 2 家”或“未关联”。
    func personHint(person id: String) -> String {
        let ref = NodeRef(kind: .person, id: id)
        let roles = Set(appointments.filter { $0.personID == id && $0.isActive(on: today) }.map(\.companyID)).count
        let held = Set(holdings.filter { $0.holder == ref && $0.isActive(on: today) }.map(\.companyID)).count
        let parts = [roles > 0 ? "任职 \(roles) 家" : nil, held > 0 ? "持股 \(held) 家" : nil].compactMap { $0 }
        return parts.isEmpty ? "未关联" : parts.joined(separator: "，")
    }

    /// 删除没有任何引用的人员。
    func deletePerson(_ id: String) {
        guard referenceCount(person: id) == 0 else { return }
        let name = person(id)?.name ?? ""
        performUndoable("删除人员", toast: name.isEmpty ? "已删除。" : "已删除“\(name)”。") {
            people.removeAll { $0.id == id }
            savePeople()
        }
    }

    /// 把 from 合并进 into：任职、持股、代持、文件、集团顶层都改到 into 名下，from 的姓名记为别名。
    func mergePerson(_ from: String, into: String) {
        guard from != into, let src = person(from), let i = people.firstIndex(where: { $0.id == into }) else { return }
        let a = NodeRef(kind: .person, id: from), b = NodeRef(kind: .person, id: into)
        for k in appointments.indices where appointments[k].personID == from { appointments[k].personID = into }
        for k in holdings.indices {
            if holdings[k].holder == a { holdings[k].holder = b }
            if holdings[k].beneficialOwner == a { holdings[k].beneficialOwner = b }
        }
        for k in documents.indices where documents[k].owner == a { documents[k].owner = b }
        for k in corporateGroups.indices {
            corporateGroups[k].tops = corporateGroups[k].tops.map { $0 == a ? b : $0 }
                .reduce(into: [NodeRef]()) { if !$0.contains($1) { $0.append($1) } }
        }
        var names = people[i].aliases
        for n in [src.name] + src.aliases where n != people[i].name && !names.contains(n) { names.append(n) }
        people[i].aliases = names
        people.removeAll { $0.id == from }
        savePeople(); saveAppointments(); saveHoldings(); saveDocuments(); saveGroups()
        refreshDerived()
        showToast("已合并到 \(people.first { $0.id == into }?.name ?? "")。")
    }
}
