import Foundation

// MARK: - 法域

struct Jurisdiction: Codable, Hashable, Identifiable {
    var code: String          // HK、SG、VG、KY、VI、JP、KR，可自行新增
    var name: String          // 香港
    var timeZone: String      // IANA，如 Asia/Hong_Kong
    var entityForms: [String] // 常见公司类型

    var id: String { code }
    var tz: TimeZone { TimeZone(identifier: timeZone) ?? .current }
}

// MARK: - 公司

enum CompanyStatus: String, Codable, CaseIterable, Identifiable {
    case forming, active, dormant, dissolving, dissolved, redomiciled
    var id: String { rawValue }
    var label: String {
        switch self {
        case .forming: "设立中"
        case .active: "正常"
        case .dormant: "休眠"
        case .dissolving: "注销中"
        case .dissolved: "已注销"
        case .redomiciled: "已迁册"
        }
    }
    /// 是否继续生成合规事项。
    var generatesObligations: Bool { self == .active || self == .dormant || self == .dissolving }
}

struct Company: Codable, Hashable, Identifiable {
    var id: String = UUID().uuidString
    var name: String                       // 注册名原文
    var formerNames: [String] = []
    var aliases: [String] = []             // 中文简称等，只用于搜索和识别
    var jurisdiction: String               // 法域代码
    var entityForm: String = ""
    var registrationNumber: String = ""
    var incorporationDate: Day?
    var fiscalYearEnd: MonthDay = MonthDay(12, 31)
    var status: CompanyStatus = .active
    var group: String = ""
    var registeredAddress: String = ""
    var defaultPartyID: String?            // 这家公司默认的负责方（通常是注册代理或秘书）
    var rulePartyIDs: [String: String] = [:]   // 某条规则改由谁负责：ruleID → partyID
    var disabledRuleIDs: [String] = []     // 对这家公司不适用的规则
    var trackingSince: Day                 // 从哪天开始跟踪，之前的事项不再提醒
    var notes: String = ""
    var position: GraphPoint?              // 结构图里手动拖过的位置
    var ruleOverrides: [String: CompanyRuleOverride]?   // 这家公司的代理单独确认过的规则（1.1 新增）
    var archive: CompanyArchive?           // 这家公司的档案条目调整与状态（2.0 新增）

    var searchText: String { ([name] + formerNames + aliases + [registrationNumber]).joined(separator: " ").lowercased() }
}

struct GraphPoint: Codable, Hashable { var x: Double; var y: Double }

// MARK: - 人

struct Person: Codable, Hashable, Identifiable {
    var id: String = UUID().uuidString
    var name: String
    var aliases: [String] = []
    var email: String = ""
    var notes: String = ""
    var position: GraphPoint?
}

// MARK: - 持股与任职

enum NodeKind: String, Codable { case company, person }

struct NodeRef: Codable, Hashable {
    var kind: NodeKind
    var id: String
}

struct Holding: Codable, Hashable, Identifiable {
    var id: String = UUID().uuidString
    var holder: NodeRef                    // 股东：公司或人
    var companyID: String                  // 被持股公司
    var percent: Double                    // 0–100
    var shares: String = ""                // 股份数，原样记录
    var shareClass: String = ""
    var isNominee: Bool = false            // 代持
    var beneficialOwner: NodeRef?          // 代持时的实际受益人
    var from: Day?
    var to: Day?

    func isActive(on day: Day) -> Bool {
        if let f = from, f > day { return false }
        if let t = to, t <= day { return false }
        return true
    }
}

struct Appointment: Codable, Hashable, Identifiable {
    var id: String = UUID().uuidString
    var personID: String
    var companyID: String
    var title: String                      // 董事、公司秘书、授权签字人……
    var from: Day?
    var to: Day?

    func isActive(on day: Day) -> Bool {
        if let f = from, f > day { return false }
        if let t = to, t <= day { return false }
        return true
    }
}

// MARK: - 负责方

enum PartyKind: String, Codable, CaseIterable, Identifiable {
    case agent, department, person
    var id: String { rawValue }
    var label: String {
        switch self {
        case .agent: "外部代理"
        case .department: "内部部门"
        case .person: "个人"
        }
    }
}

struct Party: Codable, Hashable, Identifiable {
    var id: String = UUID().uuidString
    var name: String
    var kind: PartyKind = .agent
    var contactName: String = ""
    var email: String = ""
    var phone: String = ""
    var followUpDays: Int = 14             // 交办后多少天没回音就提醒你催
    var notes: String = ""
}

