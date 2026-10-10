import SwiftUI
import AppKit
import UniformTypeIdentifiers

struct TodayView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @State private var focusKey: String?

    private var open: [Obligation] { store.openObligations }
    /// 需要我动手的：待交办、待发送、交办太久没回音。
    private var mine: [Obligation] { open.filter { store.needsMe($0) } }
    private var focus: Obligation? { mine.first { $0.key == focusKey } ?? mine.first }
    /// 已交出、还在正常等回件的。
    private var waiting: [Obligation] { open.filter { $0.status.isHandedOff && !store.waitingTooLong($0) } }
    private var next: [Obligation] { mine.filter { $0.key != focus?.key } }

    var body: some View {
        Group {
            if store.companies.isEmpty {
                FullPageState {
                    EmptyStateView(symbol: "building.2", title: "还没有公司",
                                   message: "把按公司分好的文件夹拖进“文件”，Charter 会识别并建档；也可以先载入示例数据。",
                                   actionTitle: "载入示例数据") { SampleData.install(into: store) }
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: Space.section40) {
                        VStack(alignment: .leading, spacing: Space.xl24) {
                            header
                            if let f = focus {
                                FocusCard(obligation: f)
                                    .id(f.key)
                                    .transition(reduceMotion ? .identity : .opacity)
                            } else {
                                allClear
                            }
                        }
                        if !next.isEmpty { nextSection }
                        if !waiting.isEmpty { waitingSection }
                        docsSection
                    }
                    .padding(Space.pageEdge)
                    .frame(maxWidth: 1240)
                    .frame(maxWidth: .infinity)
                    .appear()
                }
                .animation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion), value: focus?.key)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.canvas)
    }

    private var header: some View {
        let overdue = mine.filter { $0.daysLeft(from: store.today) < 0 }.count
        let headline: String = {
            if mine.isEmpty { return "今天没有需要你处理的事项。" }
            if overdue > 0 { return "\(mine.count) 件事项待你处理，其中 \(overdue) 件已逾期。" }
            return "\(mine.count) 件事项待你处理。"
        }()
        return PageHeader(title: "今天", subtitle: "\(store.today.long)，\(store.today.weekdayName)。\(headline)") {
            Button("在合规日历中查看全部 \(open.count) 件") { router.openCalendar() }
                .buttonStyle(PillButtonStyle(.secondary))
        }
    }

    /// 没有需要处理的事项：好消息，用柠檬绿。
    private var allClear: some View {
        HStack(alignment: .bottom, spacing: Space.l16) {
            VStack(alignment: .leading, spacing: Space.s8) {
                Text("一切就绪").font(TypeStyle.display).tracking(Tracking.display)
                Text(open.isEmpty ? "接下来 400 天都没有待办的合规事项。" : "目前没有需要你处理的事项，已交办的事项正在等待回件。")
                    .font(TypeStyle.body).foregroundStyle(Theme.onLime.opacity(0.7))
            }
            Spacer(minLength: Space.l16)
            Image(systemName: "checkmark").font(.system(size: 18, weight: .bold))
                .frame(width: 44, height: 44)
                .background(Theme.onLime.opacity(0.1), in: .circle)
                .accessibilityHidden(true)
        }
        .foregroundStyle(Theme.onLime)
        .padding(Space.xl24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.lime, in: .rect(cornerRadius: Radius.surface, style: .continuous))
    }

    /// 单一承载面，行之间用细线分隔。
    private func listSurface<Item: Identifiable, Row: View>(_ items: [Item], @ViewBuilder row: @escaping (Item) -> Row) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                if i > 0 { Rectangle().fill(Theme.hairline).frame(height: 1).padding(.horizontal, Space.m12) }
                row(item)
            }
        }
        .padding(6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
    }

    private var nextSection: some View {
        VStack(alignment: .leading, spacing: Space.m12) {
            ComplianceSectionHeader(title: "也在等你", trailing: "\(next.count) 件")
            listSurface(next) { o in
                ObligationRow(obligation: o, detail: "\(o.company.name)，\(store.stateLine(o))", emphasize: store.waitingTooLong(o)) {
                    withAnimation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion)) { focusKey = o.key }
                }
                .transition(.blurReplace)
            }
        }
    }

    private var waitingSection: some View {
        VStack(alignment: .leading, spacing: Space.m12) {
            ComplianceSectionHeader(title: "等回件", trailing: "\(waiting.count) 件")
            listSurface(waiting) { o in
                ObligationRow(obligation: o, detail: "\(o.company.name)，\(store.stateLine(o))") {
                    router.sheet = .obligation(o.key)
                }
            }
        }
    }

    @ViewBuilder
    private var docsSection: some View {
        let docs = Array(store.documentsNeedingAttention.prefix(3))
        if !docs.isEmpty {
            VStack(alignment: .leading, spacing: Space.m12) {
                ComplianceSectionHeader(title: "需要更新的文件", trailing: store.documentsNeedingAttention.count > 3 ? "全部 \(store.documentsNeedingAttention.count) 份" : nil) {
                    router.section = .files
                }
                listSurface(docs) { d in DocumentRow(document: d) }
            }
        }
    }
}

