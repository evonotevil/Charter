import SwiftUI
import AppKit
import UniformTypeIdentifiers

struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        @Bindable var router = router
        NavigationSplitView {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 230, ideal: 250, max: 290)
        } detail: {
            ZStack {
                Theme.canvas.ignoresSafeArea()
                if router.showCalendar {
                    // 合规日历全页：从总览“查看全部日程”或负责方页打开，“返回”回到原页面
                    CalendarView(onBack: { router.showCalendar = false })
                } else {
                    switch router.section {
                    case .overview: DashboardView()
                    case .people: PeopleView()
                    case .companies: CompaniesView()
                    case .files: FilesView()
                    case .parties: PartiesView()
                    }
                }
                ToastOverlay()
            }
            // 窗口其他地方拖入：落到当前公司或当前集团；页面里更具体的拖放区优先
            .dropDestination(for: URL.self) { urls, _ in
                guard !urls.isEmpty, router.sheet == nil else { return false }
                router.startImport(urls: urls, context: router.currentImportContext(groupsExist: { store.group($0) != nil }))
                return true
            }
            // 工具栏不画系统底色（切换页面时系统底色会闪一下白），
            // 改为自己画一条画布色渐隐，内容滚到标题下方时依然看不到重叠。
            .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
            .overlay(alignment: .top) {
                // 股权结构是平移画布，右侧详情面板顶到窗口顶部，不需要这条渐隐
                if !(router.section == .companies && router.companiesMode == .structure && !router.showCalendar) {
                GeometryReader { g in
                    let top = g.safeAreaInsets.top
                    let fade: CGFloat = 12
                    LinearGradient(stops: [.init(color: Theme.canvas, location: 0),
                                           .init(color: Theme.canvas, location: top / (top + fade)),
                                           .init(color: Theme.canvas.opacity(0), location: 1)],
                                   startPoint: .top, endPoint: .bottom)
                        .frame(height: top + fade)
                        .offset(y: -top)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
                }
            }
        }
        // 页面内已有大标题，工具栏左上角不再重复显示页面名
        .toolbar(removing: .title)
        // 切换页面时关闭盖在上面的合规日历
        .onChange(of: router.section) { router.showCalendar = false }
        .disabled(store.isLoading || store.isImporting || store.loadFailed)
        .overlay {
            if store.isLoading {
                ZStack {
                    // 读取期间仍挡住整个窗口的交互（与 .disabled 一起），但只用一张小卡片提示。
                    Theme.canvas.opacity(0.6).ignoresSafeArea()
                    VStack(alignment: .leading, spacing: Space.m12) {
                        HStack(spacing: Space.s8 + 2) {
                            ProgressView().controlSize(.small)
                            Text("正在读取档案…").font(TypeStyle.rowTitle)
                        }
                        SkeletonBlock(width: 220, height: 10)
                        SkeletonBlock(width: 160, height: 10)
                        Text("读取完成前不会保存或修改数据").font(TypeStyle.meta).foregroundStyle(Theme.muted)
                    }
                    .padding(Space.xl24)
                    .frame(width: 300, alignment: .leading)
                    .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
                    .floatingShadow()
                }
                .transition(.opacity)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("正在读取档案")
            } else if store.loadFailed {
                ErrorStateView(title: "档案暂时处于保护状态",
                               message: "现有档案已保留。请检查数据文件夹或修复读取错误，再重新载入。",
                               retryTitle: "重新载入") { store.load() }
                    .frame(maxWidth: 460)
                    .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
                    .floatingShadow()
                    .padding(Space.pageEdge)
            }
        }
        .sheet(item: $router.sheet) { sheet in
            sheetContent(sheet)
        }
        .fileImporter(isPresented: $router.showImporter,
                      allowedContentTypes: [.pdf, .image, .folder], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result, !urls.isEmpty {
                let context = router.importContext
                DispatchQueue.main.async { router.startImport(urls: urls, context: context) }
            } else {
                router.importContext = nil
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            store.reloadIfChangedElsewhere()
        }
        .alert(store.loadFailed ? "档案已暂停保存" : "操作未完成", isPresented: Binding(get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } })) {
            Button("好") { store.errorMessage = nil }
        } message: {
            Text(store.errorMessage ?? "")
        }
    }

    @ViewBuilder
    private func sheetContent(_ sheet: Router.Sheet) -> some View {
        switch sheet {
        case .newCompany:
            CompanyEditor(company: nil, groupID: router.groupFilter == Router.ungrouped ? nil : router.groupFilter)
        case .newCompanyInGroup(let g):
            CompanyEditor(company: nil, groupID: g)
        case .newGroup:
            GroupEditor(group: nil)
        case .editGroup(let id):
            GroupEditor(group: store.group(id))
        case .addRelation(let c, let up):
            RelationSheet(companyID: c, upward: up)
        case .companyItems(let c):
            CompanyItemsSheet(companyID: c)
        case .quickSearch:
            QuickSearchSheet()
        case .exportAll(let c):
            ExportSheet(companyID: c)
        case .chainQuery(let f, let t):
            ChainQuerySheet(from: f, to: t)
        case .editCompany(let id):
            CompanyEditor(company: store.company(id))
        case .importFiles(let urls):
            ImportView(urls: urls, context: router.importContext)
        case .resumeImport:
            ImportView(urls: [], context: store.pendingImport?.context, resume: store.pendingImport)
        case .packet(let id):
            PacketView(companyID: id)
        case .change(let id):
            ChangeWizard(companyID: id)
        case .changeFrom(let id, let kind, let a, let h):
            ChangeWizard(companyID: id, kind: kind, endingAppointmentID: a, endingHoldingID: h)
        case .packetFor(let id, let p):
            PacketView(companyID: id, purposeID: p)
        case .confirmRule(let r, let c):
            RuleConfirmSheet(ruleID: r, companyID: c)
        case .document(let id):
            if let d = store.documents.first(where: { $0.id == id }) {
                DocumentSheet(document: d)
            } else {
                SheetScaffold(title: "找不到这份文件", subtitle: "它可能已被删除或移到其他公司。", width: 420) {
                    EmptyView()
                } leading: {
                    EmptyView()
                } trailing: {
                    Button("关闭") { router.sheet = nil }
                        .buttonStyle(PillButtonStyle(.primary)).keyboardShortcut(.cancelAction)
                }
            }
        case .obligation(let key):
            if let o = store.allObligations.first(where: { $0.key == key }) {
                ObligationSheet(obligation: o)
            } else {
                SheetScaffold(title: "找不到这件事项", subtitle: "它可能已办结或被移除。", width: 420) {
                    EmptyView()
                } leading: {
                    EmptyView()
                } trailing: {
                    Button("关闭") { router.sheet = nil }
                        .buttonStyle(PillButtonStyle(.primary)).keyboardShortcut(.cancelAction)
                }
            }
        }
    }
}