// MARK: - 文件

struct Document: Codable, Hashable, Identifiable {
    var id: String = UUID().uuidString
    var typeID: String
    var owner: NodeRef
    var issueDate: Day?
    var expiryDate: Day?                   // 文件上写明的到期日
    var form: String = "扫描件"             // 扫描件、核证副本、公证件、海牙认证、翻译件
    var filePath: String                   // 相对于数据文件夹
    var originalFileName: String = ""
    var supersededBy: String?
    var needsUpdate: Bool = false          // “信息变更后需重开”的文件被手动或自动标记
    var addedOn: Day
    var notes: String = ""
}

// MARK: - 合规事项记录

enum ObligationStatus: String, Codable, CaseIterable, Identifiable {
    case pending        // 待交办
    case drafted        // 已起草邮件或复制消息，还没确认发出
    case handedOff      // 已交办，等回件
    case waiting        // 旧版本的“等回件”，与 handedOff 同义
    case done
    var id: String { rawValue }
    var label: String {
        switch self {
        case .pending: "待交办"
        case .drafted: "待发送"
        case .handedOff, .waiting: "已交办"
        case .done: "已完成"
        }
    }
    /// 筛选和选择时用的四种状态。
    static let visible: [ObligationStatus] = [.pending, .drafted, .handedOff, .done]
    var isHandedOff: Bool { self == .handedOff || self == .waiting }
    /// 筛选时把旧的 waiting 归到 handedOff。
    var normalized: ObligationStatus { self == .waiting ? .handedOff : self }
}

/// 交办过程中的一条记录。
struct HandoffEntry: Codable, Hashable {
    enum Action: String, Codable { case drafted, copied, sent, nudged, completed, reverted, rescheduled }
    var action: Action
    var at: Date
    var partyID: String?
    var channel: String?        // 邮件、企业微信、飞书……
    var message: String?

    var label: String {
        switch action {
        case .drafted: "起草了邮件"
        case .copied: "复制了消息"
        case .sent: "确认已发送"
        case .nudged: "催办"
        case .completed: "标记完成"
        case .reverted: "退回待交办"
        case .rescheduled: "改期"
        }
    }
}

/// 只保存“有人动过”的事项。规则算出来但还没处理的事项不落盘。
struct ObligationRecord: Codable, Hashable, Identifiable {
    var id: String { key }
    var key: String                        // ruleID|companyID|原截止日
    var ruleID: String
    var companyID: String
    var dueDate: Day                       // 规则算出的截止日
    var overrideDue: Day?                  // 手动改期
    var status: ObligationStatus = .pending
    var partyID: String?
    var handedOffOn: Day?
    var completedOn: Day?
    var receiptDocumentID: String?
    var note: String = ""
    var changeID: String?                  // 由哪次变更触发
    var draftedOn: Day?                    // 起草或复制的日期（1.1 新增）
    var log: [HandoffEntry]?               // 交办记录（1.1 新增）

    static func makeKey(ruleID: String, companyID: String, due: Day) -> String { "\(ruleID)|\(companyID)|\(due)" }
}

// MARK: - 变更记录

enum ChangeKind: String, Codable, CaseIterable, Identifiable {
    case directorChange, shareholderChange, addressChange, nameChange, statusChange, other
    var id: String { rawValue }
    var label: String {
        switch self {
        case .directorChange: "董事或高管变更"
        case .shareholderChange: "股东或持股变更"
        case .addressChange: "注册地址变更"
        case .nameChange: "公司更名"
        case .statusChange: "公司状态变更"
        case .other: "其他"
        }
    }
}

struct ChangeRecord: Codable, Hashable, Identifiable {
    var id: String = UUID().uuidString
    var companyID: String?
    var kind: ChangeKind
    var effectiveOn: Day
    var recordedOn: Day
    var summary: String
    var details: [String]?                 // 这次变更具体改了什么（1.1 新增）
    var evidenceDocumentID: String?        // 证明文件，如董事会决议（1.1 新增）
}

// MARK: - 共享设置（随数据文件夹同步）

struct SharedSettings: Codable, Hashable {
    var reminderDays: [Int] = [60, 30, 7]
    var primaryDeviceID: String?           // 负责通知和写日历的“主 Mac”
    var primaryDeviceName: String?
    var calendarEnabled: Bool = true
    var calendarName: String = "Charter"
    var notificationHour: Int = 9
    var complianceEnabled: Bool?           // 合规申报、交办、合规日历模块（2.0 起默认关闭）
}