/// 合规页面里的小节标题：标题 + 右侧计数或链接。
struct ComplianceSectionHeader: View {
    var title: String
    var trailing: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(TypeStyle.section).tracking(Tracking.section).foregroundStyle(Theme.ink)
            Spacer()
            if let trailing {
                if let action {
                    Button(trailing, action: action)
                        .buttonStyle(PillButtonStyle(.quiet, size: .small))
                } else {
                    Text(trailing).font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                }
            }
        }
        .padding(.horizontal, 4)
    }
}

// MARK: - 焦点卡片

/// 今天最该处理的一件事：页面的主色块。未逾期用柠檬绿（好消息），已逾期用深色底加红色标签。
/// 色块下方是同一承载面上的操作条。
struct FocusCard: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var obligation: Obligation
    private var o: Obligation { obligation }

    var body: some View {
        let left = o.daysLeft(from: store.today)
        let trust = store.trust(o)
        let unverifiedLate = left < 0 && !trust.isConfirmed && !o.status.isHandedOff
        let late = left < 0
        let fg: Color = late ? Theme.onEmphasis : Theme.onLime
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: Space.l16) {
                HStack(spacing: Space.s8) {
                    Text(store.jurisdictionName(o.company.jurisdiction))
                        .font(.system(size: 11, weight: .semibold))
                        .padding(.horizontal, 9).frame(height: 22)
                        .background(fg.opacity(0.12), in: .capsule)
                    Button(o.company.name) { router.open(company: o.company.id) }
                        .buttonStyle(.plain).font(TypeStyle.body).foregroundStyle(fg.opacity(0.75))
                        .help("打开公司档案")
                    Spacer(minLength: 0)
                    if late {
                        Text(unverifiedLate ? "按草稿规则已逾期" : "已逾期")
                            .font(.system(size: 12, weight: .semibold))
                            .padding(.horizontal, 10).frame(height: 24)
                            .background(Theme.danger, in: .capsule)
                            .foregroundStyle(Color.white)
                            .help(unverifiedLate ? "规则尚未核对，实际截止日可能不同，请先向负责方确认。" : "已过截止日")
                    }
                }
                HStack(alignment: .firstTextBaseline, spacing: Space.s8) {
                    if left == 0 {
                        Text("今天").font(TypeStyle.display).tracking(Tracking.display)
                        Text("截止").font(TypeStyle.section).tracking(Tracking.section)
                    } else {
                        Text("\(abs(left))").font(TypeStyle.display).tracking(Tracking.display)
                            .monospacedDigit()
                            .contentTransition(.numericText(countsDown: true))
                        Text(late ? "天已逾期" : "天后截止").font(TypeStyle.section).tracking(Tracking.section)
                    }
                }
                VStack(alignment: .leading, spacing: Space.xs4) {
                    HStack(spacing: Space.s8) {
                        Text(o.rule.name).font(TypeStyle.title).tracking(Tracking.title)
                            .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        TrustBadge(trust: trust)
                    }
                    Text("\(o.due.long)截止，\(o.due.weekdayName)。\(store.stateLine(o))")
                        .font(TypeStyle.body).foregroundStyle(fg.opacity(0.7))
                    if late && trust.isConfirmed && !o.rule.penalty.isEmpty {
                        Text("逾期后果：\(o.rule.penalty)").font(TypeStyle.body).foregroundStyle(fg.opacity(0.85))
                            .lineLimit(2)
                    }
                }
            }
            .foregroundStyle(fg)
            .padding(Space.xl24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(late ? Theme.emphasis : Theme.lime)

            HStack(spacing: 10) {
                if unverifiedLate {
                    Button(confirmTitle) { router.sheet = .confirmRule(ruleID: o.rule.id, companyID: o.company.id) }
                        .buttonStyle(PillButtonStyle(.primary, size: .large))
                        .help("规则尚未核对。请先确认实际截止日，再决定是否交办。")
                    NextStepControls(obligation: o, emphasized: false)
                } else {
                    NextStepControls(obligation: o)
                }
                Button("详情") { router.sheet = .obligation(o.key) }
                    .buttonStyle(PillButtonStyle(.quiet, size: .large))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Space.xl24).padding(.vertical, Space.l16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .clipShape(.rect(cornerRadius: Radius.surface, style: .continuous))
        .overlay {
            if late && !unverifiedLate {
                RoundedRectangle(cornerRadius: Radius.surface, style: .continuous)
                    .strokeBorder(Theme.danger.opacity(0.6), lineWidth: 1.5)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var confirmTitle: String {
        guard let p = store.responsibleParty(for: o), p.kind != .agent else { return "向负责方确认截止日" }
        return "向\(latinPad(p.name))确认截止日"
    }
}

// MARK: - 列表行

struct ObligationRow: View {
    @Environment(AppStore.self) private var store
    var obligation: Obligation
    private var o: Obligation { obligation }
    var detail: String
    /// 太久没回音等需要留意的情况：说明文字用琥珀色。
    var emphasize = false
    var onTap: () -> Void = {}
    @State private var hover = false

    var body: some View {
        let left = o.daysLeft(from: store.today)
        Button(action: onTap) {
            HStack(spacing: 14) {
                JurisdictionBadge(code: o.company.jurisdiction, size: 38)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(o.rule.name).font(TypeStyle.rowTitle).foregroundStyle(Theme.ink)
                        TrustBadge(trust: store.trust(o))
                    }
                    Text(detail).font(TypeStyle.metadata).foregroundStyle(emphasize ? Theme.amberText : Theme.muted).lineLimit(1)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(left < 0 ? "逾期 \(-left) 天" : "\(left) 天")
                        .font(.system(size: 16, weight: .semibold)).monospacedDigit()
                        .foregroundStyle(left < 0 ? Theme.danger : left <= 7 ? Theme.amberText : Theme.ink)
                    Text(o.due.display(relativeTo: store.today)).font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                }
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.muted)
                    .opacity(hover ? 1 : 0).offset(x: hover ? 0 : -4)
            }
            .padding(.horizontal, 12).frame(height: 62)
            .background(hover ? Theme.band.opacity(0.6) : .clear, in: .rect(cornerRadius: Radius.row))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { h in withAnimation(Motion.fast) { hover = h } }
        .contextMenu { ObligationContextMenu(obligation: o) }
    }
}

struct ObligationContextMenu: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var obligation: Obligation
    private var o: Obligation { obligation }

    var body: some View {
        Button("标记完成") { store.complete(o) }
        Button("详情…") { router.sheet = .obligation(o.key) }
        Button("打开公司") { router.open(company: o.company.id) }
    }
}

