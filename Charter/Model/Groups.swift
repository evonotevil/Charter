import Foundation

/// 集团：由你定义顶层（一位自然人、几位自然人，或一家/几家公司），
/// 下面的公司按持股关系自动推导和排层。
struct CorporateGroup: Codable, Hashable, Identifiable {
    var id: String = UUID().uuidString
    var name: String
    /// 顶层：实控人或最顶层公司。
    var tops: [NodeRef]
    /// 已归入这个集团、但还没和集团里的上下级连上持股关系的公司。
    var extraCompanyIDs: [String] = []
    var notes: String = ""
    /// 集团图标文件名，位于“数据文件夹/集团图标/”；旧数据里没有这个键时为 nil。
    var iconFileName: String? = nil
}

/// 集团里的一行：公司、它在树里的深度、直接上级、以及持股比例。
struct GroupRow: Hashable, Identifiable {
    var companyID: String
    var depth: Int
    var parent: NodeRef?
    var percent: Double?
    var viaNominee: Bool
    /// 归入了集团但没连上持股关系。
    var unconnected: Bool
    var id: String { companyID }
}

enum GroupEngine {

    /// 某个节点直接（或作为实际受益人经代持）持有的公司。
    static func children(of node: NodeRef, holdings: [Holding]) -> [Holding] {
        holdings.filter { $0.holder == node || ($0.isNominee && $0.beneficialOwner == node) }
    }

    /// 从顶层往下，按深度优先排出集团里的公司；每家公司只出现一次（挂在持股比例最大的上级下面）。
    static func rows(for g: CorporateGroup, holdings all: [Holding], companies: [Company], on day: Day) -> [GroupRow] {
        let holdings = all.filter { $0.isActive(on: day) }
        let existing = Set(companies.map(\.id))

        // 先用广度优先求出每家公司的最浅深度和最佳上级
        var best: [String: (depth: Int, parent: NodeRef?, percent: Double?, nominee: Bool)] = [:]
        var queue: [(NodeRef, Int)] = []
        for t in g.tops {
            if t.kind == .company, existing.contains(t.id) {
                best[t.id] = (0, nil, nil, false)
            }
            queue.append((t, 0))
        }
        var i = 0
        while i < queue.count {
            let (node, d) = queue[i]; i += 1
            for h in children(of: node, holdings: holdings) where existing.contains(h.companyID) {
                let depth = d + 1
                let nominee = h.isNominee && h.holder != node
                if let b = best[h.companyID] {
                    // 同深度时挂在持股更多的上级下
                    if depth < b.depth || (depth == b.depth && h.percent > (b.percent ?? 0)) {
                        best[h.companyID] = (depth, node, h.percent, nominee)
                    }
                    continue
                }
                best[h.companyID] = (depth, node, h.percent, nominee)
                queue.append((NodeRef(kind: .company, id: h.companyID), depth))
            }
        }

        // 再按树的顺序输出（同级按名称）
        let name: (String) -> String = { id in companies.first { $0.id == id }?.name ?? "" }
        var out: [GroupRow] = []
        var placed = Set<String>()
        func emit(_ id: String) {
            guard let b = best[id], placed.insert(id).inserted else { return }
            out.append(GroupRow(companyID: id, depth: b.depth, parent: b.parent, percent: b.percent, viaNominee: b.nominee, unconnected: false))
            let kids = best.filter { $0.value.parent == NodeRef(kind: .company, id: id) }.map(\.key).sorted { name($0) < name($1) }
            for k in kids { emit(k) }
        }
        for t in g.tops {
            if t.kind == .company { emit(t.id) }
            else {
                let kids = best.filter { $0.value.parent == t && $0.value.depth == 1 }.map(\.key).sorted { name($0) < name($1) }
                for k in kids { emit(k) }
            }
        }
        // 未连上的
        for id in g.extraCompanyIDs where existing.contains(id) && !placed.contains(id) {
            placed.insert(id)
            out.append(GroupRow(companyID: id, depth: 0, parent: nil, percent: nil, viaNominee: false, unconnected: true))
        }
        return out
    }
}
