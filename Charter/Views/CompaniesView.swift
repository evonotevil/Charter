import SwiftUI
import AppKit
import UniformTypeIdentifiers

struct CompaniesView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @State private var query = ""
    @FocusState private var searchFocused: Bool
    @Namespace private var railNS
    /// 选中底色所在的行：跟随 router.selectedCompanyID 单独做动画，详情本身即时切换。
    @State private var highlightID: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private func matches(_ c: Company) -> Bool {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        return q.isEmpty || c.searchText.contains(q) || store.jurisdictionName(c.jurisdiction).contains(q)
    }

    private var filtered: [Company] {
        let scope = store.companyIDs(forFilter: router.groupFilter)
        return store.companies.filter { matches($0) && (scope?.contains($0.id) ?? true) }.sorted { $0.name < $1.name }
    }

    private var sections: [(id: String, title: String, rows: [GroupRow])] {
        var out: [(String, String, [GroupRow])] = []
        let groups = router.groupFilter == nil ? store.corporateGroups : store.corporateGroups.filter { $0.id == router.groupFilter }
        for g in groups {
            let rows = store.rows(of: g).filter { r in store.company(r.companyID).map(matches) ?? false }
            if !rows.isEmpty { out.append((g.id, g.name, rows)) }
        }
        if router.groupFilter == nil || router.groupFilter == Router.ungrouped {
            let un = store.ungroupedCompanies.filter(matches)
                .map { GroupRow(companyID: $0.id, depth: 0, parent: nil, percent: nil, viaNominee: false, unconnected: false) }
            if !un.isEmpty { out.append((Router.ungrouped, "未归入集团", un)) }
        }
        return out.map { (id: $0.0, title: $0.1, rows: $0.2) }
    }

    var body: some View {
        @Bindable var router = router
        VStack(alignment: .leading, spacing: 0) {
            PageHeader(title: "公司") {
                PillSegmented(options: [(Router.CompaniesMode.list, "列表"), (Router.CompaniesMode.matrix, "矩阵"), (Router.CompaniesMode.structure, "结构")],
                              selection: $router.companiesMode)
                    .help("列表：逐家查看；矩阵：公司 × 档案类别一览；结构：股权结构图")
            }
            .padding(.horizontal, Space.pageEdge).padding(.top, Space.xl24)
            .padding(.bottom, router.companiesMode == .structure ? 0 : Space.xl24)
            Group {
                switch router.companiesMode {
                case .list: companyList
                case .matrix: OverviewView()
                case .structure: StructureView(embedded: true)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    private var companyList: some View {
        GeometryReader { geometry in
        let sections = self.sections
        let firstSection: [String: (id: String, title: String)] = sections.reduce(into: [:]) { acc, sec in
            for r in sec.rows where acc[r.companyID] == nil { acc[r.companyID] = (id: sec.id, title: sec.title) }
        }
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: Space.s8) {
                HStack(spacing: Space.s8) {
                    Button { searchFocused = true } label: {
                        Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut("f", modifiers: [.command])
                    .help("搜索公司（⌘F）")
                    TextField("搜索公司、编号或法域", text: $query).textFieldStyle(.plain)
                        .focused($searchFocused)
                    if !query.isEmpty {
                        Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted) }
                            .buttonStyle(.plain)
                    }
                }
                .font(TypeStyle.body)
                .padding(.horizontal, 14).frame(height: 38)
                .background(Theme.band, in: .capsule)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(sections, id: \.id) { sec in
                            HStack(spacing: 8) {
                                GroupIcon(groupID: sec.id == Router.ungrouped ? Router.ungrouped : sec.id, size: 18)
                                Text(sec.title).font(TypeStyle.micro).foregroundStyle(Theme.muted)
                                    .lineLimit(1)
                                if sec.id != Router.ungrouped && router.groupFilter == sec.id {
                                    Spacer(minLength: 4)
                                    Button("上传材料…") { router.chooseFiles(context: .group(sec.id)) }
                                        .buttonStyle(PillButtonStyle(.quiet, size: .small))
                                        .fixedSize()
                                        .help("归档到\(sec.title)的公司。拖入文件即可归档到这里")
                                }
                            }
                            .padding(.horizontal, Space.s8).padding(.top, Space.l16).padding(.bottom, Space.xs4)
                            ForEach(sec.rows) { r in
                                if let c = store.company(r.companyID) {
                                    let first = firstSection[c.id]
                                    row(c, r, alsoIn: first != nil && first?.id != sec.id ? first?.title : nil)
                                }
                            }
                        }
                    }
                }
                .scrollIndicators(.never)
                .overlay {
                    if sections.isEmpty {
                        VStack(spacing: 10) {
                            Text(query.isEmpty ? "\(store.filterName(router.groupFilter))还没有公司" : "没有找到“\(query)”")
                                .font(.system(size: 13)).foregroundStyle(Theme.muted)
                            if query.isEmpty, let g = router.groupFilter, g != Router.ungrouped {
                                Button("在此集团新建公司") { router.sheet = .newCompanyInGroup(g) }
                                    .buttonStyle(PillButtonStyle(.primary, size: .small))
                            }
                            if router.groupFilter != nil {
                                Button("显示全部公司") { router.groupFilter = nil }
                                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
                            }
                        }
                        .padding()
                    }
                }
            }
            .padding(Space.m12)
            .frame(width: min(300, max(240, geometry.size.width - 560)))
            .frame(maxHeight: .infinity, alignment: .top)
            .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
            .modifier(GroupListDrop(groupID: router.groupFilter, groupName: store.group(router.groupFilter)?.name))
            .padding(.leading, Space.pageEdge).padding(.bottom, Space.pageEdge)

            Group {
                if let id = router.selectedCompanyID, let c = store.company(id) {
                    CompanyDetailView(company: c).id(c.id)
                } else {
                    EmptyStateView(symbol: "building.2", title: "选择公司", message: "从左侧列表选择公司，或新建公司。",
                                   actionTitle: "新建公司") { router.sheet = .newCompany }
                        .frame(maxHeight: .infinity)
                        .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
                        .padding(.leading, Space.l16).padding(.trailing, Space.pageEdge).padding(.bottom, Space.pageEdge)
                }
            }
            .frame(minWidth: 520, maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        }
        .navigationTitle("公司")
        .onAppear {
            reconcileSelection()
            highlightID = router.selectedCompanyID
        }
        .onChange(of: router.groupFilter) { _, _ in reconcileSelection() }
        .onChange(of: router.selectedCompanyID) { _, new in
            withAnimation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion)) { highlightID = new }
        }
        .onMoveCommand { direction in
            switch direction {
            case .up: moveSelection(by: -1)
            case .down: moveSelection(by: 1)
            default: break
            }
        }
    }

    private func reconcileSelection() {
        let scope = store.companyIDs(forFilter: router.groupFilter)
        if let id = router.selectedCompanyID,
           store.company(id) != nil, scope?.contains(id) ?? true { return }
        router.selectedCompanyID = mostUrgent(filtered)?.id
    }

    /// 默认选中最需要处理的公司：已过期 > 即将到期 > 需更新/待核对 > 完成度最低。
    private func mostUrgent(_ list: [Company]) -> Company? {
        func key(_ c: Company) -> (Int, Int, Int, Double) {
            let items = store.archive(of: c)
            let expired = items.contains { if case .expired = $0.state { true } else { false } }
            let expiring = items.contains { if case .expiring = $0.state { true } else { false } }
            let other = items.contains { $0.state == .needsUpdate || $0.state == .noDate }
            let counted = items.filter { $0.state != .marked(.notApplicable) }
            let ratio = counted.isEmpty ? 2 : Double(counted.filter(\.state.hasFile).count) / Double(counted.count)
            return (expired ? 0 : 1, expiring ? 0 : 1, other ? 0 : 1, ratio)
        }
        let keyed = list.map { ($0, key($0)) }
        return keyed.min { a, b in a.1 != b.1 ? a.1 < b.1 : a.0.name < b.0.name }?.0
    }

    /// alsoIn 非空：这家公司已在前面的集团出现过，本行是重复行，弱化显示。
    private func row(_ c: Company, _ r: GroupRow, alsoIn: String? = nil) -> some View {
        let duplicate = alsoIn != nil
        let on = router.selectedCompanyID == c.id && !duplicate
        let severity = subtitleSeverity(c)
        let alert = alertText(c)
        return Button { select(c.id) } label: {
            HStack(spacing: 10) {
                Text(c.jurisdiction)
                    .font(.system(size: 10.5, weight: .bold))
                    .frame(width: 28, height: 28)
                    .background(on ? Theme.onSelection.opacity(0.16) : Theme.band, in: .rect(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 1) {
                    Text(c.name).font(.system(size: 13.5, weight: .semibold)).lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(alsoIn.map { "也属于 \($0)" } ?? subtitle(c, r)).font(.system(size: 11.5)).lineLimit(1)
                        .foregroundStyle(on ? Theme.onSelection.opacity(0.72) : Theme.muted)
                }
                Spacer(minLength: 0)
                if severity != .normal, !duplicate {
                    Circle().fill(severity == .overdue ? Theme.danger : Theme.amber)
                        .frame(width: 7, height: 7)
                        .help(alert)
                        .accessibilityLabel(alert)
                }
            }
            .foregroundStyle(on ? Theme.onSelection : Theme.ink)
            .opacity(duplicate ? 0.55 : 1)
            .padding(.leading, 8 + CGFloat(min(r.depth, 4)) * 12).padding(.trailing, 8).padding(.vertical, 8)
            .frame(minHeight: 48)
            .background {
                if highlightID == c.id && !duplicate {
                    RoundedRectangle(cornerRadius: Radius.row, style: .continuous)
                        .fill(Theme.selection)
                        .matchedGeometryEffect(id: "railSelection", in: railNS)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(RowButtonStyle())
        .help(c.name)
        .contextMenu {
            Button("复制注册编号") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(c.registrationNumber, forType: .string)
            }
            Button("导出材料…") { router.sheet = .exportAll(c.id) }
            Button("在股权结构中打开") {
                router.groupFilter = store.groups(containing: c.id).first?.id
                router.openStructure()
            }
        }
        .accessibilityLabel(c.name)
        .accessibilityValue(alsoIn.map { "也属于 \($0)" } ?? (alert.isEmpty ? subtitle(c, r) : subtitle(c, r) + "，" + alert))
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func subtitle(_ c: Company, _ r: GroupRow) -> String {
        let items = store.archive(of: c)
        let counted = items.filter { $0.state != .marked(.notApplicable) }
        var parts = [store.jurisdictionName(c.jurisdiction), "档案 \(counted.filter { $0.state.hasFile }.count)/\(counted.count)"]
        if let pct = r.percent { parts.append("上级持股 \(Ownership.percentLabel(pct))") }
        return parts.joined(separator: "，")
    }

    /// 行末小圆点的说明：合规逾期/临近、文件过期等。
    private func alertText(_ c: Company) -> String {
        var alerts: [String] = []
        if store.complianceOn, let o = store.openObligations.first(where: { $0.company.id == c.id }) {
            let left = o.daysLeft(from: store.today)
            if left <= 30 { alerts.append(left < 0 ? "合规事项“\(o.rule.name)”已逾期" : "合规事项“\(o.rule.name)”\(left) 天后到期") }
        }
        let items = store.archive(of: c)
        let expired = items.filter { if case .expired = $0.state { true } else { false } }.count
        let expiring = items.filter { if case .expiring = $0.state { true } else { false } }.count
        let updating = items.filter { $0.state == .needsUpdate }.count
        let noDate = items.filter { $0.state == .noDate }.count
        alerts += [
            expired > 0 ? "\(expired) 份已过期" : nil,
            updating > 0 ? "\(updating) 份需更新" : nil,
            expiring > 0 ? "\(expiring) 份即将到期" : nil,
            noDate > 0 ? "\(noDate) 份日期待核对" : nil,
        ].compactMap { $0 }
        return alerts.joined(separator: "，")
    }

    private enum SubtitleSeverity { case normal, attention, overdue }

    private func subtitleSeverity(_ c: Company) -> SubtitleSeverity {
        if store.complianceOn,
           let o = store.openObligations.first(where: { $0.company.id == c.id }),
           o.daysLeft(from: store.today) < 0 { return .overdue }
        let items = store.archive(of: c)
        if items.contains(where: { if case .expired = $0.state { true } else { false } }) { return .overdue }
        if items.contains(where: \.state.needsAttention) { return .attention }
        if store.complianceOn,
           let o = store.openObligations.first(where: { $0.company.id == c.id }),
           o.daysLeft(from: store.today) <= 30 { return .attention }
        return .normal
    }

    private func subtitleColor(_ severity: SubtitleSeverity, selected: Bool) -> Color {
        switch severity {
        case .normal: selected ? Theme.onSelection.opacity(0.72) : Theme.muted
        case .attention: selected ? Theme.attentionOnSelection : Theme.amberText
        case .overdue: Theme.danger
        }
    }

    private func moveSelection(by offset: Int) {
        guard !filtered.isEmpty else { return }
        let current = router.selectedCompanyID.flatMap { id in filtered.firstIndex { $0.id == id } }
            ?? (offset > 0 ? -1 : filtered.count)
        let next = min(max(current + offset, 0), filtered.count - 1)
        select(filtered[next].id)
    }

    /// 选中底色在行间滑动；详情本身即时切换。
    private func select(_ id: String) {
        router.selectedCompanyID = id
    }
}

// MARK: - 公司详情

struct CompanyDetailView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var company: Company
    @State private var tab = 0
    @State private var dropTargeted = false
    @State private var width: CGFloat = 1000
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var ref: NodeRef { NodeRef(kind: .company, id: company.id) }

    var body: some View {
        let wide = width >= 1120
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero
                    .padding(Space.xl24)
                hairline
                keyFacts
                // 正在等负责方补发时，关键信息下面一行说明
                if !store.openRequests(for: ref).isEmpty {
                    hairline
                    CompanyWaitingLine(companyID: company.id)
                        .padding(.horizontal, Space.xl24).padding(.vertical, Space.m12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                hairline
                HStack {
                    PillSegmented(options: tabOptions, selection: $tab)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, Space.xl24).padding(.vertical, Space.l16)
                hairline
                Group {
                    switch tab {
                    case 0:
                        if wide {
                            HStack(alignment: .top, spacing: 0) {
                                CompanyArchiveView(company: company)
                                    .padding(Space.xl24)
                                Rectangle().fill(Theme.hairline).frame(width: 1).frame(maxHeight: .infinity)
                                sidePanel.frame(width: 300)
                                    .padding(Space.xl24)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                        } else {
                            VStack(spacing: 0) {
                                CompanyArchiveView(company: company)
                                    .padding(Space.xl24)
                                hairline
                                sidePanel.padding(Space.xl24)
                            }
                        }
                    case 2: documentsTab.padding(Space.xl24)
                    case 4: obligationsTab.padding(Space.xl24)
                    default: historyTab.padding(Space.xl24)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .id(tab)
                .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.opacity.combined(with: .offset(y: 4)))
            }
            .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
            .animation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion), value: tab)
            .padding(.leading, Space.l16).padding(.trailing, Space.pageEdge).padding(.bottom, Space.pageEdge)
            .frame(maxWidth: 1200, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        // 整个详情区都接受拖入，默认归档到这家公司
        .archiveDropTarget("松开即可归档到 \(company.name)") { urls in
            router.startImport(urls: urls, context: .company(company.id))
        }
        .onAppear { tab = normalized(router.companyTab) }
        .onChange(of: router.companyTab) { tab = normalized(router.companyTab) }
    }

    private var hairline: some View {
        Rectangle().fill(Theme.hairline).frame(height: 1)
    }

    private var tabOptions: [(Int, String)] {
        var o: [(Int, String)] = [(0, "档案"), (3, "变更记录"), (2, "历史版本")]
        if store.complianceOn { o.append((4, "合规事项")) }
        return o
    }

    /// 旧的“工商信息”页签已并入档案页右侧。
    private func normalized(_ t: Int) -> Int {
        if t == 1 { return 0 }
        if t == 4 && !store.complianceOn { return 0 }
        return t
    }

    // MARK: 顶部

    private var hero: some View {
        let groups = store.groups(containing: company.id)
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: Space.l16) {
                heroIdentity(groups)
                Spacer(minLength: Space.m12)
                heroActions
            }
            VStack(alignment: .leading, spacing: Space.l16) {
                heroIdentity(groups)
                heroActions
            }
        }
    }

    /// 关键信息条：注册编号、成立日期、注册地址、档案进度，用竖向细线分隔。
    private var keyFacts: some View {
        let items = store.archive(of: company).filter { $0.state != .marked(.notApplicable) }
        let have = items.filter(\.state.hasFile).count
        let archive = VStack(alignment: .leading, spacing: 6) {
            Text("档案").font(TypeStyle.meta).foregroundStyle(Theme.muted)
            Text("\(have)/\(items.count)").font(.mono(15, .medium)).numericTransition()
            ProgressCapsule(value: items.isEmpty ? 0 : Double(have) / Double(items.count))
                .frame(maxWidth: 140)
        }
        .padding(.horizontal, Space.xl24).padding(.vertical, Space.l16)
        .frame(minWidth: 150, alignment: .leading)
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 0) {
                fact("注册编号", company.registrationNumber, mono: true)
                factDivider
                fact("成立日期", company.incorporationDate?.description ?? "", mono: true)
                factDivider
                fact("注册地址", company.registeredAddress, mono: false)
                    .frame(maxWidth: .infinity, alignment: .leading)
                factDivider
                archive
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 0) {
                    fact("注册编号", company.registrationNumber, mono: true)
                    factDivider
                    fact("成立日期", company.incorporationDate?.description ?? "", mono: true)
                    factDivider
                    archive
                    Spacer(minLength: 0)
                }
                hairline
                fact("注册地址", company.registeredAddress, mono: false)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var factDivider: some View {
        Rectangle().fill(Theme.hairline).frame(width: 1).frame(maxHeight: .infinity)
    }

    private func heroIdentity(_ groups: [CorporateGroup]) -> some View {
        HStack(alignment: .top, spacing: 16) {
                JurisdictionBadge(code: company.jurisdiction, size: 54, highlighted: true)
                VStack(alignment: .leading, spacing: 8) {
                    Text(company.name).font(TypeStyle.title).tracking(Tracking.title)
                        .lineLimit(2).truncationMode(.tail)
                        .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                        .help(company.name)
                    ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        Pill(text: store.jurisdictionName(company.jurisdiction))
                        if !company.entityForm.isEmpty { Pill(text: company.entityForm) }
                        if company.status != .active { Pill(text: company.status.label, kind: .strong) }
                        ForEach(groups) { g in
                            Button { router.openStructure(group: g.id) } label: { Pill(text: g.name, kind: .lime) }
                                .buttonStyle(.plain).help("在股权结构中查看\(g.name)")
                        }
                    }
                    }
                    .scrollIndicators(.visible)
                    .frame(height: 26)
                }
        }
    }

    private var heroActions: some View {
        HStack(spacing: 8) {
            ActionMenu(title: "编辑与上下级", kind: .secondary, entries: editEntries)
                .fixedSize()
            Button { router.sheet = .exportAll(company.id) } label: {
                Label("导出全部档案", systemImage: "archivebox")
            }
            .buttonStyle(PillButtonStyle(.secondary))
            .fixedSize()
            .help("导出全部现行材料，也可包含历史版本")
            Button("上传材料…") { router.chooseFiles(context: .company(company.id)) }
                .buttonStyle(PillButtonStyle(.secondary))
                .fixedSize()
                .help("选择 PDF、照片或文件夹，归档到这家公司。拖入文件即可归档到这里")
            Button("记录变更…") { router.sheet = .change(companyID: company.id) }
                .buttonStyle(PillButtonStyle(.secondary))
                .fixedSize()
                .help("换董事、股权转让、改名或迁址：更新记录，并标出需要重开的文件")
            Button("准备文件包…") { router.sheet = .packet(companyID: company.id) }
                .buttonStyle(PillButtonStyle(.primary))
                .fixedSize()
                .help("按银行开户、年度审计或 KYC 用途选择材料，预览缺件后生成文件包")
        }
    }

    private var editEntries: [MenuEntry] {
        let id = company.id
        var entries: [MenuEntry] = [
            .item("编辑公司资料…", systemImage: "pencil") { router.sheet = .editCompany(id) },
            .item("记录变更…", systemImage: "arrow.triangle.2.circlepath") { router.sheet = .change(companyID: id) },
            .divider,
            .item("添加上级（股东）…", systemImage: "arrow.up") { router.sheet = .addRelation(companyID: id, upward: true) },
            .item("添加下级公司…", systemImage: "arrow.down") { router.sheet = .addRelation(companyID: id, upward: false) },
        ]
        let groups = store.corporateGroups
        if !groups.isEmpty {
            entries.append(.divider)
            entries.append(.header("归入集团"))
            for g in groups {
                let gid = g.id
                entries.append(.item(g.name, systemImage: "square.stack.3d.up") { store.add(companyID: id, to: gid) })
            }
        }
        return entries
    }

    private func fact(_ label: String, _ value: String, mono: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(TypeStyle.meta).foregroundStyle(Theme.muted)
            Text(value.isEmpty ? "未填写" : value)
                .font(mono ? .mono(15, .medium) : .system(size: 14, weight: .medium))
                .foregroundStyle(value.isEmpty ? Theme.muted : Theme.ink)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, Space.xl24).padding(.vertical, Space.l16)
        .frame(minWidth: 150, alignment: .leading)
    }

    // MARK: 右侧：董事、股东、穿透

    private var sidePanel: some View {
        let officers = store.officers(of: company.id)
        let holders = store.directShareholders(of: company.id)
        let b = store.breakdown(of: company.id)
        let chains = store.chainsFromTops(to: company.id)
        return VStack(alignment: .leading, spacing: Space.xl24) {
            VStack(alignment: .leading, spacing: 10) {
                sideTitle("董事及高管", officers.count)
                if officers.isEmpty { Text("未录入").font(.system(size: 13)).foregroundStyle(Theme.muted) }
                ForEach(officers) { a in
                    HStack(spacing: 4) {
                        Button { router.open(person: a.personID) } label: {
                            HStack(spacing: 10) {
                                Avatar(name: store.name(of: NodeRef(kind: .person, id: a.personID)))
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(store.name(of: NodeRef(kind: .person, id: a.personID))).font(.system(size: 13.5, weight: .medium))
                                    Text(a.title + (a.from.map { "，自 \($0.description)" } ?? "")).font(.system(size: 11.5)).foregroundStyle(Theme.muted)
                                }
                                Spacer(minLength: 0)
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        ChangeRowMenu(companyID: company.id, appointmentID: a.id)
                    }
                }
            }

            Rectangle().fill(Theme.hairline).frame(height: 1)

            VStack(alignment: .leading, spacing: 10) {
                sideTitle("股东", holders.count)
                if holders.isEmpty { Text("未录入").font(.system(size: 13)).foregroundStyle(Theme.muted) }
                ForEach(holders) { h in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.name(of: h.holder)).font(.system(size: 13.5, weight: .medium)).lineLimit(1)
                            if h.isNominee {
                                Text("代\(h.beneficialOwner.map { store.name(of: $0) } ?? "他人")持有")
                                    .font(.system(size: 11.5, weight: .semibold)).foregroundStyle(Theme.amberText)
                            }
                        }
                        Spacer(minLength: 4)
                        Text(Ownership.percentLabel(h.percent)).font(.mono(13.5, .semibold))
                        ChangeRowMenu(companyID: company.id, holdingID: h.id)
                            .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] }
                    }
                }
                if !b.owners.isEmpty || b.unknown > 0.005 {
                    Divider().padding(.vertical, 2)
                    Text("穿透后").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.muted)
                    ForEach(b.owners, id: \.owner) { o in
                        HStack {
                            Text(store.name(of: o.owner)).font(.system(size: 13)).lineLimit(1)
                            if o.viaNominee { Pill(text: "含代持", kind: .warn) }
                            Spacer(minLength: 4)
                            Text(Ownership.percentLabel(o.percent)).font(.mono(13))
                        }
                    }
                    if b.unknown > 0.005 {
                        HStack {
                            Text("未识别").font(.system(size: 13)).foregroundStyle(Theme.amberText)
                            Spacer()
                            Text(Ownership.percentLabel(b.unknown)).font(.mono(13)).foregroundStyle(Theme.amberText)
                        }
                    }
                }
                if !chains.isEmpty {
                    Divider().padding(.vertical, 2)
                    ForEach(chains.prefix(3), id: \.chain.id) { item in
                        Text(store.chainText(item.chain)).font(.system(size: 12)).foregroundStyle(Theme.muted)
                            .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                    }
                }
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(store.companySummary(company), forType: .string)
                    store.showToast("公司资料摘要已复制。")
                } label: { Label("复制公司资料摘要", systemImage: "doc.on.doc").frame(maxWidth: .infinity) }
                .buttonStyle(PillButtonStyle(.accent))
                .padding(.top, 4)
            }
        }
    }

    private func sideTitle(_ t: String, _ n: Int) -> some View {
        HStack {
            Text(t).font(TypeStyle.section).tracking(Tracking.section)
            Spacer()
            if n > 0 { CountBadge(count: n) }
        }
    }

    // MARK: 概览

    private var overview: some View {
        let wide = width >= 860
        return Group {
            if wide {
                HStack(alignment: .top, spacing: 20) {
                    overviewMain.frame(maxWidth: .infinity)
                    overviewSide.frame(width: 320)
                }
            } else {
                VStack(alignment: .leading, spacing: 20) {
                    overviewSide
                    overviewMain
                }
            }
        }
    }

    private var overviewMain: some View {
        let alerts = store.ownedDocuments(of: ref).filter { store.freshness($0).needsAttention }
        let officers = store.officers(of: company.id)
        let b = store.breakdown(of: company.id)
        let chains = store.chainsFromTops(to: company.id)
        return VStack(alignment: .leading, spacing: 20) {
                ForEach(alerts) { d in DocumentAlertCard(document: d, company: company) }
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        SectionTitle(title: "工商信息")
                        Button("复制公司资料摘要") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(store.companySummary(company), forType: .string)
                            store.showToast("公司资料摘要已复制。")
                        }
                        .help("公司名称、注册编号、成立日期、地址、董事、股东、穿透和链条")
                    }
                    VStack(spacing: 0) {
                        FactRow(label: "注册名", value: company.name)
                        Divider()
                        FactRow(label: "注册编号", value: company.registrationNumber)
                        Divider()
                        FactRow(label: "成立日期", value: company.incorporationDate?.description ?? "")
                        Divider()
                        FactRow(label: "公司类型", value: company.entityForm)
                        Divider()
                        FactRow(label: "注册地址", value: company.registeredAddress)
                        Divider()
                        FactRow(label: "财年结束", value: company.fiscalYearEnd.label)
                        if !company.formerNames.isEmpty {
                            Divider()
                            FactRow(label: "曾用名", value: company.formerNames.joined(separator: "、"))
                        }
                        if let p = store.party(company.defaultPartyID) {
                            Divider()
                            FactRow(label: "代理机构", value: p.name)
                        }
                    }
                    .padding(.horizontal, 18).padding(.vertical, 4)
                    .background(Theme.card, in: .rect(cornerRadius: 22))
                }
                VStack(alignment: .leading, spacing: 8) {
                    SectionTitle(title: "董事及高管", trailing: officers.isEmpty ? nil : "\(officers.count) 人")
                    VStack(spacing: 0) {
                        if officers.isEmpty {
                            Text("未录入。可在“编辑”或“记录变更”里添加。").foregroundStyle(Theme.muted).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 12)
                        }
                        ForEach(officers) { a in
                            HStack {
                                Button(store.name(of: NodeRef(kind: .person, id: a.personID))) { router.open(person: a.personID) }.buttonStyle(.link)
                                Text(a.title).foregroundStyle(Theme.muted)
                                Spacer()
                                Text(a.from.map { "自 \($0.description)" } ?? "").foregroundStyle(Theme.muted).monospacedDigit()
                            }
                            .padding(.vertical, 10)
                        }
                    }
                    .padding(.horizontal, 18).padding(.vertical, 4)
                    .background(Theme.card, in: .rect(cornerRadius: 22))
                }
                VStack(alignment: .leading, spacing: 8) {
                    SectionTitle(title: "最终受益（穿透）")
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(store.breakdownLines(b), id: \.self) { line in
                            Text(line).foregroundStyle(line.hasPrefix("未识别") ? Theme.amberText : .primary)
                        }
                        if b.owners.isEmpty && b.unknown < 0.005 { Text("股东未录入").foregroundStyle(Theme.muted) }
                        ForEach(chains.prefix(6), id: \.chain.id) { item in
                            Text("链条（\(item.group.name)）：\(store.chainText(item.chain))").font(.callout).foregroundStyle(Theme.muted)
                        }
                    }
                    .textSelection(.enabled)
                    .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.card, in: .rect(cornerRadius: 22))
                }
            }
    }

    private var overviewSide: some View {
        let open = store.openObligations.filter { $0.company.id == company.id }
        return VStack(alignment: .leading, spacing: 20) {
                if store.complianceOn, let next = open.first {
                    Button { router.sheet = .obligation(next.key) } label: {
                        Card {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("下一个截止日").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Theme.muted)
                                let left = next.daysLeft(from: store.today)
                                Text(left < 0 ? "逾期 \(-left) 天" : left == 0 ? "今天截止" : "还有 \(left) 天")
                                    .font(.display(26, .bold)).monospacedDigit()
                                    .foregroundStyle(left <= 7 ? Theme.danger : .primary)
                                HStack(spacing: 6) {
                                    Text(next.rule.name).font(.system(size: 15, weight: .semibold))
                                    TrustBadge(trust: store.trust(next))
                                }
                                Text("\(next.due.long)，\(store.responsibleParty(for: next)?.name ?? "未指定负责方")").font(.callout).foregroundStyle(Theme.muted)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
                ShareholdersCard(company: company)
            }
    }

    // MARK: 文件

    private var documentsTab: some View {
        let docs = store.ownedDocuments(of: ref, includeSuperseded: true)
        // 只列有旧版的条目：每组先放现行版，再按签发日期从新到旧排旧版
        let groups = Dictionary(grouping: docs, by: \.typeID)
            .filter { $0.value.contains { $0.supersededBy != nil } }
            .map { (typeID: $0.key, versions: $0.value.sorted { a, b in
                if (a.supersededBy == nil) != (b.supersededBy == nil) { return a.supersededBy == nil }
                return (a.issueDate ?? a.addedOn) > (b.issueDate ?? b.addedOn)
            }) }
            .sorted { (store.docType($0.typeID)?.name ?? "") < (store.docType($1.typeID)?.name ?? "") }
        return VStack(alignment: .leading, spacing: 20) {
            if groups.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "clock.arrow.circlepath").font(.system(size: 24)).foregroundStyle(Theme.muted)
                    Text("还没有旧版本").font(.system(size: 15, weight: .semibold))
                    Text("归档新版后，被取代的文件会保留在这里，可单独打开或一并导出。")
                        .font(.system(size: 13)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 28)
            } else {
                ForEach(groups, id: \.typeID) { g in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(store.docType(g.typeID)?.name ?? "文件").font(.system(size: 15, weight: .semibold))
                            Text("旧版 \(g.versions.count - 1) 份").font(.system(size: 12.5)).foregroundStyle(Theme.muted)
                        }
                        ScrollView(.horizontal) {
                            HStack(alignment: .top, spacing: 14) {
                                ForEach(g.versions) { d in VersionCard(document: d) }
                            }
                            .padding(.bottom, 4)
                        }
                        .scrollIndicators(.never)
                    }
                }
            }
            HStack {
                Image(systemName: "arrow.down.doc")
                Text("将 PDF 或照片拖到这里，归档到这家公司名下")
            }
            .foregroundStyle(dropTargeted ? Theme.onLime : Theme.muted)
            .frame(maxWidth: .infinity).frame(height: 90)
            .background(dropTargeted ? Theme.lime : Theme.surface, in: .rect(cornerRadius: Radius.surface))
            .overlay(RoundedRectangle(cornerRadius: Radius.surface).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [5, 5])).foregroundStyle(dropTargeted ? Theme.ink : Theme.hairline))
            .dropDestination(for: URL.self) { urls, _ in
                guard !urls.isEmpty else { return false }
                router.startImport(urls: urls, context: .company(company.id))
                return true
            } isTargeted: { dropTargeted = $0 }
        }
    }

    // MARK: 合规事项

    private var obligationsTab: some View {
        let all = store.obligations(for: company.id)
        let open = all.filter { !$0.isDone }
        let done = all.filter { $0.isDone }.sorted { $0.due > $1.due }
        return VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                SectionTitle(title: "待办", trailing: "\(open.count) 件")
                VStack(spacing: 0) {
                    ForEach(open) { o in
                        ObligationRow(obligation: o, detail: "\(o.rule.schedule.summary)，\(store.stateLine(o))") {
                            router.sheet = .obligation(o.key)
                        }
                    }
                }
            }
            if !done.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    SectionTitle(title: "已完成")
                    VStack(spacing: 0) {
                        ForEach(done) { o in
                            HStack {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.ink)
                                Text(o.rule.name).fontWeight(.medium)
                                Text("截止 \(o.due.long)").foregroundStyle(Theme.muted)
                                Spacer()
                                Text(o.record?.completedOn.map { "\($0.long)完成" } ?? "").foregroundStyle(Theme.muted)
                                if let r = store.receipt(o) {
                                    Button("查看回执") { store.open(r) }.buttonStyle(PillButtonStyle(.quiet, size: .small))
                                }
                            }
                            .contentShape(.rect)
                            .onTapGesture { router.sheet = .obligation(o.key) }
                            .padding(.horizontal, 12).frame(height: 40)
                        }
                    }
                }
            }
            RulesForCompany(company: company)
        }
    }

    // MARK: 变更记录

    private var historyTab: some View {
        let changes = store.changes.filter { $0.companyID == company.id }.sorted { $0.effectiveOn > $1.effectiveOn }
        let holdings = store.holdings.filter { $0.companyID == company.id || $0.holder == ref }
        let unsynced = store.unsyncedChanges(companyID: company.id)
        return VStack(alignment: .leading, spacing: 20) {
            if changes.isEmpty {
                Text("还没有变更记录。董事、股东、地址或名称有变化时，点击上方的“记录变更”。").foregroundStyle(Theme.muted)
            }
            if !unsynced.isEmpty {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.amberText)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(unsynced.count) 条变更没有同步到董事或股东名单").fontWeight(.semibold)
                        Text(unsynced.map { "\($0.effectiveOn.long)：\($0.summary.isEmpty ? $0.kind.label : $0.summary)" }.joined(separator: "\n"))
                            .font(.callout).foregroundStyle(Theme.muted)
                        Text("这些变更只记了一笔，名单里没有对应的就任、离任或持股变化。请在“编辑”里补上任期日期，股权结构和文件包才会准确。")
                            .font(.callout).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    Button("编辑名单") { router.sheet = .editCompany(company.id) }
                        .buttonStyle(PillButtonStyle(.secondary))
                }
                .padding(16)
                .background(Theme.amberSoft, in: .rect(cornerRadius: 18))
            }
            VStack(alignment: .leading, spacing: 22) {
                ForEach(changes) { c in
                    HStack(alignment: .top, spacing: 22) {
                        Circle().strokeBorder(Theme.ink, lineWidth: 2.5).frame(width: 14, height: 14).padding(.top, 3)
                        Text(c.effectiveOn.description).fontWeight(.bold).monospacedDigit().frame(width: 100, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.summary.isEmpty ? c.kind.label : c.summary).font(.system(size: 15, weight: .semibold))
                            ForEach(c.details ?? [], id: \.self) { line in
                                Text(line).font(.callout)
                            }
                            HStack(spacing: 10) {
                                Text("\(c.kind.label)，\(c.recordedOn.long)录入").font(.callout).foregroundStyle(Theme.muted)
                                if let id = c.evidenceDocumentID, let d = store.documents.first(where: { $0.id == id }) {
                                    Button("查看证明文件") { router.sheet = .document(d.id) }.buttonStyle(.link).font(.callout)
                                }
                            }
                        }
                    }
                }
            }
            if !holdings.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    SectionTitle(title: "持股历史")
                    ForEach(holdings.sorted { ($0.from ?? Day(1900, 1, 1)) > ($1.from ?? Day(1900, 1, 1)) }) { h in
                        HStack {
                            Text(h.companyID == company.id ? "\(store.name(of: h.holder)) 持有本公司" : "本公司持有 \(store.name(of: NodeRef(kind: .company, id: h.companyID)))")
                            Text(Ownership.percentLabel(h.percent)).fontWeight(.bold)
                            if h.isNominee { Pill(text: "代持", kind: .warn) }
                            Spacer()
                            Text("\(h.from?.description ?? "?") 至 \(h.to?.description ?? "今")").foregroundStyle(Theme.muted).monospacedDigit()
                        }
                        .padding(.horizontal, 14).frame(height: 40)
                        .background(Theme.card, in: .rect(cornerRadius: 12))
                    }
                }
            }
        }
    }
}