struct DocumentRow: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var document: Document
    /// 在“文件”页按公司分组时不再重复显示所属方。
    var showOwner = true
    /// 显示到期日（“即将到期”列表）。
    var showExpiry = false
    /// 右键菜单最前面追加的内容（“文件”页多选时的批量操作）。
    var extraMenu: AnyView? = nil
    private var d: Document { document }

    /// 第二行：备注优先，其次当地名称；原文件名只有不像系统生成的名字时才显示。
    private var subline: String {
        if !d.notes.isEmpty { return "备注：\(d.notes)" }
        let t = store.docType(d.typeID)
        if let local = t?.localNames.first, local != t?.name { return local }
        let base = (d.originalFileName as NSString).deletingPathExtension
        return UUID(uuidString: base) == nil ? d.originalFileName : ""
    }
    @State private var hover = false
    @State private var uploading = false
    @State private var working = false
    @State private var pending: StagedFile?
    @State private var reissuing = false

    var body: some View {
        let f = store.freshness(d)
        let expiry = Freshness.expiry(of: d, type: store.docType(d.typeID))
        HStack(spacing: FileColumns.spacing) {
            HStack(spacing: 12) {
                FileThumb(url: store.fileURL(d), alert: f.pillKind == .bad, size: CGSize(width: 34, height: 42))
                VStack(alignment: .leading, spacing: 2) {
                    Text(store.docType(d.typeID)?.name ?? "文件").font(.system(size: 14, weight: .semibold)).lineLimit(1)
                    HStack(spacing: 6) {
                        if showOwner {
                            if d.owner.kind == .company, let c = store.company(d.owner.id) {
                                Text(c.jurisdiction).font(.system(size: 10, weight: .bold)).padding(.horizontal, 5).frame(height: 16)
                                    .background(Theme.band, in: .rect(cornerRadius: 5))
                            }
                            Text(store.name(of: d.owner)).lineLimit(1)
                        } else {
                            Text(subline).lineLimit(1)
                        }
                    }
                    .font(.system(size: 12)).foregroundStyle(Theme.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)

            Pill(text: f.label, kind: f.pillKind).frame(width: FileColumns.state, alignment: .leading)
            Text(d.issueDate?.description ?? "—").font(.mono(12.5)).foregroundStyle(d.issueDate == nil ? Theme.muted : Theme.ink)
                .frame(width: FileColumns.date, alignment: .leading)
            Text(Freshness.expiryLabel(of: d, type: store.docType(d.typeID))).font(.mono(12.5))
                .foregroundStyle(f.pillKind == .bad && expiry != nil ? Theme.danger : expiry == nil ? Theme.muted : Theme.ink)
                .frame(width: FileColumns.date, alignment: .leading)

            HStack(spacing: 6) {
                if working {
                    ProgressView().controlSize(.small)
                } else if f == .unknown {
                    Button("补充日期") { router.sheet = .document(d.id) }
                        .buttonStyle(PillButtonStyle(.secondary, size: .small))
                } else if f.needsAttention {
                    Button("请补发") { reissuing = true }
                        .buttonStyle(PillButtonStyle(.secondary, size: .small))
                        .help("生成请负责方补发新版的文字，可先修改再复制")
                    Button("归档新版") { uploading = true }
                        .buttonStyle(PillButtonStyle(.primary, size: .small))
                        .help("类型和归属沿用这份，旧版保留")
                } else {
                    Button("打开") { store.open(d) }
                        .buttonStyle(PillButtonStyle(.quiet, size: .small))
                }
            }
            .frame(width: FileColumns.actions, alignment: .trailing)
        }
        .padding(.horizontal, 16).frame(minHeight: 60)
        .background(hover ? Theme.band.opacity(0.6) : .clear, in: .rect(cornerRadius: Radius.row))
        .contentShape(.rect)
        .focusable()
        .onKeyPress(.return) { router.sheet = .document(d.id); return .handled }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(store.docType(d.typeID)?.name ?? "文件")，\(store.name(of: d.owner))，\(f.label)")
        .accessibilityAction { router.sheet = .document(d.id) }
        .accessibilityAction(named: "归档新版") { uploading = true }
        .onHover { h in hover = h }
        .onTapGesture { router.sheet = .document(d.id) }
        .fileImporter(isPresented: $uploading, allowedContentTypes: [.pdf, .image]) { result in
            guard case .success(let url) = result else { return }
            working = true
            Task { @MainActor in
                defer { working = false }
                do {
                    // 先放进待确认区，用户确认后才归档；取消不改动档案
                    pending = try await store.stage(url: url, typeID: d.typeID, owner: d.owner, replaces: d, form: d.form) { new in
                        router.sheet = .document(new.id)
                    }
                } catch {
                    store.errorMessage = "读取文件失败：\(error.localizedDescription)"
                }
            }
        }
        .sheet(item: $pending) { ArchiveConfirmSheet(file: $0) }
        .sheet(isPresented: $reissuing) {
            CopyTextSheet(title: "请补发：\(store.docType(d.typeID)?.name ?? "文件")", text: store.reissueText(for: d))
        }
        .contextMenu {
            if let extraMenu {
                extraMenu
                Divider()
            }
            Button("打开") { store.open(d) }
            Button("在访达中显示") { store.reveal(d) }
            Button("归档新版…") { uploading = true }
            Button("请补发…") { reissuing = true }
            Button(d.needsUpdate ? "取消“需要更新”" : "标为需要更新") {
                if let i = store.documents.firstIndex(where: { $0.id == d.id }) { store.documents[i].needsUpdate.toggle(); store.saveDocuments() }
            }
            Divider()
            Button("从 Charter 移除记录", role: .destructive) { store.delete(document: d) }
        }
    }
}

/// 文件的真实缩略图（QuickLook），生成前显示占位。
struct FileThumb: View {
    var url: URL
    var alert = false
    var size = CGSize(width: 36, height: 44)
    @State private var image: NSImage?
    @State private var loading = true

    var body: some View {
        Group {
            if loading && image == nil && size.width >= 80 {
                // 大缩略图生成较慢：先放与最终尺寸一致的骨架，加载完不跳动
                SkeletonBlock(width: size.width, height: size.height)
            } else if let image {
                Image(nsImage: image).resizable().aspectRatio(contentMode: .fill)
                    .frame(width: size.width, height: size.height)
                    .clipShape(.rect(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(alert ? Theme.danger : .black.opacity(0.12), lineWidth: alert ? 1.5 : 0.5))
                    .shadow(color: .black.opacity(0.12), radius: 3, y: 2)
            } else {
                DocThumb(alert: alert).scaleEffect(size.width / 36).frame(width: size.width, height: size.height)
            }
        }
        .task(id: url) {
            loading = true
            image = await Thumbnails.shared.image(for: url, size: size)
            loading = false
        }
    }
}

struct DocThumb: View {
    var alert = false
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Capsule().fill(alert ? Theme.danger : Theme.ink).frame(width: 14, height: 3)
            ForEach([0.9, 0.7, 0.84], id: \.self) { w in Capsule().fill(Theme.muted.opacity(0.3)).frame(width: CGFloat(22 * w), height: 2) }
        }
        .padding(7)
        .frame(width: 36, height: 44, alignment: .topLeading)
        .background(Theme.surface, in: .rect(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.black.opacity(0.12), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.12), radius: 3, y: 2)
    }
}
