import SwiftUI
import AppKit

// MARK: - ⌘K 快速查找

/// 输入公司名、别名、曾用名、注册号或人名，直接打开。
struct QuickSearchSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var selectedHitID: String?
    @FocusState private var focused: Bool

    private enum Hit: Identifiable {
        case company(Company)
        case person(Person)
        var id: String {
            switch self {
            case .company(let c): "c-\(c.id)"
            case .person(let p): "p-\(p.id)"
            }
        }
    }

    private var hits: [Hit] {
        let terms = searchForms(query)
        guard !terms.isEmpty else { return [] }
        let cs = store.companies.filter { company in
            matchesSearch(terms, sources: [
                company.searchText,
                store.jurisdictionName(company.jurisdiction),
                store.groups(containing: company.id).map(\.name).joined(separator: " "),
            ])
        }
            .sorted { $0.name < $1.name }.map(Hit.company)
        let ps = store.people.filter { matchesSearch(terms, sources: [$0.name] + $0.aliases) }
            .sorted { $0.name < $1.name }.map(Hit.person)
        return Array((cs + ps).prefix(30))
    }

    var body: some View {
        let results = hits
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 16, weight: .medium)).foregroundStyle(Theme.muted)
                TextField("公司名、别名、曾用名、注册编号或人名", text: $query)
                    .textFieldStyle(.plain).font(.system(size: 18))
                    .focused($focused)
                    .onSubmit { if let h = selectedHit ?? hits.first { open(h) } }
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
            Rectangle().fill(Theme.hairline).frame(height: 1)
            if results.isEmpty {
                VStack(spacing: 6) {
                    Text(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                         ? "输入名称、注册编号或人名，按回车打开第一个结果。"
                         : "没有找到“\(query)”。")
                        .font(TypeStyle.body).foregroundStyle(Theme.muted)
                    Text("按 Esc 关闭").font(TypeStyle.metadata).foregroundStyle(Theme.muted.opacity(0.8))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 2) {
                            ForEach(results) { h in
                                hitRow(h).id(h.id)
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
        }
        .frame(width: 560, height: SheetMetrics.height(420))
        .background(Theme.surface)
        .background {
            // Esc 总能关闭（输入框为空、焦点不在输入框时也一样）
            Button("关闭") { dismiss() }
                .keyboardShortcut(.cancelAction)
                .opacity(0).frame(width: 0, height: 0)
                .accessibilityHidden(true)
        }
        .onAppear { focused = true }
        .onChange(of: hits.map(\.id)) { _, ids in
            if selectedHitID == nil || !ids.contains(selectedHitID!) { selectedHitID = ids.first }
        }
        .onExitCommand { dismiss() }
    }

    private func hitRow(_ h: Hit) -> some View {
        let on = selectedHitID == h.id
        return Button { open(h) } label: {
            row(h, selected: on)
                .padding(.horizontal, 10).frame(height: 50)
                .background(on ? Theme.selection : Color.clear, in: .rect(cornerRadius: 10))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { inside in if inside { selectedHitID = h.id } }
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    @ViewBuilder
    private func row(_ h: Hit, selected: Bool) -> some View {
        let primary = selected ? Theme.onSelection : Theme.ink
        let secondary = selected ? Theme.onSelection.opacity(0.7) : Theme.muted
        switch h {
        case .company(let c):
            HStack(spacing: 10) {
                JurisdictionBadge(code: c.jurisdiction, size: 30, highlighted: selected)
                VStack(alignment: .leading, spacing: 1) {
                    Text(c.name).font(.system(size: 14, weight: .medium)).foregroundStyle(primary).lineLimit(1)
                    Text([store.jurisdictionName(c.jurisdiction), c.registrationNumber, store.groups(containing: c.id).map(\.name).joined(separator: "、")]
                        .filter { !$0.isEmpty }.joined(separator: "，"))
                        .font(TypeStyle.metadata).foregroundStyle(secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
        case .person(let p):
            let roles = store.appointments.filter { $0.personID == p.id && $0.isActive(on: store.today) }
            HStack(spacing: 10) {
                Avatar(name: p.name, size: 30, highlighted: selected)
                VStack(alignment: .leading, spacing: 1) {
                    Text(p.name).font(.system(size: 14, weight: .medium)).foregroundStyle(primary).lineLimit(1)
                    Text(roles.isEmpty ? "人员" : "任 \(roles.count) 家公司董事或高管")
                        .font(TypeStyle.metadata).foregroundStyle(secondary)
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func open(_ h: Hit) {
        switch h {
        case .company(let c): router.companyTab = 0; router.open(company: c.id)
        case .person(let p): router.open(person: p.id)
        }
        dismiss()
    }

    private var selectedHit: Hit? {
        selectedHitID.flatMap { id in hits.first { $0.id == id } }
    }

    private func moveSelection(by offset: Int) {
        let results = hits
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
