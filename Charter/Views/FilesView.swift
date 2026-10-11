import SwiftUI
import AppKit
import UniformTypeIdentifiers

struct FilesView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @State private var query = ""
    @FocusState private var searchFocused: Bool
    private var horizon: Int { router.filesHorizon }
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var filter: Int { router.filesFilter }
    @State private var dropTargeted = false
    /// 多选（⌘ 点按、⇧ 点按）的文件 ID；anchor 是 ⇧ 连选的起点。
    @State private var selected: Set<String> = []
    @State private var anchor: String?
    @State private var exporting = false

    private struct Snapshot {
        var document: Document
        var freshness: Freshness
        var ownerName: String
        var typeName: String
        var expiry: Day?
    }

    /// 当前集团、归属类型和搜索词共同形成一个范围；页面上的总数与提醒数都从这里计算。
    private func scopedSnapshots() -> [Snapshot] {
        let q = query.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let scope = store.companyIDs(forFilter: router.groupFilter)
        var list = store.documents.filter {
            $0.supersededBy == nil
                && (router.filesOwnerKind == nil || $0.owner.kind == router.filesOwnerKind)
                && ($0.owner.kind == .person || (scope?.contains($0.owner.id) ?? true))
        }.map { document in
            Snapshot(document: document,
                     freshness: store.freshness(document),
                     ownerName: store.name(of: document.owner),
                     typeName: store.docType(document.typeID)?.name ?? "",
                     expiry: Freshness.expiry(of: document, type: store.docType(document.typeID)))
        }
        if !q.isEmpty {
            list = list.filter { item in
                item.typeName.lowercased().contains(q)
                    || item.ownerName.lowercased().contains(q)
                    || item.document.originalFileName.lowercased().contains(q)
            }
        }
        return list
    }

    private func filteredDocuments(_ scoped: [Snapshot]) -> [Document] {
        var list = scoped
        switch filter {
        case 1:
            // “即将到期”只看今天起的未来范围；已过期文件留在“需处理”。
            list = list.filter {
                guard let expiry = $0.expiry else { return false }
                let days = store.today.days(until: expiry)
                return days >= 0 && days <= horizon
            }
                .sorted { ($0.expiry ?? store.today) < ($1.expiry ?? store.today) }
        case 2: list = list.filter {
                    $0.freshness.needsAttention
                        && (router.filesOwnerKind != nil || $0.document.owner.kind == .company)
                }
        case 3: list = list.filter {
                    let days = $0.document.addedOn.days(until: store.today)
                    return days >= 0 && days <= 30
                }
                .sorted { $0.document.addedOn > $1.document.addedOn }
        default: break
        }
        if filter == 0 || filter == 2 {
            list.sort { ($0.freshness.sortRank, $0.ownerName) < ($1.freshness.sortRank, $1.ownerName) }
        }
        return list.map(\.document)
    }

    /// 按所属公司或人分组；需要更新的组排在前面。
    private func grouped(_ documents: [Document]) -> [(NodeRef, [Document])] {
        let g = Dictionary(grouping: documents, by: \.owner)
        return g.keys.sorted { a, b in
            let ra = g[a]!.map { store.freshness($0).sortRank }.min() ?? 9
            let rb = g[b]!.map { store.freshness($0).sortRank }.min() ?? 9
            return (ra, store.name(of: a)) < (rb, store.name(of: b))
        }.map { ($0, g[$0]!) }
    }

    @AppStorage("files.grid") private var grid = false

    var body: some View {
        let scoped = scopedSnapshots()
        let docs = filteredDocuments(scoped)
        let grouped = grouped(docs)
        // 与总览、侧栏同一口径：公司文件按集团范围计数；只看个人材料时显示个人文件数。
        let attentionCount = router.filesOwnerKind == .person ? store.attentionPersonalCount
            : store.attentionCount(forFilter: router.groupFilter)
        // 页面上从上到下的显示顺序，⇧ 连选和 ⌘A 按这个顺序。
        let ordered: [Document] = (filter == 1 || filter == 3) ? docs : grouped.flatMap { $0.1 }
        let selectedDocs = ordered.filter { selected.contains($0.id) }
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Space.section40) {
                VStack(alignment: .leading, spacing: Space.xl24) {
                    header(visible: docs.count, total: scoped.count, attention: attentionCount)
                    controls(attentionCount: attentionCount)
                    if let pending = store.pendingImport, !router.isImportOpen {
                        pendingImportBanner(pending)
                    }
                }
                if store.documents.isEmpty {
                    EmptyStateView(symbol: "doc.on.doc", title: "还没有文件",
                                   message: "把 PDF、照片或按公司分好的文件夹拖进窗口，Charter 会识别类型、公司和日期，你确认后才归档。",
                                   actionTitle: "导入文件") { router.chooseFiles(context: nil) }
                        .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
                } else if docs.isEmpty {
                    emptyResults(scopedCount: scoped.count)
                } else if filter == 1 || filter == 3 {
                    section(title: filter == 1 ? "按到期日排列" : "最近 30 天添加", owner: nil, list: docs, ordered: ordered)
                } else {
                    ForEach(grouped, id: \.0) { item in
                        section(title: store.name(of: item.0), owner: item.0, list: item.1, ordered: ordered)
                    }
                }
            }
            .padding(Space.pageEdge)
            .padding(.bottom, selectedDocs.isEmpty ? 0 : 64)
            .frame(maxWidth: .infinity, alignment: .leading)
            .appear()
        }
        .background(Theme.canvas)
        .overlay {
            if dropTargeted {
                RoundedRectangle(cornerRadius: Radius.surface, style: .continuous)
                    .strokeBorder(Theme.onLime, style: StrokeStyle(lineWidth: 2, dash: [8, 6]))
                    .background(Theme.lime.opacity(0.88), in: .rect(cornerRadius: Radius.surface, style: .continuous))
                    .overlay {
                        VStack(spacing: 8) {
                            Image(systemName: "arrow.down.doc").font(.system(size: 34, weight: .semibold))
                            Text("松开以开始识别").font(.system(size: 22, weight: .semibold))
                            Text("识别结果需经你确认后才会归档").font(.system(size: 13)).opacity(0.7)
                        }
                        .foregroundStyle(Theme.onLime)
                    }
                    .padding(16)
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
        .animation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion), value: dropTargeted)
        .dropDestination(for: URL.self) { urls, _ in
            router.startImport(urls: urls, context: nil)
            return true
        } isTargeted: { dropTargeted = $0 }
        .overlay(alignment: .bottom) {
            if !selectedDocs.isEmpty {
                selectionBar(selectedDocs)
                    .padding(.bottom, Space.xl24)
                    .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(Motion.resolved(Motion.panel, reduceMotion: reduceMotion), value: selectedDocs.isEmpty)
        .background { selectionShortcuts(ordered) }
        .navigationTitle("文件")
    }

    /// 直接移除选中文件的记录（文件本身保留），提示条可撤销，也可以 ⌘Z。
    private func removeSelected(_ docs: [Document]) {
        guard !docs.isEmpty else { return }
        let ids = Set(docs.map(\.id))
        if docs.count > 1 { store.snapshotBeforeChange("移除 \(docs.count) 份文件记录前") }
        store.removeDocuments(ids)
        selected.removeAll()
        anchor = nil
    }

    /// 上次导入没完成：继续（不必重新识别）或放弃（可撤销）。
    private func pendingImportBanner(_ p: PendingImport) -> some View {
        HStack(spacing: Space.m12) {
            Image(systemName: "tray.and.arrow.down")
                .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.amberText)
                .frame(width: 32, height: 32)
                .background(Theme.band, in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text("上次导入还有 \(p.remaining) 份文件未完成").font(TypeStyle.rowTitle).foregroundStyle(Theme.ink)
                Text("识别结果和你的修改都已保存（\(AppStore.snapshotTitle(p.savedAt))），继续时不需要重新识别。")
                    .font(TypeStyle.meta).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: Space.m12)
            Button("放弃") { store.discardPendingImport() }
                .buttonStyle(PillButtonStyle(.quiet, size: .small))
            Button("继续") { router.sheet = .resumeImport }
                .buttonStyle(PillButtonStyle(.primary, size: .small))
        }
        .padding(.horizontal, Space.l16).padding(.vertical, Space.m12)
        .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("上次导入还有 \(p.remaining) 份文件未完成")
    }

    // MARK: 多选

    /// ⌘ 点按：加入或移出选择；⇧ 点按：从上次点按的文件连选到这一份。
    private func modifiedClick(_ id: String, shift: Bool, ordered: [Document]) {
        if shift, let a = anchor,
           let i = ordered.firstIndex(where: { $0.id == a }),
           let j = ordered.firstIndex(where: { $0.id == id }) {
            selected.formUnion(ordered[min(i, j)...max(i, j)].map(\.id))
        } else if selected.contains(id) && !shift {
            selected.remove(id)
            anchor = id
        } else {
            selected.insert(id)
            anchor = id
        }
    }

    /// 普通点按：保持原来的打开行为，同时清除多选。
    private func plainClick(_ id: String) {
        selected.removeAll()
        anchor = id
    }

    private func isPlainClick() -> Bool {
        let flags = NSEvent.modifierFlags
        return !flags.contains(.command) && !flags.contains(.shift)
    }

    /// ⌘A 全选当前显示的文件，Esc 取消选择。搜索框有焦点时不接管 ⌘A。
    private func selectionShortcuts(_ ordered: [Document]) -> some View {
        ZStack {
            Button("全选") {
                selected = Set(ordered.map(\.id))
                anchor = ordered.first?.id
            }
            .keyboardShortcut("a", modifiers: .command)
            .disabled(searchFocused || ordered.isEmpty)
            Button("取消选择") {
                selected.removeAll()
                anchor = nil
            }
            .keyboardShortcut(.cancelAction)
            .disabled(selected.isEmpty)
        }
        .frame(width: 0, height: 0)
        .opacity(0)
        .accessibilityHidden(true)
    }

    /// 底部浮动操作条：选中 1 份以上时出现。
    private func selectionBar(_ docs: [Document]) -> some View {
        HStack(spacing: 8) {
            Text("已选 \(docs.count) 份")
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink)
                .numericTransition()
                .animation(Motion.resolved(Motion.fast, reduceMotion: reduceMotion), value: docs.count)
                .padding(.leading, 8).padding(.trailing, 4)
            Button("打开") { openAll(docs) }
                .buttonStyle(PillButtonStyle(.quiet, size: .small))
            Button("在访达中显示") { revealAll(docs) }
                .buttonStyle(PillButtonStyle(.quiet, size: .small))
            Button("从 Charter 移除") { removeSelected(docs) }
                .buttonStyle(PillButtonStyle(.secondary, size: .small))
            Button(exporting ? "正在导出…" : "导出为 ZIP…") { exportZIP(docs) }
                .buttonStyle(PillButtonStyle(.primary, size: .small))
                .disabled(exporting)
            Rectangle().fill(Theme.hairline).frame(width: 1, height: 20)
            Button {
                selected.removeAll()
                anchor = nil
            } label: {
                Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.muted)
                    .frame(width: 28, height: 28).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .help("取消选择（Esc）")
            .accessibilityLabel("取消选择")
        }
        .padding(.horizontal, 10).frame(height: 48)
        .background(Theme.surface, in: .capsule)
        .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
        .floatingShadow()
    }

    /// 右键点到已选中的文件、且选了不止一份时，菜单最前面显示批量操作。
    private func batchMenu(for id: String, ordered: [Document]) -> AnyView? {
        guard selected.contains(id), selected.count > 1 else { return nil }
        let docs = ordered.filter { selected.contains($0.id) }
        guard docs.count > 1 else { return nil }
        return AnyView(Section("已选 \(docs.count) 份") {
            Button("打开 \(docs.count) 份") { openAll(docs) }
            Button("在访达中显示 \(docs.count) 份") { revealAll(docs) }
            Button("导出为 ZIP…") { exportZIP(docs) }
            Button("从 Charter 移除 \(docs.count) 份") { removeSelected(docs) }
        })
    }

    private func openAll(_ docs: [Document]) {
        for d in docs { store.open(d) }
    }

    private func revealAll(_ docs: [Document]) {
        NSWorkspace.shared.activateFileViewerSelecting(docs.map { store.fileURL($0) })
    }

    /// 把选中的文件打包成一个 ZIP，保存到用户选择的位置。
    private func exportZIP(_ docs: [Document]) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.zip]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = "Charter 文件 \(store.today.description).zip"
        panel.prompt = "导出"
        guard panel.runModal() == .OK, let target = panel.url else { return }
        let fm = FileManager.default
        var used = Set<String>()
        var entries: [ExportEntry] = []
        for d in docs {
            let source = store.fileURL(d)
            guard fm.fileExists(atPath: source.path) else { continue }
            let base = source.deletingPathExtension().lastPathComponent
            let ext = source.pathExtension
            var name = source.lastPathComponent
            var n = 2
            while used.contains(name) {
                name = ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)"
                n += 1
            }
            used.insert(name)
            entries.append(ExportEntry(path: name, payload: .file(source)))
        }
        let missing = docs.count - entries.count
        guard !entries.isEmpty else {
            store.errorMessage = "选中的文件在数据文件夹里都找不到了，无法导出。请在访达中检查数据文件夹的“文件”目录。"
            return
        }
        exporting = true
        Task { @MainActor in
            defer { exporting = false }
            do {
                if fm.fileExists(atPath: target.path) { try fm.removeItem(at: target) }
                guard fm.createFile(atPath: target.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
                try await ExportIO.writeZIP(entries: entries, to: target) { _, _ in }
                store.showToast("已导出 \(entries.count) 份文件到 \(target.lastPathComponent)"
                                + (missing > 0 ? "，\(missing) 份找不到原文件已跳过。" : "。"))
                NSWorkspace.shared.activateFileViewerSelecting([target])
            } catch {
                try? fm.removeItem(at: target)
                store.errorMessage = "导出 ZIP 失败：\(error.localizedDescription)。请换一个保存位置再试。"
            }
        }
    }

    private func header(visible: Int, total: Int, attention: Int) -> some View {
        PageHeader(title: "文件",
                   subtitle: (visible == total ? "\(total) 份现行文件" : "显示 \(visible) / \(total) 份")
                     + (attention > 0 ? "，\(attention) 份需处理" : "，都在有效期内")
                     + "。把 PDF、照片或文件夹拖进窗口即可导入。") {
            Button { router.chooseFiles(context: nil) } label: { Label("导入文件", systemImage: "square.and.arrow.down") }
                .buttonStyle(PillButtonStyle(.primary, size: .large))
                .help("选择 PDF、照片或文件夹；也可以直接拖进窗口")
        }
    }

    private func controls(attentionCount: Int) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                ownerMenu
                primaryFilters(attentionCount: attentionCount)
                if filter == 1 { horizonFilters }
                Spacer(minLength: 12)
                searchField.frame(width: 240)
                viewPicker
            }
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    ownerMenu
                    primaryFilters(attentionCount: attentionCount)
                    Spacer(minLength: 8)
                    viewPicker
                }
                HStack(spacing: 10) {
                    if filter == 1 { horizonFilters }
                    searchField
                }
            }
        }
        .animation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion), value: filter)
    }

    private func primaryFilters(attentionCount: Int) -> some View {
        PillSegmented(options: [(0, "全部"), (1, "即将到期"), (2, "需处理 \(attentionCount)"), (3, "最近添加")],
                      selection: Binding(get: { router.filesFilter }, set: { router.filesFilter = $0 }))
    }

    @ViewBuilder
    private func emptyResults(scopedCount: Int) -> some View {
        Group {
            if !query.isEmpty {
                EmptyStateView(symbol: "magnifyingglass", title: "没有找到“\(query)”",
                               message: "搜索范围已按当前集团和归属类型限制。",
                               actionTitle: "清除搜索") { query = "" }
            } else if scopedCount == 0 {
                EmptyStateView(symbol: "doc.on.doc", title: "当前范围没有文件",
                               message: "当前集团或归属类型下没有现行文件。",
                               actionTitle: "查看全部范围") {
                    router.groupFilter = nil
                    router.filesOwnerKind = nil
                    router.filesFilter = 0
                }
            } else {
                EmptyStateView(symbol: filter == 2 ? "checkmark.seal" : "doc.on.doc",
                               title: filter == 1 ? "未来 \(horizon) 天没有即将到期的文件" : filter == 2 ? "当前范围没有需要处理的文件" : "最近 30 天没有添加文件",
                               message: "当前范围内还有 \(scopedCount) 份现行文件。",
                               actionTitle: "查看全部文件") { router.filesFilter = 0 }
            }
        }
        .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
    }

    private var horizonFilters: some View {
        PillSegmented(options: [(30, "30 天"), (60, "60 天"), (90, "90 天"), (183, "半年")],
                      selection: Binding(get: { router.filesHorizon }, set: { router.filesHorizon = $0 }))
    }

    /// 归属范围：公司与人员 / 公司材料 / 个人材料。放进下拉菜单，和状态筛选同一行。
    private var ownerMenu: some View {
        HStack(spacing: 6) {
            Text("范围").font(TypeStyle.meta).foregroundStyle(Theme.muted)
            ownerSelect
        }
    }

    private var ownerSelect: some View {
        SelectField(options: [(0, "公司与人员"), (1, "公司材料"), (2, "个人材料（全部人员）")],
                    selection: Binding(get: {
                        router.filesOwnerKind == .company ? 1 : router.filesOwnerKind == .person ? 2 : 0
                    }, set: { router.filesOwnerKind = $0 == 1 ? .company : $0 == 2 ? .person : nil }),
                    minWidth: 130)
            .help("按归属筛选：公司材料或个人材料")
    }

    private var viewPicker: some View {
        PillSegmented(options: [(false, "列表"), (true, "缩略图")], selection: $grid)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Button { searchFocused = true } label: { Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted) }
                .buttonStyle(.plain).keyboardShortcut("f", modifiers: [.command]).help("搜索文件（⌘F）")
            TextField("搜索类型、公司或文件名", text: $query).textFieldStyle(.plain).focused($searchFocused)
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted) }.buttonStyle(.plain)
            }
        }
        .font(TypeStyle.body)
        .padding(.horizontal, 14).frame(minWidth: 200, maxWidth: .infinity, minHeight: 36, maxHeight: 36)
        .background(Theme.surface, in: .capsule)
    }

    @ViewBuilder
    private func section(title: String, owner: NodeRef?, list: [Document], ordered: [Document]) -> some View {
        VStack(alignment: .leading, spacing: Space.m12) {
            HStack(spacing: 10) {
                if let owner {
                    if owner.kind == .company, let c = store.company(owner.id) {
                        JurisdictionBadge(code: c.jurisdiction, size: 26)
                    } else {
                        Avatar(name: title, size: 26)
                    }
                    Button { if owner.kind == .company { router.open(company: owner.id) } else { router.open(person: owner.id) } } label: {
                        HStack(spacing: 4) {
                            Text(title).font(TypeStyle.section).tracking(Tracking.section)
                            Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.muted)
                        }
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(title).font(TypeStyle.section).tracking(Tracking.section)
                }
                Text("\(list.count) 份").font(TypeStyle.meta).foregroundStyle(Theme.muted)
                let bad = list.filter { store.freshness($0).needsAttention }.count
                if bad > 0 { Pill(text: "\(bad) 份需处理", kind: list.contains { store.freshness($0).pillKind == .bad } ? .bad : .warn) }
                Spacer()
            }
            if grid {
                // 文件是独立的对象：缩略图视图里每份文件一张卡片，直接放在画布上
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 160, maximum: 200), spacing: Space.l16)], alignment: .leading, spacing: Space.l16) {
                    ForEach(list) { d in
                        FileCard(document: d, showOwner: owner == nil,
                                 isSelected: selected.contains(d.id),
                                 extraMenu: batchMenu(for: d.id, ordered: ordered),
                                 onModifiedClick: { shift in modifiedClick(d.id, shift: shift, ordered: ordered) },
                                 onPlainClick: { plainClick(d.id) })
                    }
                }
            } else {
                // 列表视图：一个承载面，行之间用细线分隔
                VStack(spacing: 0) {
                FileHeaderRow()
                LazyVStack(spacing: 0) {
                    ForEach(Array(list.enumerated()), id: \.element.id) { pair in
                        let d = pair.element
                        let on = selected.contains(d.id)
                        DocumentRow(document: d, showOwner: owner == nil, extraMenu: batchMenu(for: d.id, ordered: ordered))
                            .background(on ? Theme.band : .clear, in: .rect(cornerRadius: Radius.row))
                            .overlay {
                                if on {
                                    RoundedRectangle(cornerRadius: Radius.row).strokeBorder(Theme.ink, lineWidth: 2)
                                        .allowsHitTesting(false)
                                }
                            }
                            .animation(Motion.resolved(Motion.fast, reduceMotion: reduceMotion), value: on)
                            .highPriorityGesture(TapGesture().modifiers(.command).onEnded {
                                modifiedClick(d.id, shift: false, ordered: ordered)
                            })
                            .highPriorityGesture(TapGesture().modifiers(.shift).onEnded {
                                modifiedClick(d.id, shift: true, ordered: ordered)
                            })
                            .simultaneousGesture(TapGesture().onEnded {
                                if isPlainClick() { plainClick(d.id) }
                            })
                            .accessibilityAddTraits(on ? .isSelected : [])
                        if pair.offset < list.count - 1 {
                            Rectangle().fill(Theme.hairline).frame(height: 1).padding(.horizontal, Space.l16)
                        }
                    }
                }
                }
                .padding(Space.s8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
            }
        }
    }
}

