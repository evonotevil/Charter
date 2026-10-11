import SwiftUI

#if !CHARTER_REGRESSION
@main
struct CharterApp: App {
    @State private var store = AppStore()
    @State private var router = Router()

    init() {
        #if DEBUG
        // Only isolated review builds provide these Info.plist keys. Production
        // builds follow the system appearance and the normal window defaults.
        if let appearance = Bundle.main.object(forInfoDictionaryKey: "CharterReviewAppearance") as? String {
            NSApplication.shared.appearance = NSAppearance(named: appearance == "dark" ? .darkAqua : .aqua)
        }
        #endif
    }

    private var initialSize: CGSize {
        #if DEBUG
        if let width = Bundle.main.object(forInfoDictionaryKey: "CharterReviewWidth") as? Double {
            return CGSize(width: max(width, 1080), height: 720)
        }
        #endif
        return CGSize(width: 1440, height: 920)
    }

    private var newItemTitle: String {
        switch router.section {
        case .people: "新建人员"
        case .parties: "添加负责方"
        default: "新建公司"
        }
    }

    private func newItemForCurrentPage() {
        switch router.section {
        case .people: router.newPersonRequest += 1
        case .parties: router.newPartyRequest += 1
        default: router.sheet = .newCompany
        }
    }

    var body: some Scene {
        WindowGroup("Charter") {
            RootView()
                .environment(store)
                .environment(router)
                .frame(minWidth: 1080, minHeight: 720)
                .onReceive(NotificationCenter.default.publisher(for: .charterDataCleared)) { _ in router.resetSelection() }
        }
        .defaultSize(width: initialSize.width, height: initialSize.height)
        .windowToolbarStyle(.unified)
        .commands {
            // ⌘N：按当前页面新建（人员页 → 新建人员，负责方页 → 添加负责方，其余 → 新建公司）。
            // 替换系统的“新建窗口”：Charter 只用一个主窗口。
            CommandGroup(replacing: .newItem) {
                Button(newItemTitle) { newItemForCurrentPage() }
                    .keyboardShortcut("n", modifiers: [.command])
                    .disabled(store.isLoading || store.isImporting || store.loadFailed || router.sheet != nil)
            }
            CommandGroup(after: .newItem) {
                Button("新建公司") { router.sheet = .newCompany }
                    .keyboardShortcut("n", modifiers: [.command, .shift])
                    .disabled(store.isLoading || store.isImporting || store.loadFailed)
                Button("上传材料…") { router.chooseFiles(context: router.currentImportContext(groupsExist: { store.group($0) != nil })) }
                    .keyboardShortcut("i", modifiers: [.command])
                    .disabled(store.isLoading || store.isImporting || store.loadFailed)
                Button("导出材料…") {
                    if let id = router.selectedCompanyID { router.sheet = .exportAll(id) } else { router.sheet = .packet(companyID: nil) }
                }
                    .keyboardShortcut("e", modifiers: [.command, .shift])
            }
            CommandGroup(after: .newItem) {
                Button("新建集团…") { router.sheet = .newGroup }
                    .disabled(store.isLoading || store.isImporting || store.loadFailed)
            }
            // ⌘Z / ⇧⌘Z：文本框正在输入时撤销文字，否则撤销数据修改（见 EditUndo）
            CommandGroup(replacing: .undoRedo) {
                Button(store.undoLabel.map { "撤销\($0)" } ?? "撤销") { EditUndo.undo(store) }
                    .keyboardShortcut("z", modifiers: [.command])
                Button(store.redoLabel.map { "重做\($0)" } ?? "重做") { EditUndo.redo(store) }
                    .keyboardShortcut("z", modifiers: [.command, .shift])
            }
            CommandGroup(after: .help) {
                ComponentGalleryCommand()
            }
            CommandMenu("前往") {
                Button("总览") { router.go(.overview) }.keyboardShortcut("1")
                Button("公司") { router.go(.companies) }.keyboardShortcut("2")
                Button("文件") { router.go(.files) }.keyboardShortcut("3")
                Button("人员") { router.go(.people) }.keyboardShortcut("4")
                Button("负责方") { router.go(.parties) }.keyboardShortcut("5")
                Divider()
                Button("股权结构") { router.openStructure() }
                if store.complianceOn {
                    Button("合规日历") { router.openCalendar() }
                }
                Divider()
                Button("快速查找…") { router.sheet = .quickSearch }.keyboardShortcut("k")
                Button("查询持股链条…") { router.sheet = .chainQuery(from: nil, to: router.selectedCompanyID) }.keyboardShortcut("l")
            }
        }

        Window("组件样板", id: "component-gallery") {
            ComponentGallery()
        }
        .defaultSize(width: 1040, height: 860)

        Settings {
            SettingsView()
                .environment(store)
                .frame(width: 1040, height: 680)
        }
    }
}
#endif