// MARK: - 子视图

struct DocumentAlertCard: View {
    @Environment(AppStore.self) private var store
    var document: Document
    var company: Company

    var body: some View {
        let f = store.freshness(document)
        let type = store.docType(document.typeID)
        let party = store.party(company.defaultPartyID)
        let accent = f.emphasisFill
        HStack(spacing: 18) {
            ZStack {
                Circle().stroke(accent.opacity(0.15), lineWidth: 5)
                Circle().trim(from: 0, to: 1).stroke(accent, style: StrokeStyle(lineWidth: 5, lineCap: .round)).rotationEffect(.degrees(-90))
                Text("!").font(.display(17)).foregroundStyle(f.emphasisColor)
            }
            .frame(width: 50, height: 50)
            VStack(alignment: .leading, spacing: 3) {
                Text("\(type?.name ?? "文件")\(f.label)").font(.display(17))
                Text("上一份\(document.issueDate.map { "签发于 \($0.long)" } ?? "没有签发日期")。银行开户、审计和 KYC 可能会用到。")
                    .font(.callout).foregroundStyle(Theme.muted)
            }
            Spacer()
            if let party {
                Button("请\(party.kind == .agent ? "代理" : latinPad(party.name))补发") {
                    let body = "\(company.name) 的\(type?.name ?? "文件")\(f.label)，麻烦补发一份新的，谢谢。"
                    if let s = NSSharingService(named: .composeEmail) {
                        s.recipients = party.email.isEmpty ? [] : [party.email]
                        s.subject = "\(company.name)：请补发\(type?.name ?? "文件")"
                        s.perform(withItems: [body])
                    }
                    store.showToast("已起草邮件。收到新文件后拖入 Charter，旧版会保留并标为“旧版”。")
                }
                .buttonStyle(PillButtonStyle(.primary, size: .large))
            }
        }
        .padding(20)
        .background(accent.opacity(0.1), in: .rect(cornerRadius: 26))
        .overlay(RoundedRectangle(cornerRadius: 26).strokeBorder(accent.opacity(0.18), lineWidth: 0.5))
    }
}

