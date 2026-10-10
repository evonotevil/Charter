import Foundation

enum Ownership {

    /// 某天生效的持股。
    static func active(_ holdings: [Holding], on day: Day) -> [Holding] {
        holdings.filter { $0.isActive(on: day) }
    }

    /// 穿透后的最终持股：每个人（或没有上层股东的公司）最终持有 target 公司的比例（0–100）。
    /// 代持部分归到实际受益人名下。
    static func ultimateOwners(of companyID: String, holdings: [Holding], on day: Day) -> [(owner: NodeRef, percent: Double, viaNominee: Bool)] {
        Chains.breakdown(of: companyID, holdings: holdings, on: day).owners.map {
            (owner: $0.owner, percent: $0.percent, viaNominee: $0.viaNominee)
        }
    }

    /// 某人（或公司）穿透后持有的所有公司及比例。
    static func portfolio(of owner: NodeRef, companies: [Company], holdings: [Holding], on day: Day) -> [(company: Company, percent: Double, viaNominee: Bool)] {
        companies.compactMap { (c: Company) -> (company: Company, percent: Double, viaNominee: Bool)? in
            guard let hit = ultimateOwners(of: c.id, holdings: holdings, on: day).first(where: { $0.owner == owner }), hit.percent > 0.0001 else { return nil }
            return (company: c, percent: hit.percent, viaNominee: hit.viaNominee)
        }.sorted { $0.percent > $1.percent }
    }

    /// 结构图的分层：没有上层股东的节点在第 0 层，往下逐层。
    static func layers(nodes: [NodeRef], holdings: [Holding], on day: Day) -> [NodeRef: Int] {
        let act = active(holdings, on: day)
        var level: [NodeRef: Int] = [:]
        for n in nodes { level[n] = 0 }
        // 迭代松弛，最多节点数轮，防环
        for _ in 0..<max(nodes.count, 1) {
            var changed = false
            for h in act {
                let child = NodeRef(kind: .company, id: h.companyID)
                guard let p = level[h.holder], let c = level[child] else { continue }
                if c < p + 1 && p + 1 < nodes.count + 1 { level[child] = p + 1; changed = true }
            }
            if !changed { break }
        }
        return level
    }

    static func percentLabel(_ p: Double) -> String {
        if abs(p - p.rounded()) < 0.005 { return "\(Int(p.rounded()))%" }
        return String(format: "%.2f%%", p)
    }
}

enum Freshness: Equatable {
    case valid
    case expiring(days: Int)
    case expired(days: Int)
    case superseded
    case needsUpdate
    case unknown

    var label: String {
        switch self {
        case .valid: "有效"
        case .expiring(let d): "\(d) 天后到期"
        case .expired(let d): "已过期 \(d) 天"
        case .superseded: "旧版，已有新版本"
        case .needsUpdate: "需要更新"
        case .unknown: "缺少日期"
        }
    }

    var needsAttention: Bool {
        switch self {
        case .expiring, .expired, .needsUpdate, .unknown: true
        default: false
        }
    }

    var sortRank: Int {
        switch self {
        case .expired: 0
        case .needsUpdate: 1
        case .expiring: 2
        case .unknown: 3
        case .valid: 4
        case .superseded: 5
        }
    }

    static func of(_ doc: Document, type: DocumentType?, today: Day, warnDays: Int = 30) -> Freshness {
        if doc.supersededBy != nil { return .superseded }
        if doc.needsUpdate { return .needsUpdate }
        // 手动填写的到期日永远优先，不管文件类型是否“长期有效”
        let expiry: Day?
        if let manual = doc.expiryDate {
            expiry = manual
        } else {
            guard let type else { return .unknown }
            switch type.validity {
            case .permanent, .untilChanged: return .valid
            case .expiryOnDocument: expiry = nil
            case .monthsAfterIssue: expiry = doc.issueDate.map { $0.adding(months: type.validityMonths ?? 6) }
            }
        }
        guard let e = expiry else { return .unknown }
        let left = today.days(until: e)
        if left < 0 { return .expired(days: -left) }
        if left <= warnDays { return .expiring(days: left) }
        return .valid
    }

    static func expiry(of doc: Document, type: DocumentType?) -> Day? {
        if let manual = doc.expiryDate { return manual }
        guard let type else { return nil }
        switch type.validity {
        case .permanent, .untilChanged: return nil
        case .expiryOnDocument: return doc.expiryDate
        case .monthsAfterIssue: return doc.expiryDate ?? doc.issueDate.map { $0.adding(months: type.validityMonths ?? 6) }
        }
    }

    static func expiryLabel(of doc: Document, type: DocumentType?) -> String {
        if let expiry = expiry(of: doc, type: type) { return expiry.description }
        if type?.validity == .permanent || type?.validity == .untilChanged { return "长期" }
        return "待核对"
    }
}
