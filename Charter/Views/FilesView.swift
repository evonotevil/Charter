import SwiftUI
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
        case 2: list = list.filter { $0.freshness.needsAttention }
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
        let attentionCount = scoped.lazy.filter(\.freshness.needsAttention).count
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                header(visible: docs.count, total: scoped.count, attention: attentionCount)
                controls(attentionCount: attentionCount)
                if store.documents.isEmpty {
                    EmptyState(symbol: "doc.on.doc", title: "还没有文件",
                               message: "把按公司分好的文件夹拖进来，Charter 会识别类型、公司和日期，你确认后才归档。",
                               actionTitle: "选择文件") { router.showImporter = true }
                        .surfaceCard()
                } else if docs.isEmpty {
                    emptyResults(scopedCount: scoped.count)
                } else if filter == 1 || filter == 3 {
                    section(title: filter == 1 ? "按到期日排列" : "最近 30 天添加", owner: nil, list: docs)
                } else {
                    ForEach(grouped, id: \.0) { item in
                        section(title: store.name(of: item.0), owner: item.0, list: item.1)
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.canvas)
        .overlay {
            if dropTargeted {
                RoundedRectangle(cornerRadius: 28)
                    .strokeBorder(Theme.ink, style: StrokeStyle(lineWidth: 2, dash: [8, 6]))
                    .background(Theme.lime.opacity(0.88), in: .rect(cornerRadius: 28))
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
        .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: dropTargeted)
        .dropDestination(for: URL.self) { urls, _ in
            router.sheet = .importFiles(urls)
            return true
        } isTargeted: { dropTargeted = $0 }
        .navigationTitle("文件")
    }

    private func header(visible: Int, total: Int, attention: Int) -> some View {
        HStack(alignment: .bottom) {
            PageTitle(title: "文件",
                      subtitle: (visible == total ? "\(total) 份现行文件" : "显示 \(visible) / \(total) 份")
                        + (attention > 0 ? "，\(attention) 份需处理" : "，都在有效期内")
                        + "。把 PDF、照片或文件夹拖进窗口即可导入。")
            Spacer()
            Button { router.showImporter = true } label: { Label("导入文件", systemImage: "square.and.arrow.down") }
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
        .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: filter)
    }

    private func primaryFilters(attentionCount: Int) -> some View {
        PillSegmented(options: [(0, "全部"), (1, "即将到期"), (2, "需处理 \(attentionCount)"), (3, "最近添加")],
                      selection: Binding(get: { router.filesFilter }, set: { router.filesFilter = $0 }))
    }

    @ViewBuilder
    private func emptyResults(scopedCount: Int) -> some View {
        VStack(spacing: 10) {
            if !query.isEmpty {
                Text("没有找到“\(query)”").font(.system(size: 15, weight: .semibold))
                Text("搜索范围已按当前集团和归属类型限制。").font(.system(size: 13)).foregroundStyle(Theme.muted)
                Button("清除搜索") { query = "" }.buttonStyle(PillButtonStyle(.secondary, size: .small))
            } else if scopedCount == 0 {
                Text("当前范围没有文件").font(.system(size: 15, weight: .semibold))
                Text("当前集团或归属类型下没有现行文件。").font(.system(size: 13)).foregroundStyle(Theme.muted)
                Button("查看全部范围") {
                    router.groupFilter = nil
                    router.filesOwnerKind = nil
                    router.filesFilter = 0
                }
                .buttonStyle(PillButtonStyle(.secondary, size: .small))
            } else {
                Text(filter == 1 ? "未来 \(horizon) 天没有即将到期的文件" : filter == 2 ? "当前范围没有需要处理的文件" : "最近 30 天没有添加文件")
                    .font(.system(size: 15, weight: .semibold))
                Text("当前范围内还有 \(scopedCount) 份现行文件。").font(.system(size: 13)).foregroundStyle(Theme.muted)
                Button("查看全部文件") { router.filesFilter = 0 }
                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
            }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 40)
        .surfaceCard()
    }

    private var horizonFilters: some View {
        PillSegmented(options: [(30, "30 天"), (60, "60 天"), (90, "90 天"), (183, "半年")],
                      selection: Binding(get: { router.filesHorizon }, set: { router.filesHorizon = $0 }))
    }

    /// 归属范围：公司与人员 / 公司材料 / 个人材料。放进下拉菜单，和状态筛选同一行。
    private var ownerMenu: some View {
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
        .padding(.horizontal, 14).frame(minWidth: 200, maxWidth: .infinity, minHeight: 36, maxHeight: 36)
        .background(Theme.surface, in: .capsule)
    }

    @ViewBuilder
    private func section(title: String, owner: NodeRef?, list: [Document]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                if let owner {
                    if owner.kind == .company, let c = store.company(owner.id) {
                        JurisdictionBadge(code: c.jurisdiction, size: 26)
                    } else {
                        Avatar(name: title, size: 26)
                    }
                    Button { if owner.kind == .company { router.open(company: owner.id) } else { router.open(person: owner.id) } } label: {
                        HStack(spacing: 4) {
                            Text(title).font(.system(size: 17, weight: .semibold))
                            Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.muted)
                        }
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(title).font(.system(size: 17, weight: .semibold))
                }
                Text("\(list.count) 份").font(.system(size: 13)).foregroundStyle(Theme.muted)
                let bad = list.filter { store.freshness($0).needsAttention }.count
                if bad > 0 { Pill(text: "\(bad) 份需处理", kind: list.contains { store.freshness($0).pillKind == .bad } ? .bad : .warn) }
                Spacer()
            }
            if grid {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 190), spacing: 14)], alignment: .leading, spacing: 14) {
                    ForEach(list) { d in FileCard(document: d, showOwner: owner == nil) }
                }
            } else {
                FileHeaderRow()
                LazyVStack(spacing: 0) {
                    ForEach(Array(list.enumerated()), id: \.element.id) { pair in
                        DocumentRow(document: pair.element, showOwner: owner == nil)
                        if pair.offset < list.count - 1 { Divider().padding(.horizontal, 14).opacity(0.5) }
                    }
                }
            }
        }
        .surfaceCard()
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
    @State private var hover = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let d = document
        let f = store.freshness(d)
        Button { router.sheet = .document(d.id) } label: {
            VStack(alignment: .leading, spacing: 8) {
                FileThumb(url: store.fileURL(d), alert: f.pillKind == .bad, size: CGSize(width: 120, height: 150))
                    .frame(maxWidth: .infinity).frame(height: 172)
                    .background(Theme.band, in: .rect(cornerRadius: 16))
                    .scaleEffect(hover ? 1.02 : 1)
                VStack(alignment: .leading, spacing: 2) {
                    Text(store.docType(d.typeID)?.name ?? "文件").font(.system(size: 13.5, weight: .semibold)).lineLimit(1)
                    Text(showOwner ? store.name(of: d.owner) : (d.issueDate.map { "\($0.long)签发" } ?? "缺少签发日期"))
                        .font(.system(size: 11.5)).foregroundStyle(Theme.muted).lineLimit(1)
                }
                Pill(text: f.label, kind: f.pillKind)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { h in withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { hover = h } }
        .contextMenu {
            Button("打开") { store.open(d) }
            Button("在访达中显示") { store.reveal(d) }
        }
        .help(d.originalFileName)
        .accessibilityLabel("\(store.docType(d.typeID)?.name ?? "文件")，\(f.label)")
    }
}

