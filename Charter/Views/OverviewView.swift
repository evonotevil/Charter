import SwiftUI

/// 档案矩阵：每个集团一张卡片，公司为行、档案类别为列。
/// 每格是一枚小色块：绿色已归档、琥珀需处理、红色已过期、浅灰空格未归档，扫一眼就能看出缺口。
struct OverviewView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @State private var query = ""
    @State private var onlyAttention = false

    static let nameWidth: CGFloat = 300
    static let progressWidth: CGFloat = 84
    static let cellWidth: CGFloat = 76
    static let maxColumns = 9

    private struct Block: Identifiable {
        var id: String
        var title: String
        var subtitle: String
        var groupID: String?
        var rows: [GroupRow]
        /// 这一块自己的列：块内公司实际管理的类别（最多 maxColumns 列），按全局顺序排列，
        /// 同一类别在不同集团里尽量出现在相同位置。
        var categories: [String]
    }

    private func columns(for rows: [GroupRow], order: [String: Int]) -> [String] {
        let list = rows.compactMap { store.company($0.companyID) }
        return store.overviewCategories(for: list).prefix(Self.maxColumns)
            .sorted { (order[$0] ?? .max) < (order[$1] ?? .max) }
    }

    private var blocks: [Block] {
        let order = Dictionary(uniqueKeysWithValues: store.overviewCategories(for: store.companies).enumerated().map { ($1, $0) })
        var out: [Block] = []
        let groups = router.groupFilter == nil ? store.corporateGroups
            : store.corporateGroups.filter { $0.id == router.groupFilter }
        for g in groups {
            let rows = store.rows(of: g)
            out.append(Block(id: g.id, title: g.name, subtitle: g.tops.isEmpty ? "还没有设置顶层" : "顶层：\(store.topLabel(g))",
                             groupID: g.id, rows: rows, categories: columns(for: rows, order: order)))
        }
        if router.groupFilter == nil || router.groupFilter == Router.ungrouped {
            let un = store.ungroupedCompanies
            if !un.isEmpty {
                let rows = un.map { GroupRow(companyID: $0.id, depth: 0, parent: nil, percent: nil, viaNominee: false, unconnected: false) }
                out.append(Block(id: Router.ungrouped, title: "未归入集团", subtitle: "这些公司还不属于任何集团",
                                 groupID: nil, rows: rows, categories: columns(for: rows, order: order)))
            }
        }
        return out
    }

    private func visible(_ c: Company, _ items: [ArchiveItem]) -> Bool {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        if !q.isEmpty && !c.searchText.contains(q) && !store.jurisdictionName(c.jurisdiction).contains(q) { return false }
        if onlyAttention && !items.contains(where: { $0.state.needsAttention || $0.state == .missing }) { return false }
        return true
    }

    var body: some View {
        let allowedIDs = store.companyIDs(forFilter: router.groupFilter)
        let shownCompanies = store.companies.filter { c in allowedIDs.map { $0.contains(c.id) } ?? true }
        let archives = Dictionary(uniqueKeysWithValues: shownCompanies.map { ($0.id, store.archive(of: $0)) })
        let filtering = !query.isEmpty || onlyAttention
        let shown: [Block] = blocks.compactMap { (b: Block) -> Block? in
            var copy = b
            copy.rows = b.rows.filter { r in
                guard let c = store.company(r.companyID) else { return false }
                return visible(c, archives[c.id] ?? [])
            }
            if copy.rows.isEmpty && filtering { return nil }
            return copy
        }
        Group {
            if store.companies.isEmpty {
                EmptyState(symbol: "building.2", title: "还没有公司",
                           message: "先新建一个集团（从实控人或顶层公司开始），再逐层添加公司；也可以载入示例数据。",
                           actionTitle: "新建集团") { router.sheet = .newGroup }
            } else {
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        header(shownCompanies, archives)
                            .padding(.bottom, 4)
                        ForEach(shown) { b in
                            card(b, rows: b.rows, archives: archives)
                        }
                        if shown.isEmpty {
                            Text(onlyAttention ? "没有需要处理的公司。" : "没有找到符合条件的公司。")
                                .font(TypeStyle.body).foregroundStyle(Theme.muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .surfaceCard()
                        }
                        legend.padding(.top, 4).padding(.leading, 4)
                    }
                    .padding(.horizontal, 24).padding(.bottom, 24)
                }
            }
        }
        .navigationTitle("公司")
    }

    // MARK: 顶部摘要

    private func header(_ list: [Company], _ archives: [String: [ArchiveItem]]) -> some View {
        let all = list.flatMap { archives[$0.id] ?? [] }.filter { $0.state != .marked(.notApplicable) }
        let have = all.filter { $0.state.hasFile }.count
        let expired = all.filter { if case .expired = $0.state { return true } else { return false } }.count
        let expiring = all.filter { if case .expiring = $0.state { return true } else { return false } }.count
        let missing = all.filter { $0.state == .missing }.count
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 16) {
                PillSegmented(options: [(false, "全部"), (true, "只看待处理")], selection: $onlyAttention)
                    .help("只看待处理：只显示有过期、即将到期、需要更新或未归档条目的公司")
                Spacer(minLength: 12)
                searchField
            }
            HStack(spacing: 18) {
                stat("\(list.count)", "家公司")
                stat("\(have)/\(all.count)", "条目已归档")
                if expired > 0 { stat("\(expired)", "份已过期", color: Theme.danger) { router.filesFilter = 1; router.section = .files } }
                if expiring > 0 { stat("\(expiring)", "份 30 天内到期", color: Theme.amberText) { router.filesFilter = 1; router.section = .files } }
                if missing > 0 { stat("\(missing)", "条未归档") }
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.muted)
            TextField("搜索公司、编号或法域", text: $query).textFieldStyle(.plain).font(TypeStyle.body)
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("清除搜索")
            }
        }
        .padding(.horizontal, 12).frame(width: 240, height: Kit.fieldHeight)
        .background(Theme.surface, in: .capsule)
        .overlay(Capsule().strokeBorder(Theme.hairline))
    }

    @ViewBuilder
    private func stat(_ n: String, _ label: String, color: Color? = nil, action: (() -> Void)? = nil) -> some View {
        let content = HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(n).font(.system(size: 15, weight: .semibold)).monospacedDigit().foregroundStyle(color ?? Theme.ink)
            Text(label).font(TypeStyle.body).foregroundStyle(Theme.muted)
        }
        if let action {
            Button(action: action) { content }.buttonStyle(.plain).help("查看即将到期和已过期的文件")
        } else {
            content
        }
    }

    // MARK: 集团卡片

    private func card(_ b: Block, rows: [GroupRow], archives: [String: [ArchiveItem]]) -> some View {
        let items = rows.flatMap { archives[$0.companyID] ?? [] }.filter { $0.state != .marked(.notApplicable) }
        let have = items.filter { $0.state.hasFile }.count
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                GroupIcon(groupID: b.id, size: 30)
                VStack(alignment: .leading, spacing: 1) {
                    Text(b.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text(b.subtitle).font(TypeStyle.metadata).foregroundStyle(Theme.muted).lineLimit(1)
                }
                Spacer(minLength: 12)
                if !items.isEmpty {
                    HStack(spacing: 10) {
                        Text("已归档 \(have)/\(items.count)").font(TypeStyle.metadata).monospacedDigit().foregroundStyle(Theme.muted)
                        ProgressTrack(value: Double(have) / Double(max(items.count, 1)), width: 72)
                    }
                }
                if let gid = b.groupID {
                    ActionMenu(systemImage: "ellipsis", kind: .quiet, size: .small, entries: [
                        .item("在此集团新建公司…", systemImage: "building.2") { router.sheet = .newCompanyInGroup(gid) },
                        .item("编辑集团…", systemImage: "pencil") { router.sheet = .editGroup(gid) },
                        .divider,
                        .item("查看股权结构", systemImage: "point.3.connected.trianglepath.dotted") {
                            router.groupFilter = gid
                            router.section = .structure
                        },
                    ])
                    .fixedSize()
                    .help("集团操作")
                }
            }
            .padding(.horizontal, 6)

            // 放得下时表格铺满卡片宽度；放不下时在卡片内横向滚动
            ViewThatFits(in: .horizontal) {
                grid(b, rows: rows, archives: archives)
                    .frame(maxWidth: .infinity, alignment: .leading)
                ScrollView(.horizontal) {
                    grid(b, rows: rows, archives: archives)
                }
                .scrollIndicators(.automatic)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: .rect(cornerRadius: 18))
    }

    private func grid(_ b: Block, rows: [GroupRow], archives: [String: [ArchiveItem]]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            columnHeader(b.categories)
            ForEach(rows) { r in
                if let c = store.company(r.companyID) {
                    if r.id != rows.first?.id {
                        Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, 10)
                    }
                    OverviewRow(company: c, row: r, groupID: b.groupID, categories: b.categories, items: archives[c.id] ?? [])
                }
            }
            if rows.isEmpty, let gid = b.groupID {
                HStack(spacing: 10) {
                    Text("这个集团还没有公司。").font(TypeStyle.body).foregroundStyle(Theme.muted)
                    Button("在此集团新建公司…") { router.sheet = .newCompanyInGroup(gid) }
                        .buttonStyle(PillButtonStyle(.secondary, size: .small))
                }
                .padding(.vertical, 14).padding(.leading, 10)
            }
        }
    }

    private func columnHeader(_ categories: [String]) -> some View {
        HStack(spacing: 0) {
            Text("公司").frame(width: Self.nameWidth, alignment: .leading)
            Text("已归档").frame(width: Self.progressWidth, alignment: .leading)
            ForEach(categories, id: \.self) { cat in
                Text(cat).lineLimit(2).multilineTextAlignment(.center)
                    .frame(width: Self.cellWidth)
                    .help(cat)
            }
        }
        .font(.system(size: 11.5, weight: .medium)).foregroundStyle(Theme.muted)
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
        .background(Theme.band, in: .rect(cornerRadius: 10))
    }

    private var legend: some View {
        HStack(spacing: 18) {
            ForEach([ArchiveItem.State.valid, .expiring(30), .expired(1), .needsUpdate, .missing, .marked(.restricted)], id: \.self) { s in
                HStack(spacing: 6) {
                    MatrixTile(state: s, size: 18)
                    Text(legendText(s)).font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                }
                .fixedSize()
            }
            HStack(spacing: 6) {
                NotManagedMark().frame(width: 18)
                Text("不管理这一类").font(TypeStyle.metadata).foregroundStyle(Theme.muted)
            }
            .fixedSize()
        }
    }

    private func legendText(_ s: ArchiveItem.State) -> String {
        switch s {
        case .valid: "已归档"
        case .expiring: "即将到期"
        case .expired: "已过期"
        case .needsUpdate: "需要更新"
        case .missing: "未归档"
        default: "已标记原因"
        }
    }
}

