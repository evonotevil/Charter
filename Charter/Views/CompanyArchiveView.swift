import SwiftUI
import UniformTypeIdentifiers

/// 公司详情里的“档案”：按法域条目逐行列出，有文件的显示日期和到期，没有的可以标记原因。
struct CompanyArchiveView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var company: Company
    @State private var width: CGFloat = 800
    /// 打开时这家公司还没有任何文件：显示“首次印象”拖放区，直到离开页面或清单齐全。
    @State private var firstImpression = false
    /// 第一印象下方“下一步”里已被关掉的项（按公司记在 UserDefaults）。
    @State private var dismissedSteps: Set<String> = []
    @State private var showNotApplicable = false

    var body: some View {
        let compact = width < 700
        let items = store.archive(of: company)
        let listed = items.filter { !$0.isExtra || store.itemIDs(for: company).contains($0.typeID) }
        let main = listed.filter { $0.state != .marked(.notApplicable) }
        let notApplicable = listed.filter { $0.state == .marked(.notApplicable) }
        let hidden = store.hiddenByEntityForm(company)
        let others = items.filter { $0.isExtra && !store.itemIDs(for: company).contains($0.typeID) }
        let counted = items.filter { $0.state != .marked(.notApplicable) }
        VStack(alignment: .leading, spacing: Space.m12) {
            HStack(alignment: .firstTextBaseline, spacing: Space.s8) {
                Text("档案清单").font(TypeStyle.section).tracking(Tracking.section)
                Text(company.isForming ? "成立后开始统计" : "\(counted.filter { $0.state.hasFile }.count)/\(counted.count) 已归档").font(TypeStyle.meta).monospacedDigit().foregroundStyle(Theme.muted)
                Spacer()
                Button("自定义清单") { router.sheet = .companyItems(company.id) }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                    .help("只为这家公司增加或去掉条目")
                SettingsJumpLink(title: "编辑\(store.jurisdictionName(company.jurisdiction))通用清单", pane: .archiveItems) {
                    UserDefaults.standard.set(company.jurisdiction, forKey: ArchiveItemsSettings.scopeKey)
                }
            }
            Text("按法域起始清单管理；可按实际需要调整。未持有材料可标记保管方、权限受限或不适用。")
                .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
            if company.isForming {
                formingBanner
            } else if !hasDocuments || (firstImpression && counted.contains(where: { !$0.state.hasFile })) {
                firstImpressionBlock(counted)
            }
            VStack(spacing: 0) {
                ArchiveHeaderRow(compact: compact)
                ForEach(Array(main.enumerated()), id: \.element.id) { pair in
                    if pair.offset > 0 { Rectangle().fill(Theme.hairline).frame(height: 1) }
                    ArchiveRow(company: company, item: pair.element, compact: compact)
                }
            }
            if !hidden.isEmpty || !notApplicable.isEmpty {
                DisclosureGroup(isExpanded: $showNotApplicable) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(notApplicable.enumerated()), id: \.element.id) { pair in
                            if pair.offset > 0 { Rectangle().fill(Theme.hairline).frame(height: 1) }
                            ArchiveRow(company: company, item: pair.element, compact: compact)
                        }
                        if !hidden.isEmpty {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("按实体类型（\(company.entityForm)）不需要：" + hidden.map(\.name).joined(separator: "、"))
                                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 8)
                                Button("改为需要") { router.sheet = .companyItems(company.id) }
                                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                                    .help("在这家公司的清单里单独加回这些条目")
                            }
                            .padding(.vertical, 10)
                        }
                    }
                    .padding(.top, 6)
                } label: {
                    Text("不适用 \(notApplicable.count + hidden.count) 项")
                        .font(TypeStyle.meta).foregroundStyle(Theme.muted)
                }
                .padding(.top, Space.s8)
                .help("标为不适用、或按实体类型不需要的条目。不计入缺件和完成度。")
            }
            if !others.isEmpty {
                Text("其他文件").font(TypeStyle.meta).foregroundStyle(Theme.muted).padding(.top, Space.s8)
                VStack(spacing: 0) {
                    ForEach(Array(others.enumerated()), id: \.element.id) { pair in
                        if pair.offset > 0 { Rectangle().fill(Theme.hairline).frame(height: 1) }
                        ArchiveRow(company: company, item: pair.element, compact: compact)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .onAppear {
            firstImpression = !hasDocuments
            dismissedSteps = NextStepMemory.dismissed(company.id)
        }
        .onChange(of: company.id) { _, id in dismissedSteps = NextStepMemory.dismissed(id) }
    }

    /// 设立中的公司：文件、任职和股东都还没有产生，提示与统计都按“成立后补充”处理。
    private var formingBanner: some View {
        HStack(alignment: .top, spacing: Space.m12) {
            Image(systemName: "hammer").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                .frame(width: 32, height: 32).background(Theme.band, in: .circle)
            VStack(alignment: .leading, spacing: 4) {
                Text("设立中").font(TypeStyle.rowTitle).foregroundStyle(Theme.ink)
                Text("注册证书、名册、\(store.officerNoun(for: company.id))和股东会在成立后产生，现在不算缺失，也不计入待处理和完成度。设立期间的申请材料可以照常上传。")
                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button("已成立…") { router.sheet = .changeFrom(companyID: company.id, kind: .statusChange, appointmentID: nil, holdingID: nil) }
                .buttonStyle(PillButtonStyle(.secondary, size: .small))
                .help("记录成立：更新状态和成立日期")
        }
        .padding(Space.l16)
        .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
    }

    private var hasDocuments: Bool {
        let ref = NodeRef(kind: .company, id: company.id)
        return store.documents.contains { $0.owner == ref }
    }

    /// 新公司的第一印象：大拖放区、清单预览、可以稍后再补的提示。
    private func firstImpressionBlock(_ expected: [ArchiveItem]) -> some View {
        let names = expected.map(\.name)
        let listed = names.prefix(4).joined(separator: "、")
        let jurisdiction = store.jurisdictionName(company.jurisdiction)
        let need = names.isEmpty
            ? "注册证书、章程、董事名册等文件都可以拖进来。"
            : "\(jurisdiction)公司通常需要：\(listed)" + (names.count > 4 ? "等 \(names.count) 份。" : "。")
        return VStack(alignment: .leading, spacing: Space.m12) {
            ArchiveDropZone(title: "把 \(company.name) 的文件拖进来",
                            subtitle: need + "Charter 会识别并逐项归位。",
                            action: { router.chooseFiles(context: .company(company.id)) },
                            onDrop: { urls in router.startImport(urls: urls, context: .company(company.id)) })
            if !expected.isEmpty {
                VStack(alignment: .leading, spacing: Space.s8) {
                    Text("清单预览").font(TypeStyle.meta).foregroundStyle(Theme.muted)
                    FlowChips(items: expected)
                }
                .padding(.top, Space.xs4)
            }
            nextSteps
            Text("也可以稍后再补，档案清单会提醒缺什么。")
                .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
        }
        .padding(.bottom, Space.s8)
    }

    // MARK: 下一步（添加董事、设置负责方）

    private var needsDirector: Bool {
        !company.isForming && !dismissedSteps.contains(NextStepMemory.director)
            && !store.appointments.contains { $0.companyID == company.id && $0.isActive(on: store.today) }
    }

    private var needsParty: Bool {
        !dismissedSteps.contains(NextStepMemory.party) && company.defaultPartyID == nil
    }

    @ViewBuilder
    private var nextSteps: some View {
        if needsDirector || needsParty {
            VStack(alignment: .leading, spacing: Space.s8) {
                Text("下一步").font(TypeStyle.meta).foregroundStyle(Theme.muted)
                if needsDirector { directorStep }
                if needsParty { partyStep }
            }
            .padding(.top, Space.xs4)
        }
    }

    private var directorStep: some View {
        NextStepRow(systemImage: "person.badge.plus", title: "添加\(store.officerNoun(for: company.id))",
                    detail: "任职名册和在职证明会据此核对。",
                    onDismiss: { dismissStep(NextStepMemory.director) }) {
            Button("添加任职人员…") { router.sheet = .editCompany(company.id) }
                .buttonStyle(PillButtonStyle(.secondary, size: .small))
        }
    }

    private var partyChoices: [(String?, String)] {
        let none: [(String?, String)] = [(nil, "选择负责方")]
        return none + store.parties.map { p in (Optional(p.id), p.name) }
    }

    private var partyBinding: Binding<String?> {
        Binding(get: { company.defaultPartyID }, set: { newValue in
            guard let id = newValue, var c = store.company(company.id) else { return }
            let name = store.party(id)?.name ?? "负责方"
            c.defaultPartyID = id
            store.performUndoable("设置负责方", toast: "已把 \(name) 设为负责方") { store.upsert(c) }
        })
    }

    @ViewBuilder
    private var partyStep: some View {
        NextStepRow(systemImage: "person.2", title: "设置负责方",
                    detail: "请补发和催办默认发给它。",
                    onDismiss: { dismissStep(NextStepMemory.party) }) {
            if store.parties.isEmpty {
                Button("编辑公司资料…") { router.sheet = .editCompany(company.id) }
                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
            } else {
                SelectField(options: partyChoices, selection: partyBinding, placeholder: "选择负责方", minWidth: 180)
            }
        }
    }

    private func dismissStep(_ key: String) {
        dismissedSteps.insert(key)
        NextStepMemory.dismiss(key, companyID: company.id)
    }
}

/// 新公司“下一步”被关掉的记录，按公司存。
enum NextStepMemory {
    static let director = "director"
    static let party = "party"
    private static func key(_ companyID: String) -> String { "charter.nextSteps.dismissed.\(companyID)" }

    static func dismissed(_ companyID: String) -> Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: key(companyID)) ?? [])
    }

    static func dismiss(_ step: String, companyID: String) {
        var set = dismissed(companyID)
        set.insert(step)
        UserDefaults.standard.set(Array(set).sorted(), forKey: key(companyID))
    }
}

