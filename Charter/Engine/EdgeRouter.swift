import SwiftUI

/// 正交连线（图坐标，与缩放无关）。
///
/// 规则（参考 yFiles 正交路由的最小线距原则）：
/// - 只有**同一个股东**发出的线可以合并成一条主干（总线）；不同股东的线段之间至少保持 `laneGap` 距离，绝不重合。
/// - 每个股东在每一排目标公司上方有自己的横向轨道；横向区间重叠的不同股东分到不同高度。
/// - 同一家公司有多个股东时，入口沿卡片上沿错开，各自有一段独立的竖线进入。
/// - 直下会穿过其他节点或别的股东的竖线时，改走列间缝隙，缝隙里的竖线也按股东分车道。
enum EdgeRouter {
    struct Route {
        var points: [CGPoint]
        var label: CGPoint
        var curved = false
    }

    static let laneGap: CGFloat = 9
    /// 入口竖线最短长度：留出比例标签的位置。
    static let entryLength: CGFloat = 34
    /// 同一列（或同一行）上不同股东的线段首尾之间至少留这么长，否则看起来像一条线。
    static let endGap: CGFloat = 24

    private struct Segment {
        let source: NodeRef
        let vertical: Bool
        let at: CGFloat
        let lo: CGFloat
        let hi: CGFloat
    }

