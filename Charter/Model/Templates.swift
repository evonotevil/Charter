import Foundation

// MARK: - 文件类型

enum ValidityKind: String, Codable, CaseIterable, Identifiable {
    case permanent            // 长期有效
    case monthsAfterIssue     // 签发后 N 个月
    case expiryOnDocument     // 以文件上的到期日为准
    case untilChanged         // 信息变更后需重开
    var id: String { rawValue }
    var label: String {
        switch self {
        case .permanent: "长期有效"
        case .monthsAfterIssue: "签发后若干个月"
        case .expiryOnDocument: "以文件上的到期日为准"
        case .untilChanged: "信息变更后需重开"
        }
    }
}

struct DocumentType: Codable, Hashable, Identifiable {
    var id: String
    var name: String                 // 显示名称
    var category: String             // 跨法域的通用类别，如“存续证明”
    var localNames: [String]         // 当地名称与别名
    var jurisdictions: [String]      // 空 = 所有法域
    var owner: NodeKind              // 挂在公司还是人身上
    var validity: ValidityKind
    var validityMonths: Int?
    var hints: [String]              // 识别线索
    var builtIn: Bool
    /// 只适用于这些实体类型（3.1 新增；nil 或空 = 该法域所有类型）。
    var entityForms: [String]? = nil

    func applies(to jurisdiction: String) -> Bool { jurisdictions.isEmpty || jurisdictions.contains(jurisdiction) }
}

// MARK: - 合规规则

enum ScheduleKind: String, Codable, CaseIterable, Identifiable {
    case annualFixed            // 每年固定日期
    case afterAnniversary       // 成立周年日后 N 天
    case afterFiscalYearEnd     // 财年结束后 N 个月 + N 天
    case incorporationHalf      // 按成立日期在上半年还是下半年，决定每年的截止日（BVI 年费）
    case documentExpiry         // 某类文件到期日
    case event                  // 变更后 N 天内
    var id: String { rawValue }
    var label: String {
        switch self {
        case .annualFixed: "每年固定日期"
        case .afterAnniversary: "成立周年日之后"
        case .afterFiscalYearEnd: "财年结束之后"
        case .incorporationHalf: "按成立月份分上下半年"
        case .documentExpiry: "某类文件到期时"
        case .event: "发生变更之后"
        }
    }
}

enum DateAdjust: String, Codable, CaseIterable, Identifiable {
    case none, previousBusinessDay, nextBusinessDay
    var id: String { rawValue }
    var label: String {
        switch self {
        case .none: "不调整"
        case .previousBusinessDay: "遇周末提前到周五"
        case .nextBusinessDay: "遇周末顺延到周一"
        }
    }
}

struct Schedule: Codable, Hashable {
    var kind: ScheduleKind
    var date: MonthDay?              // annualFixed
    var months: Int?                 // afterFiscalYearEnd
    var days: Int?                   // afterAnniversary / afterFiscalYearEnd / event
    var firstHalf: MonthDay?         // incorporationHalf：1–6 月成立
    var secondHalf: MonthDay?        // incorporationHalf：7–12 月成立
    var documentTypeID: String?      // documentExpiry
    var event: ChangeKind?           // event

    var summary: String {
        switch kind {
        case .annualFixed: return "每年 \(date?.label ?? "?")"
        case .afterAnniversary: return "每个成立周年日后 \(days ?? 0) 天内"
        case .afterFiscalYearEnd:
            let m = months ?? 0, d = days ?? 0
            return "财年结束后 " + (m > 0 ? "\(m) 个月" : "") + (d > 0 ? "\(d) 天" : "") + "内"
        case .incorporationHalf: return "上半年成立的 \(firstHalf?.label ?? "?")，下半年成立的 \(secondHalf?.label ?? "?")"
        case .documentExpiry: return "文件到期前办妥"
        case .event: return "\(event?.label ?? "变更")后 \(days ?? 0) 天内"
        }
    }
}

// MARK: - 规则核对

enum VerificationStatus: String, Codable {
    case draft, confirmed
}

/// 一条规则（或某家公司的规则）是怎么被确认的。
struct RuleVerification: Codable, Hashable {
    var status: VerificationStatus = .draft
    var sourceKind: String = "代理书面确认"      // 法规、注册处或税局页面、代理书面确认、其他
    var source: String = ""                       // 链接或说明
    var evidenceDocumentID: String?               // 代理回复等证明文件
    var conditions: String = ""                   // 适用条件与例外
    var confirmedBy: String = ""
    var confirmedOn: Day?

    static let sourceKinds = ["法规原文", "注册处或税局页面", "代理书面确认", "其他"]
}

/// 规则的修改记录。
struct RuleRevision: Codable, Hashable {
    var on: Day
    var summary: String
}

/// 某家公司对一条规则的单独确认或不同截止日。
struct CompanyRuleOverride: Codable, Hashable {
    var schedule: Schedule?                       // 代理给出的不同算法；空 = 沿用通用规则
    var verification: RuleVerification?
}

/// 某件事项依据的规则可信程度。
enum RuleTrust: Equatable {
    case draft
    case confirmed(scope: String, on: Day?)
    case needsReview(on: Day?)

    var isConfirmed: Bool { if case .confirmed = self { return true } else { return false } }
    var label: String {
        switch self {
        case .draft: "待核对"
        case .confirmed: "已确认"
        case .needsReview: "需复核"
        }
    }
}

struct RuleTemplate: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var localName: String
    var jurisdictions: [String]
    var entityForms: [String]        // 空 = 该法域所有公司类型
    var schedule: Schedule
    var adjust: DateAdjust
    var reminders: [Int]?            // 空 = 用全局设置
    var requiredDocTypeIDs: [String]
    var responsibleHint: String      // 通常由谁办
    var penalty: String
    var notes: String
    var needsReview: Bool            // 旧字段：1.1 起以 verification 为准
    var enabled: Bool
    var builtIn: Bool
    var verification: RuleVerification?   // 1.1 新增
    var revisions: [RuleRevision]?        // 1.1 新增

    /// 套用某家公司的单独规定后的规则。
    func effective(for company: Company) -> RuleTemplate {
        var r = self
        if let s = company.ruleOverrides?[id]?.schedule { r.schedule = s }
        return r
    }

    func applies(to company: Company) -> Bool {
        enabled && jurisdictions.contains(company.jurisdiction)
            && (entityForms.isEmpty || entityForms.contains(company.entityForm))
            && !company.disabledRuleIDs.contains(id)
    }
}

// MARK: - 文件包

struct PacketTemplate: Codable, Hashable, Identifiable {
    var id: String
    var name: String                 // 银行开户、年度审计、KYC 更新
    var categories: [String]         // 需要的文件类别
    var includeDirectorsPassports: Bool
    var maxAgeMonths: Int?           // 签发时间要求，如 3 个月内
}

struct TemplateLibrary: Codable {
    var version: Int
    var jurisdictions: [Jurisdiction]
    var documentTypes: [DocumentType]
    var rules: [RuleTemplate]
    var packets: [PacketTemplate]
    /// 每个法域的档案条目（文件类型 ID，按显示顺序）。为空时用该法域的内置类型。（2.0 新增）
    var archiveItems: [String: [String]]?
}