/// 细进度条：底色轨道 + 柠檬绿进度。
struct ProgressTrack: View {
    var value: Double
    var width: CGFloat = 48
    var body: some View {
        Capsule().fill(Theme.band)
            .frame(width: width, height: 5)
            .overlay(alignment: .leading) {
                Capsule().fill(Theme.lime).frame(width: max(0, min(1, value)) * width)
            }
            .accessibilityHidden(true)
    }
}

/// 子公司前的折角连线。
private struct Elbow: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addArc(tangent1End: CGPoint(x: r.minX, y: r.maxY), tangent2End: CGPoint(x: r.maxX, y: r.maxY), radius: 5)
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        return p
    }
}

// MARK: - 一行

struct OverviewRow: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var company: Company
    var row: GroupRow
    var groupID: String?
    var categories: [String]
    var items: [ArchiveItem]
    @State private var hover = false

    var body: some View {
        let others = store.groups(containing: company.id).filter { $0.id != groupID }
        let progress = items.filter { $0.state != .marked(.notApplicable) }
        let have = progress.filter { $0.state.hasFile }.count
        HStack(spacing: 0) {
            Button { router.companyTab = 0; router.open(company: company.id) } label: {
                HStack(spacing: 8) {
                    if row.depth > 0 {
                        Elbow().stroke(Theme.edge.opacity(0.7), lineWidth: 1)
                            .frame(width: 10, height: 14)
                            .offset(y: -6)
                            .padding(.leading, CGFloat(row.depth - 1) * 18 + 4)
                    }
                    JurisdictionBadge(code: company.jurisdiction, size: 26)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(company.name).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                        HStack(spacing: 6) {
                            if let p = row.percent {
                                Text(row.viaNominee ? "上级经代持 \(Ownership.percentLabel(p))" : "上级持股 \(Ownership.percentLabel(p))")
                            }
                            if row.unconnected { Text("未连上持股关系").foregroundStyle(Theme.amberText) }
                            if !others.isEmpty { Text("也属于 \(others.map(\.name).joined(separator: "、"))") }
                            if !company.registrationNumber.isEmpty { Text(company.registrationNumber).monospacedDigit() }
                        }
                        .font(.system(size: 11.5)).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .frame(width: OverviewView.nameWidth, alignment: .leading)
            .help(company.name)

            VStack(alignment: .leading, spacing: 5) {
                Text("\(have)/\(progress.count)")
                    .font(.system(size: 12, weight: .medium)).monospacedDigit().foregroundStyle(Theme.ink)
                ProgressTrack(value: Double(have) / Double(max(progress.count, 1)), width: 44)
            }
            .frame(width: OverviewView.progressWidth, alignment: .leading)

            ForEach(categories, id: \.self) { cat in
                OverviewCell(company: company, items: items.filter { ($0.type?.category ?? "其他") == cat })
                    .frame(width: OverviewView.cellWidth)
            }
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 58)
        .background(hover ? Theme.band.opacity(0.6) : .clear, in: .rect(cornerRadius: 10))
        .onHover { hover = $0 }
        .contextMenu {
            Button("打开档案") { router.companyTab = 0; router.open(company: company.id) }
            Button("工商信息") { router.companyTab = 1; router.open(company: company.id) }
            Divider()
            Button("添加上级（股东）…") { router.sheet = .addRelation(companyID: company.id, upward: true) }
            Button("添加下级公司…") { router.sheet = .addRelation(companyID: company.id, upward: false) }
        }
    }
}

struct OverviewCell: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var company: Company
    var items: [ArchiveItem]
    @State private var hover = false

    var body: some View {
        // 同一类别有多个条目时，显示最要紧的那个
        if let item = items.min(by: { $0.state.rank < $1.state.rank }), item.state != .marked(.notApplicable) {
            Button {
                if let d = item.document { router.sheet = .document(d.id) }
                else { router.companyTab = 0; router.open(company: company.id) }
            } label: {
                VStack(spacing: 4) {
                    MatrixTile(state: item.state, size: 26)
                        .scaleEffect(hover ? 1.08 : 1)
                    Text(caption(item)).font(.system(size: 10.5, weight: .medium)).monospacedDigit()
                        .foregroundStyle(captionColor(item.state)).lineLimit(1)
                }
                .frame(maxWidth: .infinity, minHeight: 46)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .onHover { h in withAnimation(.snappy(duration: 0.12)) { hover = h } }
            .help("\(item.name)：\(item.state.label)\(item.note.isEmpty ? "" : "\n备注：\(item.note)")")
            .accessibilityLabel("\(item.name)，\(item.state.label)")
            .contextMenu {
                if item.document == nil {
                    ForEach(ItemMark.allCases) { m in
                        Button("标记为\(m.label)") { store.setMark(m, item: item.typeID, company: company.id) }
                    }
                    Button("清除标记") { store.setMark(nil, item: item.typeID, company: company.id) }
                } else {
                    Button("打开文件") { if let d = item.document { store.open(d) } }
                }
            }
        } else {
            // 这家公司不管理这一类条目（或标记为不适用）：浅灰短横，和“未归档”的浅灰空格区分开
            NotManagedMark()
                .frame(maxWidth: .infinity, minHeight: 46)
                .help(items.isEmpty ? "\(company.name) 不管理这一类条目" : "已标记为不适用")
        }
    }

    private func caption(_ item: ArchiveItem) -> String {
        switch item.state {
        case .expiring(let d): return "\(d) 天后"
        case .expired: return "已过期"
        case .needsUpdate: return "需更新"
        case .noDate: return "无日期"
        case .missing: return " "
        case .marked(let m): return m.label
        default:
            guard let d = item.document?.issueDate else { return "已归档" }
            return String(format: "%04d.%02d", d.year, d.month)
        }
    }

    private func captionColor(_ s: ArchiveItem.State) -> Color {
        switch s {
        case .expired: Theme.danger
        case .expiring, .needsUpdate: Theme.amberText
        default: Theme.muted
        }
    }
}

/// 矩阵里的一格：圆角小色块。颜色 + 图形双重编码，灰度下也能区分。
struct MatrixTile: View {
    var state: ArchiveItem.State
    var size: CGFloat = 26

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
        ZStack {
            shape.fill(fill)
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: size * 0.44, weight: .bold))
                    .foregroundStyle(tint)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private var fill: Color {
        switch state {
        case .valid, .noDate: Theme.limeSoft
        case .expiring, .needsUpdate, .marked(.unverified): Theme.amberSoft
        case .expired: Theme.danger.opacity(0.16)
        case .missing, .marked: Theme.band
        }
    }

    private var tint: Color {
        switch state {
        case .valid, .noDate: Theme.limeText
        case .expiring, .needsUpdate, .marked(.unverified): Theme.amberText
        case .expired: Theme.danger
        default: Theme.muted
        }
    }

    private var symbol: String? {
        switch state {
        case .valid, .noDate: "checkmark"
        case .expiring: "clock"
        case .expired: "exclamationmark"
        case .needsUpdate: "arrow.triangle.2.circlepath"
        case .missing: nil
        case .marked(.notObtained): "questionmark"
        case .marked(.restricted): "lock.fill"
        case .marked(.unverified): "questionmark"
        case .marked(.external): "building.columns"
        case .marked(.notApplicable): "minus"
        }
    }
}