/// 页面跳转与弹窗。
@MainActor
@Observable
final class Router {
    /// 侧栏的五个页面（声明顺序即侧栏顺序和 ⌘1…⌘5）。
    /// 原“今天”“合规日历”并入总览（日历全页用 showCalendar 打开），“股权结构”并入公司页的“结构”视图。
    enum Section: String, Hashable, CaseIterable, Identifiable {
        case overview, companies, files, people, parties
        var id: String { rawValue }
        var title: String {
            switch self {
            case .overview: "总览"
            case .people: "人员"
            case .companies: "公司"
            case .files: "文件"
            case .parties: "负责方"
            }
        }
        var symbol: String {
            switch self {
            case .overview: "square.grid.3x3"
            case .people: "person.crop.rectangle.stack"
            case .companies: "building.2"
            case .files: "doc.on.doc"
            case .parties: "person.2"
            }
        }
    }

    /// 公司页的视图：列表、矩阵（公司 × 档案类别）、股权结构图。
    enum CompaniesMode: Hashable {
        case list, matrix, structure
    }

    enum Sheet: Identifiable, Equatable {
        case newCompany
        case newCompanyInGroup(String)
        case newGroup
        case editGroup(String)
        case addRelation(companyID: String, upward: Bool)
        case companyItems(String)
        case quickSearch
        case exportAll(String)
        case chainQuery(from: NodeRef?, to: String?)
        case editCompany(String)
        case importFiles([URL])
        /// 继续上次没完成的导入（store.pendingImport）。
        case resumeImport
        case packet(companyID: String?)
        /// 已定公司和用途的文件包（⌘K“为某公司准备某用途文件包”）。
        case packetFor(companyID: String, purposeID: String)
        case change(companyID: String)
        /// 从人员行、股东行发起的变更：预选变更类型和要结束的任职或持股。
        case changeFrom(companyID: String, kind: ChangeKind, appointmentID: String?, holdingID: String?)
        case obligation(String)
        case document(String)
        case confirmRule(ruleID: String, companyID: String?)

        var id: String {
            switch self {
            case .newCompany: "new"
            case .newCompanyInGroup(let g): "new-in-\(g)"
            case .newGroup: "new-group"
            case .editGroup(let g): "group-\(g)"
            case .addRelation(let c, let up): "rel-\(c)-\(up)"
            case .companyItems(let c): "items-\(c)"
            case .quickSearch: "quick-search"
            case .exportAll(let c): "export-\(c)"
            case .chainQuery(let f, let t): "chain-\(f?.id ?? "")-\(t ?? "")"
            case .editCompany(let id): "edit-\(id)"
            case .importFiles(let u): "import-\(u.count)-\(u.first?.path ?? "")"
            case .resumeImport: "resume-import"
            case .packet(let id): "packet-\(id ?? "")"
            case .packetFor(let id, let p): "packet-\(id)-\(p)"
            case .change(let id): "change-\(id)"
            case .changeFrom(let id, let k, let a, let h): "change-\(id)-\(k.rawValue)-\(a ?? "")-\(h ?? "")"
            case .obligation(let k): "obl-\(k)"
            case .document(let id): "doc-\(id)"
            case .confirmRule(let r, let c): "rule-\(r)-\(c ?? "")"
            }
        }
    }

    /// 合规日历的时间范围。
    enum CalendarRange: Hashable {
        case all, thisMonth, nextMonth, next3Months, custom(Day, Day)

        var label: String {
            switch self {
            case .all: "未来 12 个月"
            case .thisMonth: "本月"
            case .nextMonth: "下月"
            case .next3Months: "未来 3 个月"
            case .custom: "自定义"
            }
        }

        /// 起止日（含）。本月和“未来 12 个月”也包括逾期未办的事项。
        func bounds(today: Day) -> (from: Day?, to: Day) {
            let first = Day(today.year, today.month, 1)
            switch self {
            case .all: return (nil, today.adding(days: 366))
            case .thisMonth: return (nil, first.adding(months: 1).adding(days: -1))
            case .nextMonth: return (first.adding(months: 1), first.adding(months: 2).adding(days: -1))
            case .next3Months: return (today, today.adding(months: 3))
            case .custom(let a, let b): return (a, b)
            }
        }
    }

