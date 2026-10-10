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
                Button("导入文件…") { router.showImporter = true }
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
            CommandGroup(after: .help) {
                ComponentGalleryCommand()
            }
            CommandMenu("前往") {
                Button("总览") { router.section = .overview }.keyboardShortcut("1")
                Button("公司") { router.section = .companies }.keyboardShortcut("2")
                Button("股权结构") { router.section = .structure }.keyboardShortcut("3")
                Button("人员") { router.section = .people }.keyboardShortcut("4")
                Button("文件") { router.section = .files }.keyboardShortcut("5")
                Divider()
                Button("快速查找…") { router.sheet = .quickSearch }.keyboardShortcut("k")
                Button("查询持股链条…") { router.sheet = .chainQuery(from: nil, to: router.selectedCompanyID) }.keyboardShortcut("l")
                if store.complianceOn {
                    Divider()
                    Button("今天") { router.section = .today }.keyboardShortcut("6")
                    Button("合规日历") { router.section = .calendar }.keyboardShortcut("7")
                    Button("负责方") { router.section = .parties }.keyboardShortcut("8")
                }
            }
        }

        Window("组件样板", id: "component-gallery") {
            ComponentGallery()
        }
        .defaultSize(width: 1040, height: 860)

        Settings {
            SettingsView()
                .environment(store)
                .frame(width: 1000, height: 640)
        }
    }
}
#endif

/// 页面跳转与弹窗。
@MainActor
@Observable
final class Router {
    enum Section: String, Hashable, CaseIterable, Identifiable {
        case overview, companies, structure, people, files, today, calendar, parties
        var id: String { rawValue }
        /// 属于合规模块（默认隐藏）。
        var isCompliance: Bool { self == .today || self == .calendar || self == .parties }
        var title: String {
            switch self {
            case .overview: "总览"
            case .people: "人员"
            case .today: "今天"
            case .calendar: "合规日历"
            case .companies: "公司"
            case .structure: "股权结构"
            case .files: "文件"
            case .parties: "负责方"
            }
        }
        var symbol: String {
            switch self {
            case .overview: "square.grid.3x3"
            case .people: "person.crop.rectangle.stack"
            case .today: "clock"
            case .calendar: "calendar"
            case .companies: "building.2"
            case .structure: "point.3.connected.trianglepath.dotted"
            case .files: "doc.on.doc"
            case .parties: "person.2"
            }
        }
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
        case packet(companyID: String?)
        case change(companyID: String)
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
            case .packet(let id): "packet-\(id ?? "")"
            case .change(let id): "change-\(id)"
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
    var selectedCompanyID: String?
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
    /// 公司页显示矩阵视图（公司 × 档案类别）。
    var companiesMatrix = false
    var sheet: Sheet?
    var showImporter = false

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
        section = .overview
    }

    func openCalendar(_ preset: CalendarPreset = CalendarPreset()) {
        calendarPreset = preset
        section = .calendar
    }

    func open(person id: String) {
        selectedPersonID = id
        section = .people
    }

    func open(company id: String) {
        selectedCompanyID = id
        section = .companies
    }
}
