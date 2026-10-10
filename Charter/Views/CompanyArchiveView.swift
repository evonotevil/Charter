import SwiftUI
import UniformTypeIdentifiers

/// 公司详情里的“档案”：按法域条目逐行列出，有文件的显示日期和到期，没有的可以标记原因。
struct CompanyArchiveView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var company: Company
    @State private var width: CGFloat = 800

    var body: some View {
        let compact = width < 700
        let items = store.archive(of: company)
        let main = items.filter { !$0.isExtra || store.itemIDs(for: company).contains($0.typeID) }
        let others = items.filter { $0.isExtra && !store.itemIDs(for: company).contains($0.typeID) }
        let counted = items.filter { $0.state != .marked(.notApplicable) }
        VStack(alignment: .leading, spacing: Space.m12) {
            HStack(alignment: .firstTextBaseline, spacing: Space.s8) {
                Text("档案清单").font(TypeStyle.section).tracking(Tracking.section)
                Text("\(counted.filter { $0.state.hasFile }.count)/\(counted.count) 已归档").font(TypeStyle.meta).monospacedDigit().foregroundStyle(Theme.muted)
                Spacer()
                Button("自定义清单") { router.sheet = .companyItems(company.id) }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                    .help("只为这家公司增加或去掉条目；法域通用条目在“设置 → 档案条目”里改")
            }
            Text("按法域起始清单管理；可按实际需要调整。未持有材料可标记保管方、权限受限或不适用。")
                .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 0) {
                ArchiveHeaderRow(compact: compact)
                ForEach(Array(main.enumerated()), id: \.element.id) { pair in
                    if pair.offset > 0 { Rectangle().fill(Theme.hairline).frame(height: 1) }
                    ArchiveRow(company: company, item: pair.element, compact: compact)
                }
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
                    .buttonStyle(PillButtonStyle(d == nil ? .primary : .secondary, size: .small))
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
        .background(hover || focused ? Theme.band.opacity(0.7) : .clear, in: .rect(cornerRadius: Radius.row))
        .contentShape(.rect)
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
        .onHover { hover = $0 }
        .onTapGesture(count: 2) { if let d { router.sheet = .document(d.id) } }
        .fileImporter(isPresented: $uploading, allowedContentTypes: [.pdf, .image]) { result in
            guard case .success(let url) = result else { return }
            Task { @MainActor in
                do {
                    pending = try await store.stage(url: url, typeID: item.typeID, owner: NodeRef(kind: .company, id: company.id),
                                                    replaces: d, form: d?.form ?? "扫描件")
                } catch {
                    store.errorMessage = "读取文件失败：\(error.localizedDescription)"
                }
            }
        }
        .sheet(item: $pending) { ArchiveConfirmSheet(file: $0) }
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
        entries.append(.item("本公司不再管理此条目", systemImage: "minus.circle") { store.removeItem(typeID, from: companyID) })
        return entries
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
                          subtitle: "只调整 \(c.name) 的档案条目。\(jName)所有公司通用的条目在“设置 → 档案条目”里改。",
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
                                Button("去掉") { store.removeItem(id, from: c.id) }
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