    static func routes(holdings: [Holding], positions: [NodeRef: CGPoint], sizeOf: (NodeRef) -> CGSize) -> [String: Route] {
        var rects: [NodeRef: CGRect] = [:]
        for (n, p) in positions {
            let s = sizeOf(n)
            rects[n] = CGRect(x: p.x - s.width / 2, y: p.y - s.height / 2, width: s.width, height: s.height)
        }
        let valid = holdings
            .filter { rects[$0.holder] != nil && rects[NodeRef(kind: .company, id: $0.companyID)] != nil }
            .sorted { $0.id < $1.id }
        func target(_ h: Holding) -> NodeRef { NodeRef(kind: .company, id: h.companyID) }

        // 1. 入口位置：同一目标的股东按左右顺序沿上沿错开
        var entryX: [String: CGFloat] = [:]
        for (_, hs) in Dictionary(grouping: valid, by: \.companyID) {
            let bRect = rects[target(hs[0])]!
            let sorted = hs.sorted {
                let a = rects[$0.holder]!.midX, b = rects[$1.holder]!.midX
                return a == b ? $0.id < $1.id : a < b
            }
            let n = sorted.count
            let spacing = n > 1 ? min(64, (bRect.width - 60) / CGFloat(n - 1)) : 0
            for (k, h) in sorted.enumerated() {
                entryX[h.id] = bRect.midX + (CGFloat(k) - CGFloat(n - 1) / 2) * spacing
            }
        }

        // 2. 横向轨道：按目标所在的“排”分组；同一排里横向区间重叠的不同股东分到不同高度
        func bandKey(_ h: Holding) -> Int { Int((rects[target(h)]!.minY / 24).rounded()) }
        var trackY: [String: CGFloat] = [:]            // holding id → 横线高度
        for (_, hs) in Dictionary(grouping: valid, by: bandKey) {
            let bandTop = hs.map { rects[target($0)]!.minY }.min()!
            let bySource = Dictionary(grouping: hs, by: \.holder)
            let intervals: [(source: NodeRef, lo: CGFloat, hi: CGFloat)] = bySource.map { source, edges in
                let xs = edges.map { entryX[$0.id]! } + [rects[source]!.midX]
                return (source, xs.min()! - 44, xs.max()! + 44)
            }
            .sorted { $0.lo == $1.lo ? key($0.source) < key($1.source) : $0.lo < $1.lo }
            var trackEnds: [CGFloat] = []
            var trackOf: [NodeRef: Int] = [:]
            for iv in intervals {
                if let t = trackEnds.firstIndex(where: { $0 + laneGap < iv.lo }) {
                    trackOf[iv.source] = t
                    trackEnds[t] = iv.hi
                } else {
                    trackOf[iv.source] = trackEnds.count
                    trackEnds.append(iv.hi)
                }
            }
            for h in hs {
                let y = bandTop - entryLength - CGFloat(trackOf[h.holder] ?? 0) * laneGap
                trackY[h.id] = max(y, rects[h.holder]!.maxY + 12)
            }
        }

        // 3. 预留每条线的入口竖线
        var segments: [Segment] = valid.map { h in
            let y2 = rects[target(h)]!.minY
            return Segment(source: h.holder, vertical: true, at: entryX[h.id]!, lo: trackY[h.id] ?? y2 - entryLength, hi: y2)
        }

        func obstacles(excluding a: NodeRef, _ b: NodeRef) -> [CGRect] {
            rects.filter { $0.key != a && $0.key != b }.map { $0.value.insetBy(dx: -10, dy: -8) }
        }
        func vFree(_ x: CGFloat, _ ya: CGFloat, _ yb: CGFloat, _ source: NodeRef, _ obs: [CGRect]) -> Bool {
            let lo = min(ya, yb), hi = max(ya, yb)
            if obs.contains(where: { $0.minX < x && x < $0.maxX && $0.minY < hi && lo < $0.maxY }) { return false }
            return !segments.contains { s in
                s.vertical && s.source != source && abs(s.at - x) < laneGap - 1 && s.lo < hi + endGap && lo - endGap < s.hi
            }
        }
        func hFree(_ y: CGFloat, _ xa: CGFloat, _ xb: CGFloat, _ source: NodeRef, _ obs: [CGRect]) -> Bool {
            let lo = min(xa, xb), hi = max(xa, xb)
            if obs.contains(where: { $0.minY < y && y < $0.maxY && $0.minX < hi && lo < $0.maxX }) { return false }
            return !segments.contains { s in
                !s.vertical && s.source != source && abs(s.at - y) < laneGap - 1 && s.lo < hi + endGap && lo - endGap < s.hi
            }
        }
        func register(_ pts: [CGPoint], _ source: NodeRef) {
            for i in 1..<pts.count {
                let a = pts[i - 1], b = pts[i]
                if abs(a.x - b.x) < 0.5 {
                    segments.append(Segment(source: source, vertical: true, at: a.x, lo: min(a.y, b.y), hi: max(a.y, b.y)))
                } else if abs(a.y - b.y) < 0.5 {
                    segments.append(Segment(source: source, vertical: false, at: a.y, lo: min(a.x, b.x), hi: max(a.x, b.x)))
                }
            }
        }

        // 4. 按股东逐个布线（上排先、左边先，结果稳定）
        var out: [String: Route] = [:]
        let sources = Dictionary(grouping: valid, by: \.holder)
            .sorted { lhs, rhs in
                let a = rects[lhs.key]!, b = rects[rhs.key]!
                return a.minY == b.minY ? (a.midX == b.midX ? key(lhs.key) < key(rhs.key) : a.midX < b.midX) : a.minY < b.minY
            }
        for (source, edges) in sources {
            let aRect = rects[source]!
            let y1 = aRect.maxY
            let ordered = edges.sorted { (trackY[$0.id] ?? 0, entryX[$0.id] ?? 0) < (trackY[$1.id] ?? 0, entryX[$1.id] ?? 0) }

            // 主干竖线：优先在卡片中线，被别的股东占用时左右平移一个车道
            let deepest = ordered.compactMap { trackY[$0.id] }.max() ?? y1 + 20
            let shifts: [CGFloat] = [0, 1, -1, 2, -2, 3, -3].map { $0 * laneGap * 1.5 }
            let dropObs = obstacles(excluding: source, source)
            let dropX = shifts.map { aRect.midX + $0 }
                .first { vFree($0, y1, deepest, source, dropObs) } ?? aRect.midX

            for h in ordered {
                let bRef = target(h)
                let bRect = rects[bRef]!
                let ex = entryX[h.id]!, y2 = bRect.minY
                let labelPt = CGPoint(x: ex, y: y2 - 15)
                guard let yT = trackY[h.id], y2 - y1 > entryLength + 10 else {
                    let pts = [CGPoint(x: aRect.midX, y: y1), CGPoint(x: ex, y: y2)]
                    out[h.id] = Route(points: pts, label: labelPt, curved: true)
                    continue
                }
                let obs = obstacles(excluding: source, bRef)
                var pts: [CGPoint]
                if vFree(dropX, y1, yT, source, obs) && hFree(yT, dropX, ex, source, obs) {
                    pts = [CGPoint(x: dropX, y: y1), CGPoint(x: dropX, y: yT), CGPoint(x: ex, y: yT), CGPoint(x: ex, y: y2)]
                } else {
                    // 绕行：先在源卡片下方横向到列间缝隙，再下到目标排的轨道
                    let yA = y1 + 16
                    var candidates: [CGFloat] = []
                    for r in obs {
                        for k in 0..<4 {
                            candidates.append(r.minX - 4 - CGFloat(k) * laneGap)
                            candidates.append(r.maxX + 4 + CGFloat(k) * laneGap)
                        }
                    }
                    let best = candidates
                        .filter { gx in
                            hFree(yA, dropX, gx, source, obs) && vFree(gx, yA, yT, source, obs) && hFree(yT, gx, ex, source, obs)
                        }
                        .min { abs($0 - dropX) + abs($0 - ex) < abs($1 - dropX) + abs($1 - ex) }
                    if let gx = best {
                        pts = [CGPoint(x: dropX, y: y1), CGPoint(x: dropX, y: yA), CGPoint(x: gx, y: yA),
                               CGPoint(x: gx, y: yT), CGPoint(x: ex, y: yT), CGPoint(x: ex, y: y2)]
                    } else {
                        pts = [CGPoint(x: dropX, y: y1), CGPoint(x: dropX, y: yT), CGPoint(x: ex, y: yT), CGPoint(x: ex, y: y2)]
                    }
                }
                register(pts, source)
                out[h.id] = Route(points: pts, label: labelPt)
            }
        }
        return out
    }

