import SwiftUI

/// 首页：先回答“今天要处理什么”，再看整体档案状况。
struct DashboardView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    private struct Row: Identifiable {
        var document: Document
        var owner: NodeRef
        var name: String
        var state: ArchiveItem.State
        var id: String { document.id }
    }

    private func attentionRows(scope: Set<String>?) -> [Row] {
        store.documentsNeedingAttention.compactMap { d in
            guard d.owner.kind == .company else { return nil }
            if let scope, !scope.contains(d.owner.id) { return nil }
            let st: ArchiveItem.State
            switch store.freshness(d) {
            case .expired(let n): st = .expired(n)
            case .expiring(let n): st = .expiring(n)
            case .unknown: st = .noDate
            default: st = .needsUpdate
            }
            return Row(document: d, owner: d.owner, name: store.docType(d.typeID)?.name ?? "文件", state: st)
        }
        .sorted { ($0.state.rank, store.name(of: $0.owner)) < ($1.state.rank, store.name(of: $1.owner)) }
    }

    var body: some View {
        let scope = store.companyIDs(forFilter: router.groupFilter)
        let companies = store.companies.filter { scope?.contains($0.id) ?? true }.sorted { $0.name < $1.name }
        let archives = companies.map { ($0, store.archive(of: $0)) }
        let all = archives.flatMap { $0.1 }.filter { $0.state != .marked(.notApplicable) }
        let have = all.filter { $0.state.hasFile }.count
        let expired = all.filter { if case .expired = $0.state { true } else { false } }.count
        let expiring = all.filter { if case .expiring = $0.state { true } else { false } }.count
        let notObtained = all.filter { $0.state == .marked(.notObtained) }.count
        let attention = attentionRows(scope: scope)
        let personalAttention = store.documentsNeedingAttention.filter { $0.owner.kind == .person }.count
        let jurisdictions = Set(companies.map(\.jurisdiction)).count

        Group {
            if store.isLoading {
                ScrollView { skeleton.padding(Space.pageEdge).frame(maxWidth: 1240).frame(maxWidth: .infinity) }
            } else if store.companies.isEmpty {
                FullPageState {
                    EmptyStateView(symbol: "building.2", title: "还没有公司",
                                   message: "先新建一个集团（从实控人或顶层公司开始），再逐层添加公司；也可以在设置里载入示例数据。",
                                   actionTitle: "新建集团") { router.sheet = .newGroup }
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: Space.section40) {
                        VStack(alignment: .leading, spacing: Space.xl24) {
                            header
                            hero(attention, personalAttention: personalAttention)
                        }

                        attentionList(attention)

                        overview(companies: companies.count, jurisdictions: jurisdictions, have: have, total: all.count,
                                 expiring: expiring, expired: expired, notObtained: notObtained)

                        companiesList(archives)
                    }
                    .padding(Space.pageEdge)
                    .frame(maxWidth: 1240)
                    .frame(maxWidth: .infinity)
                    .appear()
                }
            }
        }
        .navigationTitle("总览")
    }

    // MARK: 顶部

    private var header: some View {
        HStack(spacing: Space.l16) {
            Text(greeting).font(TypeStyle.pageTitle).tracking(Tracking.title).lineLimit(1)
            Spacer(minLength: Space.m12)
            Button { router.sheet = .quickSearch } label: {
                HStack(spacing: Space.s8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
                    Text("查找公司或人员").foregroundStyle(Theme.muted)
                    Spacer(minLength: Space.l16)
                    Text("⌘K").font(.system(size: 11.5, weight: .bold))
                        .padding(.horizontal, Space.s8).frame(height: 24)
                        .background(Theme.band, in: .capsule).foregroundStyle(Theme.ink)
                }
                .font(TypeStyle.body)
                .padding(.leading, Space.l16).padding(.trailing, 6).frame(width: 260, height: 38)
                .background(Theme.surface, in: .capsule)
                .overlay { Capsule().strokeBorder(Theme.hairline) }
                .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("查找公司或人员")
            .accessibilityHint("快捷键 Command K")
        }
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        return h < 12 ? "早上好" : h < 18 ? "下午好" : "晚上好"
    }

    // MARK: 柠檬绿主指标

    private func hero(_ rows: [Row], personalAttention: Int) -> some View {
        let n = rows.count
        return HStack(alignment: .bottom, spacing: Space.l16) {
            VStack(alignment: .leading, spacing: Space.s8) {
                if n > 0 {
                    HStack(alignment: .firstTextBaseline, spacing: Space.s8) {
                        Text("\(n)").font(TypeStyle.display).tracking(Tracking.display).numericTransition()
                        Text("份文件需处理").font(TypeStyle.section).tracking(Tracking.section)
                    }
                    Text(heroSubline(rows))
                        .font(TypeStyle.body).foregroundStyle(Theme.onLime.opacity(0.7))
                } else {
                    Text("一切就绪").font(TypeStyle.display).tracking(Tracking.display)
                    Text("当前范围内没有过期、即将到期或需要更新的公司文件。")
                        .font(TypeStyle.body).foregroundStyle(Theme.onLime.opacity(0.7))
                }
                if personalAttention > 0 {
                    Button {
                        router.filesFilter = 2; router.filesOwnerKind = .person; router.section = .files
                    } label: {
                        Text("另有 \(personalAttention) 份个人文件需处理").underline()
                            .font(TypeStyle.meta).foregroundStyle(Theme.onLime)
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer(minLength: Space.l16)
            if let first = rows.first {
                Button { open(first) } label: {
                    HStack(spacing: 6) {
                        Text("先处理第一份")
                        Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold))
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .padding(.horizontal, 14).frame(height: 30)
                    .background(Theme.emphasis, in: .capsule)
                    .foregroundStyle(Theme.onEmphasis)
                    .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .help("\(store.name(of: first.owner))：\(first.name)")
            } else {
                Image(systemName: "checkmark").font(.system(size: 18, weight: .bold))
                    .frame(width: 44, height: 44)
                    .background(Theme.onLime.opacity(0.1), in: .circle)
                    .accessibilityHidden(true)
            }
        }
        .foregroundStyle(Theme.onLime)
        .padding(Space.xl24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.lime, in: .rect(cornerRadius: Radius.surface, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private func heroSubline(_ rows: [Row]) -> String {
        let expired = rows.filter { if case .expired = $0.state { true } else { false } }.count
        let expiring = rows.filter { if case .expiring = $0.state { true } else { false } }.count
        let other = rows.count - expired - expiring
        var parts: [String] = []
        if expired > 0 { parts.append("\(expired) 份已过期") }
        if expiring > 0 { parts.append("\(expiring) 份即将到期") }
        if other > 0 { parts.append("\(other) 份需更新或日期待核对") }
        return parts.joined(separator: "，")
    }

    private func open(_ r: Row) {
        if r.owner.kind == .company { router.companyTab = 0; router.open(company: r.owner.id) }
        else { router.sheet = .document(r.document.id) }
    }

    // MARK: 需要处理

    private func sectionHeader<Trailing: View>(_ title: String, _ subtitle: String? = nil,
                                               @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(TypeStyle.section).tracking(Tracking.section)
                if let subtitle { Text(subtitle).font(TypeStyle.meta).foregroundStyle(Theme.muted) }
            }
            Spacer()
            trailing()
        }
    }

    @ViewBuilder
    private func attentionList(_ rows: [Row]) -> some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: Space.m12) {
                sectionHeader("需要处理", "已过期、即将到期、需要更新或日期待核对") {
                    if rows.count > 8 {
                        Button("查看全部 \(rows.count) 份") { router.filesFilter = 2; router.filesOwnerKind = .company; router.section = .files }
                            .buttonStyle(PillButtonStyle(.quiet, size: .small))
                    }
                }
                VStack(spacing: 0) {
                    HStack {
                        Text("公司").frame(maxWidth: .infinity, alignment: .leading)
                        Text("条目").frame(width: 150, alignment: .leading)
                        Text("状态").frame(width: 110, alignment: .leading)
                        Text("到期").frame(width: 96, alignment: .leading)
                    }
                    .font(TypeStyle.micro).foregroundStyle(Theme.muted)
                    .padding(.horizontal, Space.l16).frame(height: 36)
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                    ForEach(Array(rows.prefix(8).enumerated()), id: \.element.id) { pair in
                        let r = pair.element
                        if pair.offset > 0 { Rectangle().fill(Theme.hairline).frame(height: 1).padding(.horizontal, Space.l16) }
                        Button { open(r) } label: {
                            HStack {
                                HStack(spacing: 10) {
                                    if r.owner.kind == .company, let c = store.company(r.owner.id) {
                                        JurisdictionBadge(code: c.jurisdiction, size: 28)
                                    } else {
                                        Avatar(name: store.name(of: r.owner), size: 28)
                                    }
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(store.name(of: r.owner)).font(TypeStyle.rowTitle).lineLimit(1)
                                        Text(r.owner.kind == .company ? (store.company(r.owner.id)?.registrationNumber ?? "") : "人员")
                                            .font(.mono(11.5)).foregroundStyle(Theme.muted)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .help(store.name(of: r.owner))
                                Text(r.name).font(.system(size: 13.5)).lineLimit(1).frame(width: 150, alignment: .leading)
                                StatusPill(state: r.state).frame(width: 110, alignment: .leading)
                                Text(Freshness.expiry(of: r.document, type: store.docType(r.document.typeID))?.description ?? "—")
                                    .font(.mono(12.5)).foregroundStyle(r.state.emphasisColor)
                                    .frame(width: 96, alignment: .leading)
                            }
                            .padding(.horizontal, Space.l16).frame(height: 56)
                            .contentShape(.rect)
                        }
                        .buttonStyle(RowButtonStyle())
                    }
                }
                .padding(.vertical, Space.xs4)
                .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
            }
        }
    }

    // MARK: 档案概况

    private func overview(companies: Int, jurisdictions: Int, have: Int, total: Int,
                          expiring: Int, expired: Int, notObtained: Int) -> some View {
        let ratio = total == 0 ? 0 : Double(have) / Double(total)
        let pct = Int((ratio * 100).rounded())
        return VStack(alignment: .leading, spacing: Space.m12) {
            sectionHeader("档案概况", store.filterName(router.groupFilter)) { EmptyView() }
            HStack(alignment: .top, spacing: 0) {
                metric("公司", "\(companies)", "\(jurisdictions) 个法域") { router.section = .companies }
                metricDivider
                VStack(alignment: .leading, spacing: 6) {
                    Text("已归档比例").font(TypeStyle.meta).foregroundStyle(Theme.muted)
                    Text("\(pct)%").font(TypeStyle.title).tracking(Tracking.title).numericTransition()
                    ProgressCapsule(value: ratio).frame(maxWidth: 160)
                    Text("已归档 \(have) / \(total) 条").font(TypeStyle.meta).foregroundStyle(Theme.muted).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Space.xl24)
                metricDivider
                metric("30 天内到期", "\(expiring)",
                       expired > 0 ? "另有 \(expired) 份已过期" : (expiring == 0 ? "30 天内没有文件到期" : "点按查看即将到期的文件"),
                       valueColor: expiring > 0 ? Theme.amberText : Theme.ink,
                       captionColor: expired > 0 ? Theme.danger : Theme.muted) {
                    router.filesFilter = 1; router.filesOwnerKind = .company; router.filesHorizon = 30; router.section = .files
                }
                metricDivider
                metric("未取得", "\(notObtained)",
                       notObtained > 0 ? "已明确标记暂未取得" : "没有标记为未取得的条目",
                       valueColor: notObtained > 0 ? Theme.amberText : Theme.ink)
            }
            .padding(.vertical, Space.xl24)
            .fixedSize(horizontal: false, vertical: true)
            .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
        }
    }

    private var metricDivider: some View {
        Rectangle().fill(Theme.hairline).frame(width: 1).frame(maxHeight: .infinity)
    }

    @ViewBuilder
    private func metric(_ title: String, _ value: String, _ caption: String,
                        valueColor: Color = Theme.ink, captionColor: Color = Theme.muted,
                        action: (() -> Void)? = nil) -> some View {
        let content = VStack(alignment: .leading, spacing: 6) {
            Text(title).font(TypeStyle.meta).foregroundStyle(Theme.muted)
            Text(value).font(TypeStyle.title).tracking(Tracking.title).numericTransition().foregroundStyle(valueColor)
            Text(caption).font(TypeStyle.meta).foregroundStyle(captionColor).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Space.xl24)
        .contentShape(.rect)
        if let action {
            Button(action: action) { content }.buttonStyle(.plain)
                .accessibilityElement(children: .combine)
        } else {
            content.accessibilityElement(children: .combine)
        }
    }

    // MARK: 公司

    private func companiesList(_ archives: [(Company, [ArchiveItem])]) -> some View {
        VStack(alignment: .leading, spacing: Space.m12) {
            sectionHeader("公司档案") {
                Button("矩阵视图") { router.companiesMatrix = true; router.section = .companies }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
            }
            VStack(spacing: 0) {
                ForEach(Array(archives.enumerated()), id: \.element.0.id) { entry in
                    let idx = entry.offset
                    let pair = entry.element
                    let counted = pair.1.filter { $0.state != .marked(.notApplicable) }
                    let have = counted.filter(\.state.hasFile).count
                    let bad = counted.filter(\.state.needsAttention).count
                    if idx > 0 { Rectangle().fill(Theme.hairline).frame(height: 1).padding(.horizontal, Space.l16) }
                    Button { router.companyTab = 0; router.open(company: pair.0.id) } label: {
                        HStack(spacing: Space.m12) {
                            JurisdictionBadge(code: pair.0.jurisdiction, size: 28)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(pair.0.name).font(TypeStyle.rowTitle).lineLimit(1)
                                Text(pair.0.registrationNumber.isEmpty ? store.jurisdictionName(pair.0.jurisdiction) : pair.0.registrationNumber)
                                    .font(.mono(11.5)).foregroundStyle(Theme.muted).lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .help(pair.0.name)
                            if bad > 0 { Pill(text: "\(bad) 需处理", kind: .warn) }
                            ProgressCapsule(value: counted.isEmpty ? 0 : Double(have) / Double(counted.count))
                                .frame(width: 120)
                            Text("\(have)/\(counted.count)").font(.mono(12)).foregroundStyle(Theme.muted)
                                .frame(width: 52, alignment: .trailing)
                        }
                        .padding(.horizontal, Space.l16).frame(height: 56)
                        .contentShape(.rect)
                    }
                    .buttonStyle(RowButtonStyle())
                }
            }
            .padding(.vertical, Space.xs4)
            .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
        }
    }

    // MARK: 加载

    private var skeleton: some View {
        VStack(alignment: .leading, spacing: Space.section40) {
            HStack {
                SkeletonBlock(width: 160, height: 28)
                Spacer()
                SkeletonBlock(width: 260, height: 38)
            }
            SkeletonBlock(height: 120)
            VStack(alignment: .leading, spacing: Space.m12) {
                SkeletonBlock(width: 120, height: 17)
                VStack(spacing: Space.l16) {
                    ForEach(0..<5, id: \.self) { _ in SkeletonBlock(height: 24) }
                }
                .padding(Space.l16)
                .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
            }
            HStack(spacing: Space.l16) {
                ForEach(0..<4, id: \.self) { _ in SkeletonBlock(height: 72) }
            }
            .padding(Space.xl24)
            .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
        }
        .accessibilityElement()
        .accessibilityLabel("正在读取档案")
    }
}

/// 细长进度条：柠檬绿表示已归档部分。
struct ProgressCapsule: View {
    var value: Double
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.hairline)
                Capsule().fill(Theme.lime)
                    .overlay(Capsule().strokeBorder(Theme.onLime.opacity(0.18), lineWidth: 0.5))
                    .frame(width: max(g.size.width * min(max(value, 0), 1), value > 0 ? 6 : 0))
            }
        }
        .frame(height: 6)
        .accessibilityElement()
        .accessibilityLabel("已归档比例")
        .accessibilityValue("\(Int((min(max(value, 0), 1) * 100).rounded()))%")
    }
}

/// 表格行按钮：悬停时浅灰底。
struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        RowBody(configuration: configuration)
    }
    private struct RowBody: View {
        let configuration: Configuration
        @State private var hover = false
        var body: some View {
            configuration.label
                .background(configuration.isPressed ? Theme.band : hover ? Theme.band.opacity(0.6) : .clear, in: .rect(cornerRadius: Radius.row))
                .onHover { hover = $0 }
        }
    }
}