struct Sidebar: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var navNS
    /// 选中底色所在的行：跟随 router.section，但单独做动画，页面本身即时切换。
    @State private var highlighted: Router.Section = .overview

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: Space.s8) {
                GroupSwitcher()
                ActionMenu(systemImage: "plus", kind: .secondary, entries: newEntries, arrowEdge: .trailing)
                    .help("新建")
                    .accessibilityLabel("新建")
            }
            .padding(.bottom, Space.l16)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Router.Section.allCases) { s in navRow(s) }
                }
            }
            .scrollIndicators(.never)
            // 底部：真实同步状态 + 设置入口（与熊掌记、Notion 一致，账户与设置放在侧栏底部）
            SidebarFooter()
                .padding(.top, Space.m12)
        }
        .padding(.horizontal, Space.m12).padding(.top, Space.s8).padding(.bottom, Space.m12)
        .onAppear { highlighted = router.section }
        // 菜单快捷键（⌘1…⌘5）或其他页面跳转改变 section 时，底色同样滑过去
        .onChange(of: router.section) { _, new in
            guard highlighted != new else { return }
            withAnimation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion)) { highlighted = new }
        }
    }

    /// 侧栏顶部“+”：新建公司（落在当前选中的集团里）、新建集团、导入文件。
    private var newEntries: [MenuEntry] {
        [
            .item("新建公司", systemImage: "building.2", shortcut: "⇧⌘N") {
                if let g = router.groupFilter, g != Router.ungrouped, store.group(g) != nil {
                    router.sheet = .newCompanyInGroup(g)
                } else {
                    router.sheet = .newCompany
                }
            },
            .item("新建集团", systemImage: "square.stack.3d.up") { router.sheet = .newGroup },
            .divider,
            .item("上传材料…", systemImage: "square.and.arrow.down", shortcut: "⌘I") {
                router.chooseFiles(context: router.currentImportContext(groupsExist: { store.group($0) != nil }))
            },
        ]
    }

    private func navRow(_ s: Router.Section) -> some View {
        let on = router.section == s
        let n = badge(for: s)
        let index = Router.Section.allCases.firstIndex(of: s)
        return Button {
            // 切换页面本身不做淡入淡出（两页叠在一起时工具栏会闪一下），只让选中底色在行间滑动
            withAnimation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion)) {
                highlighted = s
            }
            router.go(s)
        } label: {
            HStack(spacing: Space.m12) {
                Image(systemName: s.symbol).font(.system(size: 15, weight: .medium)).frame(width: 20)
                Text(s.title).font(.system(size: 14, weight: on ? .semibold : .medium))
                Spacer(minLength: Space.xs4)
                if n > 0 { CountBadge(count: n, inverted: on) }
                if s == .files, store.pendingImport != nil, !router.isImportOpen {
                    // 待处理导入：一个琥珀色小点，悬停说明
                    Circle().fill(on ? Theme.onSelection : Theme.amberText).frame(width: 7, height: 7)
                        .help("上次导入还有 \(store.pendingImport?.remaining ?? 0) 份文件未完成")
                        .accessibilityLabel("有待处理的导入")
                }
            }
            .foregroundStyle(on ? Theme.onSelection : Theme.ink)
            .padding(.horizontal, Space.m12).frame(height: 36)
            .background {
                if highlighted == s {
                    RoundedRectangle(cornerRadius: Radius.row, style: .continuous)
                        .fill(Theme.selection)
                        .matchedGeometryEffect(id: "navSelection", in: navNS)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help(helpText(s, index: index, count: n))
        .accessibilityLabel(s.title)
        .accessibilityValue(n > 0 ? "\(n) 项待处理" : "")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func helpText(_ s: Router.Section, index: Int?, count: Int) -> String {
        var t = index.map { "\(s.title)（⌘\($0 + 1)）" } ?? s.title
        if count > 0 {
            switch s {
            case .files: t += "：\(count) 份公司文件需处理"
            default: break
            }
        }
        return t
    }

    private func badge(for s: Router.Section) -> Int {
        switch s {
        case .files: store.attentionCount(forFilter: router.groupFilter)
        default: 0
        }
    }
}

/// 侧栏顶部的集团切换器：显示当前集团和顶层，点开是主题化的列表。
struct GroupSwitcher: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @State private var open = false
    @State private var hover = false

    var body: some View {
        let g = store.group(router.groupFilter)
        Button { open.toggle() } label: {
            HStack(spacing: 8) {
                GroupIcon(groupID: router.groupFilter, size: 30, fill: Theme.surface)
                VStack(alignment: .leading, spacing: 1) {
                    Text(store.filterName(router.groupFilter)).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                    Text(subtitle(g)).font(.system(size: 11.5)).foregroundStyle(Theme.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.muted)
            }
            .foregroundStyle(Theme.ink)
            .padding(6).padding(.trailing, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(hover || open ? Theme.hairline.opacity(0.7) : Theme.band, in: .rect(cornerRadius: 14))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityLabel("切换集团，当前：\(store.filterName(router.groupFilter))")
        // 向内容区（右侧）弹出，避免贴着窗口左边缘被截断
        .popover(isPresented: $open, arrowEdge: .trailing) {
            list(current: g)
        }
    }

    private func list(current g: CorporateGroup?) -> some View {
        let groups = store.corporateGroups.sorted { $0.name < $1.name }
        let ungrouped = store.ungroupedCompanies.count
        return VStack(alignment: .leading, spacing: 1) {
            row(id: nil, name: "全部公司", count: store.companies.count)
            if !groups.isEmpty {
                Text("集团").font(TypeStyle.micro).foregroundStyle(Theme.muted)
                    .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 2)
                if groups.count > 9 {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 1) {
                            ForEach(groups) { grp in row(id: grp.id, name: grp.name, count: store.companyIDs(in: grp).count) }
                        }
                    }
                    .frame(height: 320)
                } else {
                    ForEach(groups) { grp in row(id: grp.id, name: grp.name, count: store.companyIDs(in: grp).count) }
                }
            }
            if ungrouped > 0 {
                Divider().padding(.vertical, 4).padding(.horizontal, 8)
                row(id: Router.ungrouped, name: "未归入集团", count: ungrouped)
            }
            Divider().padding(.vertical, 4).padding(.horizontal, 8)
            PopoverRow(title: "新建集团…", systemImage: "plus") {
                open = false
                router.sheet = .newGroup
            }
            if let g {
                PopoverRow(title: "编辑当前集团…", systemImage: "pencil") {
                    open = false
                    router.sheet = .editGroup(g.id)
                }
            }
        }
        .padding(6)
        .frame(minWidth: 270, alignment: .leading)
        .presentationBackground(Theme.surface)
    }

    private func row(id: String?, name: String, count: Int) -> some View {
        GroupSwitcherRow(groupID: id, name: name, count: count, checked: router.groupFilter == id) {
            open = false
            router.groupFilter = id
        }
    }

    private func subtitle(_ g: CorporateGroup?) -> String {
        if let g { return g.tops.isEmpty ? "\(store.companyIDs(in: g).count) 家公司" : "顶层：\(store.topLabel(g))" }
        if router.groupFilter == Router.ungrouped { return "\(store.ungroupedCompanies.count) 家公司" }
        return "\(store.companies.count) 家公司"
    }
}

/// 集团切换列表里的一行：图标、名称、公司数、当前项打勾。
private struct GroupSwitcherRow: View {
    var groupID: String?
    var name: String
    var count: Int
    var checked: Bool
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                GroupIcon(groupID: groupID, size: 22)
                Text(name).font(TypeStyle.body).fontWeight(checked ? .semibold : .regular)
                    .foregroundStyle(Theme.ink).lineLimit(1)
                Spacer(minLength: 16)
                Text("\(count)").font(TypeStyle.metadata).monospacedDigit().foregroundStyle(Theme.muted)
                Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.ink)
                    .opacity(checked ? 1 : 0)
            }
            .padding(.horizontal, 10).frame(height: 34)
            .background(hover ? Theme.band : Color.clear, in: .rect(cornerRadius: 8))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityLabel("\(name)，\(count) 家公司")
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}


