import Foundation

/// 持股链条上的一步。asBeneficial = 这一步是“实际受益人经名义股东代持”。
struct ChainStep: Hashable {
    var holding: Holding
    var asBeneficial: Bool
}

/// 从某个人或公司往下到目标公司的一条持股路径。
struct Chain: Hashable, Identifiable {
    var from: NodeRef
    var steps: [ChainStep]
    /// 这条路径贡献的比例（0–100）。
    var percent: Double
    var id: String { steps.map(\.holding.id).joined(separator: ">") + "|\(from.id)" }
    var hasNominee: Bool { steps.contains { $0.holding.isNominee } }
}

/// 穿透结果：最终受益人、未知部分和未知的来源。
struct OwnershipBreakdown {
    struct Owner: Hashable {
        var owner: NodeRef
        var percent: Double
        var viaNominee: Bool
        /// 是一家公司，且它的股东没有录入（只能穿透到它为止）。
        var isTopCompany: Bool
    }
    var owners: [Owner]
    /// 没有录入股东的部分（0–100）。
    var unknown: Double
    /// 哪家公司缺了多少（按该公司自身的比例，0–100）。
    var gaps: [(companyID: String, missing: Double)]
    var unresolvedNominees: [Holding]
    /// 循环持股无法使用简单路径相乘求最终受益，相关比例保持未识别。
    var cyclicCompanyIDs: [String] = []
}

enum Chains {

    /// 从 from 往下找到 companyID 的所有持股路径（含代持：实际受益人经名义股东的持股也算）。
    static func paths(from: NodeRef, to companyID: String, holdings all: [Holding], on day: Day, maxDepth: Int = 12) -> [Chain] {
        let holdings = all.filter { $0.isActive(on: day) }
        var out: [Chain] = []
        func dfs(_ node: NodeRef, _ steps: [ChainStep], _ pct: Double, _ visited: Set<NodeRef>) {
            guard steps.count < maxDepth else { return }
            for h in holdings {
                let direct = h.holder == node
                let beneficial = h.isNominee && h.beneficialOwner == node && h.holder != node
                guard direct || beneficial else { continue }
                let next = NodeRef(kind: .company, id: h.companyID)
                guard !visited.contains(next) else { continue }
                let s = steps + [ChainStep(holding: h, asBeneficial: beneficial)]
                let p = pct * h.percent / 100
                if h.companyID == companyID {
                    out.append(Chain(from: from, steps: s, percent: p))
                } else {
                    dfs(next, s, p, visited.union([next]))
                }
            }
        }
        dfs(from, [], 100, [from])
        return out.sorted { $0.percent > $1.percent }
    }

    /// 穿透到自然人（或股东未录入的顶层公司），同时算出未知比例。
    static func breakdown(of companyID: String, holdings all: [Holding], on day: Day) -> OwnershipBreakdown {
        let act = all.filter { $0.isActive(on: day) }
        var totals: [NodeRef: (Double, Bool, Bool)] = [:]
        var unknown = 0.0
        var gaps: [String: Double] = [:]
        var unresolved: [Holding] = []
        var cyclic = Set<String>()

        func walk(_ company: String, factor: Double, nominee: Bool, visited: Set<String>) {
            let ups = act.filter { $0.companyID == company }
            let sum = ups.reduce(0) { $0 + $1.percent }
            if sum < 99.995 {
                unknown += factor * (100 - sum) / 100
                gaps[company] = max(gaps[company] ?? 0, 100 - sum)
            }
            for h in ups {
                let share = factor * h.percent / 100
                if h.isNominee && h.beneficialOwner == nil {
                    unknown += share
                    if !unresolved.contains(where: { $0.id == h.id }) { unresolved.append(h) }
                    continue
                }
                var holder = h.holder
                var via = nominee
                if h.isNominee, let bo = h.beneficialOwner { holder = bo; via = true }
                switch holder.kind {
                case .person:
                    let prev = totals[holder] ?? (0, false, false)
                    totals[holder] = (prev.0 + share, prev.1 || via, false)
                case .company:
                    let hasParents = act.contains { $0.companyID == holder.id }
                    if visited.contains(holder.id) {
                        unknown += share
                        cyclic.insert(holder.id)
                    } else if hasParents {
                        walk(holder.id, factor: share, nominee: via, visited: visited.union([holder.id]))
                    } else {
                        let prev = totals[holder] ?? (0, false, true)
                        totals[holder] = (prev.0 + share, prev.1 || via, !hasParents)
                    }
                }
            }
        }
        walk(companyID, factor: 100, nominee: false, visited: [companyID])
        let owners = totals.map { OwnershipBreakdown.Owner(owner: $0.key, percent: $0.value.0, viaNominee: $0.value.1, isTopCompany: $0.value.2) }
            .sorted { $0.percent > $1.percent }
        return OwnershipBreakdown(owners: owners, unknown: unknown,
                                  gaps: gaps.map { (companyID: $0.key, missing: $0.value) }.sorted { $0.missing > $1.missing },
                                  unresolvedNominees: unresolved, cyclicCompanyIDs: cyclic.sorted())
    }
}
