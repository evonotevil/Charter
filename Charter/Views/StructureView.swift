import SwiftUI
import AppKit
import Charts

struct StructureView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var stopIndex: Int?
    @State private var stops: [Day] = []
    @State private var snapshot: StructureSnapshot?
    @State private var routes: [String: EdgeRouter.Route] = [:]
    @State private var hover: NodeRef?
    @State private var selected: NodeRef?
    @State private var drag: [NodeRef: CGSize] = [:]
    /// 0 表示“适合窗口”；其他值是用户手动选的缩放，记在本机。
    @AppStorage("structure.zoom") private var savedZoom: Double = 0
    @State private var playing = false
    @State private var playbackTask: Task<Void, Never>?
    @State private var graphScroll = ScrollPosition(x: 0, y: 0)
    @State private var scrollOffset: CGPoint = .zero
    @State private var pinchStart: GraphInteraction.ZoomStart?
    @State private var viewport: CGSize = CGSize(width: 900, height: 600)
    /// 当前显示哪个集团（一个集团一张图）。nil 表示全部公司。
    @State private var graphGroup: String?
    @State private var didInit = false

    static let companySize = CGSize(width: 280, height: 70)
    static let personSize = CGSize(width: 170, height: 56)

    // MARK: 时间点

    private var asOf: Day {
        guard !stops.isEmpty else { return store.today }
        return stops[min(stopIndex ?? stops.count - 1, stops.count - 1)]
    }
    private var isToday: Bool { (snapshot?.asOf ?? asOf) == store.today }

    private func size(_ r: NodeRef) -> CGSize { r.kind == .company ? Self.companySize : Self.personSize }

    /// 适合窗口的缩放比例。
    private func fitZoom(_ canvas: CGSize) -> CGFloat {
        let z = min((viewport.width - 24) / canvas.width, (viewport.height - 24) / canvas.height, 1.2)
        return GraphInteraction.clamp(z)
    }

    private func zoom(_ canvas: CGSize) -> CGFloat { savedZoom > 0 ? CGFloat(savedZoom) : fitZoom(canvas) }

    /// 代持线上直接写明“代谁持有”。
    private func nomineeLabel(_ h: Holding) -> String {
        guard h.isNominee else { return Ownership.percentLabel(h.percent) }
        let who = h.beneficialOwner.map { store.name(of: $0) } ?? "他人"
        return "\(store.name(of: h.holder))代\(who)持有 \(Ownership.percentLabel(h.percent))"
    }

    private struct EdgeLabel: Identifiable {
        var id: String
        var text: String
        var x: CGFloat
        var y: CGFloat
        var width: CGFloat
        var hot: Bool
        var nominee: Bool
    }

    /// 比例标签：放在进入被持股公司前的空档里，同一行内互相避让，不重叠。
    private func edgeLabels(_ routes: [String: EdgeRouter.Route], hot: Set<String>, holdings: [Holding]) -> [EdgeLabel] {
        func estWidth(_ t: String) -> CGFloat {
            min(Self.companySize.width - 10,
                t.unicodeScalars.reduce(CGFloat(28)) { $0 + ($1.value > 0x2E80 ? 12 : 8.5) })
        }
        var labels: [EdgeLabel] = holdings.compactMap { h in
            guard let route = routes[h.id] else { return nil }
            let text = nomineeLabel(h)
            return EdgeLabel(id: h.id, text: text, x: route.label.x, y: route.label.y,
                             width: estWidth(text), hot: hot.contains(h.id), nominee: h.isNominee)
        }
        let rows = Dictionary(grouping: labels.indices) { Int((labels[$0].y / 8).rounded()) }
        for (_, idx) in rows {
            let sorted = idx.sorted { labels[$0].x < labels[$1].x }
            for k in 1..<max(sorted.count, 1) where sorted.count > 1 {
                let prev = labels[sorted[k - 1]], cur = labels[sorted[k]]
                let minX = prev.x + prev.width / 2 + 6 + cur.width / 2
                if cur.x < minX { labels[sorted[k]].x = minX }
            }
        }
        return labels
    }

    private func pt(_ n: NodeRef, _ base: [NodeRef: CGPoint]) -> CGPoint {
        let p = base[n] ?? .zero
        let d = drag[n] ?? .zero
        return CGPoint(x: p.x + d.width, y: p.y + d.height)
    }

    // MARK: 控制链

    /// 悬停优先：鼠标在哪就临时预览哪条链路；移开后回到点选的链路。右侧详情始终显示点选的对象。
    private var focus: NodeRef? { GraphInteraction.focus(selected: selected, hover: hover) }

    private func chain(in snapshot: StructureSnapshot) -> (nodes: Set<NodeRef>, edges: Set<String>) {
        GraphInteraction.chain(focus: focus, holdings: snapshot.activeHoldings)
    }

    // MARK: 视图

    var body: some View {
        let canvas = snapshot?.canvas ?? CGSize(width: 900, height: 600)
        let z = zoom(canvas)
        HStack(spacing: 0) {
            Group {
                if let snapshot {
                    graph(snapshot, zoom: z)
                } else {
                    ProgressView("正在整理股权结构…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) { title }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                timeScrubber.padding(.vertical, 12).frame(maxWidth: .infinity)
            }

            if let selected {
                // 分隔线画在详情栏自己的背景里，和背景一起延伸到工具栏下面，顶部不留缺口
                inspector(selected)
                    .frame(width: 340)
                    .transition(reduceMotion ? .opacity : .move(edge: .trailing).combined(with: .opacity))
            }
        }
        .navigationTitle("股权结构")
        .toolbar {
            ToolbarItemGroup {
                ControlGroup {
                    Button { animate(.smooth) { savedZoom = Double(GraphInteraction.clamp(z - 0.1)) } } label: { Image(systemName: "minus") }
                        .help("缩小")
                    Button { animate(.smooth) { savedZoom = 0; graphScroll.scrollTo(x: 0, y: 0) } } label: {
                        Text(savedZoom == 0 ? "适合窗口" : "\(Int(z * 100))%").monospacedDigit()
                    }
                    .help("适合窗口")
                    Button { animate(.smooth) { savedZoom = Double(GraphInteraction.clamp(z + 0.1)) } } label: { Image(systemName: "plus") }
                        .help("放大")
                }
                Button {
                    router.sheet = .chainQuery(from: selected?.kind == .person ? selected : nil, to: selected?.kind == .company ? selected?.id : nil)
                } label: { Label("查询链条", systemImage: "arrow.triangle.branch") }
                    .help("查询某人或某公司到目标公司之间的持股路径")
                Button { resetLayout() } label: { Label("重新排列", systemImage: "rectangle.3.group") }
                    .help("清除拖动过的位置，按层级自动排列")
            }
        }
        .onAppear {
            guard !didInit else { return }
            didInit = true
            graphGroup = router.groupFilter
            rebuildTimeline()
        }
        .onChange(of: router.groupFilter) {
            guard graphGroup != router.groupFilter else { return }
            graphGroup = router.groupFilter
        }
        .onChange(of: graphGroup) {
            if router.groupFilter != graphGroup { router.groupFilter = graphGroup }
            stopIndex = nil
            rebuildTimeline()
        }
        .onChange(of: stopIndex) { rebuildSnapshot() }
        .onChange(of: store.companies) { rebuildTimeline(preservingSelection: true) }
        .onChange(of: store.people) { rebuildSnapshot() }
        .onChange(of: store.holdings) { rebuildTimeline(preservingSelection: true) }
        .onChange(of: store.corporateGroups) { rebuildTimeline(preservingSelection: true) }
        .onChange(of: store.today) { rebuildTimeline(preservingSelection: true) }
        .onDisappear { stopPlayback() }
    }

    private func graph(_ snapshot: StructureSnapshot, zoom z: CGFloat) -> some View {
        let ch = chain(in: snapshot)
        let focused = focus != nil
        // 不再整体 scaleEffect：macOS 的悬停与点击区域不跟随缩放变换，会和看到的位置错开。
        // 这里把所有坐标乘以缩放比例，每个元素在自己的位置上缩放，悬停与点击区域和画面一致。
        func sp(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x * z, y: p.y * z) }
        return ScrollView([.horizontal, .vertical]) {
            ZStack(alignment: .topLeading) {
                Color.clear.contentShape(.rect).onTapGesture { animate(.smooth) { selected = nil } }
                EdgesLayer(holdings: snapshot.activeHoldings, routes: routes, hot: ch.edges, focused: focused, zoom: z)
                ForEach(edgeLabels(routes, hot: ch.edges, holdings: snapshot.activeHoldings)) { l in
                    Text(l.text)
                        .font(TypeStyle.micro).fontWeight(.semibold).monospacedDigit()
                        .lineLimit(1).truncationMode(.tail)
                        .padding(.horizontal, 9).frame(width: l.width, height: 22)
                        .background(l.hot ? (l.nominee ? Theme.amber : Theme.lime) : (l.nominee ? Theme.amberSoft : Theme.surface), in: .capsule)
                        .foregroundStyle(l.hot ? Theme.onLime : (l.nominee ? Theme.amberText : Theme.ink))
                        .overlay(Capsule().strokeBorder(l.hot ? Theme.onLime.opacity(0.25) : Theme.hairline, lineWidth: 1))
                        .opacity(focused && !l.hot ? 0.3 : 1)
                        .scaleEffect(z)
                        .position(sp(CGPoint(x: l.x, y: l.y)))
                        .help(l.text)
                        .accessibilityLabel(l.text)
                        .allowsHitTesting(false)
                }
                ForEach(snapshot.companies.filter { (snapshot.totalsByCompany[$0.id] ?? 0) < 99.5 }) { c in
                    let total = snapshot.totalsByCompany[c.id] ?? 0
                    let p = pt(NodeRef(kind: .company, id: c.id), snapshot.positions)
                    Text(total == 0 ? "股东未录入" : "另有 \(Ownership.percentLabel(100 - total)) 股东未录入")
                        .font(TypeStyle.micro).fontWeight(.semibold)
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 9).frame(height: 22)
                        .overlay(Capsule().strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [3, 3])).foregroundStyle(Theme.muted.opacity(0.6)))
                        .scaleEffect(z)
                        // 放在节点下方右侧，不和上方的持股比例标签挤在一起
                        .position(sp(CGPoint(x: p.x + 70, y: p.y + Self.companySize.height / 2 + 14)))
                        .opacity(focused ? 0.3 : 1)
                        .allowsHitTesting(false)
                }
                ForEach(snapshot.nodes, id: \.self) { n in
                    let s = size(n)
                    NodeView(ref: n, highlighted: ch.nodes.contains(n) && focused, selected: selected == n,
                             dimmed: focused && !ch.nodes.contains(n), showNext: isToday && (hover == n || selected == n),
                             showAlerts: isToday)
                        .scaleEffect(z)
                        .frame(width: s.width * z, height: s.height * z)
                        .contentShape(n.kind == .company ? AnyShape(RoundedRectangle(cornerRadius: 22 * z)) : AnyShape(Capsule()))
                        .onHover { h in
                            if h { hover = n } else if hover == n { hover = nil }
                        }
                        .position(sp(pt(n, snapshot.positions)))
                        .focusable()
                        .onKeyPress(.return) {
                            select(n)
                            return .handled
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(store.name(of: n))
                        .accessibilityValue(accessibilityValue(for: n, in: snapshot))
                        .accessibilityAddTraits(selected == n ? [.isButton, .isSelected] : .isButton)
                        .accessibilityAction { select(n) }
                        .accessibilityAction(named: n.kind == .company ? "打开公司档案" : "打开人员档案") {
                            if n.kind == .company { router.open(company: n.id) } else { router.open(person: n.id) }
                        }
                        // 一个手势同时处理点选和拖动：移动不到 4 点算点击
                        .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
                            .onChanged { v in
                                if hypot(v.translation.width, v.translation.height) >= 4 {
                                    updateDrag(n, translation: v.translation, zoom: z, snapshot: snapshot)
                                }
                            }
                            .onEnded { v in
                                if hypot(v.translation.width, v.translation.height) < 4 {
                                    select(n)
                                } else {
                                    let base = snapshot.positions[n] ?? .zero
                                    save(n, GraphPoint(x: base.x + v.translation.width / z, y: base.y + v.translation.height / z))
                                }
                                drag[n] = nil
                            })
                        .transition(.opacity)
                }
            }
            .frame(width: snapshot.canvas.width * z, height: snapshot.canvas.height * z, alignment: .topLeading)
            .frame(minWidth: viewport.width, minHeight: viewport.height, alignment: .topLeading)
        }
        .scrollPosition($graphScroll)
        .onScrollGeometryChange(for: CGPoint.self) { $0.contentOffset } action: { _, offset in
            scrollOffset = offset
        }
        .simultaneousGesture(MagnifyGesture(minimumScaleDelta: 0.005)
            .onChanged { value in
                if pinchStart == nil {
                    pinchStart = GraphInteraction.ZoomStart(scale: z, offset: scrollOffset,
                                                          anchor: value.startLocation)
                }
                guard let start = pinchStart else { return }
                let next = GraphInteraction.clamp(start.scale * value.magnification)
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    savedZoom = Double(next)
                    graphScroll.scrollTo(point: start.offset(at: next, canvas: snapshot.canvas, viewport: viewport))
                }
            }
            .onEnded { _ in pinchStart = nil })
        .background(DotGrid())
        .onGeometryChange(for: CGSize.self) { $0.size } action: { size in
            viewport = size
            // 详情栏打开或窗口变窄后，选中的节点仍要完整可见
            if let selected { reveal(selected) }
        }
        .task(id: selected) {
            // 详情栏已打开时视口不变，不会触发上面的回调；等出现动画结束后再检查
            guard let node = selected else { return }
            try? await Task.sleep(for: .milliseconds(320))
            if selected == node { reveal(node) }
        }
    }

    private func inspector(_ ref: NodeRef) -> some View {
        InspectorPanel(ref: ref, asOf: snapshot?.asOf ?? asOf)
            .overlay(alignment: .topTrailing) {
                InspectorCloseButton { animate(.snappy) { selected = nil } }
                    .padding(14)
            }
            // 背景和左侧细线一直延伸到窗口顶部（工具栏下面），和左边的画布齐平，不出现台阶
            .background {
                Theme.surface
                    .overlay(alignment: .leading) { Rectangle().fill(Theme.hairline).frame(width: 1) }
                    .ignoresSafeArea(.container, edges: .top)
            }
    }

    private var title: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(store.filterName(graphGroup)).font(TypeStyle.pageTitle).tracking(-0.5)
                    .lineLimit(1).truncationMode(.tail)
                Text("\(snapshot?.companies.count ?? 0) 家公司")
                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted).monospacedDigit()
                Spacer(minLength: 0)
            }
            .help("打开侧栏可切换集团")
            Group {
                if isToday {
                    Text("双指捏合缩放，双指滑动浏览。点选固定链路，拖动调整位置。").foregroundStyle(Theme.muted)
                } else {
                    Text("历史视图：\(String(asOf.year)) 年末的持股。不显示当前的截止日和文件提醒。")
                        .foregroundStyle(Theme.amberText).fontWeight(.medium)
                }
            }
            .font(TypeStyle.body)
        }
        .padding(.horizontal, 24).padding(.top, 24).padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var timeScrubber: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 4) {
                Button { play() } label: {
                    Image(systemName: playing ? "pause.fill" : "play.fill")
                        .font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.onInk)
                        .frame(width: 36, height: 36).background(Theme.ink, in: .circle)
                }
                .buttonStyle(.plain)
                .help(playing ? "暂停" : "回放结构变化")
                .accessibilityLabel(playing ? "暂停结构回放" : "回放结构变化")
                ForEach(Array(stops.enumerated()), id: \.offset) { i, d in
                    let on = d == asOf
                    Button {
                        stopPlayback()
                        stopIndex = i
                    } label: {
                        Text(verbatim: d == store.today ? "今天" : String(d.year))
                            .font(TypeStyle.body).fontWeight(on ? .bold : .medium).monospacedDigit()
                            .foregroundStyle(on ? .primary : .secondary)
                            .frame(width: 62, height: 36)
                            .background {
                                if on {
                                    Capsule().fill(.background).shadow(color: .black.opacity(0.18), radius: 6, y: 3)
                                }
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(d == store.today ? "今天" : "\(d.year) 年末")
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(6)
            .floatingGlass(cornerRadius: 26)
            .padding(.horizontal, 12)
        }
        .scrollIndicators(.never)
    }

    private func play() {
        if playing { stopPlayback(); return }
        playbackTask?.cancel()
        playing = true
        let indices = stops.indices
        playbackTask = Task { @MainActor in
            for i in indices {
                guard playing, !Task.isCancelled else { return }
                stopIndex = i
                do {
                    try await Task.sleep(for: .seconds(1.4))
                } catch {
                    return
                }
            }
            playing = false
            playbackTask = nil
        }
    }

    private func stopPlayback() {
        playing = false
        playbackTask?.cancel()
        playbackTask = nil
    }

    private func save(_ n: NodeRef, _ p: GraphPoint) {
        switch n.kind {
        case .company:
            if var c = store.company(n.id) { c.position = p; store.upsert(c) }
        case .person:
            if var x = store.person(n.id) { x.position = p; store.upsert(x) }
        }
    }

    private func resetLayout() {
        for n in snapshot?.nodes ?? [] {
            switch n.kind {
            case .company: if let i = store.companies.firstIndex(where: { $0.id == n.id }) { store.companies[i].position = nil }
            case .person: if let i = store.people.firstIndex(where: { $0.id == n.id }) { store.people[i].position = nil }
            }
        }
        store.saveCompanies()
        store.savePeople()
        rebuildSnapshot()
    }

    private func rebuildTimeline(preservingSelection: Bool = false) {
        stopPlayback()
        let previous = preservingSelection ? snapshot?.asOf : nil
        let ids = store.companyIDs(forFilter: graphGroup) ?? Set(store.companies.map(\.id))
        stops = StructureSnapshot.stops(holdings: store.holdings, companyIDs: ids, today: store.today)
        if let previous, let index = stops.firstIndex(of: previous) {
            stopIndex = index
        } else {
            stopIndex = nil
        }
        rebuildSnapshot()
    }

    private func rebuildSnapshot() {
        let day = asOf
        let scope = store.companyIDs(forFilter: graphGroup, on: day)
        var names: [NodeRef: String] = [:]
        var saved: [NodeRef: GraphPoint] = [:]
        for company in store.companies {
            let ref = NodeRef(kind: .company, id: company.id)
            names[ref] = company.name
            saved[ref] = company.position
        }
        for person in store.people {
            let ref = NodeRef(kind: .person, id: person.id)
            names[ref] = person.name
            saved[ref] = person.position
        }
        let next = StructureSnapshot.build(
            companies: store.companies,
            holdings: store.holdings,
            scope: scope,
            asOf: day,
            names: names,
            savedPositions: saved,
            companySize: Self.companySize,
            personSize: Self.personSize
        )
        let nextRoutes = EdgeRouter.routes(holdings: next.activeHoldings, positions: next.positions, sizeOf: size)
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            snapshot = next
            routes = nextRoutes
            drag = [:]
            if let selected, !next.nodes.contains(selected) { self.selected = nil }
            if let hover, !next.nodes.contains(hover) { self.hover = nil }
        }
    }

    private func updateDrag(_ node: NodeRef, translation: CGSize, zoom: CGFloat, snapshot: StructureSnapshot) {
        let offset = CGSize(width: translation.width / zoom, height: translation.height / zoom)
        drag[node] = offset
        var positions = snapshot.positions
        if let base = positions[node] {
            positions[node] = CGPoint(x: base.x + offset.width, y: base.y + offset.height)
        }
        // 入口槽位和横线层级属于整张图；仅用相连关系重算会改变槽位，导致拖动时跳线。
        routes = EdgeRouter.routes(holdings: snapshot.activeHoldings, positions: positions, sizeOf: size)
    }

    private func select(_ node: NodeRef) {
        animate(.snappy(duration: 0.22)) { selected = node }
    }

    /// 详情栏打开后视口变窄；等新的视口尺寸到来，再把选中节点平滑滚到可见区。
    private func reveal(_ node: NodeRef) {
        guard let snapshot, let p = snapshot.positions[node] else { return }
        let z = zoom(snapshot.canvas)
        let s = size(node)
        let frame = CGRect(x: (p.x - s.width / 2) * z, y: (p.y - s.height / 2) * z, width: s.width * z, height: s.height * z)
        let visible = CGRect(origin: scrollOffset, size: viewport).insetBy(dx: 24, dy: 24)
        guard !visible.contains(frame) else { return }
        let maxX = max(0, snapshot.canvas.width * z - viewport.width)
        let maxY = max(0, snapshot.canvas.height * z - viewport.height)
        var target = scrollOffset
        if frame.minX < visible.minX || frame.maxX > visible.maxX { target.x = min(max(0, frame.midX - viewport.width / 2), maxX) }
        if frame.minY < visible.minY || frame.maxY > visible.maxY { target.y = min(max(0, frame.midY - viewport.height / 2), maxY) }
        animate(.smooth(duration: 0.3)) { graphScroll.scrollTo(point: target) }
    }

    private func accessibilityValue(for node: NodeRef, in snapshot: StructureSnapshot) -> String {
        switch node.kind {
        case .company:
            let total = snapshot.totalsByCompany[node.id] ?? 0
            if total < 0.005 { return "公司，股东未录入" }
            if total < 99.5 { return "公司，已录入 \(Ownership.percentLabel(total)) 持股" }
            return "公司，持股已完整录入"
        case .person:
            let count = snapshot.activeHoldings.filter { $0.holder == node }.count
            return "人员，直接持有 \(count) 家公司"
        }
    }

    private func animate(_ animation: Animation, changes: () -> Void) {
        if reduceMotion {
            changes()
        } else {
            withAnimation(animation) { changes() }
        }
    }
}

