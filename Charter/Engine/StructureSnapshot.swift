import CoreGraphics
import Foundation

/// 股权图一次稳定的数据与布局快照。
///
/// 视图的悬停、点选和拖动不会重新构建它；只有公司、人员、持股、集团、日期或集团范围变化时才更新。
struct StructureSnapshot {
    let asOf: Day
    let companies: [Company]
    let activeHoldings: [Holding]
    let nodes: [NodeRef]
    let positions: [NodeRef: CGPoint]
    let canvas: CGSize
    let totalsByCompany: [String: Double]

    static func stops(holdings: [Holding], companyIDs: Set<String>, today: Day) -> [Day] {
        let scoped = holdings.filter { companyIDs.contains($0.companyID) }
        let years = Set(scoped.compactMap(\.from?.year) + scoped.compactMap(\.to?.year))
            .filter { $0 < today.year }
        return years.sorted().map { Day($0, 12, 31) } + [today]
    }

    static func build(
        companies allCompanies: [Company],
        holdings allHoldings: [Holding],
        scope: Set<String>?,
        asOf: Day,
        names: [NodeRef: String],
        savedPositions: [NodeRef: GraphPoint],
        companySize: CGSize,
        personSize: CGSize
    ) -> StructureSnapshot {
        let companies = allCompanies.filter { company in
            (scope == nil || scope!.contains(company.id))
                && (company.incorporationDate.map { $0 <= asOf } ?? true)
                && company.status != .dissolved
        }
        let companyIDs = Set(companies.map(\.id))
        let activeHoldings = Ownership.active(allHoldings, on: asOf)
            .filter { companyIDs.contains($0.companyID) }

        var nodes: [NodeRef] = []
        var seen: Set<NodeRef> = []
        for holding in activeHoldings where seen.insert(holding.holder).inserted {
            nodes.append(holding.holder)
        }
        for company in companies {
            let ref = NodeRef(kind: .company, id: company.id)
            if seen.insert(ref).inserted { nodes.append(ref) }
        }

        let incoming = Dictionary(grouping: activeHoldings, by: \.companyID)
        let totals = incoming.mapValues { $0.reduce(0) { $0 + $1.percent } }
        let levels = Ownership.layers(nodes: nodes, holdings: activeHoldings, on: asOf)
        let maxLevel = levels.values.max() ?? 0
        var rows = Array(repeating: [NodeRef](), count: maxLevel + 1)
        for node in nodes { rows[levels[node] ?? 0].append(node) }

        var positions: [NodeRef: CGPoint] = [:]
        let stepX: CGFloat = 320
        let stepY: CGFloat = 170
        let top: CGFloat = 70
        let widest = CGFloat(rows.map(\.count).max() ?? 1)
        let width = max(widest * stepX + 80, 600)

        for (rowIndex, row) in rows.enumerated() {
            // 每个节点的重心只算一次，避免排序比较器反复扫描全部持股。
            let barycentres: [NodeRef: CGFloat] = Dictionary(uniqueKeysWithValues: row.map { node in
                guard node.kind == .company else { return (node, .greatestFiniteMagnitude / 2) }
                let xs = (incoming[node.id] ?? []).compactMap { positions[$0.holder]?.x }
                let barycentre = xs.isEmpty ? CGFloat.greatestFiniteMagnitude / 2 : xs.reduce(0, +) / CGFloat(xs.count)
                return (node, barycentre)
            })
            let ordered = row.sorted { lhs, rhs in
                let left = barycentres[lhs] ?? .greatestFiniteMagnitude / 2
                let right = barycentres[rhs] ?? .greatestFiniteMagnitude / 2
                return left == right ? (names[lhs] ?? "") < (names[rhs] ?? "") : left < right
            }
            let rowWidth = CGFloat(ordered.count) * stepX
            for (column, node) in ordered.enumerated() {
                positions[node] = CGPoint(
                    x: (width - rowWidth) / 2 + stepX * (CGFloat(column) + 0.5),
                    y: top + stepY * CGFloat(rowIndex)
                )
            }
        }

        var maxX = width
        var maxY = top + stepY * CGFloat(maxLevel) + 80
        for node in nodes {
            if let saved = savedPositions[node] {
                positions[node] = CGPoint(x: saved.x, y: saved.y)
            }
            if let point = positions[node] {
                let size = node.kind == .company ? companySize : personSize
                maxX = max(maxX, point.x + size.width / 2 + 40)
                maxY = max(maxY, point.y + size.height / 2 + 40)
            }
        }

        return StructureSnapshot(
            asOf: asOf,
            companies: companies,
            activeHoldings: activeHoldings,
            nodes: nodes,
            positions: positions,
            canvas: CGSize(width: maxX, height: maxY),
            totalsByCompany: totals
        )
    }
}
