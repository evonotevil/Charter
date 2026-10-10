import Foundation

/// 一件具体的合规事项：某条规则在某家公司的某一次截止。
struct Obligation: Identifiable, Hashable {
    var key: String
    var rule: RuleTemplate
    var company: Company
    var originalDue: Day
    var due: Day
    var record: ObligationRecord?

    var id: String { key }
    var status: ObligationStatus { record?.status ?? .pending }
    var isDone: Bool { status == .done }

    func daysLeft(from today: Day) -> Int { today.days(until: due) }
}

enum DeadlineEngine {

    /// 计算一条规则在一家公司、一段时间内的所有截止日（已按周末调整）。
    static func dueDates(rule: RuleTemplate, company: Company, documents: [Document], from start: Day, to end: Day) -> [Day] {
        let s = rule.schedule
        var raw: [Day] = []
        let years = (start.year - 1)...(end.year + 1)

        switch s.kind {
        case .annualFixed:
            guard let md = s.date else { return [] }
            raw = years.map { md.inYear($0) }

        case .afterAnniversary:
            guard let inc = company.incorporationDate else { return [] }
            raw = years.filter { $0 > inc.year }.map { Day($0, inc.month, inc.day).adding(days: s.days ?? 0) }

        case .afterFiscalYearEnd:
            raw = years.compactMap { y in
                let fye = company.fiscalYearEnd.inYear(y)
                // 第一个财年在成立之后才结束
                if let inc = company.incorporationDate, fye < inc { return nil }
                return fye.adding(months: s.months ?? 0).adding(days: s.days ?? 0)
            }

        case .incorporationHalf:
            guard let inc = company.incorporationDate, let a = s.firstHalf, let b = s.secondHalf else { return [] }
            let md = inc.month <= 6 ? a : b
            raw = years.filter { $0 > inc.year }.map { md.inYear($0) }

        case .documentExpiry:
            guard let typeID = s.documentTypeID else { return [] }
            let current = documents
                .filter { $0.typeID == typeID && $0.owner == NodeRef(kind: .company, id: company.id) && $0.supersededBy == nil }
                .compactMap { $0.expiryDate }
                .max()
            if let d = current { raw = [d] }

        case .event:
            return [] // 由变更记录生成，见 eventObligations
        }

        return raw.map { adjust($0, rule.adjust) }.filter { $0 >= start && $0 <= end }.sorted()
    }

    static func adjust(_ d: Day, _ a: DateAdjust) -> Day {
        switch a {
        case .none: return d
        case .previousBusinessDay:
            var x = d
            while x.isWeekend { x = x.adding(days: -1) }
            return x
        case .nextBusinessDay:
            var x = d
            while x.isWeekend { x = x.adding(days: 1) }
            return x
        }
    }