/// 一行可关掉的下一步：图标、标题与说明、操作、关闭按钮。
private struct NextStepRow<Action: View>: View {
    var systemImage: String
    var title: String
    var detail: String
    var onDismiss: () -> Void
    @ViewBuilder var action: Action

    var body: some View {
        HStack(spacing: Space.m12) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .frame(width: 20)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(TypeStyle.rowTitle).foregroundStyle(Theme.ink)
                Text(detail).font(TypeStyle.metadata).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: Space.s8)
            action
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.system(size: 10, weight: .semibold))
            }
            .buttonStyle(PillButtonStyle(.quiet, size: .small))
            .help("不再提示")
            .accessibilityLabel("不再提示\(title)")
        }
        .padding(.horizontal, Space.m12).padding(.vertical, Space.s8)
        .background(Theme.band, in: .rect(cornerRadius: 12, style: .continuous))
    }
}

/// 清单预览：未归档为虚线空心，归档后变为柠檬绿浅底。
private struct FlowChips: View {
    var items: [ArchiveItem]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ChipFlow(spacing: 6) {
            ForEach(items) { item in
                let done = item.state.hasFile
                HStack(spacing: 4) {
                    if done {
                        Image(systemName: "checkmark").font(.system(size: 9, weight: .bold))
                    }
                    Text(item.name).lineLimit(1)
                }
                .font(.system(size: 12, weight: done ? .semibold : .regular))
                .foregroundStyle(done ? Theme.limeText : Theme.muted)
                .padding(.horizontal, 10).frame(height: 26)
                .background(done ? Theme.limeSoft : Color.clear, in: .capsule)
                .overlay {
                    if !done {
                        Capsule().strokeBorder(Theme.hairline, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(item.name)，\(done ? "已归档" : "未归档")")
            }
        }
        .animation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion), value: items.map(\.state.hasFile))
    }
}