/// 文件表的列宽，表头与行共用。
enum FileColumns {
    static let state: CGFloat = 104
    static let date: CGFloat = 92
    static let actions: CGFloat = 176
    static let spacing: CGFloat = 12
}

struct FileHeaderRow: View {
    var body: some View {
        BandHeader {
            HStack(spacing: FileColumns.spacing) {
                Text("文件").frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 46)
                Text("状态").frame(width: FileColumns.state, alignment: .leading)
                Text("签发").frame(width: FileColumns.date, alignment: .leading)
                Text("到期").frame(width: FileColumns.date, alignment: .leading)
                Color.clear.frame(width: FileColumns.actions, height: 1)
            }
        }
    }
}

/// 缩略图视图里的一张文件卡。
struct FileCard: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var document: Document
    var showOwner = false
    var isSelected = false
    /// 右键菜单最前面追加的批量操作。
    var extraMenu: AnyView? = nil
    /// ⌘ 或 ⇧ 点按时调用（参数：是否按着 ⇧）；为空时一律打开文件详情。
    var onModifiedClick: ((Bool) -> Void)? = nil
    var onPlainClick: (() -> Void)? = nil
    @State private var hover = false
    @State private var uploading = false
    @State private var pending: StagedFile?
    @State private var reissuing = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let d = document
        let f = store.freshness(d)
        Button {
            let flags = NSEvent.modifierFlags
            if let onModifiedClick, flags.contains(.command) || flags.contains(.shift) {
                onModifiedClick(flags.contains(.shift))
            } else {
                onPlainClick?()
                router.sheet = .document(d.id)
            }
        } label: {
            VStack(alignment: .leading, spacing: Space.m12) {
                FileThumb(url: store.fileURL(d), alert: f.pillKind == .bad, size: CGSize(width: 120, height: 150))
                    .frame(maxWidth: .infinity).frame(height: 172)
                    .background(Theme.band, in: .rect(cornerRadius: Radius.field, style: .continuous))
                    .scaleEffect(hover && !reduceMotion ? 1.02 : 1)
                VStack(alignment: .leading, spacing: 2) {
                    Text(store.docType(d.typeID)?.name ?? "文件").font(TypeStyle.rowTitle).lineLimit(1)
                    Text(showOwner ? store.name(of: d.owner) : (d.issueDate.map { "\($0.long)签发" } ?? "缺少签发日期"))
                        .font(TypeStyle.micro).foregroundStyle(Theme.muted).lineLimit(1)
                }
                Pill(text: f.label, kind: f.pillKind)
            }
            .padding(Space.m12)
            .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.surface, style: .continuous)
                    .strokeBorder(isSelected ? Theme.ink : (hover ? Theme.hairline : .clear), lineWidth: isSelected ? 2.5 : 1)
            }
            .overlay(alignment: .topTrailing) {
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Theme.onInk, Theme.ink)
                        .padding(Space.l16)
                        .transition(.opacity)
                }
            }
            .animation(Motion.resolved(Motion.fast, reduceMotion: reduceMotion), value: isSelected)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { h in withAnimation(Motion.resolved(Motion.fast, reduceMotion: reduceMotion)) { hover = h } }
        .contextMenu {
            if let extraMenu {
                extraMenu
                Divider()
            }
            Button("打开") { store.open(d) }
            Button("在访达中显示") { store.reveal(d) }
            Button("归档新版…") { uploading = true }
            Button("请补发…") { reissuing = true }
            Divider()
            Button("从 Charter 移除记录", role: .destructive) {
                store.delete(document: d)
            }
        }
        .fileImporter(isPresented: $uploading, allowedContentTypes: [.pdf, .image]) { result in
            guard case .success(let url) = result else { return }
            Task { @MainActor in
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
            ReissueRequestSheet(owner: d.owner, typeIDs: [d.typeID])
        }
        .help(d.originalFileName)
        .accessibilityLabel("\(store.docType(d.typeID)?.name ?? "文件")，\(f.label)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - 导入与识别

struct ImportItem: Identifiable, Codable {
    var id = UUID()
    var url: URL
    var folderHint: String?          // 上层文件夹名，通常是公司名
    var recognized = false
    var usedModel = false
    var typeID: String?
    var owner: NodeRef?
    var newCompanyKey: String?       // 归到待新建的公司
    var issueDate: Day?
    var expiryDate: Day?
    var include = true
    /// 识别依据（简短说明）。
    var evidence: [String] = []
    var confidence: Double = 0
    /// 需要人看一眼。
    var needsReview = false
    /// 类型只是推断（不是从文件内容中读到的）。
    var typeUncertain = false
    /// 归属只是推断（没在文件里找到已有公司）。
    var ownerUncertain = false
    /// 用户已确认（点了“确认”或亲手改过类型、归属）。
    var confirmed = false
    /// 文件里读到的公司资料，用于新建公司。
    var companyNameGuess: String?
    var jurisdiction: String?
    var registrationNumber: String?
    var incorporationDate: Day?
    /// 继续上次的导入时找不到原文件（已移动或删除）。
    var missing = false
    /// 同类文件已有现行版本时“另存为一份”（不取代）。可选，兼容旧的待处理导入。
    var keepBoth: Bool?
}

struct CompanyDraft: Identifiable, Codable {
    var id: String { key }
    var key: String                  // 文件夹名，或识别出的公司名
    var name: String
    var jurisdiction: String
    var incorporationDate: Day?
    var registrationNumber: String = ""
    var create = true
}

/// 归档完成后要展示的结果。
struct ImportResult: Equatable {
    var count: Int
    var companyIDs: [String]
    var newCompanyCount: Int
}

struct ImportView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    var urls: [URL]
    /// 从哪里上传：当前公司时全部默认归到这家公司；当前集团时先在集团里找公司。
    var context: Router.ImportContext? = nil
    /// 继续上次没完成的导入：直接用保存的行，不重新识别。
    var resume: PendingImport? = nil
    @State private var items: [ImportItem] = []
    /// 已有未完成的导入，又拖进了新文件：先问一次继续还是开始新的。
    @State private var asking = false
    @State private var started = false
    /// 点了“放弃”或已归档：关闭时不再保存草稿。
    @State private var finished = false
    @State private var drafts: [CompanyDraft] = []
    @State private var progress = 0
    @State private var working = true
    @State private var committing = false
    @State private var commitError: String?
    @State private var result: ImportResult?

    private enum Col {
        static let check: CGFloat = 22
        static let type: CGFloat = 200
        static let owner: CGFloat = 220
        static let date: CGFloat = 140
        static let state: CGFloat = 150
        static let spacing: CGFloat = 10
    }

    var body: some View {
        Group {
            if let result {
                ImportDoneView(result: result, focusCompanyID: contextCompany?.id)
            } else if asking, let old = store.pendingImport {
                resumeChoice(old)
            } else {
                review
            }
        }
        .task { await start() }
        .onDisappear {
            router.importContext = nil
            // 关闭窗口（稍后继续、Esc、关窗）：保存未确认的行和改动，下次直接继续
            if !finished, result == nil, !items.isEmpty { saveDraft() }
        }
    }

    private func start() async {
        guard !started else { return }
        started = true
        if let resume {
            load(resume)
            await scan([])
        } else if store.pendingImport != nil, !urls.isEmpty {
            asking = true
        } else {
            await scan(urls)
        }
    }

    private func load(_ draft: PendingImport) {
        items = draft.resolvedItems()
        drafts = draft.drafts
    }

    private func saveDraft() {
        store.savePendingImport(PendingImport(deviceID: store.deviceID, context: context, items: items, drafts: drafts))
    }

    /// 放弃这次导入：不归档、删除草稿；提示条可撤销（草稿写回，可从文件页继续）。
    private func discard() {
        finished = true
        let draft = PendingImport(deviceID: store.deviceID, context: context, items: items, drafts: drafts)
        store.savePendingImport(nil)
        dismiss()
        let appStore = store
        appStore.showToast("已放弃这次导入，原文件没有改动。") { appStore.savePendingImport(draft) }
    }

    /// 已有未完成的导入时，又开始一次新的导入。
    private func resumeChoice(_ old: PendingImport) -> some View {
        SheetScaffold(title: "继续上次的导入，还是开始新的？",
                      subtitle: "上次还有 \(old.remaining) 份文件没有归档（\(AppStore.snapshotTitle(old.savedAt)) 保存）。继续时，这次的 \(urls.count) 项会一起加进来识别。",
                      width: 560) {
            EmptyView()
        } leading: {
            Button("取消") { finished = true; dismiss() }
                .buttonStyle(PillButtonStyle(.quiet))
                .keyboardShortcut(.cancelAction)
        } trailing: {
            Button("开始新的") {
                store.discardPendingImport()
                asking = false
                Task { await scan(urls) }
            }
            .buttonStyle(PillButtonStyle(.secondary))
            Button("继续上次的") {
                load(old)
                asking = false
                Task { await scan(urls) }
            }
            .buttonStyle(PillButtonStyle(.primary))
            .keyboardShortcut(.defaultAction)
        }
    }

    /// 至少有一份识别完的文件：关闭时可以“稍后继续”。
    private var hasRecognizedRows: Bool { items.contains { $0.recognized } }

    /// 上下文指向的公司（仍存在时）。
    private var contextCompany: Company? {
        if case .company(let id)? = context { return store.company(id) }
        return nil
    }

    /// 上下文指向的集团（仍存在时）。
    private var contextGroup: CorporateGroup? {
        if case .group(let id)? = context { return store.group(id) }
        return nil
    }

    private var pendingCount: Int { working ? 0 : items.filter { !resolved($0) }.count }

    private var title: String {
        if committing { return "正在归档 \(items.filter { ready($0) }.count) 份文件" }
        if working { return "正在识别 \(progress) / \(items.count) 份文件" }
        let n = pendingCount
        return n > 0 ? "识别完成，请确认 \(n) 处" : "都确认好了，可以归档"
    }

    private var subtitle: String {
        let base = baseSubtitle
        if let c = contextCompany { return "归档到 \(c.name)。" + base }
        if let g = contextGroup { return "优先在\(g.name)的公司中匹配，新公司会归入这个集团。" + base }
        return base
    }

    private var baseSubtitle: String {
        if committing { return "正在复制文件并一次写入档案，请保持窗口打开。" }
        if working { return "逐份读取首页，找出公司名称、注册编号、文件类型和签发日期。全部在这台 Mac 上完成，不会上传。" }
        return "把握高的已自动归位。琥珀色的需要你看一眼，改好或点“确认”后一起归档。"
    }

    private var review: some View {
        let readyCount = items.lazy.filter { ready($0) }.count
        let pending = pendingCount
        let shown = working ? items.filter(\.recognized) : items
        return SheetScaffold(title: title, subtitle: subtitle, width: 1240, height: 820) {
            VStack(alignment: .leading, spacing: 18) {
                if let commitError {
                    Label(commitError, systemImage: "exclamationmark.triangle.fill")
                        .font(TypeStyle.body).foregroundStyle(Theme.amberText)
                        .textSelection(.enabled)
                }
                if working {
                    ImportMeter(fraction: Double(progress) / Double(max(items.count, 1)))
                }

                if !drafts.isEmpty {
                    FormGroup(title: "新公司（归档时新建档案）") {
                        ForEach($drafts) { $d in
                            HStack(spacing: Col.spacing) {
                                Toggle("建档", isOn: $d.create)
                                    .toggleStyle(KitCheckboxStyle())
                                TextField("注册名", text: $d.name)
                                    .textFieldStyle(KitFieldStyle())
                                    .frame(width: 260)
                                SelectField(options: store.library.jurisdictions.map { ($0.code, $0.name) },
                                            selection: $d.jurisdiction, minWidth: 150)
                                TextField("注册编号", text: $d.registrationNumber)
                                    .textFieldStyle(KitFieldStyle())
                                    .frame(width: 140)
                                DateField(day: $d.incorporationDate, placeholder: "成立日期", minWidth: 150)
                                Spacer(minLength: 0)
                            }
                            .disabled(committing)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    BandHeader {
                        HStack(spacing: Col.spacing) {
                            Color.clear.frame(width: Col.check, height: 1)
                            Text("文件").frame(maxWidth: .infinity, alignment: .leading)
                            Text("类型").frame(width: Col.type, alignment: .leading)
                            Text("归属").frame(width: Col.owner, alignment: .leading)
                            Text("签发日期").frame(width: Col.date, alignment: .leading)
                            Text("到期日期").frame(width: Col.date, alignment: .leading)
                            Text("结果").frame(width: Col.state, alignment: .leading)
                        }
                    }
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(shown) { i in
                            importRow(i)
                                .transition(.opacity)
                            if i.id != shown.last?.id {
                                Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, 16)
                            }
                        }
                    }
                    .animation(Motion.standard, value: progress)
                    .disabled(committing)
                }
            }
        } leading: {
            if committing {
                ProgressView().controlSize(.small)
            } else if !working {
                let companies = Set(items.filter(\.include).compactMap { i -> String? in
                    if let o = i.owner, o.kind == .company { return o.id }
                    return i.newCompanyKey.map { "new:" + $0 }
                }).count
                HStack(spacing: 18) {
                    summaryFigure(items.filter(\.include).count, "份文件")
                    summaryFigure(companies, "家公司")
                    summaryFigure(pending, "处待确认")
                }
            }
        } trailing: {
            if hasRecognizedRows {
                Button("放弃") { discard() }
                    .buttonStyle(PillButtonStyle(.quiet))
                    .disabled(committing)
                    .help("不归档这些文件，也不保存草稿")
                Button("稍后继续") { dismiss() }
                    .buttonStyle(PillButtonStyle(.secondary))
                    .keyboardShortcut(.cancelAction)
                    .disabled(committing)
                    .help("保存识别结果和你的修改，可以从“文件”页继续")
            } else {
                Button("取消") { dismiss() }
                    .buttonStyle(PillButtonStyle(.secondary))
                    .keyboardShortcut(.cancelAction)
                    .disabled(committing)
            }
            Button(pending > 0 ? "还有 \(pending) 处待确认" : "归档全部") { commit() }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(working || committing || pending > 0 || readyCount == 0)
        }
    }

    private func summaryFigure(_ n: Int, _ label: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("\(n)").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).monospacedDigit()
            Text(label).font(TypeStyle.body).foregroundStyle(Theme.muted)
        }
    }

    /// 导入列表的一行：勾选、文件、类型、归属、签发日、到期日、结果。
    private func importRow(_ i: ImportItem) -> some View {
        let item = bind(i.id)
        let typeChoices: [(String?, String)] = typeOptions(for: i).map { t in
            (Optional(t.id), t.name + (t.jurisdictions.count == 1 ? "（\(t.jurisdictions[0])）" : ""))
        }
        let unresolvedRow = i.include && i.recognized && !resolved(i)
        let typeFlag = unresolvedRow && (i.typeID == nil || (i.needsReview && !i.confirmed && i.typeUncertain))
        let ownerFlag = unresolvedRow && ((i.owner == nil && i.newCompanyKey == nil) || (i.needsReview && !i.confirmed && i.ownerUncertain))
        let line = basis(i)
        return HStack(spacing: Col.spacing) {
            Toggle(isOn: item.include) { EmptyView() }
                .toggleStyle(KitCheckboxStyle())
                .frame(width: Col.check, alignment: .leading)
                .accessibilityLabel("归档 \(i.url.lastPathComponent)")
                .disabled(i.missing)
            HStack(spacing: 8) {
                FileThumb(url: i.url, size: CGSize(width: 26, height: 32))
                VStack(alignment: .leading, spacing: 2) {
                    Text(i.url.lastPathComponent).font(TypeStyle.body).lineLimit(1).truncationMode(.middle)
                        .help(i.url.path)
                    Text(line).font(TypeStyle.metadata)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1).truncationMode(.tail)
                        .help(fullBasis(i))
                    if i.recognized, !i.missing, replaced(i) != nil {
                        Toggle("另存为一份", isOn: Binding(get: { item.wrappedValue.keepBoth ?? false },
                                                       set: { item.wrappedValue.keepBoth = $0 }))
                            .toggleStyle(KitCheckboxStyle())
                            .font(TypeStyle.metadata)
                            .help("勾选后不替换现有版本，两份都保留为现行文件")
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            SelectField(options: typeChoices, selection: typeBinding(item), placeholder: "请选择类型", minWidth: Col.type, maxWidth: Col.type)
                .overlay { flagBorder(typeFlag) }
                .frame(width: Col.type, alignment: .leading)
            SelectField(options: ownerChoices, selection: ownerBinding(item), placeholder: "请选择归属", minWidth: Col.owner, maxWidth: Col.owner)
                .overlay { flagBorder(ownerFlag) }
                .frame(width: Col.owner, alignment: .leading)
            DateField(day: item.issueDate, placeholder: "可留空", minWidth: Col.date)
                .frame(width: Col.date, alignment: .leading)
            DateField(day: item.expiryDate, placeholder: "可留空", relativeTo: i.issueDate, minWidth: Col.date)
                .frame(width: Col.date, alignment: .leading)
            stateCell(i, item: item)
                .frame(width: Col.state, alignment: .leading)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .opacity(i.include ? 1 : 0.55)
    }

    @ViewBuilder
    private func flagBorder(_ on: Bool) -> some View {
        if on {
            RoundedRectangle(cornerRadius: Kit.fieldRadius)
                .strokeBorder(Theme.amberText, lineWidth: 1.5)
                .allowsHitTesting(false)
        }
    }

    @ViewBuilder
    private func stateCell(_ i: ImportItem, item: Binding<ImportItem>) -> some View {
        if !i.recognized {
            ProgressView().controlSize(.mini)
        } else if !i.include {
            Pill(text: "不归档", kind: .neutral)
        } else if resolved(i) {
            Pill(text: i.needsReview ? "✓ 已确认" : "✓ 把握高", kind: .valid)
                .help(i.needsReview ? "你已确认" : "把握程度 \(Int((i.confidence * 100).rounded()))%")
        } else {
            HStack(spacing: 6) {
                Pill(text: "请确认", kind: .warn)
                    .help("把握程度 \(Int((i.confidence * 100).rounded()))%")
                Button("确认") { item.wrappedValue.confirmed = true }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                    .disabled(!ready(i))
                    .help(ready(i) ? "类型和归属没问题" : "先选好类型和归属")
            }
        }
    }

    /// 归属选项：新建一家公司、待新建的公司、已有公司、人员。值与 ownerBinding 的编码一致。
    private var ownerChoices: [(String, String)] {
        let create: [(String, String)] = [("create", "新建一家公司…")]
        let news: [(String, String)] = drafts.filter(\.create).map { d in ("new:" + d.key, "新公司：\(d.name)") }
        let companies: [(String, String)] = store.companies.map { c in ("company:" + c.id, c.name) }
        let people: [(String, String)] = store.people.map { p in ("person:" + p.id, "人员：\(p.name)") }
        return news + companies + people + create
    }

    private func bind(_ id: UUID) -> Binding<ImportItem> {
        Binding<ImportItem>(
            get: { items.first { $0.id == id } ?? ImportItem(url: URL(fileURLWithPath: "/")) },
            set: { v in if let k = items.firstIndex(where: { $0.id == id }) { items[k] = v } })
    }

    /// 用户亲手选了类型，视为已确认。
    private func typeBinding(_ i: Binding<ImportItem>) -> Binding<String?> {
        Binding<String?>(
            get: { i.wrappedValue.typeID },
            set: { v in
                i.wrappedValue.typeID = v
                if v != nil { i.wrappedValue.confirmed = true }
            })
    }

    /// 同类型、同归属的现有文件，归档后会变成旧版。
    private func replaced(_ i: ImportItem) -> Document? {
        guard let t = i.typeID, let o = i.owner else { return nil }
        return store.documents.first { $0.typeID == t && $0.owner == o && $0.supersededBy == nil
            && !(($0.issueDate ?? .today()) > (i.issueDate ?? .today())) }
    }

    /// 识别依据，一行说明。
    private func basis(_ i: ImportItem) -> String {
        if i.missing { return "找不到原文件（已移动或删除），不会归档" }
        if !i.recognized { return "识别中…" }
        if let old = replaced(i) {
            return Self.versionNotice(old, keepBoth: i.keepBoth ?? false)
        }
        return "依据：" + evidenceParts(i).joined(separator: "，")
    }

    /// 新版本提示：“将替换 2025 年版本，旧版保留在历史版本中”。
    static func versionNotice(_ old: Document, keepBoth: Bool) -> String {
        let year = (old.issueDate ?? old.addedOn).year
        return keepBoth ? "另存为一份，\(year) 年版本仍为现行" : "将替换 \(year) 年版本，旧版保留在历史版本中"
    }

    /// 悬停时显示的完整依据。
    private func fullBasis(_ i: ImportItem) -> String {
        var lines = evidenceParts(i)
        if let old = replaced(i) {
            lines.insert(Self.versionNotice(old, keepBoth: i.keepBoth ?? false), at: 0)
        }
        lines.append("把握程度 \(Int((i.confidence * 100).rounded()))%")
        return lines.joined(separator: "\n")
    }

    private func evidenceParts(_ i: ImportItem) -> [String] {
        var parts = i.evidence
        if i.folderHint != nil { parts.append("归属参考文件夹名“\(i.folderHint ?? "")”") }
        if i.usedModel && !parts.contains(where: { $0.contains("Apple 智能") }) { parts.append("经 Apple 智能核对") }
        return parts.isEmpty ? ["按文件内容和文件名识别"] : parts
    }

    private func typeOptions(for i: ImportItem) -> [DocumentType] {
        let j: String? = {
            guard let o = i.owner else { return drafts.first { $0.key == i.newCompanyKey }?.jurisdiction }
            return o.kind == .company ? store.company(o.id)?.jurisdiction : nil
        }()
        let owner: NodeKind = i.owner?.kind ?? .company
        return store.library.documentTypes.filter { t in t.owner == owner && (j == nil || t.applies(to: j!)) }
    }

    private func ownerBinding(_ i: Binding<ImportItem>) -> Binding<String> {
        Binding<String>(
            get: {
                if let k = i.wrappedValue.newCompanyKey { return "new:" + k }
                guard let o = i.wrappedValue.owner else { return "" }
                return (o.kind == .company ? "company:" : "person:") + o.id
            },
            set: { v in
                i.wrappedValue.newCompanyKey = nil
                i.wrappedValue.owner = nil
                if v == "create" {
                    i.wrappedValue.newCompanyKey = addDraft(for: i.wrappedValue)
                } else if v.hasPrefix("new:") { i.wrappedValue.newCompanyKey = String(v.dropFirst(4)) }
                else if v.hasPrefix("company:") { i.wrappedValue.owner = NodeRef(kind: .company, id: String(v.dropFirst(8))) }
                else if v.hasPrefix("person:") { i.wrappedValue.owner = NodeRef(kind: .person, id: String(v.dropFirst(7))) }
                if !v.isEmpty && i.wrappedValue.typeID != nil { i.wrappedValue.confirmed = true }
            })
    }

    /// 按文件里读到的公司资料新建一份公司草稿，返回草稿的键。
    private func addDraft(for item: ImportItem) -> String {
        let name = item.companyNameGuess ?? item.folderHint ?? item.url.deletingPathExtension().lastPathComponent
        let key = "manual:" + UUID().uuidString
        drafts.append(CompanyDraft(key: key, name: name,
                                   jurisdiction: item.jurisdiction ?? store.library.jurisdictions.first?.code ?? "HK",
                                   incorporationDate: item.incorporationDate,
                                   registrationNumber: item.registrationNumber ?? ""))
        return key
    }

    private func ready(_ i: ImportItem) -> Bool {
        i.include && i.typeID != nil && (i.owner != nil || (i.newCompanyKey != nil && drafts.contains { $0.key == i.newCompanyKey && $0.create }))
    }

    /// 不归档，或可以归档且（把握高或已确认）。
    private func resolved(_ i: ImportItem) -> Bool {
        !i.include || (ready(i) && (!i.needsReview || i.confirmed))
    }

    // MARK: 扫描

    /// 识别新加入的文件，以及（继续上次导入时）还没识别完的行。已识别的行保持不变。
    private func scan(_ newURLs: [URL]) async {
        var found: [ImportItem] = []
        let exts = Set(["pdf", "png", "jpg", "jpeg", "heic", "tif", "tiff"])
        for url in newURLs {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            var isDir: ObjCBool = false
            FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
            if isDir.boolValue {
                let enumerator = FileManager.default.enumerator(at: url, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
                while let f = enumerator?.nextObject() as? URL {
                    guard exts.contains(f.pathExtension.lowercased()) else { continue }
                    // 拖进来的是“公司文件夹的上一层”时，用第一层子文件夹名；拖进来的就是公司文件夹时，用它自己的名字
                    let rel = f.path.dropFirst(url.path.count + 1).split(separator: "/")
                    let hint = rel.count > 1 ? String(rel[0]) : url.lastPathComponent
                    found.append(ImportItem(url: f, folderHint: hint))
                }
            } else if exts.contains(url.pathExtension.lowercased()) {
                found.append(ImportItem(url: url))
            }
        }
        let firstNew = items.count
        items += found
        let toRecognize = items.indices.filter { !items[$0].recognized && !items[$0].missing }
        progress = items.count - toRecognize.count
        working = !toRecognize.isEmpty
        var ctx = store.recognitionContext
        let targetCompany = contextCompany
        if let g = contextGroup {
            // 集团里的公司排在前面，名称相近时先匹配它们
            let inGroup = store.companyIDs(in: g)
            ctx.companies = ctx.companies.filter { inGroup.contains($0.id) } + ctx.companies.filter { !inGroup.contains($0.id) }
        }

        // 文件夹名先和已有公司匹配，匹配不上的作为新公司草稿
        var newKeys: [String] = []
        var folderMatched = Set<UUID>()
        for i in items.indices where i >= firstNew && targetCompany == nil {
            guard let hint = items[i].folderHint else { continue }
            if let cid = Recognizer.matchCompany(hint, context: ctx) {
                items[i].owner = NodeRef(kind: .company, id: cid)
                folderMatched.insert(items[i].id)
            } else {
                items[i].newCompanyKey = hint
                if !newKeys.contains(hint) { newKeys.append(hint) }
            }
        }
        for key in newKeys where !drafts.contains(where: { $0.key == key }) {
            drafts.append(CompanyDraft(key: key, name: key, jurisdiction: store.library.jurisdictions.first?.code ?? "HK"))
        }

        for i in toRecognize {
            let r = await Recognizer.recognize(file: items[i].url, context: ctx)
            items[i].usedModel = r.usedModel
            items[i].typeID = r.typeID
            items[i].issueDate = r.issueDate
            items[i].expiryDate = r.expiryDate
            items[i].evidence = r.evidence
            items[i].companyNameGuess = r.companyNameGuess
            items[i].jurisdiction = r.jurisdiction
            items[i].registrationNumber = r.registrationNumber
            items[i].incorporationDate = r.incorporationDate
            items[i].typeUncertain = r.typeID == nil || !r.typeFromContent
            var confidence = r.confidence
            var ownerUncertain = r.companyID == nil
            if folderMatched.contains(items[i].id) || items[i].newCompanyKey != nil {
                // 用户自己的文件夹结构也是可靠的依据
                if r.companyID == nil { confidence += 0.2 }
                ownerUncertain = false
            }
            if let target = targetCompany {
                // 从公司页上传：默认都归到这家公司；文件上的公司名称不同则请用户看一眼
                items[i].owner = NodeRef(kind: .company, id: target.id)
                items[i].newCompanyKey = nil
                ownerUncertain = false
                if r.companyID == nil { confidence += 0.2 }
                var otherName: String?
                if let cid = r.companyID, cid != target.id {
                    otherName = store.company(cid)?.name ?? r.companyNameGuess
                } else if r.companyID == nil, let guess = r.companyNameGuess, guess.count > 2 {
                    let names = ([target.name] + target.formerNames + target.aliases).map { $0.lowercased() }.filter { $0.count >= 3 }
                    let g = guess.lowercased()
                    if !names.contains(where: { g.contains($0) || $0.contains(g) }) { otherName = guess }
                }
                if let otherName {
                    ownerUncertain = true
                    items[i].evidence.append("文件上的公司名称与当前公司不同：\(otherName)")
                }
            }
            if items[i].owner == nil && items[i].newCompanyKey == nil, let cid = r.companyID {
                items[i].owner = NodeRef(kind: .company, id: cid)
            }
            if let t = r.typeID, store.docType(t)?.owner == .person, items[i].owner?.kind != .person {
                // 护照等个人文件：按名字找人
                if let p = store.people.first(where: { r.text.contains($0.name) || $0.aliases.contains { a in r.text.localizedCaseInsensitiveContains(a) } }) {
                    items[i].owner = NodeRef(kind: .person, id: p.id); items[i].newCompanyKey = nil
                    ownerUncertain = false
                    if r.companyID == nil { confidence += 0.2 }
                }
            }
            // 认不出已有公司，但文件上有公司名称：建议新建这家公司
            if items[i].owner == nil && items[i].newCompanyKey == nil, let guess = r.companyNameGuess, guess.count > 2 {
                let key = "guess:" + guess.lowercased()
                if !drafts.contains(where: { $0.key == key }) {
                    drafts.append(CompanyDraft(key: key, name: guess,
                                               jurisdiction: r.jurisdiction ?? store.library.jurisdictions.first?.code ?? "HK",
                                               incorporationDate: r.incorporationDate,
                                               registrationNumber: r.registrationNumber ?? ""))
                }
                items[i].newCompanyKey = key
                ownerUncertain = true
            }
            // 用注册证书给新公司补全资料
            if let key = items[i].newCompanyKey, let di = drafts.firstIndex(where: { $0.key == key }) {
                if let j = r.jurisdiction { drafts[di].jurisdiction = j }
                if let t = r.typeID, store.docType(t)?.category == "注册证书" {
                    drafts[di].incorporationDate = r.incorporationDate ?? r.issueDate ?? drafts[di].incorporationDate
                    if let n = r.registrationNumber { drafts[di].registrationNumber = n }
                    if let name = r.companyNameGuess, name.count > 2 { drafts[di].name = name }
                }
            }
            confidence = min(max(confidence, 0), 1)
            items[i].confidence = confidence
            items[i].ownerUncertain = ownerUncertain
            items[i].needsReview = confidence < 0.8 || r.typeID == nil || ownerUncertain
                || (items[i].owner == nil && items[i].newCompanyKey == nil)
            items[i].recognized = true
            progress += 1
        }
        // 需要确认的排在前面（只在识别完成时排一次，编辑时不跳动）
        let order = items.enumerated().sorted { a, b in
            if a.element.needsReview != b.element.needsReview { return a.element.needsReview }
            return a.offset < b.offset
        }
        withAnimation(Motion.standard) {
            items = order.map { $0.element }
            working = false
        }
        // 识别完就先存一份草稿：应用意外退出也能回来继续（窗口还开着时文件页不显示提示）
        if !items.isEmpty && result == nil && !finished { saveDraft() }
    }

    // MARK: 归档

    private func commit() {
        commitError = nil
        var companiesByKey: [String: Company] = [:]
        for draft in drafts where draft.create && items.contains(where: { $0.newCompanyKey == draft.key && $0.include }) {
            companiesByKey[draft.key] = Company(name: draft.name, jurisdiction: draft.jurisdiction,
                                                 entityForm: store.jurisdiction(draft.jurisdiction)?.entityForms.first ?? "",
                                                 registrationNumber: draft.registrationNumber,
                                                 incorporationDate: draft.incorporationDate,
                                                 trackingSince: store.today)
        }
        let requests = items.filter(ready).compactMap { item -> ArchiveRequest? in
            guard let typeID = item.typeID else { return nil }
            let owner = item.owner ?? item.newCompanyKey.flatMap { companiesByKey[$0] }.map { NodeRef(kind: .company, id: $0.id) }
            guard let owner else { return nil }
            var request = ArchiveRequest(url: item.url, typeID: typeID, owner: owner, issued: item.issueDate, expiry: item.expiryDate)
            request.keepBoth = (item.keepBoth ?? false) && replaced(item) != nil
            return request
        }
        guard !requests.isEmpty else { return }
        committing = true
        var companyIDs: [String] = []
        for r in requests where r.owner.kind == .company && !companyIDs.contains(r.owner.id) { companyIDs.append(r.owner.id) }
        let newCount = companiesByKey.count
        let ids = companyIDs
        // 批量写入前先存一份本地快照
        store.snapshotBeforeChange("导入 \(requests.count) 份文件前")
        let before = store.captureState()
        let appStore = store
        Task { @MainActor in
            do {
                let archived = try await store.archiveBatch(requests, newCompanies: Array(companiesByKey.values))
                if let g = contextGroup {
                    for c in companiesByKey.values { store.add(companyID: c.id, to: g.id) }
                }
                // 正在等的补发请求：收到对应文件就关闭（同一步撤销里，撤销归档时请求回到等回件）
                let received = store.closeRequests(receiving: archived)
                // 撤销整批：记录、新公司、集团归属退回；这次复制进数据文件夹的文件移到隐藏的撤销区（原文件不受影响）
                let undoID = store.recordUndo("归档 \(archived.count) 份文件", before: before, createdFiles: archived.map(\.filePath))
                finished = true
                store.savePendingImport(nil)
                store.showToast("已归档 \(archived.count) 份文件" + received + (newCount == 0 ? "。" : "，新建 \(newCount) 家公司。请补充新公司的财年结束日和负责方。")) { [weak appStore] in
                    if let undoID { appStore?.undo(undoID) }
                }
                committing = false
                withAnimation(Motion.panel) {
                    result = ImportResult(count: archived.count, companyIDs: ids, newCompanyCount: newCount)
                }
            } catch {
                commitError = "归档失败，档案没有改动：\(error.localizedDescription)"
                committing = false
            }
        }
    }
}

/// 识别进度：细的墨色进度条。
struct ImportMeter: View {
    var fraction: Double

    var body: some View {
        Capsule().fill(Theme.hairline)
            .frame(height: 6)
            .overlay(alignment: .leading) {
                GeometryReader { g in
                    Capsule().fill(Theme.ink)
                        .frame(width: g.size.width * min(max(fraction, 0), 1))
                        .animation(Motion.standard, value: fraction)
                }
            }
            .accessibilityElement()
            .accessibilityLabel("识别进度")
            .accessibilityValue("\(Int((fraction * 100).rounded()))%")
    }
}
