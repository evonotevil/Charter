import Foundation

extension AppStore {

    // MARK: 查询

    func group(_ id: String?) -> CorporateGroup? { corporateGroups.first { $0.id == id } }

    /// 集团里的公司，按层级排好。
    func rows(of g: CorporateGroup, on day: Day? = nil) -> [GroupRow] {
        GroupEngine.rows(for: g, holdings: holdings, companies: companies, on: day ?? today)
    }

    func companyIDs(in g: CorporateGroup, on day: Day? = nil) -> Set<String> {
        Set(rows(of: g, on: day).map(\.companyID))
    }

    /// 包含这家公司的所有集团（股权重合时会有多个）。
    func groups(containing companyID: String) -> [CorporateGroup] {
        corporateGroups.filter { companyIDs(in: $0).contains(companyID) }
    }

    /// 不属于任何集团的公司。
    var ungroupedCompanies: [Company] {
        let inAny = corporateGroups.reduce(into: Set<String>()) { $0.formUnion(companyIDs(in: $1)) }
        return companies.filter { !inAny.contains($0.id) }.sorted { $0.name < $1.name }
    }

    /// 侧栏选中的集团对应的公司；nil 表示全部公司。
    func companyIDs(forFilter filter: String?, on day: Day? = nil) -> Set<String>? {
        guard let filter else { return nil }
        if filter == Router.ungrouped { return Set(ungroupedCompanies.map(\.id)) }
        guard let g = group(filter) else { return nil }
        return companyIDs(in: g, on: day)
    }

    /// 唯一的“需处理”口径：当前集团范围内、过期/快过期/需更新/日期待核对的公司文件。
    /// 总览主指标、侧栏“文件”角标、文件页“需处理 N”都用这个数。
    func attentionCompanyDocuments(forFilter filter: String?) -> [Document] {
        let scope = companyIDs(forFilter: filter)
        return documentsNeedingAttention.filter {
            $0.owner.kind == .company && (scope?.contains($0.owner.id) ?? true)
        }
    }

    func attentionCount(forFilter filter: String?) -> Int { attentionCompanyDocuments(forFilter: filter).count }

    /// 个人文件的需处理数，只作为总览主指标的次要一行。
    var attentionPersonalCount: Int { documentsNeedingAttention.filter { $0.owner.kind == .person }.count }

    func filterName(_ filter: String?) -> String {
        guard let filter else { return "全部公司" }
        if filter == Router.ungrouped { return "未归入集团" }
        return group(filter)?.name ?? "全部公司"
    }

    func topLabel(_ g: CorporateGroup) -> String {
        g.tops.map { name(of: $0) }.joined(separator: "、")
    }

    // MARK: 修改

    @discardableResult
    func createGroup(name: String, top: NodeRef) -> CorporateGroup {
        let g = CorporateGroup(name: name, tops: [top])
        corporateGroups.append(g)
        saveGroups()
        return g
    }

    func update(_ g: CorporateGroup) {
        if let i = corporateGroups.firstIndex(where: { $0.id == g.id }) { corporateGroups[i] = g } else { corporateGroups.append(g) }
        saveGroups()
    }

    func delete(group g: CorporateGroup) {
        corporateGroups.removeAll { $0.id == g.id }
        saveGroups()
    }

    /// 把一家公司归入集团（还没连上持股关系时显示为“待连接”）。排除过的会先恢复。
    func add(companyID: String, to groupID: String) {
        guard let i = corporateGroups.firstIndex(where: { $0.id == groupID }) else { return }
        var g = corporateGroups[i]
        g.excludedCompanyIDs = g.excludedCompanyIDs?.filter { $0 != companyID }
        corporateGroups[i] = g
        if !companyIDs(in: g).contains(companyID) {
            corporateGroups[i].extraCompanyIDs.append(companyID)
        }
        saveGroups()
    }

    /// 只移除手动归入的公司；由顶层或持股推导的归属不在这里改动。
    func canRemove(companyID: String, from groupID: String) -> Bool {
        group(groupID)?.extraCompanyIDs.contains(companyID) == true
    }

    @discardableResult
    func remove(companyID: String, from groupID: String) -> Bool {
        guard canRemove(companyID: companyID, from: groupID),
              let i = corporateGroups.firstIndex(where: { $0.id == groupID }) else { return false }
        corporateGroups[i].extraCompanyIDs.removeAll { $0 == companyID }
        saveGroups()
        return true
    }

    /// 把公司移出集团（任何来源）：手动加入的直接去掉；股权推导出来的记为“已排除”。返回一句结果说明。
    @discardableResult
    func moveOut(companyID: String, from groupID: String) -> String {
        guard let i = corporateGroups.firstIndex(where: { $0.id == groupID }) else { return "" }
        let m = membership(of: companyID, in: corporateGroups[i])
        var g = corporateGroups[i]
        g.extraCompanyIDs.removeAll { $0 == companyID }
        if case .top = m { g.tops.removeAll { $0 == NodeRef(kind: .company, id: companyID) } }
        // 仍能经股权推导到时，记为排除，避免下次又被自动纳入
        let reach = companyIDs(in: CorporateGroup(name: "", tops: g.tops, excludedCompanyIDs: g.excludedCompanyIDs))
        if reach.contains(companyID) || m == .excluded {
            g.excludedCompanyIDs = Array(Set((g.excludedCompanyIDs ?? []) + [companyID])).sorted()
        }
        corporateGroups[i] = g
        saveGroups()
        let rest = groups(containing: companyID).map(\.name)
        let base = "已从\(g.name)移出"
        return rest.isEmpty ? base + "，现在不属于任何集团" : base + "，仍属于" + rest.joined(separator: "、")
    }