/// 简单的换行排布。
private struct ChipFlow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let size = v.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > maxWidth {
                y += rowHeight + spacing
                x = 0; rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, maxWidth), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for v in subviews {
            let size = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX; rowHeight = 0
            }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// 表头和行共用同一套列宽，保证对齐。
enum ArchiveColumns {
    static let state: CGFloat = 104
    static let date: CGFloat = 92
    static let actions: CGFloat = 132
    static let stateCompact: CGFloat = 88
    static let dateCompact: CGFloat = 80
    static let actionsCompact: CGFloat = 94
    static let spacing: CGFloat = 12
    static let nameMin: CGFloat = 120
    static let nameMinCompact: CGFloat = 90
}

struct ArchiveHeaderRow: View {
    var compact = false
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: ArchiveColumns.spacing) {
                Text("条目").padding(.leading, 28).frame(minWidth: compact ? ArchiveColumns.nameMinCompact : ArchiveColumns.nameMin, maxWidth: .infinity, alignment: .leading)
                Text("状态").frame(width: compact ? ArchiveColumns.stateCompact : ArchiveColumns.state, alignment: .leading)
                if !compact { Text("签发").frame(width: ArchiveColumns.date, alignment: .leading) }
                Text("到期").frame(width: compact ? ArchiveColumns.dateCompact : ArchiveColumns.date, alignment: .leading)
                Color.clear.frame(width: compact ? ArchiveColumns.actionsCompact : ArchiveColumns.actions, height: 1)
            }
            .font(TypeStyle.micro)
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, Space.l16).frame(height: 32)
            Rectangle().fill(Theme.hairline).frame(height: 1)
        }
        .accessibilityHidden(true)
    }
}