// MARK: - 导入与识别

struct ImportItem: Identifiable {
    let id = UUID()
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
}

struct CompanyDraft: Identifiable {
    var id: String { key }
    var key: String                  // 文件夹名
    var name: String
    var jurisdiction: String
    var incorporationDate: Day?
    var registrationNumber: String = ""
    var create = true
}

struct ImportView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var urls: [URL]
    @State private var items: [ImportItem] = []
    @State private var drafts: [CompanyDraft] = []
    @State private var progress = 0
    @State private var working = true
    @State private var committing = false
    @State private var commitError: String?

    private enum Col {
        static let check: CGFloat = 22
        static let type: CGFloat = 220
        static let owner: CGFloat = 240
        static let date: CGFloat = 150
        static let spacing: CGFloat = 10
    }

    var body: some View {
        let readyCount = items.lazy.filter { ready($0) }.count
        SheetScaffold(
            title: committing ? "正在归档 \(readyCount) 份文件" : working ? "正在识别 \(progress) / \(items.count)" : "确认后归档",
            subtitle: committing ? "正在复制文件并一次写入档案，请保持窗口打开。" : working ? "全部在这台 Mac 上完成，不会上传。" : "核对每份文件的类型、所属公司和日期。没把握的已标出。",
            width: 1160, height: 820
        ) {
            VStack(alignment: .leading, spacing: 18) {
                if let commitError {
                    Label(commitError, systemImage: "exclamationmark.triangle.fill")
                        .font(TypeStyle.body).foregroundStyle(Theme.amberText)
                        .textSelection(.enabled)
                }
                if working {
                    ProgressView(value: Double(progress), total: Double(max(items.count, 1)))
                        .tint(Theme.ink)
                }

                if !drafts.isEmpty {
                    FormGroup(title: "新公司（按文件夹名建档）") {
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
                        }
                    }
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(items) { i in
                            importRow(i)
                            if i.id != items.last?.id {
                                Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, 16)
                            }
                        }
                    }
                    .disabled(committing)
                }
            }
        } leading: {
            if committing {
                ProgressView().controlSize(.small)
            } else if !working {
                let n = items.filter { ready($0) }.count
                Text(n == items.count ? "全部可以归档。" : "\(items.count - n) 份还缺类型或归属，不会归档。")
                    .font(TypeStyle.body).foregroundStyle(Theme.muted)
            }
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
                .disabled(committing)
            Button("归档 \(readyCount) 份") { commit() }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(working || committing || readyCount == 0)
        }
        .task { await scan() }
    }

    /// 导入列表的一行：勾选、文件、类型、归属、签发日、到期日。
    private func importRow(_ i: ImportItem) -> some View {
        let item = bind(i.id)
        let typeChoices: [(String?, String)] = typeOptions(for: i).map { t in
            (Optional(t.id), t.name + (t.jurisdictions.count == 1 ? "（\(t.jurisdictions[0])）" : ""))
        }
        return HStack(spacing: Col.spacing) {
            Toggle(isOn: item.include) { EmptyView() }
                .toggleStyle(KitCheckboxStyle())
                .frame(width: Col.check, alignment: .leading)
                .accessibilityLabel("归档 \(i.url.lastPathComponent)")
            HStack(spacing: 8) {
                FileThumb(url: i.url, size: CGSize(width: 26, height: 32))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        if !i.recognized { ProgressView().controlSize(.mini) }
                        Text(i.url.lastPathComponent).font(TypeStyle.body).lineLimit(1).truncationMode(.middle)
                            .help(i.url.path)
                    }
                    Text(basis(i)).font(TypeStyle.metadata)
                        .foregroundStyle(replaced(i) == nil ? Theme.muted : Theme.amberText).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            SelectField(options: typeChoices, selection: item.typeID, placeholder: "未识别", minWidth: Col.type, maxWidth: Col.type)
                .frame(width: Col.type, alignment: .leading)
            SelectField(options: ownerChoices, selection: ownerBinding(item), placeholder: "未识别", minWidth: Col.owner, maxWidth: Col.owner)
                .frame(width: Col.owner, alignment: .leading)
            DateField(day: item.issueDate, placeholder: "可留空", minWidth: Col.date)
                .frame(width: Col.date, alignment: .leading)
            DateField(day: item.expiryDate, placeholder: "可留空", relativeTo: i.issueDate, minWidth: Col.date)
                .frame(width: Col.date, alignment: .leading)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .opacity(i.include ? 1 : 0.55)
    }

    /// 归属选项：待新建的公司、已有公司、人员。值与 ownerBinding 的编码一致。
    private var ownerChoices: [(String, String)] {
        let news: [(String, String)] = drafts.filter(\.create).map { d in ("new:" + d.key, "新公司：\(d.name)") }
        let companies: [(String, String)] = store.companies.map { c in ("company:" + c.id, c.name) }
        let people: [(String, String)] = store.people.map { p in ("person:" + p.id, "人员：\(p.name)") }
        return news + companies + people
    }

    private func bind(_ id: UUID) -> Binding<ImportItem> {
        Binding<ImportItem>(
            get: { items.first { $0.id == id } ?? ImportItem(url: URL(fileURLWithPath: "/")) },
            set: { v in if let k = items.firstIndex(where: { $0.id == id }) { items[k] = v } })
    }

    /// 同类型、同归属的现有文件，归档后会变成旧版。
    private func replaced(_ i: ImportItem) -> Document? {
        guard let t = i.typeID, let o = i.owner else { return nil }
        return store.documents.first { $0.typeID == t && $0.owner == o && $0.supersededBy == nil
            && !(($0.issueDate ?? .today()) > (i.issueDate ?? .today())) }
    }

    /// 识别依据，一行说明。
    private func basis(_ i: ImportItem) -> String {
        if !i.recognized { return "识别中…" }
        if let old = replaced(i) {
            return "将取代旧版（\(old.issueDate.map { "\($0.long)签发" } ?? "日期未知")），旧版保留"
        }
        var parts: [String] = []
        parts.append(i.usedModel ? "按文件内容（Apple 智能）识别" : "按文件内容和文件名识别")
        if i.folderHint != nil { parts.append("归属参考文件夹名") }
        return parts.joined(separator: "，")
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
                if v.hasPrefix("new:") { i.wrappedValue.newCompanyKey = String(v.dropFirst(4)) }
                else if v.hasPrefix("company:") { i.wrappedValue.owner = NodeRef(kind: .company, id: String(v.dropFirst(8))) }
                else if v.hasPrefix("person:") { i.wrappedValue.owner = NodeRef(kind: .person, id: String(v.dropFirst(7))) }
            })
    }

    private func ready(_ i: ImportItem) -> Bool {
        i.include && i.typeID != nil && (i.owner != nil || (i.newCompanyKey != nil && drafts.contains { $0.key == i.newCompanyKey && $0.create }))
    }

    // MARK: 扫描

    private func scan() async {
        var found: [ImportItem] = []
        let exts = Set(["pdf", "png", "jpg", "jpeg", "heic", "tif", "tiff"])
        for url in urls {
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
        items = found
        let ctx = store.recognitionContext

        // 文件夹名先和已有公司匹配，匹配不上的作为新公司草稿
        var newKeys: [String] = []
        for i in items.indices {
            guard let hint = items[i].folderHint else { continue }
            if let cid = Recognizer.matchCompany(hint, context: ctx) {
                items[i].owner = NodeRef(kind: .company, id: cid)
            } else {
                items[i].newCompanyKey = hint
                if !newKeys.contains(hint) { newKeys.append(hint) }
            }
        }
        drafts = newKeys.map { CompanyDraft(key: $0, name: $0, jurisdiction: store.library.jurisdictions.first?.code ?? "HK") }

        for i in items.indices {
            let r = await Recognizer.recognize(file: items[i].url, context: ctx)
            items[i].recognized = true
            items[i].usedModel = r.usedModel
            items[i].typeID = r.typeID
            items[i].issueDate = r.issueDate
            items[i].expiryDate = r.expiryDate
            if items[i].owner == nil && items[i].newCompanyKey == nil, let cid = r.companyID {
                items[i].owner = NodeRef(kind: .company, id: cid)
            }
            if let t = r.typeID, store.docType(t)?.owner == .person, items[i].owner?.kind != .person {
                // 护照等个人文件：按名字找人
                if let p = store.people.first(where: { r.text.contains($0.name) || $0.aliases.contains { a in r.text.localizedCaseInsensitiveContains(a) } }) {
                    items[i].owner = NodeRef(kind: .person, id: p.id); items[i].newCompanyKey = nil
                }
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
            progress = i + 1
        }
        working = false
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
            return ArchiveRequest(url: item.url, typeID: typeID, owner: owner, issued: item.issueDate, expiry: item.expiryDate)
        }
        guard !requests.isEmpty else { return }
        committing = true
        Task { @MainActor in
            do {
                let archived = try await store.archiveBatch(requests, newCompanies: Array(companiesByKey.values))
                store.showToast("已归档 \(archived.count) 份文件" + (companiesByKey.isEmpty ? "。" : "，新建 \(companiesByKey.count) 家公司。请补充新公司的财年结束日和负责方。"))
                dismiss()
            } catch {
                commitError = "归档失败，档案没有改动：\(error.localizedDescription)"
                committing = false
            }
        }
    }
}
