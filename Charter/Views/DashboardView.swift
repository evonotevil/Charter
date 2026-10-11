import SwiftUI

/// 首页按顺序回答三个问题，每个问题一个承载面：
/// 现在要处理几件事（柠檬绿主指标）→ 随时能出哪些材料（按用途）→ 接下来 30 天（文件到期与合规截止合在一条时间线），
/// 最后是在等回件。公司完成度在“公司”页（列表/矩阵）里看。
struct DashboardView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var reissue: ReissueTarget?
    /// 展开的用途（默认全部收起）。
    @State private var expandedPurposes: Set<String> = []

    private struct Row: Identifiable {
        var document: Document
        var owner: NodeRef
        var name: String
        var state: ArchiveItem.State
        var id: String { document.id }
    }

    private func attentionRows() -> [Row] {
        store.attentionCompanyDocuments(forFilter: router.groupFilter).map { d in
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

    /// 时间线里的合规事项：需要我动手的（待交办、待发送、交办太久没回音），30 天内截止或已逾期。
    /// 只在开启“合规申报与交办”时显示。
    private func actionObligations(scope: Set<String>?) -> [Obligation] {
        guard store.complianceOn else { return [] }
        return store.openObligations.filter { o in
            (scope?.contains(o.company.id) ?? true) && store.needsMe(o)
                && (o.daysLeft(from: store.today) <= 30 || store.waitingTooLong(o))
        }
    }

    /// 已交办、正常等回件的合规事项：列在“在等回件”。
    private func waitingObligations(scope: Set<String>?) -> [Obligation] {
        guard store.complianceOn else { return [] }
        return store.openObligations.filter { o in
            (scope?.contains(o.company.id) ?? true) && o.status.isHandedOff && !store.waitingTooLong(o)
        }
        .sorted { $0.due < $1.due }
    }

    var body: some View {
        let scope = store.companyIDs(forFilter: router.groupFilter)
        let companies = store.companies.filter { scope?.contains($0.id) ?? true }.sorted { $0.name < $1.name }
        let attention = attentionRows()
        let obligations = actionObligations(scope: scope)
        let entries = timelineEntries(attention, obligations)
        let personalAttention = store.attentionPersonalCount

        Group {
            if store.isLoading {
                ScrollView { skeleton.padding(Space.pageEdge).frame(maxWidth: 1240).frame(maxWidth: .infinity) }
            } else if store.companies.isEmpty {
                FirstRunView()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: Space.section40) {
                        VStack(alignment: .leading, spacing: Space.xl24) {
                            header
                            hero(entries, documents: attention.count, obligations: obligations, personalAttention: personalAttention)
                        }

                        readinessSection(purposes(companies))

                        timeline(entries, documentTotal: attention.count)

                        WaitingRequestsSection(scope: scope, obligations: waitingObligations(scope: scope))
                    }
                    .padding(Space.pageEdge)
                    .frame(maxWidth: 1240)
                    .frame(maxWidth: .infinity)
                    .appear()
                }
            }
        }
        .navigationTitle("总览")
        .reissueSheet($reissue)
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

    private func hero(_ entries: [Entry], documents: Int, obligations: [Obligation], personalAttention: Int) -> some View {
        let n = entries.count
        return HStack(alignment: .bottom, spacing: Space.l16) {
            VStack(alignment: .leading, spacing: Space.s8) {
                if n > 0 {
                    HStack(alignment: .firstTextBaseline, spacing: Space.s8) {
                        Text("\(n)").font(TypeStyle.display).tracking(Tracking.display).numericTransition()
                        Text(obligations.isEmpty ? "份文件需处理" : "项需处理").font(TypeStyle.section).tracking(Tracking.section)
                    }
                    Text(heroSubline(entries, documents: documents, obligations: obligations))
                        .font(TypeStyle.body).foregroundStyle(Theme.onLime.opacity(0.7))
                } else {
                    Text("一切就绪").font(TypeStyle.display).tracking(Tracking.display)
                    Text(store.complianceOn ? "当前范围内没有需要处理的文件，30 天内也没有待你办理的合规事项。"
                                            : "当前范围内没有过期、即将到期或需要更新的公司文件。")
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
            if let first = entries.first {
                Button { open(first) } label: {
                    HStack(spacing: 6) {
                        Text("先处理第一项")
                        Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold))
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .padding(.horizontal, 14).frame(height: 30)
                    .background(Theme.emphasis, in: .capsule)
                    .foregroundStyle(Theme.onEmphasis)
                    .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .help(firstHelp(first))
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

    private func firstHelp(_ e: Entry) -> String {
        if let r = e.row { return "\(store.name(of: r.owner))：\(r.name)" }
        if let o = e.obligation { return "\(o.company.name)：\(o.rule.name)" }
        return ""
    }

    private func heroSubline(_ entries: [Entry], documents: Int, obligations: [Obligation]) -> String {
        let rows = entries.compactMap(\.row)
        let expired = rows.filter { if case .expired = $0.state { true } else { false } }.count
        let expiring = rows.filter { if case .expiring = $0.state { true } else { false } }.count
        let other = rows.count - expired - expiring
        var parts: [String] = []
        if expired > 0 { parts.append("\(expired) 份已过期") }
        if expiring > 0 { parts.append("\(expiring) 份即将到期") }
        if other > 0 { parts.append("\(other) 份需更新或日期待核对") }
        if !obligations.isEmpty {
            let late = obligations.filter { $0.daysLeft(from: store.today) < 0 }.count
            parts.append(late > 0 ? "\(obligations.count) 件合规事项待你处理（\(late) 件已逾期）" : "\(obligations.count) 件合规事项待你处理")
        }
        return parts.joined(separator: "，")
    }

    private func open(_ e: Entry) {
        if let r = e.row { open(r) } else if let o = e.obligation { router.sheet = .obligation(o.key) }
    }

    private func open(_ r: Row) {
        if r.owner.kind == .company { router.companyTab = 0; router.open(company: r.owner.id) }
        else { router.sheet = .document(r.document.id) }
    }

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

    // MARK: 随时能出哪些材料

    private struct Purpose: Identifiable {
        var template: PacketTemplate
        var rows: [PurposeReadiness]
        var id: String { template.id }
        var ready: Int { rows.filter(\.complete).count }
    }

    /// 当前集团范围内每个用途的准备度；缺件的公司排在前面，缺得少的更靠前。
    private func purposes(_ companies: [Company]) -> [Purpose] {
        let all = PurposeReadiness.compute(companyIDs: companies.map(\.id), store: store)
        return store.library.packets.compactMap { t in
            let rows = all.filter { $0.template.id == t.id }.sorted { a, b in
                if a.complete != b.complete { return !a.complete }
                if a.missing.count != b.missing.count { return a.missing.count < b.missing.count }
                return a.company.name < b.company.name
            }
            return rows.isEmpty ? nil : Purpose(template: t, rows: rows)
        }
    }

    @ViewBuilder
    private func readinessSection(_ list: [Purpose]) -> some View {
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: Space.m12) {
                sectionHeader("随时能出哪些材料", "按用途检查\(store.filterName(router.groupFilter))的文件包，缺的那份可以直接请负责方补发。") {
                    Button("查看矩阵") { router.companiesMode = .matrix; router.go(.companies) }
                        .buttonStyle(PillButtonStyle(.quiet, size: .small))
                        .help("在公司页查看公司 × 档案类别矩阵")
                }
                VStack(spacing: 0) {
                    ForEach(Array(list.enumerated()), id: \.element.id) { pair in
                        if pair.offset > 0 { Rectangle().fill(Theme.hairline).frame(height: 1).padding(.horizontal, Space.l16) }
                        purposeRow(pair.element)
                    }
                }
                .padding(.vertical, Space.xs4)
                .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
                .clipShape(.rect(cornerRadius: Radius.surface, style: .continuous))
            }
        }
    }

    private func purposeRow(_ p: Purpose) -> some View {
        let isOpen = expandedPurposes.contains(p.id)
        let missing = p.rows.count - p.ready
        return VStack(spacing: 0) {
            Button {
                withAnimation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion)) {
                    if isOpen { expandedPurposes.remove(p.id) } else { expandedPurposes.insert(p.id) }
                }
            } label: {
                HStack(spacing: Space.l16) {
                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.muted)
                        .rotationEffect(.degrees(isOpen ? 90 : 0))
                        .frame(width: 12)
                    Text(p.template.name).font(TypeStyle.rowTitle).lineLimit(1)
                        .frame(width: 160, alignment: .leading)
                    ReadinessTrack(fraction: Double(p.ready) / Double(max(p.rows.count, 1)))
                        .frame(width: 160)
                    Spacer(minLength: Space.m12)
                    Text("\(p.ready) 家可随时导出").font(TypeStyle.metadata).monospacedDigit()
                        .foregroundStyle(p.ready > 0 ? Theme.ink : Theme.muted)
                    if missing > 0 {
                        Text("\(missing) 家还缺文件").font(TypeStyle.metadata).monospacedDigit()
                            .foregroundStyle(Theme.amberText)
                    }
                }
                .padding(.horizontal, Space.l16).frame(height: 52)
                .contentShape(.rect)
            }
            .buttonStyle(RowButtonStyle())
            .accessibilityLabel("\(p.template.name)：\(p.ready) 家可随时导出" + (missing > 0 ? "，\(missing) 家还缺文件" : ""))
            .accessibilityValue(isOpen ? "已展开" : "已收起")
            .accessibilityHint("展开查看每家公司缺什么")

            if isOpen {
                VStack(spacing: 0) {
                    ForEach(p.rows) { r in companyReadinessRow(r) }
                }
                .padding(.leading, 28).padding(.bottom, Space.s8)
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private func companyReadinessRow(_ r: PurposeReadiness) -> some View {
        HStack(spacing: Space.l16) {
            Button { router.companyTab = 0; router.open(company: r.company.id) } label: {
                HStack(spacing: 10) {
                    JurisdictionBadge(code: r.company.jurisdiction, size: 24)
                    Text(r.company.name).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .frame(width: 240, alignment: .leading)
            .help("打开\(r.company.name)的档案")
            Text(r.complete ? "齐全，可随时导出" : "还缺：" + r.missing.joined(separator: "、"))
                .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                .lineLimit(2)
                .help(r.complete ? "" : r.missingDetail.joined(separator: "\n"))
                .frame(maxWidth: .infinity, alignment: .leading)
            PurposeReadinessAction(row: r) { reissue = $0 }
                .frame(width: 140, alignment: .trailing)
        }
        .padding(.horizontal, Space.l16).padding(.vertical, 10)
        .accessibilityElement(children: .contain)
    }

    // MARK: 接下来 30 天

    private enum Bucket: Int, CaseIterable {
        case overdue, week, month, undated
        var title: String {
            switch self {
            case .overdue: "已逾期"
            case .week: "本周"
            case .month: "30 天内"
            case .undated: "需更新/待核对"
            }
        }
        var color: Color {
            switch self {
            case .overdue: Theme.danger
            case .week: Theme.amberText
            default: Theme.muted
            }
        }
    }

    /// 时间线上的一项：一份文件或一件合规事项。
    private struct Entry: Identifiable {
        var row: Row?
        var obligation: Obligation?
        var date: Day?
        var bucket: Bucket
        var id: String { row.map { "d-\($0.document.id)" } ?? "o-\(obligation?.key ?? "")" }
    }

    /// 文件到期/需更新与合规截止合成一条时间线，按日期排序。
    /// 没有到期日、或需更新但到期日还远的文件放在最后的“需更新/待核对”。
    private func timelineEntries(_ rows: [Row], _ obligations: [Obligation]) -> [Entry] {
        let today = store.today
        var out: [Entry] = []
        for r in rows {
            let expiry = Freshness.expiry(of: r.document, type: store.docType(r.document.typeID))
            let bucket: Bucket
            switch r.state {
            case .expired:
                bucket = .overdue
            case .expiring:
                if let e = expiry { bucket = today.days(until: e) <= 7 ? .week : .month } else { bucket = .undated }
            default:
                bucket = .undated
            }
            out.append(Entry(row: r, obligation: nil, date: expiry, bucket: bucket))
        }
        for o in obligations {
            let left = o.daysLeft(from: today)
            let bucket: Bucket = left < 0 ? .overdue : (left <= 7 || store.waitingTooLong(o)) ? .week : .month
            out.append(Entry(row: nil, obligation: o, date: o.due, bucket: bucket))
        }
        return out.sorted { a, b in
            if a.bucket != b.bucket { return a.bucket.rawValue < b.bucket.rawValue }
            switch (a.date, b.date) {
            case let (x?, y?) where x != y: return x < y
            case (.some, .none): return true
            case (.none, .some): return false
            default: return a.id < b.id
            }
        }
    }

    private static let perBucket = 6

    private func timeline(_ entries: [Entry], documentTotal: Int) -> some View {
        let groups: [(Bucket, [Entry], Int)] = Bucket.allCases.compactMap { b in
            let all = entries.filter { $0.bucket == b }
            return all.isEmpty ? nil : (b, Array(all.prefix(Self.perBucket)), all.count)
        }
        let truncated = groups.contains { $0.1.count < $0.2 }
        let subtitle = store.complianceOn ? "文件到期与合规截止，按日期排列" : "文件到期与需要更新的文件，按日期排列"
        return VStack(alignment: .leading, spacing: Space.m12) {
            sectionHeader("接下来 30 天", subtitle) { EmptyView() }
            VStack(spacing: 0) {
                if groups.isEmpty {
                    Text(store.complianceOn ? "30 天内没有到期的文件，也没有待你办理的合规截止。" : "30 天内没有到期或需要更新的文件。")
                        .font(TypeStyle.body).foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, Space.l16).padding(.vertical, Space.l16)
                }
                ForEach(Array(groups.enumerated()), id: \.element.0) { gi, group in
                    if gi > 0 { Rectangle().fill(Theme.hairline).frame(height: 1) }
                    HStack(spacing: Space.s8) {
                        Text(group.0.title).font(TypeStyle.micro).foregroundStyle(group.0.color)
                        Text("\(group.2)").font(.mono(11.5)).foregroundStyle(Theme.muted)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, Space.l16).frame(height: 32)
                    .background(Theme.band.opacity(0.5))
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)
                    ForEach(Array(group.1.enumerated()), id: \.element.id) { pair in
                        if pair.offset > 0 { Rectangle().fill(Theme.hairline).frame(height: 1).padding(.horizontal, Space.l16) }
                        if let r = pair.element.row {
                            attentionRow(r)
                        } else if let o = pair.element.obligation {
                            obligationRow(o)
                        }
                    }
                }
            }
            .padding(.vertical, Space.xs4)
            .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
            .clipShape(.rect(cornerRadius: Radius.surface, style: .continuous))

            if store.complianceOn || truncated {
                HStack(spacing: Space.s8) {
                    Spacer()
                    if truncated && documentTotal > 0 {
                        Button("查看全部 \(documentTotal) 份需处理文件") {
                            router.filesFilter = 2; router.filesOwnerKind = .company; router.section = .files
                        }
                        .buttonStyle(PillButtonStyle(.quiet, size: .small))
                    }
                    if store.complianceOn {
                        Button("查看全部日程") { router.openCalendar() }
                            .buttonStyle(PillButtonStyle(.quiet, size: .small))
                            .help("打开合规日历：按月排列所有截止日，可筛选、交办或导出")
                    }
                }
            }
        }
    }

    private func attentionRow(_ r: Row) -> some View {
        HStack(spacing: 0) {
            attentionRowButton(r)
            ActionMenu(systemImage: "ellipsis", kind: .quiet, size: .small, entries: attentionMenu(r))
                .fixedSize()
                .help("更多操作")
                .frame(width: 32)
                .padding(.trailing, Space.s8)
        }
    }

    /// 行尾“…”：请负责方补发（已在等时显示在等谁），打开文件详情。
    private func attentionMenu(_ r: Row) -> [MenuEntry] {
        let owner = r.owner
        let typeID = r.document.typeID
        let docID = r.document.id
        var entries: [MenuEntry] = []
        if let waiting = store.openRequest(owner: owner, typeID: typeID) {
            entries.append(.item("已在等\(store.party(waiting.partyID)?.name ?? "负责方")补发", systemImage: "hourglass", disabled: true) {})
        } else {
            entries.append(.item("请负责方补发…", systemImage: "paperplane") {
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(250))
                    reissue = ReissueTarget(owner: owner, typeIDs: [typeID])
                }
            })
        }
        entries.append(.item("查看文件详情", systemImage: "doc.text.magnifyingglass") { router.sheet = .document(docID) })
        return entries
    }

    private func attentionRowButton(_ r: Row) -> some View {
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
                Text(r.name).font(.system(size: 13.5)).lineLimit(1).frame(width: 190, alignment: .leading)
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

    /// 合规事项行：点按打开详情；行尾是下一步操作（交办、发送、催办…）和“…”。
    private func obligationRow(_ o: Obligation) -> some View {
        let left = o.daysLeft(from: store.today)
        let late = store.waitingTooLong(o)
        return HStack(spacing: 0) {
            Button { router.sheet = .obligation(o.key) } label: {
                HStack {
                    HStack(spacing: 10) {
                        JurisdictionBadge(code: o.company.jurisdiction, size: 28)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(o.company.name).font(TypeStyle.rowTitle).lineLimit(1)
                            Text(store.stateLine(o)).font(.system(size: 11.5))
                                .foregroundStyle(late ? Theme.amberText : Theme.muted).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .help(o.company.name)
                    HStack(spacing: 4) {
                        Text(o.rule.name).font(.system(size: 13.5)).lineLimit(1)
                        TrustBadge(trust: store.trust(o))
                    }
                    .frame(width: 190, alignment: .leading)
                    Pill(text: left < 0 ? "逾期 \(-left) 天" : left == 0 ? "今天截止" : "\(left) 天后截止",
                         kind: left < 0 ? .bad : left <= 7 ? .warn : .neutral)
                        .frame(width: 110, alignment: .leading)
                    Text(o.due.description)
                        .font(.mono(12.5)).foregroundStyle(left < 0 ? Theme.danger : Theme.ink)
                        .frame(width: 96, alignment: .leading)
                }
                .padding(.leading, Space.l16).padding(.trailing, Space.s8).frame(height: 56)
                .contentShape(.rect)
            }
            .buttonStyle(RowButtonStyle())
            NextStepControls(obligation: o, large: false, emphasized: false)
                .padding(.horizontal, Space.xs4)
            ActionMenu(systemImage: "ellipsis", kind: .quiet, size: .small, entries: obligationMenu(o))
                .fixedSize()
                .help("更多操作")
                .frame(width: 32)
                .padding(.trailing, Space.s8)
        }
        .contextMenu { ObligationContextMenu(obligation: o) }
    }

    /// 合规事项行尾“…”：规则未核对且已逾期时先确认截止日；详情、打开公司、标记完成。
    private func obligationMenu(_ o: Obligation) -> [MenuEntry] {
        var entries: [MenuEntry] = []
        let ruleID = o.rule.id
        let companyID = o.company.id
        let key = o.key
        if o.daysLeft(from: store.today) < 0 && !store.trust(o).isConfirmed && !o.status.isHandedOff {
            entries.append(.item("向负责方确认截止日…", systemImage: "checkmark.seal") {
                router.sheet = .confirmRule(ruleID: ruleID, companyID: companyID)
            })
        }
        entries.append(.item("事项详情", systemImage: "info.circle") { router.sheet = .obligation(key) })
        entries.append(.item("打开公司", systemImage: "building.2") { router.open(company: companyID) })
        entries.append(.divider)
        entries.append(.item("标记完成", systemImage: "checkmark") { store.complete(o) })
        return entries
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
