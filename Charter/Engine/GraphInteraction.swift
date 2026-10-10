import CoreGraphics

/// 缩放以手指所在位置为锚点；相同锚点的图坐标在整次手势中保持不变。
enum GraphInteraction {
    static func clamp(_ scale: CGFloat) -> CGFloat { min(3, max(0.2, scale)) }

    /// 悬停优先于点选：点选后鼠标经过别的节点时临时预览它的链路，移开后回到点选的链路。
    static func focus(selected: NodeRef?, hover: NodeRef?) -> NodeRef? { hover ?? selected }

    static func chain(focus: NodeRef?, holdings: [Holding]) -> (nodes: Set<NodeRef>, edges: Set<String>) {
        guard let focus else { return ([], []) }
        var nodes: Set<NodeRef> = [focus], edges: Set<String> = []
        var ancestors: Set<NodeRef> = []
        func up(_ node: NodeRef) {
            guard node.kind == .company, ancestors.insert(node).inserted else { return }
            for holding in holdings where holding.companyID == node.id {
                edges.insert(holding.id)
                nodes.insert(holding.holder)
                up(holding.holder)
                if holding.isNominee, let owner = holding.beneficialOwner {
                    nodes.insert(owner)
                    up(owner)
                }
            }
        }
        up(focus)
        var queue = [focus], visited: Set<NodeRef> = [focus], index = 0
        while index < queue.count {
            let node = queue[index]
            index += 1
            for holding in holdings where holding.holder == node || (holding.isNominee && holding.beneficialOwner == node) {
                let target = NodeRef(kind: .company, id: holding.companyID)
                edges.insert(holding.id)
                nodes.formUnion([holding.holder, target])
                if visited.insert(target).inserted { queue.append(target) }
            }
        }
        return (nodes, edges)
    }

    struct ZoomStart {
        var scale: CGFloat
        var offset: CGPoint
        var anchor: CGPoint

        func offset(at next: CGFloat, canvas: CGSize, viewport: CGSize) -> CGPoint {
            let ratio = next / scale
            return CGPoint(
                x: min(max(0, (offset.x + anchor.x) * ratio - anchor.x), max(0, canvas.width * next - viewport.width)),
                y: min(max(0, (offset.y + anchor.y) * ratio - anchor.y), max(0, canvas.height * next - viewport.height))
            )
        }
    }
}