/// 历史版本里的一份文件：真实缩略图 + 现行/旧版 + 签发日期。
struct VersionCard: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var document: Document
    @State private var hover = false

    var body: some View {
        let current = document.supersededBy == nil
        Button { router.sheet = .document(document.id) } label: {
            VStack(alignment: .leading, spacing: 8) {
                FileThumb(url: store.fileURL(document), size: CGSize(width: 96, height: 124))
                    .opacity(current ? 1 : 0.75)
                    .frame(width: 140, height: 148)
                    .background(Theme.band, in: .rect(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(hover ? Theme.ink.opacity(0.35) : .clear, lineWidth: 1))
                HStack(spacing: 6) {
                    Pill(text: current ? "现行" : "旧版", kind: current ? .valid : .neutral)
                    Text(document.issueDate?.description ?? "日期未知")
                        .font(TypeStyle.metadata).monospacedDigit().foregroundStyle(current ? Theme.ink : Theme.muted)
                }
            }
            .frame(width: 140, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .contextMenu {
            Button("打开") { store.open(document) }
            Button("在访达中显示") { store.reveal(document) }
        }
        .help(document.originalFileName)
        .accessibilityLabel("\(store.docType(document.typeID)?.name ?? "文件")，\(current ? "现行版" : "旧版")，\(document.issueDate?.description ?? "日期未知")")
    }
}

struct DocumentCard: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var document: Document
    @State private var hover = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let f = store.freshness(document)
        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                RoundedRectangle(cornerRadius: 6).fill(Theme.muted.opacity(0.15)).frame(width: 76, height: 100)
                    .rotationEffect(.degrees(hover ? -6 : 0)).offset(x: hover ? -8 : 0, y: 4)
                RoundedRectangle(cornerRadius: 6).fill(Theme.muted.opacity(0.1)).frame(width: 76, height: 100)
                    .rotationEffect(.degrees(hover ? 5 : 0)).offset(x: hover ? 8 : 0, y: 4)
                VStack(alignment: .leading, spacing: 6) {
                    Capsule().fill(f.emphasisFill).frame(width: 34, height: 5)
                    ForEach([0.8, 0.92, 0.64, 0.86], id: \.self) { w in Capsule().fill(Theme.muted.opacity(0.25)).frame(width: CGFloat(52 * w), height: 3) }
                }
                .padding(12)
                .frame(width: 76, height: 104, alignment: .topLeading)
                .background(.background, in: .rect(cornerRadius: 6))
                .shadow(color: .black.opacity(0.15), radius: 6, y: 4)
            }
            .frame(maxWidth: .infinity).frame(height: 128)
            VStack(alignment: .leading, spacing: 3) {
                Text(store.docType(document.typeID)?.name ?? "文件").font(.system(size: 14, weight: .semibold))
                Text(document.issueDate.map { "\($0.long)签发" } ?? "未注明日期").font(.caption).foregroundStyle(Theme.muted)
                Pill(text: f.label, kind: f.pillKind).padding(.top, 6)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background)
        }
        .background(Theme.card)
        .clipShape(.rect(cornerRadius: 22))
        .opacity(document.supersededBy == nil ? 1 : 0.55)
        .scaleEffect(hover ? 1.02 : 1)
        .shadow(color: .black.opacity(hover ? 0.18 : 0), radius: 18, y: 12)
        .onHover { h in withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { hover = h } }
        .onTapGesture { router.sheet = .document(document.id) }
        .focusable()
        .onKeyPress(.return) { router.sheet = .document(document.id); return .handled }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(store.docType(document.typeID)?.name ?? "文件")，\(f.label)")
        .accessibilityAction { router.sheet = .document(document.id) }
        .contextMenu {
            Button("打开") { store.open(document) }
            Button("在访达中显示") { store.reveal(document) }
            Divider()
            Button("从 Charter 移除记录", role: .destructive) { store.delete(document: document) }
        }
    }
}