struct ArchiveRow: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var company: Company
    var item: ArchiveItem
    var compact = false
    @State private var uploading = false
    @State private var pending: StagedFile?
    @State private var editingNote = false
    @State private var noteText = ""
    @State private var hover = false
    @State private var dropTargeted = false
    @State private var reissue: ReissueTarget?
    @FocusState private var focused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let d = item.document
        HStack(spacing: ArchiveColumns.spacing) {
            HStack(spacing: 10) {
                StateGlyph(state: item.state).frame(width: 18)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(item.name).font(TypeStyle.rowTitle).lineLimit(2).help(item.name)
                        if item.olderVersions > 0 {
                            Text("旧版 \(item.olderVersions)").font(.system(size: 10.5, weight: .medium)).foregroundStyle(Theme.muted)
                                .padding(.horizontal, 6).frame(height: 18)
                                .background(Theme.band, in: .capsule)
                        }
                        // 已经在等负责方补发：常驻一个安静的标签；有缺口时悬停给出“请补发”
                        if let waiting = store.openRequest(owner: ownerRef, typeID: item.typeID) {
                            Text("在等\(store.party(waiting.partyID)?.name ?? "负责方")补发")
                                .font(.system(size: 10.5, weight: .medium)).foregroundStyle(Theme.muted)
                                .lineLimit(1)
                                .padding(.horizontal, 6).frame(height: 18)
                                .background(Theme.band, in: .capsule)
                                .help("已等 \(store.daysWaiting(waiting)) 天，\(waiting.followUpOn.short)跟进")
                        } else if canRequest && (hover || focused) {
                            Button("请补发") { requestReissue() }
                                .buttonStyle(PillButtonStyle(.quiet, size: .small))
                                .help("请负责方补发这一份")
                        }
                    }
                    let sub = [item.type?.localNames.first.flatMap { $0 == item.name ? nil : $0 }, noteShown(d).isEmpty ? nil : "备注：\(noteShown(d))"]
                        .compactMap { $0 }.joined(separator: "　")
                    if !sub.isEmpty {
                        Text(sub).font(.system(size: 12)).foregroundStyle(Theme.muted).lineLimit(1).help(sub)
                    }
                }
            }
            .frame(minWidth: compact ? ArchiveColumns.nameMinCompact : ArchiveColumns.nameMin, maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)

            StatusPill(state: item.state).frame(width: compact ? ArchiveColumns.stateCompact : ArchiveColumns.state, alignment: .leading)
            if !compact {
                Text(d?.issueDate?.description ?? "—").font(TypeStyle.metadata).monospacedDigit().foregroundStyle(d == nil ? Theme.muted : Theme.ink)
                    .frame(width: ArchiveColumns.date, alignment: .leading)
            }
            Text(expiryText(d)).font(TypeStyle.metadata).monospacedDigit()
                // 只有过期、即将到期时日期本身是问题；需更新的“长期”保持普通颜色
                .foregroundStyle(dateIsTheProblem ? item.state.emphasisColor : Theme.muted)
                .frame(width: compact ? ArchiveColumns.dateCompact : ArchiveColumns.date, alignment: .leading)

            HStack(spacing: 6) {
                Button(d == nil ? "归档" : "归档新版") { uploading = true }
                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
                ActionMenu(systemImage: "ellipsis", kind: .quiet, size: .small, entries: menuEntries(d))
                    .fixedSize()
                    .help("更多操作")
            }
            .frame(width: compact ? ArchiveColumns.actionsCompact : ArchiveColumns.actions, alignment: .trailing)
            // 行内操作平时低调，悬停或键盘聚焦时加强；需要归档的空条目始终清晰
            .opacity(hover || focused || d == nil ? 1 : 0.55)
            .animation(Motion.resolved(Motion.fast, reduceMotion: reduceMotion), value: hover)
        }
        .font(.system(size: 12.5))
        .padding(.horizontal, Space.l16).padding(.vertical, Space.s8).frame(minHeight: 56)
        .background(dropTargeted ? Theme.limeSoft : hover || focused ? Theme.band.opacity(0.7) : .clear, in: .rect(cornerRadius: Radius.row))
        .overlay {
            if dropTargeted {
                RoundedRectangle(cornerRadius: Radius.row)
                    .strokeBorder(Theme.limeText.opacity(0.6), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                    .allowsHitTesting(false)
            }
        }
        .contentShape(.rect)
        // 把一份文件拖到某一行：直接按这一条目归档；拖入多份时交给整家公司的导入
        .dropDestination(for: URL.self) { urls, _ in
            guard let first = urls.first else { return false }
            if urls.count > 1 {
                router.startImport(urls: urls, context: .company(company.id))
            } else {
                stage(first, replacing: d)
            }
            return true
        } isTargeted: { dropTargeted = $0 }
        // 用浅色底代替系统的方形焦点框
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(.return) {
            if let d { router.sheet = .document(d.id) } else { uploading = true }
            return .handled
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.name)，\(item.state.label)，到期日 \(expiryText(d))")
        .accessibilityAction {
            if let d { router.sheet = .document(d.id) } else { uploading = true }
        }
        .accessibilityAction(named: "归档材料") { uploading = true }
        .accessibilityAction(named: "请负责方补发") { if canRequest { requestReissue() } }
        .onHover { hover = $0 }
        .onTapGesture(count: 2) { if let d { router.sheet = .document(d.id) } }
        .fileImporter(isPresented: $uploading, allowedContentTypes: [.pdf, .image]) { result in
            guard case .success(let url) = result else { return }
            stage(url, replacing: d)
        }
        .sheet(item: $pending) { ArchiveConfirmSheet(file: $0) }
        .reissueSheet($reissue)
        .popover(isPresented: $editingNote, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 12) {
                Text("\(item.name)：备注").font(TypeStyle.rowTitle)
                TextField("例如：原件由开曼代理保管，需要时邮件索取", text: $noteText, axis: .vertical)
                    .lineLimit(3...6)
                    .textFieldStyle(KitFieldStyle())
                    .frame(width: 340)
                HStack(spacing: 8) {
                    Spacer()
                    Button("取消") { editingNote = false }
                        .buttonStyle(PillButtonStyle(.secondary))
                        .keyboardShortcut(.cancelAction)
                    Button("保存") { store.setNote(noteText, item: item.typeID, company: company.id); editingNote = false }
                        .buttonStyle(PillButtonStyle(.primary))
                        .keyboardShortcut(.defaultAction)
                }
            }
            .padding(16)
            .presentationBackground(Theme.surface)
        }
    }

    /// 行尾“…”菜单：有文件时是查看与打开；没有文件时是标记原因和备注。
    private func menuEntries(_ d: Document?) -> [MenuEntry] {
        let typeID = item.typeID
        let companyID = company.id
        var entries: [MenuEntry] = []
        if canRequest {
            if let waiting = store.openRequest(owner: ownerRef, typeID: typeID) {
                entries.append(.item("已在等\(store.party(waiting.partyID)?.name ?? "负责方")补发", systemImage: "hourglass", disabled: true) {})
            } else {
                entries.append(.item("请负责方补发…", systemImage: "paperplane") {
                    // 等菜单浮层收起后再弹出
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(250))
                        requestReissue()
                    }
                })
            }
            entries.append(.divider)
        }
        if let d {
            let docID = d.id
            entries.append(.item("查看与编辑（到期日、备注）…", systemImage: "doc.text.magnifyingglass") { router.sheet = .document(docID) })
            entries.append(.item("打开文件", systemImage: "arrow.up.forward.app") { store.open(d) })
            entries.append(.item("在访达中显示", systemImage: "folder") { store.reveal(d) })
        } else {
            entries.append(.header("标记原因"))
            for m in ItemMark.allCases {
                entries.append(.item("标记为\(m.label)", systemImage: "tag") { store.setMark(m, item: typeID, company: companyID) })
            }
            if case .marked = item.state {
                entries.append(.item("清除标记", systemImage: "xmark.circle") { store.setMark(nil, item: typeID, company: companyID) })
            }
            entries.append(.divider)
            let note = item.note
            entries.append(.item("编辑备注…", systemImage: "square.and.pencil") {
                noteText = note
                // 等菜单浮层收起后再弹出备注浮层
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(250))
                    editingNote = true
                }
            })
        }
        entries.append(.divider)
        entries.append(.item("本公司不再管理此条目", systemImage: "minus.circle") { store.dropItem(typeID, from: companyID) })
        return entries
    }

    private var ownerRef: NodeRef { NodeRef(kind: .company, id: company.id) }

    /// 缺失、过期、即将到期或需要更新的条目可以请负责方补发。
    private var canRequest: Bool {
        switch item.state {
        case .missing, .expired, .expiring, .needsUpdate: true
        default: false
        }
    }

    private func requestReissue() {
        reissue = ReissueTarget(owner: ownerRef, typeIDs: [item.typeID])
    }

    private var dateIsTheProblem: Bool {
        switch item.state {
        case .expired, .expiring: true
        default: false
        }
    }

    private func expiryText(_ d: Document?) -> String {
        guard let d else { return "—" }
        return Freshness.expiryLabel(of: d, type: item.type)
    }

    /// 按这一条目暂存文件，弹出归档确认。
    private func stage(_ url: URL, replacing d: Document?) {
        Task { @MainActor in
            do {
                pending = try await store.stage(url: url, typeID: item.typeID, owner: NodeRef(kind: .company, id: company.id),
                                                replaces: d, form: d?.form ?? "扫描件")
            } catch {
                store.errorMessage = "读取文件失败：\(error.localizedDescription)"
            }
        }
    }

    /// 有文件时显示文件备注，否则显示条目备注。
    private func noteShown(_ d: Document?) -> String {
        if let d, !d.notes.isEmpty { return d.notes }
        return item.note.isEmpty ? "" : item.note
    }
}

