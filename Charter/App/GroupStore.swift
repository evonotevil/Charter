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

    /// 把一家公司归入集团（还没连上持股关系时显示为“待连接”）。
    func add(companyID: String, to groupID: String) {
        guard let i = corporateGroups.firstIndex(where: { $0.id == groupID }) else { return }
        if !companyIDs(in: corporateGroups[i]).contains(companyID) {
            corporateGroups[i].extraCompanyIDs.append(companyID)
            saveGroups()
        }
    }

    /// 连上持股关系后，清理已经能自动推导出来的“待连接”。
    func tidyGroups() {
        var changed = false
        for i in corporateGroups.indices {
            let reach = Set(GroupEngine.rows(for: CorporateGroup(name: "", tops: corporateGroups[i].tops), holdings: holdings, companies: companies, on: today).map(\.companyID))
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