/// 矩阵里“这家公司没有这一类条目”的标记。
struct NotManagedMark: View {
    var body: some View {
        Text("—")
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Theme.muted.opacity(0.45))
            .accessibilityLabel("不适用")
    }
}

/// 条目状态的小图标：颜色 + 形状，灰度下也能区分。
struct StateGlyph: View {
    var state: ArchiveItem.State

    var body: some View {
        switch state {
        case .valid, .noDate:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.primary.opacity(0.75))
        case .expiring:
            Image(systemName: "clock.badge.exclamationmark").foregroundStyle(Theme.amberText)
        case .expired:
            Image(systemName: "xmark.octagon.fill").foregroundStyle(Theme.danger)
        case .needsUpdate:
            Image(systemName: "arrow.triangle.2.circlepath").foregroundStyle(Theme.amberText)
        case .marked(.notObtained):
            Image(systemName: "questionmark.circle").foregroundStyle(.secondary)
        case .marked(.restricted):
            Image(systemName: "lock.circle").foregroundStyle(.secondary)
        case .marked(.unverified):
            Image(systemName: "questionmark.diamond").foregroundStyle(Theme.amberText)
        case .marked(.external):
            Image(systemName: "building.columns").foregroundStyle(.secondary)
        case .marked(.notApplicable):
            Image(systemName: "minus").foregroundStyle(.tertiary)
        case .missing:
            Image(systemName: "circle.dashed").foregroundStyle(.tertiary)
        }
    }
}
