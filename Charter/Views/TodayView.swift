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
                EmptyState(symbol: "building.2", title: "还没有公司",
                           message: "把按公司分好的文件夹拖进“文件”，Charter 会识别并建档；也可以先载入示例数据。",
                           actionTitle: "载入示例数据") { SampleData.install(into: store) }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        header
                        if let f = focus {
                            FocusCard(obligation: f)
                                .id(f.key)
                                .transition(reduceMotion ? .identity : .opacity)
                        } else {
                            Text(open.isEmpty ? "接下来 400 天都没有待办的合规事项。" : "目前没有需要你处理的事项，已交办的事项正在等待回件。")
                                .font(TypeStyle.body).foregroundStyle(Theme.muted)
                                .surfaceCard(padding: 22, radius: 18)
                        }
                        if !next.isEmpty { nextSection }
                        if !waiting.isEmpty { waitingSection }
                        docsSection
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity)
                }
                .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: focus?.key)
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
        return HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("今天").font(TypeStyle.pageTitle).tracking(-0.5)
                Text("\(store.today.long)，\(store.today.weekdayName)。\(headline)")
                    .font(TypeStyle.body).foregroundStyle(Theme.muted)
                    .contentTransition(.numericText())
            }
            Spacer(minLength: 12)
            Button("在合规日历中查看全部 \(open.count) 件") { router.openCalendar() }
                .buttonStyle(PillButtonStyle(.secondary))
        }
    }

    private var nextSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            ComplianceSectionHeader(title: "也在等你", trailing: "\(next.count) 件")
            VStack(spacing: 0) {
                ForEach(next) { o in
                    ObligationRow(obligation: o, detail: "\(o.company.name)，\(store.stateLine(o))", emphasize: store.waitingTooLong(o)) {
                        withAnimation(.smooth) { focusKey = o.key }
                    }
                    .transition(.blurReplace)
                }
            }
            .surfaceCard(padding: 6, radius: 18)
        }
    }

    private var waitingSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            ComplianceSectionHeader(title: "等回件", trailing: "\(waiting.count) 件")
            VStack(spacing: 0) {
                ForEach(waiting) { o in
                    ObligationRow(obligation: o, detail: "\(o.company.name)，\(store.stateLine(o))") {
                        router.sheet = .obligation(o.key)
                    }
                }
            }
            .surfaceCard(padding: 6, radius: 18)
        }
    }

    @ViewBuilder
    private var docsSection: some View {
        let docs = Array(store.documentsNeedingAttention.prefix(3))
        if !docs.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                ComplianceSectionHeader(title: "需要更新的文件", trailing: store.documentsNeedingAttention.count > 3 ? "全部 \(store.documentsNeedingAttention.count) 份" : nil) {
                    router.section = .files
                }
                VStack(spacing: 0) {
                    ForEach(docs) { d in DocumentRow(document: d) }
                }
                .surfaceCard(padding: 6, radius: 18)
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
            Text(title).font(TypeStyle.rowTitle).foregroundStyle(Theme.ink)
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

/// 今天最该处理的一件事。紧凑：左边是时间，右边是事项和下一步。
struct FocusCard: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var obligation: Obligation
    private var o: Obligation { obligation }

    var body: some View {
        let left = o.daysLeft(from: store.today)
        let trust = store.trust(o)
        let unverifiedLate = left < 0 && !trust.isConfirmed && !o.status.isHandedOff
        HStack(alignment: .top, spacing: 30) {
            VStack(alignment: .leading, spacing: 6) {
                Text(left < 0 ? "逾期 \(-left) 天" : left == 0 ? "今天截止" : "还有 \(left) 天")
                    .font(.system(size: 34, weight: .semibold)).tracking(-0.8).monospacedDigit()
                    .foregroundStyle(left < 0 ? Theme.danger : left <= 7 ? Theme.amberText : Theme.ink)
                    .contentTransition(.numericText(countsDown: true))
                Text("\(o.due.long)截止，\(o.due.weekdayName)")
                    .font(TypeStyle.body).foregroundStyle(Theme.muted)
                if unverifiedLate {
                    Text("按草稿规则已过截止日 \(-left) 天")
                        .font(TypeStyle.metadata).fontWeight(.semibold).foregroundStyle(Theme.amberText)
                        .padding(.top, 4)
                        .help("规则尚未核对，实际截止日可能不同，请先向负责方确认。")
                }
            }
            .frame(width: 200, alignment: .leading)

            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    Text(store.jurisdictionName(o.company.jurisdiction))
                        .font(.system(size: 11, weight: .semibold))
                        .padding(.horizontal, 9).frame(height: 22)
                        .background(Theme.ink, in: .capsule)
                        .foregroundStyle(Theme.onInk)
                    Button(o.company.name) { router.open(company: o.company.id) }
                        .buttonStyle(.plain).font(TypeStyle.body).foregroundStyle(Theme.muted)
                        .help("打开公司档案")
                }
                HStack(spacing: 8) {
                    Text(o.rule.name).font(.system(size: 24, weight: .semibold)).tracking(-0.3)
                    TrustBadge(trust: trust)
                }
                .padding(.top, 10)
                Text(store.stateLine(o)).font(TypeStyle.body).foregroundStyle(Theme.muted).padding(.top, 4)
                if left < 0 && trust.isConfirmed && !o.rule.penalty.isEmpty {
                    Text("逾期后果：\(o.rule.penalty)").font(TypeStyle.body).foregroundStyle(Theme.danger).padding(.top, 4).lineLimit(2)
                }
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
                }
                .padding(.top, 18)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 28).padding(.vertical, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: .rect(cornerRadius: Theme.radius))
        .overlay {
            if left < 0 && !unverifiedLate {
                RoundedRectangle(cornerRadius: Theme.radius).strokeBorder(Theme.danger.opacity(0.6), lineWidth: 1.5)
            }
        }
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
            .background(hover ? Theme.band : .clear, in: .rect(cornerRadius: 14))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { h in withAnimation(.snappy(duration: 0.2)) { hover = h } }
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
        .background(hover ? Theme.band.opacity(0.6) : .clear, in: .rect(cornerRadius: 14))
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
            Button("打开") { store.open(d) }
            Button("在访达中显示") { store.reveal(d) }
            Button("归档新版…") { uploading = true }
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

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image).resizable().aspectRatio(contentMode: .fill)
                    .frame(width: size.width, height: size.height)
                    .clipShape(.rect(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(alert ? Theme.danger : .black.opacity(0.12), lineWidth: alert ? 1.5 : 0.5))
                    .shadow(color: .black.opacity(0.12), radius: 3, y: 2)
            } else {
                DocThumb(alert: alert).scaleEffect(size.width / 36).frame(width: size.width, height: size.height)
            }
        }
        .task(id: url) { image = await Thumbnails.shared.image(for: url, size: size) }
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