    /// 撤销排除，恢复为按股权推导。
    func restore(companyID: String, in groupID: String) {
        guard let i = corporateGroups.firstIndex(where: { $0.id == groupID }) else { return }
        corporateGroups[i].excludedCompanyIDs = corporateGroups[i].excludedCompanyIDs?.filter { $0 != companyID }
        saveGroups()
    }

    /// 这家公司在这个集团里的来源。
    func membership(of companyID: String, in g: CorporateGroup) -> GroupMembership {
        if g.excluded.contains(companyID) { return .excluded }
        let all = rows(of: g)
        guard let row = all.first(where: { $0.companyID == companyID }) else { return .none }
        if row.unconnected { return .manual }
        if row.parent == nil, g.tops.contains(NodeRef(kind: .company, id: companyID)) { return .top }
        var path: [NodeRef] = [NodeRef(kind: .company, id: companyID)]
        var percents: [Double] = []
        var cur = row
        var guardCount = 0
        while let parent = cur.parent, guardCount < 64 {
            guardCount += 1
            percents.insert(cur.percent ?? 0, at: 0)
            path.insert(parent, at: 0)
            guard parent.kind == .company, let next = all.first(where: { $0.companyID == parent.id }) else { break }
            cur = next
        }
        return .derived(path: path, percents: percents)
    }

    /// 一句话说明归属来源，例如“经 远澜控股 60% → 远澜香港 100%”。
    func membershipExplanation(of companyID: String, in g: CorporateGroup) -> String {
        switch membership(of: companyID, in: g) {
        case .top: return "你把它设为\(g.name)的顶层"
        case .manual: return "你手动加入，还没连上集团里的持股关系"
        case .excluded: return "股权能推导到，但你把它排除在\(g.name)之外"
        case .none: return "不在\(g.name)"
        case .derived(let path, let percents):
            var parts: [String] = []
            for (k, node) in path.dropLast().enumerated() {
                parts.append("\(name(of: node)) 持有 \(AppStore.percentText(percents[k]))")
            }
            return parts.joined(separator: " → ") + " → 这家公司"
        }
    }

    /// 能经股权推导到、但被排除的公司（用于在结构图上显示为灰色）。
    func excludedCompanyIDs(in g: CorporateGroup) -> Set<String> { g.excluded }

    static func percentText(_ p: Double) -> String {
        p == p.rounded() ? "\(Int(p))%" : String(format: "%.2f%%", p)
    }

    /// 连上持股关系后，清理已经能自动推导出来的“待连接”。
    func tidyGroups() {
        var changed = false
        for i in corporateGroups.indices {
            let reach = Set(GroupEngine.rows(for: CorporateGroup(name: "", tops: corporateGroups[i].tops, excludedCompanyIDs: corporateGroups[i].excludedCompanyIDs), holdings: holdings, companies: companies, on: today).map(\.companyID))
            let before = corporateGroups[i].extraCompanyIDs
            corporateGroups[i].extraCompanyIDs = before.filter { !reach.contains($0) && company($0) != nil }
            if before != corporateGroups[i].extraCompanyIDs { changed = true }
        }
        if changed { saveGroups() }
    }

    @discardableResult
    func createCompany(name: String, jurisdiction: String) -> Company {
        let c = Company(name: name, jurisdiction: jurisdiction, trackingSince: today)
        companies.append(c)
        saveCompanies()
        return c
    }

    @discardableResult
    func createPerson(name: String) -> Person {
        let p = Person(name: name)
        people.append(p)
        savePeople()
        return p
    }

    /// 新增一条持股：holder 持有 companyID 的 percent%。
    @discardableResult
    func addHolding(holder: NodeRef, companyID: String, percent: Double, nominee: Bool, beneficialOwner: NodeRef?, from: Day?) -> Bool {
        var h = Holding(holder: holder, companyID: companyID, percent: percent, isNominee: nominee, from: from)
        if nominee { h.beneficialOwner = beneficialOwner }
        do {
            try HoldingValidation.validate(holdings + [h],
                                           companyIDs: Set(companies.map(\.id)),
                                           personIDs: Set(people.map(\.id)),
                                           changedCompanyIDs: [companyID])
        } catch {
            errorMessage = "无法添加持股：\(error.localizedDescription)"
            return false
        }
        holdings.append(h)
        saveHoldings()
        tidyGroups()
        refreshDerived()
        return true
    }

    // MARK: 迁移

    /// 1.x 的“所属集团”是一段文字。按文字分组，以每组里没有组内上级的公司为顶层。
    static func legacyGroups(companies: [Company], holdings: [Holding], today: Day) -> [CorporateGroup] {
        let names = Array(Set(companies.map(\.group).filter { !$0.isEmpty })).sorted()
        return names.map { name in
            let members = Set(companies.filter { $0.group == name }.map(\.id))
            let active = holdings.filter { $0.isActive(on: today) }
            let roots = members.filter { id in
                !active.contains { $0.companyID == id && $0.holder.kind == .company && members.contains($0.holder.id) }
            }
            let nameOf = { (id: String) in companies.first { $0.id == id }?.name ?? "" }
            var g = CorporateGroup(name: name, tops: roots.sorted { nameOf($0) < nameOf($1) }.map { NodeRef(kind: .company, id: $0) })
            let reach = Set(GroupEngine.rows(for: g, holdings: holdings, companies: companies, on: today).map(\.companyID))
            g.extraCompanyIDs = members.subtracting(reach).sorted()
            return g
        }
    }
}
