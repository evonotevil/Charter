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
        let needsUpdate = all.filter { $0.state == .needsUpdate }.count
        let noDate = all.filter { $0.state == .noDate }.count
        let notObtained = all.filter { $0.state == .marked(.notObtained) }.count
        let external = all.filter { $0.state == .marked(.external) }.count
        let restricted = all.filter { $0.state == .marked(.restricted) }.count
        let unverified = all.filter { $0.state == .marked(.unverified) }.count
        let missing = all.filter { $0.state == .missing }.count
        let pct = all.isEmpty ? 0 : Int((Double(have) / Double(all.count) * 100).rounded())
        let attention = attentionRows(scope: scope)
        let personalAttention = store.documentsNeedingAttention.filter { $0.owner.kind == .person }.count
        let jurisdictions = Set(companies.map(\.jurisdiction)).count

        Group {
            if store.companies.isEmpty {
                EmptyState(symbol: "building.2", title: "还没有公司",
                           message: "先新建一个集团（从实控人或顶层公司开始），再逐层添加公司；也可以在设置里载入示例数据。",
                           actionTitle: "新建集团") { router.sheet = .newGroup }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        header(attention.count, personalAttention: personalAttention)
                            .padding(.bottom, 6)

                        attentionTable(attention)

                        // 档案概况
                        VStack(alignment: .leading, spacing: 16) {
                            HStack {
                                Text("档案概况").font(.system(size: 20, weight: .semibold))
                                Spacer()
                                Text(store.filterName(router.groupFilter)).font(.system(size: 13)).foregroundStyle(Theme.muted)
                            }
                            HStack(spacing: 12) {
                                StatCard(title: "公司", value: "\(companies.count)", caption: "\(jurisdictions) 个法域", style: .ink) {
                                    router.section = .companies
                                }
                                StatCard(title: "已归档比例", value: "\(pct)%", caption: "已归档 \(have) / \(all.count) 条",
                                         progress: all.isEmpty ? 0 : Double(have) / Double(all.count))
                                StatCard(title: "30 天内到期", value: "\(expiring)",
                                         caption: expired > 0 ? "另有 \(expired) 份已过期" : (expiring == 0 ? "30 天内没有文件到期" : "点按查看即将到期的文件"),
                                         style: expired > 0 ? .danger : (expiring > 0 ? .warn : .plain)) {
                                    router.filesFilter = 1; router.filesOwnerKind = .company; router.filesHorizon = 30; router.section = .files
                                }
                                StatCard(title: "未取得", value: "\(notObtained)",
                                         caption: notObtained > 0 ? "已明确标记暂未取得" : "没有标记为未取得的条目",
                                         style: notObtained > 0 ? .warn : .plain)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                            statusBar(have: have, expiring: expiring, expired: expired, needsUpdate: needsUpdate,
                                      noDate: noDate,
                                      notObtained: notObtained, external: external, restricted: restricted,
                                      unverified: unverified, missing: missing)
                        }
                        .surfaceCard()

                        companiesCard(archives)
                    }
                    .padding(24)
                    .frame(maxWidth: 1240)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .navigationTitle("总览")
    }

    // MARK: 顶部

    private func header(_ n: Int, personalAttention: Int) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
            Text(greeting).font(.system(size: 26, weight: .semibold)).tracking(-0.5)
            Spacer()
            Button { router.sheet = .quickSearch } label: {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                    Text("查找公司或人员").foregroundStyle(Theme.muted)
                    Spacer(minLength: 20)
                    Text("⌘K").font(.system(size: 11.5, weight: .bold))
                        .padding(.horizontal, 8).frame(height: 24)
                        .background(Theme.lime, in: .capsule).foregroundStyle(Theme.onLime)
                }
                .font(.system(size: 14))
                .padding(.leading, 16).padding(.trailing, 6).frame(width: 260, height: 40)
                .background(Theme.surface, in: .capsule)
                .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            }
            if n > 0 || personalAttention > 0 {
                HStack(spacing: 12) {
            if n > 0 {
                Button { router.filesFilter = 2; router.filesOwnerKind = .company; router.section = .files } label: {
                    Label("\(n) 份公司文件需处理", systemImage: "exclamationmark.triangle")
                        .font(.system(size: 14, weight: .semibold))
                        .padding(.horizontal, 14).frame(height: 34)
                        .background(Theme.amberSoft, in: .capsule).foregroundStyle(Theme.amberText)
                }
                .buttonStyle(.plain)
            }
            if personalAttention > 0 {
                Button("另有 \(personalAttention) 份个人文件需处理") {
                    router.filesFilter = 2; router.filesOwnerKind = .person; router.section = .files
                }
                .buttonStyle(.link)
                .foregroundStyle(Theme.amberText)
            }
                }
            }
        }
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        return h < 12 ? "早上好" : h < 18 ? "下午好" : "晚上好"
    }

    // MARK: 状态条

    private func statusBar(have: Int, expiring: Int, expired: Int, needsUpdate: Int, noDate: Int, notObtained: Int,
                           external: Int, restricted: Int, unverified: Int, missing: Int) -> some View {
        let segs: [(String, Int, Color)] = [
            ("有效", max(have - expiring - expired - needsUpdate - noDate, 0), Theme.lime),
            ("日期待核对", noDate, Theme.amber),
            ("即将到期", expiring, Theme.amber),
            ("需更新", needsUpdate, Theme.amber),
            ("已过期", expired, Theme.danger),
            ("外部保管", external, Theme.ink),
            ("权限受限", restricted, Theme.muted),
            ("待核对", unverified, Theme.amber),
            ("未取得", notObtained, Theme.muted),
            ("未归档", missing, Theme.muted),
        ].filter { $0.1 > 0 }
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 10)], alignment: .leading, spacing: 10) {
            ForEach(segs, id: \.0) { s in
                HStack(spacing: 8) {
                    Circle().fill(s.2).frame(width: 8, height: 8)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(s.1)").font(.system(size: 16, weight: .semibold)).monospacedDigit()
                        Text(s.0).font(.system(size: 12.5)).foregroundStyle(Theme.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
            }
        }
        .padding(16)
        .background(Theme.band.opacity(0.5), in: .rect(cornerRadius: 20))
    }

    // MARK: 需要处理

    private func attentionTable(_ rows: [Row]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("需要处理").font(.system(size: 20, weight: .semibold))
                    Text(rows.isEmpty ? "当前没有已归档的公司文件需要处理" : "\(rows.count) 份文件已过期、即将到期、需要更新或日期待核对")
                        .font(.system(size: 13)).foregroundStyle(Theme.muted)
                }
                Spacer()
                if rows.count > 8 {
                    Button("查看全部") { router.filesFilter = 2; router.filesOwnerKind = .company; router.section = .files }.buttonStyle(PillButtonStyle(.secondary, size: .small))
                }
            }
            BandHeader {
                HStack {
                    Text("公司").frame(maxWidth: .infinity, alignment: .leading)
                    Text("条目").frame(width: 150, alignment: .leading)
                    Text("状态").frame(width: 110, alignment: .leading)
                    Text("到期").frame(width: 96, alignment: .leading)
                }
            }
            if rows.isEmpty {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.ink)
                    Text("没有需要处理的文件。").foregroundStyle(Theme.muted)
                }
                .padding(.vertical, 18).padding(.horizontal, 16)
            }
            VStack(spacing: 0) {
                ForEach(Array(rows.prefix(8).enumerated()), id: \.element.id) { pair in
                    let r = pair.element
                    Button {
                        if r.owner.kind == .company { router.companyTab = 0; router.open(company: r.owner.id) }
                        else { router.sheet = .document(r.document.id) }
                    } label: {
                        HStack {
                            HStack(spacing: 10) {
                                if r.owner.kind == .company, let c = store.company(r.owner.id) {
                                    JurisdictionBadge(code: c.jurisdiction, size: 30)
                                } else {
                                    Avatar(name: store.name(of: r.owner))
                                }
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(store.name(of: r.owner)).font(.system(size: 14, weight: .medium)).lineLimit(1)
                                    Text(r.owner.kind == .company ? (store.company(r.owner.id)?.registrationNumber ?? "") : "人员")
                                        .font(.mono(11.5)).foregroundStyle(Theme.muted)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Text(r.name).font(.system(size: 13.5)).lineLimit(1).frame(width: 150, alignment: .leading)
                            StatusPill(state: r.state).frame(width: 110, alignment: .leading)
                            Text(Freshness.expiry(of: r.document, type: store.docType(r.document.typeID))?.description ?? "—")
                                .font(.mono(12.5)).frame(width: 96, alignment: .leading)
                        }
                        .padding(.horizontal, 16).frame(height: 58)
                        .contentShape(.rect)
                    }
                    .buttonStyle(RowButtonStyle())
                    if pair.offset < min(rows.count, 8) - 1 { Divider().padding(.horizontal, 16).opacity(0.6) }
                }
            }
        }
        .surfaceCard()
    }

    // MARK: 公司

    private func companiesCard(_ archives: [(Company, [ArchiveItem])]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("公司档案").font(.system(size: 20, weight: .semibold))
                Spacer()
                Button("矩阵视图") { router.companiesMatrix = true; router.section = .companies }
                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
                ForEach(archives, id: \.0.id) { pair in
                    let counted = pair.1.filter { $0.state != .marked(.notApplicable) }
                    let have = counted.filter(\.state.hasFile).count
                    let bad = counted.filter(\.state.needsAttention).count
                    Button { router.companyTab = 0; router.open(company: pair.0.id) } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(spacing: 10) {
                                JurisdictionBadge(code: pair.0.jurisdiction, size: 32)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(pair.0.name).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                                    Text(pair.0.registrationNumber.isEmpty ? store.jurisdictionName(pair.0.jurisdiction) : pair.0.registrationNumber)
                                        .font(.mono(11.5)).foregroundStyle(Theme.muted).lineLimit(1)
                                }
                                Spacer(minLength: 0)
                                if bad > 0 { Pill(text: "\(bad) 需处理", kind: .warn) }
                            }
                            HStack(spacing: 10) {
                                ProgressCapsule(value: counted.isEmpty ? 0 : Double(have) / Double(counted.count))
                                Text("\(have)/\(counted.count)").font(.mono(12)).foregroundStyle(Theme.muted)
                            }
                        }
                        .padding(14)
                        .background(Theme.band.opacity(0.6), in: .rect(cornerRadius: 18))
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .surfaceCard()
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
                .background(configuration.isPressed ? Theme.band : hover ? Theme.band.opacity(0.6) : .clear, in: .rect(cornerRadius: 14))
                .onHover { hover = $0 }
        }
    }
}
