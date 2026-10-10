import CoreGraphics
import Foundation

@main
enum StructureSnapshotRegression {
    static func main() {
        let today = Day(2026, 10, 9)
        let owner = NodeRef(kind: .person, id: "owner")
        let parent = Company(id: "parent", name: "Parent", jurisdiction: "HK", trackingSince: today)
        let alpha = Company(id: "alpha", name: "Alpha", jurisdiction: "SG", trackingSince: today)
        var beta = Company(id: "beta", name: "Beta", jurisdiction: "JP", trackingSince: today)
        beta.position = GraphPoint(x: 777, y: 333)
        let future = Company(id: "future", name: "Future", jurisdiction: "KY", incorporationDate: Day(2027, 1, 1), trackingSince: today)
        let dissolved = Company(id: "closed", name: "Closed", jurisdiction: "VG", status: .dissolved, trackingSince: today)

        let holdings = [
            Holding(id: "h0", holder: owner, companyID: parent.id, percent: 100, from: Day(2020, 1, 1)),
            Holding(id: "h1", holder: NodeRef(kind: .company, id: parent.id), companyID: alpha.id, percent: 60, from: Day(2021, 1, 1)),
            Holding(id: "h2", holder: NodeRef(kind: .company, id: parent.id), companyID: beta.id, percent: 100, from: Day(2022, 1, 1)),
            Holding(id: "expired", holder: owner, companyID: alpha.id, percent: 40, from: Day(2019, 1, 1), to: Day(2024, 1, 1)),
            Holding(id: "outside", holder: owner, companyID: "outside", percent: 100, from: Day(2018, 1, 1))
        ]

        let stops = StructureSnapshot.stops(
            holdings: holdings,
            companyIDs: [parent.id, alpha.id, beta.id],
            today: today
        )
        precondition(stops == [Day(2019, 12, 31), Day(2020, 12, 31), Day(2021, 12, 31), Day(2022, 12, 31), Day(2024, 12, 31), today])

        let companies = [parent, alpha, beta, future, dissolved]
        let companyRefs = companies.map { NodeRef(kind: .company, id: $0.id) }
        let names = Dictionary(uniqueKeysWithValues: zip(companyRefs, companies.map(\.name)))
            .merging([owner: "Owner"]) { first, _ in first }
        let saved = [NodeRef(kind: .company, id: beta.id): beta.position!]
        let snapshot = StructureSnapshot.build(
            companies: companies,
            holdings: holdings,
            scope: [parent.id, alpha.id, beta.id, future.id, dissolved.id],
            asOf: today,
            names: names,
            savedPositions: saved,
            companySize: CGSize(width: 280, height: 70),
            personSize: CGSize(width: 170, height: 56)
        )

        precondition(Set(snapshot.companies.map(\.id)) == [parent.id, alpha.id, beta.id])
        precondition(Set(snapshot.activeHoldings.map(\.id)) == ["h0", "h1", "h2"])
        precondition(snapshot.totalsByCompany[parent.id] == 100)
        precondition(snapshot.totalsByCompany[alpha.id] == 60)
        precondition(snapshot.positions[owner]!.y < snapshot.positions[NodeRef(kind: .company, id: parent.id)]!.y)
        precondition(snapshot.positions[NodeRef(kind: .company, id: parent.id)]!.y < snapshot.positions[NodeRef(kind: .company, id: alpha.id)]!.y)
        precondition(snapshot.positions[NodeRef(kind: .company, id: beta.id)] == CGPoint(x: 777, y: 333))

        var largeCompanies: [Company] = []
        var largeHoldings: [Holding] = []
        var largeNames: [NodeRef: String] = [owner: "Owner"]
        for index in 0..<60 {
            let id = "company-\(index)"
            let company = Company(id: id, name: "Company \(index)", jurisdiction: "HK", trackingSince: today)
            largeCompanies.append(company)
            let ref = NodeRef(kind: .company, id: id)
            largeNames[ref] = company.name
            let holder = index == 0 ? owner : NodeRef(kind: .company, id: "company-\((index - 1) / 2)")
            largeHoldings.append(Holding(id: "large-\(index)", holder: holder, companyID: id, percent: 100, from: Day(2020, 1, 1)))
        }
        let large = StructureSnapshot.build(
            companies: largeCompanies,
            holdings: largeHoldings,
            scope: nil,
            asOf: today,
            names: largeNames,
            savedPositions: [:],
            companySize: CGSize(width: 280, height: 70),
            personSize: CGSize(width: 170, height: 56)
        )
        precondition(large.companies.count == 60)
        precondition(large.nodes.count == 61)
        precondition(large.positions.count == 61)

        // 点选不再被另一节点的悬停覆盖。
        precondition(GraphInteraction.focus(selected: owner, hover: companyRefs[0]) == companyRefs[0])
        precondition(GraphInteraction.focus(selected: owner, hover: nil) == owner)
        precondition(GraphInteraction.focus(selected: nil, hover: owner) == owner)
        precondition(GraphInteraction.clamp(0.01) == 0.2 && GraphInteraction.clamp(10) == 3)
        let fullChain = GraphInteraction.chain(focus: owner, holdings: snapshot.activeHoldings)
        precondition(fullChain.edges == ["h0", "h1", "h2"])
        let nominee = NodeRef(kind: .person, id: "nominee")
        let nomineeHolding = Holding(id: "nominee", holder: nominee, companyID: beta.id, percent: 30, isNominee: true, beneficialOwner: owner)
        let beneficialChain = GraphInteraction.chain(focus: owner, holdings: snapshot.activeHoldings + [nomineeHolding])
        precondition(beneficialChain.edges.contains("nominee") && beneficialChain.nodes.contains(nominee))
        let upwardChain = GraphInteraction.chain(focus: NodeRef(kind: .company, id: beta.id), holdings: snapshot.activeHoldings + [nomineeHolding])
        precondition(upwardChain.nodes.contains(owner) && upwardChain.edges.contains("nominee"))
        // 先滚动，再围绕手指缩放；同一图坐标留在同一视口位置。
        let pinch = GraphInteraction.ZoomStart(scale: 0.5, offset: CGPoint(x: 200, y: 100), anchor: CGPoint(x: 150, y: 120))
        let offset = pinch.offset(at: 1, canvas: CGSize(width: 2000, height: 2000), viewport: CGSize(width: 500, height: 400))
        precondition(offset == CGPoint(x: 550, y: 320))
        precondition(pinch.offset(at: 0.2, canvas: CGSize(width: 2000, height: 2000), viewport: CGSize(width: 500, height: 400)) == .zero)
        func nodeSize(_ n: NodeRef) -> CGSize { n.kind == .company ? CGSize(width: 280, height: 70) : CGSize(width: 170, height: 56) }
        let originalRoutes = EdgeRouter.routes(holdings: snapshot.activeHoldings, positions: snapshot.positions, sizeOf: nodeSize)
        let reversedRoutes = EdgeRouter.routes(holdings: Array(snapshot.activeHoldings.reversed()), positions: snapshot.positions, sizeOf: nodeSize)
        for h in snapshot.activeHoldings {
            precondition(originalRoutes[h.id]!.points == reversedRoutes[h.id]!.points)
        }
        var movedPositions = snapshot.positions
        let target = NodeRef(kind: .company, id: alpha.id)
        movedPositions[target]!.x += 30
        let movedRoutes = EdgeRouter.routes(holdings: snapshot.activeHoldings, positions: movedPositions, sizeOf: nodeSize)
        precondition(movedRoutes["h1"]!.points.last!.x == movedPositions[target]!.x)
        precondition(movedRoutes["h1"]!.points.last!.y == movedPositions[target]!.y - 35)
        precondition(movedRoutes["h1"]!.points.last != originalRoutes["h1"]!.points.last)

        let start = ContinuousClock.now
        for _ in 0..<1_000 {
            _ = StructureSnapshot.build(
                companies: companies,
                holdings: holdings,
                scope: nil,
                asOf: today,
                names: names,
                savedPositions: saved,
                companySize: CGSize(width: 280, height: 70),
                personSize: CGSize(width: 170, height: 56)
            )
        }
        let smallDuration = start.duration(to: .now)
        let largeStart = ContinuousClock.now
        for _ in 0..<100 {
            _ = StructureSnapshot.build(
                companies: largeCompanies,
                holdings: largeHoldings,
                scope: nil,
                asOf: today,
                names: largeNames,
                savedPositions: [:],
                companySize: CGSize(width: 280, height: 70),
                personSize: CGSize(width: 170, height: 56)
            )
        }
        print("StructureSnapshot regression passed; 1,000 small rebuilds: \(smallDuration); 100 × 60-company rebuilds: \(largeStart.duration(to: .now))")
    }
}