struct ShareholdersCard: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var company: Company

    var body: some View {
        let ref = NodeRef(kind: .company, id: company.id)
        let direct = Ownership.active(store.holdings, on: store.today).filter { $0.companyID == company.id }
        let subs = Ownership.active(store.holdings, on: store.today).filter { $0.holder == ref }
        let ultimate = Ownership.ultimateOwners(of: company.id, holdings: store.holdings, on: store.today)
        Card(padding: 20) {
            VStack(alignment: .leading, spacing: 10) {
                Text("股东").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Theme.muted)
                ForEach(direct) { h in
                    HStack(spacing: 10) {
                        avatar(h.holder)
                        Text(store.name(of: h.holder)).fontWeight(.medium).lineLimit(1)
                        if h.isNominee { Pill(text: "代持", kind: .warn) }
                        Spacer()
                        Text(Ownership.percentLabel(h.percent)).fontWeight(.bold).monospacedDigit()
                    }
                }
                if ultimate.contains(where: { u in !direct.contains { $0.holder == u.owner } }) {
                    Text("穿透后").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Theme.muted).padding(.top, 6)
                    ForEach(ultimate, id: \.owner) { u in
                        HStack(spacing: 10) {
                            avatar(u.owner)
                            Text(store.name(of: u.owner)).fontWeight(.medium)
                            if u.viaNominee { Pill(text: "含代持", kind: .warn) }
                            Spacer()
                            Text(Ownership.percentLabel(u.percent)).fontWeight(.bold).monospacedDigit()
                        }
                    }
                }
                if !subs.isEmpty {
                    Text("下属公司").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Theme.muted).padding(.top, 6)
                    ForEach(subs) { h in
                        Button { router.open(company: h.companyID) } label: {
                            HStack(spacing: 10) {
                                JurisdictionBadge(code: store.company(h.companyID)?.jurisdiction ?? "?", size: 32)
                                Text(store.name(of: NodeRef(kind: .company, id: h.companyID))).fontWeight(.medium).lineLimit(1)
                                Spacer()
                                Text(Ownership.percentLabel(h.percent)).fontWeight(.bold).monospacedDigit()
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func avatar(_ ref: NodeRef) -> some View {
        switch ref.kind {
        case .person:
            Text(String(store.name(of: ref).prefix(1)))
                .font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.onInk)
                .frame(width: 32, height: 32).background(Theme.ink, in: .circle)
        case .company:
            JurisdictionBadge(code: store.company(ref.id)?.jurisdiction ?? "?", size: 32)
        }
    }
}

/// 对这家公司适用的规则，可以逐条关闭或改负责方。
struct RulesForCompany: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var company: Company

    var body: some View {
        let rules = store.library.rules.filter { $0.jurisdictions.contains(company.jurisdiction) }
        VStack(alignment: .leading, spacing: 6) {
            SectionTitle(title: "适用规则", trailing: "关掉的规则不会再提醒")
            VStack(spacing: 0) {
                ForEach(rules) { r in
                    HStack(spacing: 12) {
                        Toggle("", isOn: Binding(
                            get: { !company.disabledRuleIDs.contains(r.id) },
                            set: { on in
                                var c = company
                                if on { c.disabledRuleIDs.removeAll { $0 == r.id } } else { c.disabledRuleIDs.append(r.id) }
                                store.upsert(c)
                            }))
                        .toggleStyle(KitSwitchStyle()).fixedSize()
                        .disabled(!r.enabled || !(r.entityForms.isEmpty || r.entityForms.contains(company.entityForm)))
                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 6) {
                                Text(r.name).fontWeight(.medium)
                                Button { router.sheet = .confirmRule(ruleID: r.id, companyID: company.id) } label: {
                                    TrustBadge(trust: store.trust(ruleID: r.id, company: company), showConfirmed: true)
                                }
                                .buttonStyle(.plain)
                                .help("查看或记录这条规则的核对信息")
                            }
                            Text(r.effective(for: company).schedule.summary).font(.caption).foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        SelectField(options: partyOptions, selection: Binding<String>(
                            get: { company.rulePartyIDs[r.id] ?? "" },
                            set: { v in var c = company; c.rulePartyIDs[r.id] = v.isEmpty ? nil : v; store.upsert(c) }),
                                    minWidth: 200)
                    }
                    .padding(.horizontal, 12).frame(height: 52)
                }
            }
            .background(Theme.card, in: .rect(cornerRadius: 20))
        }
    }

    private var partyOptions: [(String, String)] {
        [("", "默认（\(store.party(company.defaultPartyID)?.name ?? "未指定")）")] + store.parties.map { ($0.id, $0.name) }
    }
}

/// 公司列表在筛选某个集团时接受拖入，归档到这个集团的公司。
private struct GroupListDrop: ViewModifier {
    @Environment(Router.self) private var router
    var groupID: String?
    var groupName: String?

    @ViewBuilder
    func body(content: Content) -> some View {
        if let groupID, groupID != Router.ungrouped, let groupName {
            content.archiveDropTarget("松开即可归档到\(groupName)") { urls in
                router.startImport(urls: urls, context: .group(groupID))
            }
        } else {
            content
        }
    }
}