/// 侧栏底部：点同步状态看详情，点齿轮打开设置。
struct SidebarFooter: View {
    @Environment(AppStore.self) private var store
    @Environment(\.openSettings) private var openSettings
    @State private var showing = false

    var body: some View {
        let s = SyncMonitor.shared.state
        HStack(spacing: Space.s8) {
            Button { showing.toggle() } label: {
                HStack(spacing: 6) {
                    Image(systemName: s.symbol)
                        .symbolEffect(.pulse, isActive: isBusy(s))
                    Text(s.title).lineLimit(1)
                }
                .font(.caption)
                .foregroundStyle(s.needsAttention ? Theme.amberText : Theme.muted)
                .padding(.leading, Space.m12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .help("查看同步详情")
            .popover(isPresented: $showing, arrowEdge: .top) { detail(s) }

            Button { SettingsPane.sync.open(with: openSettings) } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 28, height: 28)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .help("设置（⌘,）")
            .accessibilityLabel("设置")
        }
        .onAppear { SyncMonitor.shared.start(root: store.store.root) }
    }

    private func isBusy(_ s: SyncMonitor.State) -> Bool {
        switch s { case .checking, .syncing: true; default: false }
    }

    private func detail(_ s: SyncMonitor.State) -> some View {
        VStack(alignment: .leading, spacing: Space.s8) {
            Label(s.title, systemImage: s.symbol)
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.ink)
            Text(s.detail).font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Space.s8) {
                Button("立即检查") { SyncMonitor.shared.refresh() }
                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
                Button("同步设置…") {
                    showing = false
                    SettingsPane.sync.open(with: openSettings)
                }
                .buttonStyle(PillButtonStyle(.quiet, size: .small))
            }
            .padding(.top, 4)
        }
        .padding(Space.l16)
        .frame(width: 280, alignment: .leading)
    }
}