// MARK: - 连线

struct EdgesLayer: View {
    var holdings: [Holding]
    var routes: [String: EdgeRouter.Route]
    var hot: Set<String>
    /// 有悬停或点选时，链路外的线退到背景。
    var focused: Bool
    var zoom: CGFloat

    var body: some View {
        // 路由在图坐标里；这里按缩放把路径变换到屏幕坐标，线宽保持屏幕上的固定粗细。
        Canvas { ctx, _ in
            let transform = CGAffineTransform(scaleX: zoom, y: zoom)
            func path(_ h: Holding) -> Path? { routes[h.id].map { EdgeRouter.path($0).applying(transform) } }

            // 1. 链路外的线：默认清晰；有焦点时退到背景
            for h in holdings where !hot.contains(h.id) {
                guard let p = path(h) else { continue }
                let color: Color = h.isNominee ? Theme.amber : Theme.edge
                ctx.stroke(p, with: .color(color.opacity(focused ? 0.22 : 1)),
                           style: StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round, dash: h.isNominee ? [6, 4] : []))
            }
            // 2. 链路：柠檬绿底衬 + 深色主线（像荧光笔划过），代持保持琥珀虚线
            let chain = holdings.filter { hot.contains($0.id) }
            for h in chain {
                guard let p = path(h) else { continue }
                ctx.stroke(p, with: .color(Theme.lime.opacity(0.85)), style: StrokeStyle(lineWidth: 8, lineCap: .round, lineJoin: .round))
            }
            for h in chain {
                guard let p = path(h) else { continue }
                ctx.stroke(p, with: .color(h.isNominee ? Theme.amberText : Theme.onLime),
                           style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: h.isNominee ? [6, 4] : []))
            }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - 节点

struct NodeView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var ref: NodeRef
    var highlighted: Bool
    var selected: Bool
    var dimmed: Bool
    var showNext: Bool
    var showAlerts = true