// MARK: - 调整本公司条目

struct CompanyItemsSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var companyID: String
    @State private var creating = false

    private var company: Company? { store.company(companyID) }

    var body: some View {
        if let c = company {
            let jName = store.jurisdictionName(c.jurisdiction)
            let template = store.templateItems(for: c.jurisdiction)
            let a = c.archive ?? CompanyArchive()
            let current = store.itemIDs(for: c)
            let candidates = store.library.documentTypes.filter {
                $0.owner == .company && !current.contains($0.id) && !AppStore.nonArchiveTypeIDs.contains($0.id)
                    && ($0.jurisdictions.isEmpty || $0.jurisdictions.contains(c.jurisdiction))
            }
            SheetScaffold(title: "自定义清单",
                          subtitle: "只调整 \(c.name) 的档案条目。\(jName)所有公司通用的条目在“设置 → 档案清单”里改。",
                          width: 600, height: 760) {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        FormGroup(title: "\(jName)通用条目") {
                            if template.isEmpty {
                                Text("\(jName)还没有通用条目。").font(TypeStyle.body).foregroundStyle(Theme.muted)
                            }
                            ForEach(template, id: \.self) { id in
                                Toggle(store.docType(id)?.name ?? id, isOn: Binding(
                                    get: { !a.removed.contains(id) },
                                    set: { $0 ? store.addItem(id, to: c.id) : store.removeItem(id, from: c.id) }))
                                    .toggleStyle(KitCheckboxStyle())
                            }
                        }
                        Text("取消勾选只影响这家公司。已归档的文件不会删除，会出现在“其他文件”里。")
                            .font(TypeStyle.metadata).foregroundStyle(Theme.muted).padding(.leading, 4)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    FormGroup(title: "只给这家公司加的条目") {
                        if a.added.isEmpty {
                            Text("还没有单独加的条目。").font(TypeStyle.body).foregroundStyle(Theme.muted)
                        }
                        ForEach(a.added, id: \.self) { id in
                            HStack {
                                Text(store.docType(id)?.name ?? id).font(TypeStyle.body).foregroundStyle(Theme.ink)
                                Spacer()
                                Button("去掉") { store.dropItem(id, from: c.id) }
                                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                            }
                        }
                        HStack(spacing: 8) {
                            if !candidates.isEmpty {
                                ActionMenu(title: "从已有类型添加", systemImage: "plus", kind: .secondary, size: .small,
                                           entries: candidates.map { t -> MenuEntry in
                                               let tid = t.id
                                               return MenuEntry.item(t.name) { store.addItem(tid, to: c.id) }
                                           })
                                    .fixedSize()
                            }
                            Button { creating = true } label: { Label("新建条目…", systemImage: "square.and.pencil") }
                                .buttonStyle(PillButtonStyle(.secondary, size: .small))
                            Spacer(minLength: 0)
                        }
                    }
                }
            } leading: {
                EmptyView()
            } trailing: {
                Button("完成") { dismiss() }
                    .buttonStyle(PillButtonStyle(.primary))
                    .keyboardShortcut(.defaultAction)
            }
            .sheet(isPresented: $creating) { NewCompanyItemSheet(company: c, jurisdictionName: jName) }
            .onExitCommand { dismiss() }
        } else {
            SheetScaffold(title: "找不到这家公司", subtitle: "它可能已被删除。", width: 420) {
                EmptyView()
            } leading: {
                EmptyView()
            } trailing: {
                Button("关闭") { dismiss() }
                    .buttonStyle(PillButtonStyle(.primary))
                    .keyboardShortcut(.cancelAction)
            }
        }
    }
}

