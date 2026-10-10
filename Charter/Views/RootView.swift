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
                switch router.section {
                case .overview: DashboardView()
                case .people: PeopleView()
                case .today: TodayView()
                case .calendar: CalendarView()
                case .companies: CompaniesView()
                case .structure: StructureView()
                case .files: FilesView()
                case .parties: PartiesView()
                }
                ToastOverlay()
            }
            // 工具栏不画系统底色（切换页面时系统底色会闪一下白），
            // 改为自己画一条画布色渐隐，内容滚到标题下方时依然看不到重叠。
            .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
            .overlay(alignment: .top) {
                // 股权结构是平移画布，右侧详情面板顶到窗口顶部，不需要这条渐隐
                if router.section != .structure {
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
        .disabled(store.isLoading || store.isImporting || store.loadFailed)
        .overlay {
            if store.isLoading {
                ZStack {
                    Theme.canvas.opacity(0.86).ignoresSafeArea()
                    VStack(spacing: 12) {
                        ProgressView().controlSize(.large)
                        Text("正在读取档案…").font(.system(size: 14, weight: .semibold))
                        Text("读取完成前不会保存或修改数据").font(.caption).foregroundStyle(Theme.muted)
                    }
                    .padding(24)
                    .background(Theme.surface, in: .rect(cornerRadius: 20))
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("正在读取档案")
            } else if store.loadFailed {
                VStack(spacing: 12) {
                    Label("档案暂时处于保护状态", systemImage: "exclamationmark.shield")
                        .font(.system(size: 17, weight: .semibold))
                    Text("现有档案已保留。请检查数据文件夹或修复读取错误，再重新载入。")
                        .font(.callout).multilineTextAlignment(.center)
                    Button("重新载入") { store.load() }.buttonStyle(PillButtonStyle(.primary))
                }
                .padding(24).frame(maxWidth: 440)
                .background(Theme.surface, in: .rect(cornerRadius: 20))
            }
        }
        .sheet(item: $router.sheet) { sheet in
            sheetContent(sheet)
        }
        .fileImporter(isPresented: $router.showImporter,
                      allowedContentTypes: [.pdf, .image, .folder], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result, !urls.isEmpty {
                DispatchQueue.main.async { router.sheet = .importFiles(urls) }
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
            ImportView(urls: urls)
        case .packet(let id):
            PacketView(companyID: id)
        case .change(let id):
            ChangeWizard(companyID: id)
        case .confirmRule(let r, let c):
            RuleConfirmSheet(ruleID: r, companyID: c)
        case .document(let id):
            if let d = store.documents.first(where: { $0.id == id }) {
                DocumentSheet(document: d)
            } else {
                Text("找不到这份文件").padding(40)
            }
        case .obligation(let key):
            if let o = store.allObligations.first(where: { $0.key == key }) {
                ObligationSheet(obligation: o)
            } else {
                Text("找不到这件事项").padding(40)
            }
        }
    }
}

struct Sidebar: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                GroupSwitcher()
                ActionMenu(systemImage: "plus", kind: .secondary, entries: newEntries, arrowEdge: .trailing)
                    .help("新建")
                    .accessibilityLabel("新建")
            }
            .padding(.bottom, 16)
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Router.Section.allCases.filter { !$0.isCompliance }) { s in navRow(s) }
                    if store.complianceOn {
                        Text("合规").font(.system(size: 11.5, weight: .semibold)).foregroundStyle(Theme.muted)
                            .padding(.leading, 14).padding(.top, 18).padding(.bottom, 4)
                        ForEach(Router.Section.allCases.filter(\.isCompliance)) { s in navRow(s) }
                    }
                }
            }
            .scrollIndicators(.never)
            attentionCard
        }
        .padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 12)
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
            .item("导入文件…", systemImage: "square.and.arrow.down", shortcut: "⌘I") { router.showImporter = true },
        ]
    }

    private func navRow(_ s: Router.Section) -> some View {
        let on = router.section == s
        let n = badge(for: s)
        return Button {
            // 切换页面不做淡入淡出：两页叠在一起时工具栏会闪一下
            router.section = s
        } label: {
            HStack(spacing: 12) {
                Image(systemName: s.symbol).font(.system(size: 15, weight: .medium)).frame(width: 22)
                Text(s.title).font(.system(size: 14, weight: on ? .semibold : .medium))
                Spacer(minLength: 4)
                if n > 0 { CountBadge(count: n, inverted: on) }
            }
            .foregroundStyle(on ? Theme.onSelection : Theme.ink)
            .padding(.horizontal, 14).frame(height: 40)
            .background(on ? Theme.selection : .clear, in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(s.title)
        .accessibilityValue(n > 0 ? "\(n) 项待处理" : "")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    /// 底部提醒：中性底色，琥珀色警告。
    @ViewBuilder
    private var attentionCard: some View {
        let n = store.documentsNeedingAttention.count
        if n > 0 {
            Button {
                router.filesFilter = 2
                router.filesOwnerKind = nil
                router.section = .files
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 14, weight: .semibold))
                        .frame(width: 32, height: 32).background(Theme.amberSoft, in: .circle).foregroundStyle(Theme.amberText)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(n) 份文件需处理").font(.system(size: 13.5, weight: .semibold))
                        Text("过期、即将到期或需更新").font(.system(size: 11.5)).opacity(0.7)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                }
                .foregroundStyle(Theme.ink)
                .padding(12)
                .background(Theme.surface, in: .rect(cornerRadius: 20))
                .overlay { RoundedRectangle(cornerRadius: 20).strokeBorder(Theme.hairline) }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(n) 份文件需处理")
            .accessibilityHint("打开文件页并只显示需要处理的文件")
        } else {
            HStack(spacing: 6) {
                Image(systemName: store.store.isInICloud ? "icloud" : "internaldrive")
                Text(store.store.isInICloud ? "已通过 iCloud 同步" : "数据保存在本机")
            }
            .font(.caption).foregroundStyle(Theme.muted).padding(.leading, 14)
        }
    }

    private func badge(for s: Router.Section) -> Int {
        switch s {
        case .today: store.openObligations.filter { $0.daysLeft(from: store.today) <= 14 }.count
        case .files: store.documentsNeedingAttention.count
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