    private static func key(_ n: NodeRef) -> String { "\(n.kind)-\(n.id)" }

    /// 折线转圆角路径。
    static func path(_ route: Route, radius: CGFloat = 12) -> Path {
        var path = Path()
        var pts: [CGPoint] = []
        for p in route.points where pts.last.map({ abs($0.x - p.x) > 0.5 || abs($0.y - p.y) > 0.5 }) ?? true { pts.append(p) }
        // 去掉共线的中间点
        var k = 1
        while k < pts.count - 1 {
            let a = pts[k - 1], m = pts[k], c = pts[k + 1]
            if abs((m.x - a.x) * (c.y - a.y) - (m.y - a.y) * (c.x - a.x)) < 0.5 { pts.remove(at: k) } else { k += 1 }
        }
        guard let first = pts.first, let last = pts.last, pts.count >= 2 else { return path }
        path.move(to: first)
        if route.curved {
            path.addCurve(to: last, control1: CGPoint(x: first.x, y: (first.y + last.y) / 2),
                          control2: CGPoint(x: last.x, y: (first.y + last.y) / 2))
            return path
        }
        func dist(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x - b.x, a.y - b.y) }
        for i in 1..<(pts.count - 1) {
            let r = min(radius, dist(pts[i - 1], pts[i]) / 2, dist(pts[i], pts[i + 1]) / 2)
            if r < 1 { path.addLine(to: pts[i]) } else { path.addArc(tangent1End: pts[i], tangent2End: pts[i + 1], radius: r) }
        }
        path.addLine(to: last)
        return path
    }
}
