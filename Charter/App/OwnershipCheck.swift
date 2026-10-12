import SwiftUI

/// 股东录入情况：用于结构图的“核对股东”和总览提示。
enum ShareholderStatus: Equatable {
    /// 没有任何在册股东。
    case missing
    /// 已录入股东合计不足 100%。
    case partial(Double)
    /// 比例齐了，但有代持未填实际受益人、合计超过 100% 或缺持股起始日期。
    case pending([String])
    case complete

    var label: String {
        switch self {
        case .missing: "没有股东"
        case .partial(let t): "合计 \(Ownership.percentLabel(t))"
        case .pending: "待确认"
        case .complete: "完整"
        }
    }

    var detail: String {
        switch self {
        case .missing: "还没有录入任何股东。"
        case .partial(let t): "已录入的股东合计 \(Ownership.percentLabel(t))，另有 \(Ownership.percentLabel(max(0, 100 - t))) 未录入。"
        case .pending(let reasons): reasons.joined(separator: "；") + "。"
        case .complete: "股东比例合计 100%，信息齐全。"
        }
    }

    var color: Color {
        switch self {
        case .missing: Theme.danger
        case .partial: Theme.amber
        case .pending: Theme.amberText
        case .complete: Theme.lime
        }
    }

    var needsAttention: Bool { self != .complete }
    /// 排序用：越需要处理越靠前。
    var rank: Int {
        switch self { case .missing: 0; case .partial: 1; case .pending: 2; case .complete: 3 }
    }
}

extension AppStore {
    /// 需要核对股东的公司：已注销、已迁册、设立中的不计入。
    func shareholderCheckApplies(_ c: Company) -> Bool {
        switch c.status {
        case .dissolved, .redomiciled, .forming: false
        default: true
        }
    }

    func shareholderStatus(of companyID: String, on day: Day? = nil) -> ShareholderStatus {
        let d = day ?? today
        let hs = holdings.filter { $0.companyID == companyID && $0.isActive(on: d) }
        guard !hs.isEmpty else { return .missing }
        let total = hs.reduce(0) { $0 + $1.percent }
        if total < 99.5 { return .partial(total) }
        var reasons: [String] = []
        if total > 100.5 { reasons.append("股东合计 \(Ownership.percentLabel(total))，超过 100%") }
        let nominees = hs.filter { $0.isNominee && $0.beneficialOwner == nil }
        if !nominees.isEmpty {
            reasons.append(nominees.map { "\(name(of: $0.holder)) 代持未填实际受益人" }.joined(separator: "；"))
        }
        let undated = hs.filter { $0.from == nil }
        if !undated.isEmpty { reasons.append("\(undated.count) 条持股缺起始日期") }
        return reasons.isEmpty ? .complete : .pending(reasons)
    }

    /// 范围内股东不完整（没有股东或合计不足 100%）的公司数，供总览提示。
    func incompleteShareholderCount(in scope: Set<String>?) -> Int {
        companies.filter { c in
            guard scope?.contains(c.id) ?? true, shareholderCheckApplies(c) else { return false }
            switch shareholderStatus(of: c.id) {
            case .missing, .partial: return true
            default: return false
            }
        }.count
    }

    /// 向上穿透：这家公司以及它所有上层公司（经持股或代持受益关系）。
    func upwardScope(of companyID: String, on day: Day? = nil) -> Set<String> {
        let d = day ?? today
        let active = holdings.filter { $0.isActive(on: d) }
        var seen: Set<String> = [companyID]
        var queue = [companyID]
        while let id = queue.popLast() {
            for h in active where h.companyID == id {
                for node in [h.holder] + (h.isNominee ? [h.beneficialOwner].compactMap { $0 } : [])
                    where node.kind == .company && seen.insert(node.id).inserted {
                    queue.append(node.id)
                }
            }
        }
        return seen
    }
}