    /// 所有公司、所有规则在时间窗口内的事项，合并已保存的处理记录。
    static func obligations(
        companies: [Company],
        rules: [RuleTemplate],
        documents: [Document],
        records: [ObligationRecord],
        changes: [ChangeRecord],
        today: Day,
        horizonDays: Int = 400
    ) -> [Obligation] {
        let byKey = Dictionary(records.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
        let end = today.adding(days: horizonDays)
        var out: [Obligation] = []

        for company in companies where company.status.generatesObligations {
            for base in rules where base.applies(to: company) {
                let rule = base.effective(for: company)
                guard rule.schedule.kind != .event else { continue }
                let dues = dueDates(rule: rule, company: company, documents: documents, from: company.trackingSince, to: end)
                for d in dues {
                    let key = ObligationRecord.makeKey(ruleID: rule.id, companyID: company.id, due: d)
                    let rec = byKey[key]
                    out.append(Obligation(key: key, rule: rule, company: company, originalDue: d, due: rec?.overrideDue ?? d, record: rec))
                }
            }
            // 变更触发的事项
            for change in changes where change.companyID == company.id && change.effectiveOn >= company.trackingSince {
                for base in rules where base.applies(to: company) {
                    let rule = base.effective(for: company)
                    guard rule.schedule.kind == .event, rule.schedule.event == change.kind else { continue }
                    let d = adjust(change.effectiveOn.adding(days: rule.schedule.days ?? 0), rule.adjust)
                    let key = ObligationRecord.makeKey(ruleID: rule.id, companyID: company.id, due: d) + "|" + change.id
                    let rec = byKey[key]
                    out.append(Obligation(key: key, rule: rule, company: company, originalDue: d, due: rec?.overrideDue ?? d, record: rec))
                }
            }
        }
        return out.sorted { ($0.due, $0.company.name) < ($1.due, $1.company.name) }
    }

    /// 每个“规则 × 公司”只取最早一件未完成的；之后的周期等这一件完成后再出现。
    static func open(_ all: [Obligation]) -> [Obligation] {
        var seen = Set<String>()
        var result: [Obligation] = []
        for o in all where !o.isDone {
            let group = o.rule.schedule.kind == .event ? o.key : "\(o.rule.id)|\(o.company.id)"
            if seen.insert(group).inserted { result.append(o) }
        }
        return result
    }

    /// 某个事项应在哪些日期提醒（截止前 N 天，9 点）。
    static func reminderDays(for o: Obligation, settings: SharedSettings) -> [Day] {
        (o.rule.reminders ?? settings.reminderDays).map { o.due.adding(days: -$0) } + [o.due]
    }

    // MARK: 可信度与解释

    /// 规则在这家公司的可信程度：公司单独确认优先，其次法域通用确认；确认超过 12 个月需复核。
    static func trust(rule: RuleTemplate, company: Company, today: Day) -> RuleTrust {
        func judge(_ v: RuleVerification?, scope: String) -> RuleTrust? {
            guard let v, v.status == .confirmed else { return nil }
            if let on = v.confirmedOn, on.adding(months: 12) < today { return .needsReview(on: on) }
            return .confirmed(scope: scope, on: v.confirmedOn)
        }
        if let t = judge(company.ruleOverrides?[rule.id]?.verification, scope: "这家公司") { return t }
        if let t = judge(rule.verification, scope: "该法域通用") { return t }
        return .draft
    }

    /// 这件事项的截止日是怎么算出来的，逐行说明。
    static func explain(_ o: Obligation, documents: [Document], docTypeName: (String) -> String) -> [String] {
        let s = o.rule.schedule
        let c = o.company
        var lines: [String] = []
        switch s.kind {
        case .annualFixed:
            lines.append("规则：每年 \(s.date?.label ?? "?") 前")
        case .afterAnniversary:
            let inc = c.incorporationDate.map { "\($0.month) 月 \($0.day) 日" } ?? "未填写"
            lines.append("成立日 \(c.incorporationDate?.long ?? "未填写")，每年周年日（\(inc)）后 \(s.days ?? 0) 天内")
        case .afterFiscalYearEnd:
            let fye = ((o.originalDue.year - 2)...o.originalDue.year).map { c.fiscalYearEnd.inYear($0) }
                .first { adjust($0.adding(months: s.months ?? 0).adding(days: s.days ?? 0), o.rule.adjust) == o.originalDue }
                ?? c.fiscalYearEnd.inYear(o.originalDue.year - 1)
            var calc = "财年结束 \(fye.long)"
            if let m = s.months, m > 0 { calc += " ＋ \(m) 个月" }
            if let d = s.days, d > 0 { calc += " ＋ \(d) 天" }
            let raw = fye.adding(months: s.months ?? 0).adding(days: s.days ?? 0)
            lines.append(calc + " ＝ \(raw.long)")
            if raw != o.originalDue { lines.append("\(raw.long)是周末，调整到 \(o.originalDue.long)") }
            lines.append("这家公司的财年结束日：每年 \(c.fiscalYearEnd.label)")
        case .incorporationHalf:
            if let inc = c.incorporationDate {
                let first = inc.month <= 6
                lines.append("成立于 \(inc.long)（\(first ? "上半年" : "下半年")），每年 \((first ? s.firstHalf : s.secondHalf)?.label ?? "?") 前")
            } else {
                lines.append("缺少成立日，无法判断上半年还是下半年")
            }
        case .documentExpiry:
            lines.append("按现有\(s.documentTypeID.map(docTypeName) ?? "文件")的到期日 \(o.originalDue.long) 计算")
        case .event:
            lines.append("变更生效后 \(s.days ?? 0) 天内，即 \(o.originalDue.long) 前")
        }
        switch o.rule.adjust {
        case .none: lines.append("遇周末不调整")
        case .previousBusinessDay: lines.append("遇周末提前到周五")
        case .nextBusinessDay: lines.append("遇周末顺延到周一")
        }
        if c.ruleOverrides?[o.rule.id]?.schedule != nil { lines.append("这家公司使用单独确认的算法") }
        if o.due != o.originalDue {
            lines.append("已手动改期到 \(o.due.long)（原定 \(o.originalDue.long)）")
        }
        return lines
    }
}