    /// 从其他页面跳到合规日历时带上的筛选。
    struct CalendarPreset: Equatable {
        var partyID: String?
        var range: CalendarRange = .all
        var status: ObligationStatus?
    }

    var section: Section = .overview
    /// ⌘N 在“人员”“负责方”页发出的新建请求（页面监听计数变化，打开自己的新建弹窗）。
    var newPersonRequest = 0
    var newPartyRequest = 0
    var calendarPreset: CalendarPreset?
    var selectedCompanyID: String? {
        didSet { if let id = selectedCompanyID, id != oldValue { noteRecent(company: id) } }
    }
    /// 最近查看的公司（最多 5 家，最新在前），⌘K 空查询时显示。
    private(set) var recentCompanyIDs: [String] = UserDefaults.standard.stringArray(forKey: Router.recentKey) ?? []
    private static let recentKey = "charter.recentCompanies"

    func noteRecent(company id: String) {
        var list = recentCompanyIDs.filter { $0 != id }
        list.insert(id, at: 0)
        recentCompanyIDs = Array(list.prefix(5))
        UserDefaults.standard.set(recentCompanyIDs, forKey: Router.recentKey)
    }
    var selectedPersonID: String?
    /// 选中的集团 ID；Router.ungrouped 表示“未归入集团”。
    var groupFilter: String?
    static let ungrouped = "__ungrouped__"
    /// 打开公司时默认显示的分页（0 = 档案）。
    var companyTab = 0
    /// 文件页筛选：0 全部、1 即将到期、2 需处理、3 最近添加。
    var filesFilter = 0
    var filesOwnerKind: NodeKind?
    var filesHorizon = 30
    /// 公司页的视图。
    var companiesMode: CompaniesMode = .list
    /// 全页显示合规日历（盖在当前页面上，“返回”关闭；切换侧栏页面时也关闭）。
    var showCalendar = false
    var sheet: Sheet?
    var showImporter = false

    /// 上传材料的去向：当前公司、当前集团，或交给识别自行判断（nil）。
    enum ImportContext: Equatable, Codable {
        case company(String)
        case group(String)
    }
    /// 下一次导入使用的上下文；ImportView 打开时读取，关闭时清空。
    var importContext: ImportContext?

    /// 拖入或已选好的文件：带上上下文，打开导入表。
    func startImport(urls: [URL], context: ImportContext?) {
        guard !urls.isEmpty else { return }
        importContext = context
        sheet = .importFiles(urls)
    }

    /// 导入窗口正开着（新导入或继续上次的）。
    var isImportOpen: Bool {
        switch sheet {
        case .importFiles?, .resumeImport?: true
        default: false
        }
    }

    /// 打开系统文件选择器，选好后按这个上下文导入。
    func chooseFiles(context: ImportContext?) {
        importContext = context
        showImporter = true
    }

    /// 没有明确落点时（整个窗口、⌘I）：公司页选中的公司，否则当前集团筛选。
    func currentImportContext(groupsExist: (String) -> Bool = { _ in true }) -> ImportContext? {
        if section == .companies, companiesMode == .list, !showCalendar, let id = selectedCompanyID { return .company(id) }
        if let g = groupFilter, g != Router.ungrouped, groupsExist(g) { return .group(g) }
        return nil
    }

    /// 清空数据后回到初始状态：不再指向已删除的公司、人员或集团。
    func resetSelection() {
        sheet = nil
        calendarPreset = nil
        selectedCompanyID = nil
        selectedPersonID = nil
        groupFilter = nil
        filesOwnerKind = nil
        filesFilter = 0
        companyTab = 0
        companiesMode = .list
        showCalendar = false
        section = .overview
    }

    /// 切换侧栏页面（同时关闭盖在上面的合规日历）。
    func go(_ s: Section) {
        showCalendar = false
        section = s
    }

    func openCalendar(_ preset: CalendarPreset = CalendarPreset()) {
        calendarPreset = preset
        showCalendar = true
    }

    /// 公司页的股权结构视图（可指定集团）。
    func openStructure(group: String? = nil) {
        if let group { groupFilter = group }
        companiesMode = .structure
        showCalendar = false
        section = .companies
    }

    func open(person id: String) {
        selectedPersonID = id
        showCalendar = false
        section = .people
    }

    func open(company id: String) {
        selectedCompanyID = id
        companiesMode = .list
        showCalendar = false
        section = .companies
    }
}