/// 自定义清单里的“新建条目”：单独一个小弹窗，不再把整张表单铺在清单下面。
private struct NewCompanyItemSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var company: Company
    var jurisdictionName: String
    @State private var draft = ArchiveItemDraft()
    @State private var toTemplate = false

    var body: some View {
        SheetScaffold(title: "新建条目", subtitle: "加到 \(company.name) 的档案清单。", width: 520) {
            VStack(alignment: .leading, spacing: 16) {
                ArchiveItemFields(draft: $draft)
                FormGroup(title: "适用范围") {
                    Toggle("同时加到\(jurisdictionName)所有公司的通用条目", isOn: $toTemplate)
                        .toggleStyle(KitCheckboxStyle())
                }
            }
        } leading: {
            EmptyView()
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button("添加条目") { create() }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(!draft.isValid)
        }
    }

    private func create() {
        let c = company
        let t = store.createItem(name: draft.trimmedName, category: draft.category, jurisdiction: toTemplate ? c.jurisdiction : nil,
                                 validity: draft.validity, months: draft.validity == .monthsAfterIssue ? draft.months : nil,
                                 scope: c.jurisdiction)
        if !toTemplate { store.addItem(t.id, to: c.id) }
        store.showToast("已添加条目 \(t.name)")
        dismiss()
    }
}