    var body: some View {
        Group {
            switch ref.kind {
            case .company: companyNode
            case .person: personNode
            }
        }
        .opacity(dimmed ? 0.4 : 1)
        .saturation(dimmed ? 0.2 : 1)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: highlighted)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: selected)
    }

    private var companyNode: some View {
        let c = store.company(ref.id)
        let next = store.complianceOn ? store.openObligations.first { $0.company.id == ref.id } : nil
        let alert = showAlerts && store.ownedDocuments(of: ref).contains { store.freshness($0).needsAttention }
        let companyName = c?.name ?? ""
        let detail: String
        let detailNeedsAttention: Bool
        if showNext, let next {
            let left = next.daysLeft(from: store.today)
            detail = left < 0 ? "逾期 \(-left) 天：\(next.rule.name)" : "\(left) 天后：\(next.rule.name)"
            detailNeedsAttention = false
        } else if alert {
            detail = "有文件需要更新"
            detailNeedsAttention = true
        } else {
            detail = [c?.registrationNumber ?? "", c?.incorporationDate?.description ?? ""]
                .filter { !$0.isEmpty }.joined(separator: "  ").ifEmpty(store.jurisdictionName(c?.jurisdiction ?? ""))
            detailNeedsAttention = false
        }
        return HStack(spacing: 12) {
            JurisdictionBadge(code: c?.jurisdiction ?? "?", size: 42, highlighted: highlighted)
            VStack(alignment: .leading, spacing: 0) {
                Text(companyName)
                    .font(TypeStyle.rowTitle)
                    .lineLimit(2).truncationMode(.tail)
                    .layoutPriority(1)
                Text(detail)
                    .font(TypeStyle.metadata)
                    .fontWeight(detailNeedsAttention ? .semibold : .regular)
                    .foregroundStyle(detailNeedsAttention ? Theme.amberText : Color.secondary)
                    .lineLimit(1).truncationMode(.tail)
                    .monospacedDigit()
                    .contentTransition(.opacity)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .frame(width: StructureView.companySize.width, height: StructureView.companySize.height)
        .background(Theme.surface, in: .rect(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(selected ? Theme.ink : (highlighted ? Theme.onLime.opacity(0.7) : Theme.hairline), lineWidth: selected || highlighted ? 2 : 1))
        .background(RoundedRectangle(cornerRadius: 26).fill(Theme.lime).padding(-4).opacity(highlighted || selected ? 1 : 0))
        .shadow(color: .black.opacity(selected ? 0.16 : 0.06), radius: selected ? 16 : 8, y: selected ? 8 : 3)
    }

    private var personNode: some View {
        let p = store.person(ref.id)
        let personName = p?.name ?? ""
        let nominee = store.holdings.contains { $0.holder == ref && $0.isNominee }
        return HStack(spacing: 10) {
            Text(String((p?.name ?? "?").prefix(1)))
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(highlighted || !nominee ? Theme.onInk : Theme.ink)
                .frame(width: 44, height: 44)
                .background(highlighted ? Theme.ink : (nominee ? Color.clear : Theme.ink.opacity(0.85)), in: .circle)
                .overlay(Circle().strokeBorder(style: StrokeStyle(lineWidth: nominee && !highlighted ? 1.5 : 0, dash: [3, 3])).foregroundStyle(.secondary))
            VStack(alignment: .leading, spacing: 1) {
                Text(personName)
                    .font(TypeStyle.rowTitle)
                    .lineLimit(2).truncationMode(.tail)
                    .layoutPriority(1)
                Text(nominee ? "名义股东" : "股东").font(TypeStyle.metadata).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 6).padding(.trailing, 18)
        .frame(width: StructureView.personSize.width, height: StructureView.personSize.height)
        .background(Theme.surface, in: .capsule)
        .overlay(Capsule().strokeBorder(selected ? Theme.ink : (highlighted ? Theme.onLime.opacity(0.7) : Theme.hairline), lineWidth: selected || highlighted ? 2 : 1))
        .background(Capsule().fill(Theme.lime).padding(-4).opacity(highlighted || selected ? 1 : 0))
        .shadow(color: .black.opacity(0.12), radius: 12, y: 8)
    }
}

struct DotGrid: View {
    var body: some View {
        Canvas { ctx, size in
            let step: CGFloat = 22
            var y: CGFloat = 0
            while y < size.height {
                var x: CGFloat = 0
                while x < size.width {
                    ctx.fill(Path(ellipseIn: CGRect(x: x, y: y, width: 2, height: 2)), with: .color(.primary.opacity(0.07)))
                    x += step
                }
                y += step
            }
        }
        .background(Theme.canvas)
    }
}

// MARK: - 检查器

struct InspectorPanel: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var ref: NodeRef
    var asOf: Day

    private static let palette: [Color] = [Theme.ink, Theme.lime, Theme.muted.opacity(0.5)]
    /// 代持一律琥珀色，与图上的代持虚线一致；其他股东依次取黑、柠檬绿、灰。
    private static func color(for h: Holding, at index: Int) -> Color {
        h.isNominee ? Theme.amber : palette[index % palette.count]
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                switch ref.kind {
                case .company: company
                case .person: person
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .transition(.blurReplace)
            .id(ref)
        }
        .scrollIndicators(.automatic)
        .safeAreaInset(edge: .bottom, spacing: 0) { actionBar }
    }

    /// 底部操作栏：固定在详情栏底部，顶部细线、浅灰底，与弹窗底栏一致。
    private var actionBar: some View {
        HStack(spacing: 8) {
            switch ref.kind {
            case .company:
                ViewThatFits(in: .horizontal) {
                    companyActions(size: .regular)
                    companyActions(size: .small)
                }
            case .person:
                Spacer(minLength: 0)
                Button("打开档案") { router.open(person: ref.id) }
                    .buttonStyle(PillButtonStyle(.primary))
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .background(Theme.band.opacity(0.6))
        .background(Theme.surface)
        .overlay(alignment: .top) { Rectangle().fill(Theme.hairline).frame(height: 1) }
    }

    private func companyActions(size: PillButtonStyle.Size) -> some View {
        HStack(spacing: 8) {
            Button("添加上级…") { router.sheet = .addRelation(companyID: ref.id, upward: true) }
                .buttonStyle(PillButtonStyle(.secondary, size: size))
            Button("添加下级…") { router.sheet = .addRelation(companyID: ref.id, upward: false) }
                .buttonStyle(PillButtonStyle(.secondary, size: size))
            Spacer(minLength: 0)
            Button("打开档案") { router.companyTab = 0; router.open(company: ref.id) }
                .buttonStyle(PillButtonStyle(.primary, size: size))
        }
    }

    @ViewBuilder
    private var company: some View {
        let c = store.company(ref.id)
        let holders = Ownership.active(store.holdings, on: asOf).filter { $0.companyID == ref.id }.sorted { $0.percent > $1.percent }
        let b = store.breakdown(of: ref.id, on: asOf)
        let officers = store.officers(of: ref.id, on: asOf)
        let chains = store.chainsFromTops(to: ref.id, on: asOf)
        JurisdictionBadge(code: c?.jurisdiction ?? "?", size: 40, highlighted: true)
        VStack(alignment: .leading, spacing: 4) {
            Text(c?.name ?? "").font(TypeStyle.sectionTitle).tracking(-0.3).textSelection(.enabled)
            Text([store.jurisdictionName(c?.jurisdiction ?? ""), c?.entityForm ?? ""].filter { !$0.isEmpty }.joined(separator: "，"))
                .foregroundStyle(.secondary)
        }
        VStack(spacing: 0) {
            infoRow("注册编号", c?.registrationNumber ?? "")
            Divider()
            infoRow("成立日期", c?.incorporationDate?.description ?? "")
            Divider()
            infoRow("注册地址", c?.registeredAddress ?? "")
            if let c, c.status != .active {
                Divider()
                infoRow("状态", c.status.label)
            }
        }
        .padding(.horizontal, 12)
        .background(Theme.card, in: .rect(cornerRadius: 14))

        block("董事及高管") {
            if officers.isEmpty { Text("未录入").foregroundStyle(.secondary) }
            // 同一人担任多个职务时合并成一行
            let grouped: [(personID: String, titles: String)] = officers.reduce(into: [(String, [String])]()) { acc, a in
                if let i = acc.firstIndex(where: { $0.0 == a.personID }) { acc[i].1.append(a.title) } else { acc.append((a.personID, [a.title])) }
            }.map { (personID: $0.0, titles: $0.1.joined(separator: "、")) }
            ForEach(grouped, id: \.personID) { a in
                HStack {
                    Button { router.open(person: a.personID) } label: {
                        HStack(spacing: 4) {
                            Text(store.name(of: NodeRef(kind: .person, id: a.personID))).fontWeight(.semibold)
                            Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.muted)
                        }
                        .foregroundStyle(Theme.ink)
                    }
                    .buttonStyle(.plain)
                    Spacer()
                    Text(a.titles).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                }
            }
        }
        if !holders.isEmpty {
            block("直接股东") {
                HStack(alignment: .top, spacing: 14) {
                    Chart(Array(holders.enumerated()), id: \.element.id) { pair in
                        SectorMark(angle: .value("比例", pair.element.percent), innerRadius: .ratio(0.62), angularInset: 1.5)
                            .foregroundStyle(Self.color(for: pair.element, at: pair.offset))
                    }
                    .frame(width: 64, height: 64)
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(holders.enumerated()), id: \.element.id) { pair in
                            let h = pair.element
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Circle().fill(Self.color(for: pair.element, at: pair.offset)).frame(width: 7, height: 7)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(store.name(of: h.holder)).lineLimit(1)
                                    if h.isNominee {
                                        Text("名义股东，代\(h.beneficialOwner.map { store.name(of: $0) } ?? "他人")持有")
                                            .font(.caption).foregroundStyle(Theme.amberText)
                                    }
                                }
                                Spacer()
                                Text(Ownership.percentLabel(h.percent)).fontWeight(.bold).monospacedDigit()
                            }
                        }
                    }
                }
            }
        }
        block("最终受益（穿透）") {
            if b.owners.isEmpty && b.unknown < 0.005 { Text("股东未录入").foregroundStyle(.secondary) }
            ForEach(b.owners, id: \.owner) { u in
                HStack {
                    Text(store.name(of: u.owner)).fontWeight(.medium)
                    if u.viaNominee { Pill(text: "含代持", kind: .warn) }
                    if u.isTopCompany { Pill(text: "上层未录入") }
                    Spacer()
                    Text(Ownership.percentLabel(u.percent)).fontWeight(.bold).monospacedDigit()
                }
            }
            if b.unknown > 0.005 {
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text("未识别").fontWeight(.medium).foregroundStyle(Theme.amberText)
                        Spacer()
                        Text(Ownership.percentLabel(b.unknown)).fontWeight(.bold).monospacedDigit().foregroundStyle(Theme.amberText)
                    }
                    ForEach(b.gaps, id: \.companyID) { g in
                        Text("\(store.name(of: NodeRef(kind: .company, id: g.companyID))) 有 \(Ownership.percentLabel(g.missing)) 股东未录入")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if !b.cyclicCompanyIDs.isEmpty {
                        Text("存在循环持股，相关比例暂列未识别，需单独核算。")
                            .font(TypeStyle.metadata).foregroundStyle(Theme.amberText)
                    }
                    ForEach(b.unresolvedNominees) { h in
                        Text("\(store.name(of: h.holder)) 的代持受益人尚未确认")
                            .font(.caption).foregroundStyle(Theme.amberText)
                    }
                }
            }
        }
        if !chains.isEmpty {
            block("所在链条") {
                ForEach(chains.prefix(6), id: \.chain.id) { item in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.group.name).font(.caption).foregroundStyle(.secondary)
                        Text(store.chainText(item.chain)).font(.callout).textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        if let c {
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(store.companySummary(c, on: asOf), forType: .string)
                store.showToast("公司资料摘要已复制。")
            } label: { Label("复制公司资料摘要", systemImage: "doc.on.doc") }
            .buttonStyle(PillButtonStyle(.accent))
            .help("公司名称、注册编号、成立日期、地址、董事、股东、穿透和链条，可直接发给同事或负责方")
        }
        if store.complianceOn, asOf == store.today, let next = store.openObligations.first(where: { $0.company.id == ref.id }) {
            let left = next.daysLeft(from: store.today)
            LabeledContent(next.rule.name, value: left < 0 ? "逾期 \(-left) 天" : "\(left) 天后")
        }
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary).frame(width: 64, alignment: .leading)
            Text(value.isEmpty ? "未填写" : value).foregroundStyle(value.isEmpty ? .secondary : .primary)
                .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(TypeStyle.body).padding(.vertical, 8)
    }

    private func block<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(TypeStyle.metadata).fontWeight(.semibold).foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 可以直接贴进 KYC 问卷或邮件的股权说明。
    private func explain(_ c: Company?, holders: [Holding], ultimate: [(owner: NodeRef, percent: Double, viaNominee: Bool)]) -> String {
        guard let c else { return "" }
        let date = asOf == store.today ? "截至 \(asOf.long)" : "\(asOf.year) 年末"
        var parts: [String] = []
        if holders.isEmpty {
            parts.append("\(c.name)（\(store.jurisdictionName(c.jurisdiction))）\(date)没有录入股东。")
        } else {
            let direct = holders.sorted { $0.percent > $1.percent }.map { h -> String in
                var t = "\(store.name(of: h.holder))持有 \(Ownership.percentLabel(h.percent))"
                if h.isNominee { t += "（代\(h.beneficialOwner.map { store.name(of: $0) } ?? "他人")持有）" }
                return t
            }
            parts.append("\(c.name)（\(store.jurisdictionName(c.jurisdiction))）\(date)的直接股东：\(direct.joined(separator: "；"))。")
        }
        if !ultimate.isEmpty {
            let ub = ultimate.map { "\(store.name(of: $0.owner)) \(Ownership.percentLabel($0.percent))\($0.viaNominee ? "（含代持）" : "")" }
            parts.append("穿透后的最终受益人：\(ub.joined(separator: "，"))。")
        }
        // 未知部分必须说明，不能让结论看起来完整
        let known = ultimate.reduce(0) { $0 + $1.percent }
        if known < 99.5 {
            parts.append("另有 \(Ownership.percentLabel(100 - known)) 未识别到最终股东（上层股东未录入）。补录位置：编辑公司 → 股东。")
        }
        return parts.joined(separator: "\n")
    }

    @ViewBuilder
    private var person: some View {
        let p = store.person(ref.id)
        let portfolio = Ownership.portfolio(of: ref, companies: store.companies, holdings: store.holdings, on: asOf)
        let roles = store.appointments.filter { $0.personID == ref.id && $0.isActive(on: asOf) }
        Text(String((p?.name ?? "?").prefix(1)))
            .font(.system(size: 18, weight: .bold)).foregroundStyle(Theme.onInk)
            .frame(width: 44, height: 44).background(Theme.ink, in: .circle)
        VStack(alignment: .leading, spacing: 4) {
            Text(p?.name ?? "").font(TypeStyle.entityTitle)
            if let notes = p?.notes, !notes.isEmpty { Text(notes).foregroundStyle(.secondary) }
        }
        VStack(alignment: .leading, spacing: 8) {
            Text("穿透后持有").font(TypeStyle.metadata).fontWeight(.semibold).foregroundStyle(.secondary)
            ForEach(portfolio, id: \.company.id) { item in
                Button { router.open(company: item.company.id) } label: {
                    HStack(spacing: 10) {
                        JurisdictionBadge(code: item.company.jurisdiction, size: 30)
                        Text(item.company.name).lineLimit(1)
                        if item.viaNominee { Pill(text: "含代持", kind: .warn) }
                        Spacer()
                        Text(Ownership.percentLabel(item.percent)).fontWeight(.bold).monospacedDigit()
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
        if !roles.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("任职").font(TypeStyle.metadata).fontWeight(.semibold).foregroundStyle(.secondary)
                ForEach(roles) { a in
                    LabeledContent(store.company(a.companyID)?.name ?? "", value: a.title)
                }
            }
        }
    }
}

/// 详情栏的关闭按钮：圆形、无底，悬停时出浅灰底。
private struct InspectorCloseButton: View {
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(hover ? Theme.ink : Theme.muted)
                .frame(width: 28, height: 28)
                .background(hover ? Theme.band : Color.clear, in: .circle)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help("关闭")
        .accessibilityLabel("关闭详情")
    }
}
