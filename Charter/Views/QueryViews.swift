import SwiftUI
import AppKit

// MARK: - ⌘K 命令面板

/// 输入公司名、别名、曾用名、注册号或人名，直接打开；也可以输入“远澜 开户”这类一句话，直接执行动作。
/// 空查询时显示最近查看的公司和常用动作。
struct QuickSearchSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openSettings) private var openSettings
    @State private var query = ""
    @State private var selectedHitID: String?
    @State private var reissue: ReissueTarget?
    @FocusState private var focused: Bool

    /// 面板里能执行的动作。
    fileprivate enum Act: Hashable {
        case packet(companyID: String, purposeID: String?)
        case upload(companyID: String)
        case reissue(companyID: String, typeIDs: [String])
        case change(companyID: String)
        case structure(companyID: String)
        case newCompany, newGroup, uploadAny, calendar
        case settings(SettingsPane)
    }

    fileprivate struct Action: Hashable {
        var act: Act
        var title: String
        var symbol: String
    }

    private enum Hit: Identifiable {
        case company(Company)
        case person(Person)
        case action(Action)
        var id: String {
            switch self {
            case .company(let c): "c-\(c.id)"
            case .person(let p): "p-\(p.id)"
            case .action(let a): "a-\(a.act.hashValue)-\(a.title)"
            }
        }
    }

    private struct PaletteSection: Identifiable {
        var id: String
        var title: String
        var hits: [Hit]
    }

    /// 动作关键词。用途名另外从文件包用途里取。
    private static let verbs: [(String, Verb)] = [
        ("文件包", .packet), ("准备", .packet), ("上传", .upload), ("归档", .upload),
        ("补发", .reissue), ("缺少", .reissue), ("缺", .reissue),
        ("记录变更", .change), ("变更", .change), ("股权结构", .structure), ("结构", .structure), ("股权", .structure),
    ]

    private enum Verb { case packet, upload, reissue, change, structure }

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    // MARK: 结果

    private var sections: [PaletteSection] {
        let q = trimmedQuery
        if q.isEmpty {
            let recent = router.recentCompanyIDs.compactMap { store.company($0) }.map(Hit.company)
            return [PaletteSection(id: "recent", title: "最近", hits: recent),
                    PaletteSection(id: "common", title: "常用动作", hits: globalActions(matching: nil).map(Hit.action))]
                .filter { !$0.hits.isEmpty }
        }
        let parsed = parse(q)
        let actions = (companyActions(parsed) + globalActions(matching: q)).map(Hit.action)
        let found = searchHits(q)
        let companies = found.filter { if case .company = $0 { true } else { false } }
        let people = found.filter { if case .person = $0 { true } else { false } }
        let actionSection = PaletteSection(id: "actions", title: "动作", hits: Array(actions.prefix(8)))
        let list = [PaletteSection(id: "companies", title: "公司", hits: companies),
                    PaletteSection(id: "people", title: "人员", hits: people)]
        // 一句话里带了用途或动作词：动作排在最前
        let ordered = parsed.intent ? [actionSection] + list : list + [actionSection]
        return ordered.filter { !$0.hits.isEmpty }
    }

    private var flatHits: [Hit] { sections.flatMap(\.hits) }

    /// 原有的公司和人员查找。
    private func searchHits(_ q: String) -> [Hit] {
        let terms = searchForms(q)
        guard !terms.isEmpty else { return [] }
        let cs = store.companies.filter { companyMatches($0, terms) }
            .sorted { $0.name < $1.name }.map(Hit.company)
        let ps = store.people.filter { matchesSearch(terms, sources: [$0.name] + $0.aliases) }
            .sorted { $0.name < $1.name }.map(Hit.person)
        return Array((cs + ps).prefix(30))
    }

    private func companyMatches(_ company: Company, _ terms: Set<String>) -> Bool {
        matchesSearch(terms, sources: [
            company.searchText,
            store.jurisdictionName(company.jurisdiction),
            store.groups(containing: company.id).map(\.name).joined(separator: " "),
        ])
    }

    // MARK: 解析一句话

    private struct Parsed {
        var companies: [Company] = []
        var purposes: [PacketTemplate] = []
        var verbs: [Verb] = []
        var intent: Bool { !purposes.isEmpty || !verbs.isEmpty }
    }

    /// 从查询里找出用途和动作词，剩下的部分用来匹配公司。
    private func parse(_ q: String) -> Parsed {
        var rest = q.lowercased()
        var out = Parsed()
        for t in store.library.packets {
            let name = t.name.lowercased()
            let keys = [name] + ["开户", "审计", "kyc", "尽调", "续期", "签证"].filter { name.contains($0) }
            if let key = keys.first(where: { rest.contains($0) }) {
                out.purposes.append(t)
                rest = rest.replacingOccurrences(of: key, with: " ")
            }
        }
        for (word, verb) in Self.verbs where rest.contains(word) {
            if !out.verbs.contains(verb) { out.verbs.append(verb) }
            rest = rest.replacingOccurrences(of: word, with: " ")
        }
        if !out.purposes.isEmpty && !out.verbs.contains(.packet) { out.verbs.insert(.packet, at: 0) }
        // 连接用的字眼不参与公司匹配
        for filler in ["为", "的", "文件", "材料", "请", "打开", "记录", "到"] where out.intent {
            rest = rest.replacingOccurrences(of: filler, with: " ")
        }
        let tokens = rest.split(whereSeparator: { $0.isWhitespace }).map(String.init).filter { !$0.isEmpty }
        guard !tokens.isEmpty else { return out }
        out.companies = store.companies
            .filter { c in tokens.allSatisfy { companyMatches(c, searchForms($0)) } }
            .sorted { $0.name < $1.name }
        return out
    }

    // MARK: 动作

    private func companyActions(_ p: Parsed) -> [Action] {
        var out: [Action] = []
        for c in p.companies.prefix(p.intent ? 2 : 1) {
            let wanted: [Verb] = p.verbs.isEmpty ? [.packet, .upload, .reissue, .change, .structure] : p.verbs
            for verb in wanted {
                switch verb {
                case .packet:
                    if p.purposes.isEmpty {
                        out.append(Action(act: .packet(companyID: c.id, purposeID: nil),
                                          title: "为 \(c.name) 准备文件包", symbol: "shippingbox"))
                    } else {
                        for t in p.purposes {
                            out.append(Action(act: .packet(companyID: c.id, purposeID: t.id),
                                              title: "为 \(c.name) 准备\(t.name)文件包", symbol: "shippingbox"))
                        }
                    }
                case .upload:
                    out.append(Action(act: .upload(companyID: c.id), title: "上传材料到 \(c.name)", symbol: "tray.and.arrow.down"))
                case .reissue:
                    let gaps = gapTypeIDs(c)
                    if !gaps.isEmpty {
                        let party = store.party(c.defaultPartyID)?.name ?? "负责方"
                        out.append(Action(act: .reissue(companyID: c.id, typeIDs: gaps),
                                          title: "请 \(party) 补发 \(c.name) 缺少的文件", symbol: "envelope"))
                    }
                case .change:
                    out.append(Action(act: .change(companyID: c.id), title: "记录 \(c.name) 的变更", symbol: "arrow.triangle.2.circlepath"))
                case .structure:
                    out.append(Action(act: .structure(companyID: c.id), title: "打开 \(c.name) 的股权结构", symbol: "point.3.connected.trianglepath.dotted"))
                }
            }
        }
        return out
    }

    /// 缺失、过期、即将到期或需要更新，且还没在等负责方补发的条目。
    private func gapTypeIDs(_ c: Company) -> [String] {
        let owner = NodeRef(kind: .company, id: c.id)
        return store.archive(of: c).filter { item in
            let open: Bool
            switch item.state {
            case .missing, .expired, .expiring, .needsUpdate: open = true
            default: open = false
            }
            return open && store.openRequest(owner: owner, typeID: item.typeID) == nil
        }.map(\.typeID)
    }

    /// 全局动作。query 为 nil 时全部列出（常用动作）。
    private func globalActions(matching q: String?) -> [Action] {
        var all: [Action] = [
            Action(act: .newCompany, title: "新建公司", symbol: "plus.square"),
            Action(act: .newGroup, title: "新建集团", symbol: "square.stack.3d.up"),
            Action(act: .uploadAny, title: "上传材料", symbol: "tray.and.arrow.down"),
        ]
        if store.complianceOn { all.append(Action(act: .calendar, title: "查看全部日程", symbol: "calendar")) }
        all.append(Action(act: .settings(.sync), title: "设置", symbol: "gearshape"))
        guard let q else { return all }
        // 输入时也能直接搜到某一页设置，例如“提醒”“用途”“快照”
        for p in SettingsPane.allCases where p != .sync && (p != .rules || store.complianceOn) {
            all.append(Action(act: .settings(p), title: "设置：\(p.title)", symbol: p.symbol))
        }
        let terms = searchForms(q)
        return all.filter { a in
            let forms = searchForms(a.title)
            return matchesSearch(terms, sources: [a.title]) || terms.contains { t in forms.contains { t.contains($0) } }
        }
    }

    private func perform(_ act: Act) {
        switch act {
        case .packet(let cid, let pid):
            if let pid { router.sheet = .packetFor(companyID: cid, purposeID: pid) } else { router.sheet = .packet(companyID: cid) }
        case .change(let cid):
            router.sheet = .change(companyID: cid)
        case .newCompany:
            router.sheet = .newCompany
        case .newGroup:
            router.sheet = .newGroup
        case .reissue(let cid, let ids):
            // 在面板上叠一层“请补发”；关掉后面板一起关
            reissue = ReissueTarget(owner: NodeRef(kind: .company, id: cid), typeIDs: ids)
        case .upload(let cid):
            closeThen { r in r.chooseFiles(context: .company(cid)) }
        case .uploadAny:
            closeThen { [store] r in r.chooseFiles(context: r.currentImportContext(groupsExist: { store.group($0) != nil })) }
        case .structure(let cid):
            let group = store.groups(containing: cid).first?.id
            router.selectedCompanyID = cid
            router.openStructure(group: group)
            dismiss()
        case .calendar:
            router.openCalendar()
            dismiss()
        case .settings(let pane):
            dismiss()
            pane.open(with: openSettings)
        }
    }

    /// 先关掉面板，再做需要系统面板的事（文件选择器不能叠在弹窗上）。
    private func closeThen(_ body: @escaping (Router) -> Void) {
        let r = router
        dismiss()
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            body(r)
        }
    }

    // MARK: 视图

    var body: some View {
        let groups = sections
        VStack(spacing: 0) {
            searchField
            Rectangle().fill(Theme.hairline).frame(height: 1)
            if groups.isEmpty {
                emptyState
            } else {
                resultList(groups)
            }
        }
        .frame(width: 600, height: SheetMetrics.height(460))
        .background(Theme.surface)
        .background {
            // Esc 总能关闭（输入框为空、焦点不在输入框时也一样）
            Button("关闭") { dismiss() }
                .keyboardShortcut(.cancelAction)
                .opacity(0).frame(width: 0, height: 0)
                .accessibilityHidden(true)
        }
        .onAppear {
            focused = true
            selectedHitID = flatHits.first?.id
        }
        .onChange(of: flatHits.map(\.id)) { _, ids in
            if selectedHitID == nil || !ids.contains(selectedHitID!) { selectedHitID = ids.first }
        }
        .onExitCommand { dismiss() }
        .sheet(item: $reissue, onDismiss: { dismiss() }) { t in
            ReissueRequestSheet(owner: t.owner, typeIDs: t.typeIDs)
        }
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").font(.system(size: 16, weight: .medium)).foregroundStyle(Theme.muted)
            TextField("公司、人名，或“远澜 开户”这样的一句话", text: $query)
                .textFieldStyle(.plain).font(.system(size: 18))
                .focused($focused)
                .onSubmit { if let h = selectedHit ?? flatHits.first { run(h) } }
                .onKeyPress(.downArrow) { moveSelection(by: 1); return .handled }
                .onKeyPress(.upArrow) { moveSelection(by: -1); return .handled }
                .onExitCommand { dismiss() }
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
            }
            .buttonStyle(PillButtonStyle(.quiet, size: .small))
            .help("关闭（Esc）")
            .accessibilityLabel("关闭")
        }
        .padding(.leading, 18).padding(.trailing, 12)
        .frame(height: 60)
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Text(trimmedQuery.isEmpty
                 ? "输入名称、注册编号或人名，按回车打开第一个结果。"
                 : "没有找到“\(query)”。")
                .font(TypeStyle.body).foregroundStyle(Theme.muted)
            Text("按 Esc 关闭").font(TypeStyle.metadata).foregroundStyle(Theme.muted.opacity(0.8))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func resultList(_ groups: [PaletteSection]) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(groups) { g in
                        sectionHeader(g.title)
                        ForEach(g.hits) { h in
                            hitRow(h).id(h.id)
                        }
                    }
                }
                .padding(8)
            }
            .scrollIndicators(.automatic)
            .onChange(of: selectedHitID) { _, id in
                if let id { proxy.scrollTo(id) }
            }
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(TypeStyle.micro).foregroundStyle(Theme.muted)
            .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 2)
    }

    private func hitRow(_ h: Hit) -> some View {
        let on = selectedHitID == h.id
        return Button { run(h) } label: {
            row(h, selected: on)
                .padding(.horizontal, 10).frame(height: 46)
                .background(on ? Theme.selection : Color.clear, in: .rect(cornerRadius: 10))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { inside in if inside { selectedHitID = h.id } }
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    @ViewBuilder
    private func row(_ h: Hit, selected: Bool) -> some View {
        switch h {
        case .company(let c): companyRow(c, selected: selected)
        case .person(let p): personRow(p, selected: selected)
        case .action(let a): actionRow(a, selected: selected)
        }
    }

    private func hint(_ text: String, selected: Bool) -> some View {
        Text(text)
            .font(TypeStyle.metadata)
            .foregroundStyle(selected ? Theme.onSelection.opacity(0.7) : Theme.muted.opacity(0.8))
            .lineLimit(1)
            .fixedSize()
    }

    private func companyRow(_ c: Company, selected: Bool) -> some View {
        let primary = selected ? Theme.onSelection : Theme.ink
        let secondary = selected ? Theme.onSelection.opacity(0.7) : Theme.muted
        let meta = [store.jurisdictionName(c.jurisdiction), c.registrationNumber, store.groups(containing: c.id).map(\.name).joined(separator: "、")]
            .filter { !$0.isEmpty }.joined(separator: "，")
        return HStack(spacing: 10) {
            JurisdictionBadge(code: c.jurisdiction, size: 30, highlighted: selected)
            VStack(alignment: .leading, spacing: 1) {
                Text(c.name).font(.system(size: 14, weight: .medium)).foregroundStyle(primary).lineLimit(1)
                Text(meta).font(TypeStyle.metadata).foregroundStyle(secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            hint("↩ 打开", selected: selected)
        }
    }

    private func personRow(_ p: Person, selected: Bool) -> some View {
        let primary = selected ? Theme.onSelection : Theme.ink
        let secondary = selected ? Theme.onSelection.opacity(0.7) : Theme.muted
        let roles = store.appointments.filter { $0.personID == p.id && $0.isActive(on: store.today) }
        return HStack(spacing: 10) {
            Avatar(name: p.name, size: 30, highlighted: selected)
            VStack(alignment: .leading, spacing: 1) {
                Text(p.name).font(.system(size: 14, weight: .medium)).foregroundStyle(primary).lineLimit(1)
                Text(roles.isEmpty ? "人员" : "任 \(roles.count) 家公司董事或高管")
                    .font(TypeStyle.metadata).foregroundStyle(secondary)
            }
            Spacer(minLength: 8)
            hint("↩ 打开", selected: selected)
        }
    }

    private func actionRow(_ a: Action, selected: Bool) -> some View {
        let primary = selected ? Theme.onSelection : Theme.ink
        return HStack(spacing: 10) {
            Image(systemName: a.symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(selected ? Theme.onSelection : Theme.muted)
                .frame(width: 30, height: 30)
                .background(selected ? Theme.onSelection.opacity(0.12) : Theme.band, in: .rect(cornerRadius: 8))
            Text(a.title).font(.system(size: 14, weight: .medium)).foregroundStyle(primary).lineLimit(1)
            Spacer(minLength: 8)
            hint("↩ 执行", selected: selected)
        }
    }

    private func run(_ h: Hit) {
        switch h {
        case .company(let c):
            router.companyTab = 0; router.open(company: c.id)
            dismiss()
        case .person(let p):
            router.open(person: p.id)
            dismiss()
        case .action(let a):
            perform(a.act)
        }
    }

    private var selectedHit: Hit? {
        selectedHitID.flatMap { id in flatHits.first { $0.id == id } }
    }

    private func moveSelection(by offset: Int) {
        let results = flatHits
        guard !results.isEmpty else { return }
        let current = selectedHitID.flatMap { id in results.firstIndex { $0.id == id } }
            ?? (offset > 0 ? -1 : results.count)
        let next = min(max(current + offset, 0), results.count - 1)
        selectedHitID = results[next].id
    }
}

private func searchForms(_ value: String) -> Set<String> {
    let base = value.trimmingCharacters(in: .whitespacesAndNewlines)
        .folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: .current)
        .lowercased()
    guard !base.isEmpty else { return [] }
    var forms: Set<String> = [base]
    if let simplified = base.applyingTransform(StringTransform(rawValue: "Traditional-Simplified"), reverse: false) {
        forms.insert(simplified.lowercased())
    }
    if let traditional = base.applyingTransform(StringTransform(rawValue: "Simplified-Traditional"), reverse: false) {
        forms.insert(traditional.lowercased())
    }
    return forms
}

private func matchesSearch(_ terms: Set<String>, sources: [String]) -> Bool {
    sources.contains { source in
        let forms = searchForms(source)
        return terms.contains { term in forms.contains { $0.contains(term) } }
    }
}

// MARK: - 持股链条

/// 查询某人或某公司到目标公司之间的所有持股路径，回答“这家公司在不在 X 的架构链条上”。
struct ChainQuerySheet: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var from: NodeRef?
    @State private var to: String?

    init(from: NodeRef?, to: String?) {
        _from = State(initialValue: from)
        _to = State(initialValue: to)
    }

    private var nodes: [NodeRef] {
        store.people.sorted { $0.name < $1.name }.map { NodeRef(kind: .person, id: $0.id) }
            + store.companies.sorted { $0.name < $1.name }.map { NodeRef(kind: .company, id: $0.id) }
    }

    private var fromOptions: [(NodeRef?, String)] {
        nodes.map { n in (Optional(n), n.kind == .person ? "人：\(store.name(of: n))" : store.name(of: n)) }
    }

    private var toOptions: [(String?, String)] {
        store.companies.sorted { $0.name < $1.name }.map { c in (Optional(c.id), c.name) }
    }

    var body: some View {
        let chains: [Chain] = {
            guard let f = from, let t = to, f != NodeRef(kind: .company, id: t) else { return [] }
            return Chains.paths(from: f, to: t, holdings: store.holdings, on: store.today)
        }()
        let total = chains.reduce(0) { $0 + $1.percent }
        let breakdown = to.map { Chains.breakdown(of: $0, holdings: store.holdings, on: store.today) }
        SheetScaffold(title: "查询持股链条", subtitle: "列出从某人或某公司到目标公司的所有持股路径，含代持。", width: 640, height: 600) {
            VStack(alignment: .leading, spacing: 18) {
                FormGroup(title: "查询") {
                    FieldRow(label: "起点") {
                        SelectField(options: fromOptions, selection: $from, placeholder: "选择人或公司", minWidth: 320)
                    }
                    FieldRow(label: "目标公司") {
                        SelectField(options: toOptions, selection: $to, placeholder: "选择公司", minWidth: 320)
                    }
                }
                VStack(alignment: .leading, spacing: 10) {
                    if from == nil || to == nil {
                        Text("选好起点和目标公司，Charter 会列出所有持股路径。").font(TypeStyle.body).foregroundStyle(Theme.muted)
                    } else if chains.isEmpty {
                        Label("根据当前已录入关系，未找到持股路径", systemImage: "magnifyingglass")
                            .font(.system(size: 15, weight: .semibold))
                        Text("未找到不代表实际不存在；结果受股东和代持信息的录入范围影响。").font(TypeStyle.body).foregroundStyle(Theme.muted)
                    } else {
                        Label("找到 \(chains.count) 条持股路径，路径比例合计 \(Ownership.percentLabel(total))", systemImage: "checkmark.circle.fill")
                            .font(.system(size: 15, weight: .semibold))
                        ForEach(chains) { c in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(store.chainText(c)).font(TypeStyle.body).textSelection(.enabled)
                                if c.hasNominee {
                                    Text("包含已记录的代持关系").font(TypeStyle.metadata).foregroundStyle(Theme.amberText)
                                }
                            }
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.band, in: .rect(cornerRadius: 12))
                        }
                    }
                    if let breakdown, breakdown.unknown > 0.005 {
                        Label("目标公司有 \(Ownership.percentLabel(breakdown.unknown)) 的最终持股尚未识别", systemImage: "exclamationmark.triangle")
                            .font(TypeStyle.body).foregroundStyle(Theme.amberText)
                    }
                    if let breakdown, !breakdown.cyclicCompanyIDs.isEmpty {
                        Text("存在循环持股；简单路径合计不能作为最终受益比例。请核对结构并单独计算。").font(TypeStyle.body).foregroundStyle(Theme.amberText)
                    }
                }
            }
        } leading: {
            if !chains.isEmpty {
                Button("复制链条") {
                    let text = chains.map { store.chainText($0) }.joined(separator: "\n")
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(text, forType: .string)
                    store.showToast("链条已复制。")
                }
                .buttonStyle(PillButtonStyle(.secondary))
            }
        } trailing: {
            Button("完成") { dismiss() }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
        }
        .onExitCommand { dismiss() }
    }
}
