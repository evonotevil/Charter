import SwiftUI
import AppKit

/// 字体层级（设计语言）：只用四档 —— Display 44/800、Title 28/750、Section 17/650、Body 14，外加 Meta 12.5/500。
/// 标题收紧字距（用 `Tracking`），数字一律 `.monospacedDigit()`。
enum TypeStyle {
    // 新档位
    static let display = Font.system(size: 44, weight: .heavy)
    /// 28 / 750：SwiftUI 没有 750，取 .bold；配合 `Tracking.title`。
    static let title = Font.system(size: 28, weight: .bold)
    /// 17 / 650：取 .semibold。
    static let section = Font.system(size: 17, weight: .semibold)
    static let body = Font.system(size: 14)
    static let meta = Font.system(size: 12.5, weight: .medium)

    // 旧名称（保留调用点），映射到新档位
    static let entityTitle = TypeStyle.title
    static let sectionTitle = TypeStyle.section
    /// 页面大标题：28 / 800，字距收紧。
    static let pageTitle = Font.system(size: 28, weight: .heavy)
    static let rowTitle = Font.system(size: 14, weight: .semibold)
    static let metadata = TypeStyle.meta
    static let micro = Font.system(size: 11, weight: .medium)
}

/// 标题字距（-0.02em / -0.03em 换算为点）。
enum Tracking {
    static let display: CGFloat = -1.3   // 44 × -0.03
    static let title: CGFloat = -0.56    // 28 × -0.02
    static let section: CGFloat = -0.2
}

// MARK: - 间距、圆角、动效

/// 4 点网格。页边 32，区块间距 40。
enum Space {
    static let xs4: CGFloat = 4
    static let s8: CGFloat = 8
    static let m12: CGFloat = 12
    static let l16: CGFloat = 16
    static let xl24: CGFloat = 24
    static let xxl32: CGFloat = 32
    static let section40: CGFloat = 40
    static let xxxl48: CGFloat = 48
    /// 页面左右边距。
    static let pageEdge: CGFloat = 32
}

/// 圆角：按钮为胶囊，输入框 12，行高亮 10，承载面 20。
enum Radius {
    /// 按钮与胶囊控件：用 `.capsule`；这里给需要数值的场合一个足够大的值。
    static let control: CGFloat = 999
    static let field: CGFloat = 12
    static let row: CGFloat = 10
    static let surface: CGFloat = 20
}

/// 动效：一条缓动曲线 cubic-bezier(.2,.8,.2,1)，三档时长 120 / 200 / 280 ms。减少动态效果时只做淡入淡出。
enum Motion {
    static let fastDuration: Double = 0.12
    static let standardDuration: Double = 0.2
    static let panelDuration: Double = 0.28

    /// 按下、悬停、勾选。
    static let fast = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.12)
    /// 选中、切换、展开。
    static let standard = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.2)
    /// 浮层、提示条、侧板进出。
    static let panel = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.28)

    /// 减少动态效果时换成短淡入淡出（位移由调用方改用 `.opacity` 过渡）。
    static func resolved(_ animation: Animation, reduceMotion: Bool) -> Animation {
        reduceMotion ? .easeOut(duration: fastDuration) : animation
    }

    /// 系统“减少动态效果”设置（非视图代码里用）。
    @MainActor static var reduceMotion: Bool {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }

    /// `withAnimation` 的包装，自动遵守减少动态效果。
    @MainActor static func perform<R>(_ animation: Animation = Motion.standard, _ body: () throws -> R) rethrows -> R {
        try withAnimation(resolved(animation, reduceMotion: reduceMotion), body)
    }
}

extension View {
    /// 浮层（菜单、提示条、拖动中的对象）共用的一层阴影。页面内的承载面不加阴影。
    func floatingShadow() -> some View {
        self.shadow(color: Color.black.opacity(0.12), radius: 16, y: 12)
            .shadow(color: Color.black.opacity(0.06), radius: 3, y: 2)
    }

    /// 出现时淡入并上移 4 点；减少动态效果时只淡入。
    func appear(delay: Double = 0) -> some View {
        modifier(AppearModifier(delay: delay))
    }

    /// 数字变化时逐位滚动（`.contentTransition(.numericText())`）。
    func numericTransition() -> some View {
        self.monospacedDigit().contentTransition(.numericText())
    }
}

private struct AppearModifier: ViewModifier {
    var delay: Double
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 4)
            .onAppear {
                withAnimation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion).delay(delay)) { shown = true }
            }
    }
}

// MARK: - 按钮

/// 胶囊按钮。颜色固定，窗口失焦时不会变灰（只在禁用时降低不透明度）。
struct PillButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, accent, quiet, danger }
    enum Size { case small, regular, large }
    var kind: Kind
    var size: Size

    init(_ kind: Kind = .secondary, size: Size = .regular) {
        self.kind = kind
        self.size = size
    }

    func makeBody(configuration: Configuration) -> some View {
        PillBody(configuration: configuration, kind: kind, size: size)
    }

    private struct PillBody: View {
        let configuration: Configuration
        let kind: Kind
        let size: Size
        @Environment(\.isEnabled) private var enabled
        @Environment(\.isFocused) private var focused
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @State private var hover = false

        var body: some View {
            configuration.label
                .font(.system(size: size == .small ? 13 : size == .large ? 14.5 : 14, weight: .semibold))
                .lineLimit(1)
                .padding(.horizontal, size.horizontalPadding)
                .frame(height: size.height)
                .background(background, in: .capsule)
                .overlay { if kind == .secondary { Capsule().strokeBorder(Theme.hairline, lineWidth: 1.5) } }
                .foregroundStyle(foreground)
                .opacity(enabled ? 1 : 0.4)
                .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
                .animation(Motion.resolved(Motion.fast, reduceMotion: reduceMotion), value: configuration.isPressed)
                // 键盘焦点：柠檬绿外圈（只在“全键盘控制”下按钮可获得焦点时出现）
                .overlay {
                    if focused {
                        Capsule().strokeBorder(Theme.lime, lineWidth: 3).padding(-4)
                    }
                }
                .onHover { hover = $0 }
                .contentShape(.capsule)
        }

        private var background: Color {
            let pressed = configuration.isPressed
            switch kind {
            case .primary: return Theme.ink.opacity(pressed ? 0.8 : hover ? 0.9 : 1)
            case .secondary: return pressed || hover ? Theme.band : Theme.surface
            case .accent: return Theme.lime.opacity(pressed ? 0.8 : 1)
            case .quiet: return pressed || hover ? Theme.band : .clear
            case .danger: return Theme.danger.opacity(pressed ? 0.8 : 1)
            }
        }
        private var foreground: Color {
            switch kind {
            case .primary: Theme.onInk
            case .secondary, .quiet: Theme.ink
            case .accent: Theme.onLime
            case .danger: .white
            }
        }
    }
}

extension PillButtonStyle.Size {
    /// 高度：大 44（页面主操作）、常规 38（页面与弹窗）、小 30（表格行内）。
    var height: CGFloat {
        switch self {
        case .small: 30
        case .regular: 38
        case .large: 44
        }
    }
    var horizontalPadding: CGFloat {
        switch self {
        case .small: 14
        case .regular: 18
        case .large: 22
        }
    }
}

// MARK: - 分段切换（黑色胶囊表示选中）

struct PillSegmented<Value: Hashable>: View {
    var options: [(Value, String)]
    @Binding var selection: Value
    @Namespace private var ns
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.0) { opt in
                let on = opt.0 == selection
                Button {
                    withAnimation(reduceMotion ? nil : .snappy(duration: 0.22)) { selection = opt.0 }
                } label: {
                    Text(opt.1)
                        .font(.system(size: 13, weight: on ? .semibold : .medium))
                        .foregroundStyle(on ? Theme.onSelection : Theme.ink)
                        .padding(.horizontal, 14).frame(height: 30)
                        .background {
                            if on { Capsule().fill(Theme.selection).matchedGeometryEffect(id: "seg", in: ns) }
                        }
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Theme.band, in: .capsule)
        .fixedSize()
    }
}

// MARK: - 卡片

extension View {
    /// 白色圆角卡片。
    func surfaceCard(padding: CGFloat = 20, radius: CGFloat = Theme.radius) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: .rect(cornerRadius: radius))
    }
}

/// 指标卡：大数字 + 标题 + 说明。
struct StatCard: View {
    /// ink：主数；plain：中性；lime：品牌强调；warn：需要处理（琥珀）；danger：已过期（红）。
    enum Style { case ink, plain, lime, warn, danger }
    var title: String
    var value: String
    var caption: String
    var style: Style = .plain
    var alert = false
    /// 设定后在数字下方显示柠檬绿进度条（0…1）。
    var progress: Double? = nil
    var action: (() -> Void)?

    var body: some View {
        let content = VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(subtle)
            Text(value).font(.system(size: 40, weight: .semibold)).tracking(-1.2).monospacedDigit()
                .foregroundStyle(alert ? Theme.danger : main)
                .contentTransition(.numericText())
            if let progress {
                ProgressCapsule(value: progress).padding(.vertical, 4)
            }
            Text(caption).font(.system(size: 12.5)).foregroundStyle(subtle).lineLimit(1)
        }
        .padding(18)
        // 同一行的方块等高：外层 HStack 用 .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, minHeight: 128, maxHeight: .infinity, alignment: .topLeading)
        .background(bg, in: .rect(cornerRadius: 22))
        if let action {
            Button(action: action) { content }.buttonStyle(.plain)
        } else {
            content
        }
    }

    private var bg: Color {
        switch style {
        case .ink: Theme.emphasis
        case .plain: Theme.band
        case .lime: Theme.lime
        case .warn: Theme.amberSoft
        case .danger: Theme.danger
        }
    }
    private var main: Color {
        switch style {
        case .ink: Theme.onEmphasis
        case .plain: Theme.ink
        case .lime: Theme.onLime
        case .warn: Theme.amberText
        case .danger: .white
        }
    }
    private var subtle: Color {
        switch style {
        case .ink: Theme.onEmphasis.opacity(0.7)
        case .plain: Theme.muted
        case .lime: Theme.onLime.opacity(0.65)
        case .warn: Theme.amberText.opacity(0.8)
        case .danger: .white.opacity(0.85)
        }
    }
}

/// 计数徽章（侧栏、标题旁）。
struct CountBadge: View {
    var count: Int
    var inverted = false
    var body: some View {
        Text("\(count)")
            .font(.system(size: 11.5, weight: .semibold)).monospacedDigit()
            .contentTransition(.numericText())
            .padding(.horizontal, 8).frame(minWidth: 24, minHeight: 22)
            .background(inverted ? Theme.onSelection.opacity(0.18) : Theme.band, in: .capsule)
            .foregroundStyle(inverted ? Theme.onSelection : Theme.muted)
    }
}

/// 表格的浅灰表头带。
struct BandHeader<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, 16).frame(height: 38)
            .background(Theme.band, in: .rect(cornerRadius: 14))
    }
}

// MARK: - 档案状态

extension ArchiveItem.State {
    var pillKind: PillKind {
        switch self {
        case .valid: .valid
        case .noDate: .warn
        case .expiring, .needsUpdate: .warn
        case .expired: .bad
        case .marked(.notObtained), .marked(.restricted): .outline
        case .marked(.unverified): .warn
        case .marked(.external), .marked(.notApplicable): .neutral
        case .missing: .outline
        }
    }

    var emphasisColor: Color {
        switch self {
        case .expired: Theme.danger
        case .expiring, .needsUpdate: Theme.amberText
        default: Theme.muted
        }
    }
}

extension Freshness {
    var emphasisColor: Color {
        switch self {
        case .expired: Theme.danger
        case .expiring, .needsUpdate: Theme.amberText
        default: Theme.ink
        }
    }

    var emphasisFill: Color {
        switch self {
        case .expired: Theme.danger
        case .expiring, .needsUpdate: Theme.amber
        default: Theme.ink
        }
    }
}

struct StatusPill: View {
    var state: ArchiveItem.State
    var body: some View {
        Pill(text: state.label, kind: state.pillKind)
            .accessibilityLabel("状态：\(state.label)")
    }
}

/// 页面标题：大字标题 + 副标题。
struct PageTitle: View {
    var title: String
    var subtitle: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(TypeStyle.pageTitle).tracking(Tracking.title)
                .lineLimit(1).minimumScaleFactor(0.6)
            if let subtitle { Text(subtitle).font(TypeStyle.body).foregroundStyle(Theme.muted) }
        }
    }
}

/// 人员首字头像。
struct Avatar: View {
    var name: String
    var size: CGFloat = 30
    var dashed = false
    var highlighted = false
    var body: some View {
        Text(String(name.prefix(1)))
            .font(.system(size: size * 0.42, weight: .semibold))
            .frame(width: size, height: size)
            .background(dashed ? Color.clear : highlighted ? Theme.onSelection.opacity(0.16) : Theme.band, in: .circle)
            .overlay {
                if dashed {
                    Circle().strokeBorder(style: StrokeStyle(lineWidth: 1.2, dash: [3, 3]))
                        .foregroundStyle(highlighted ? Theme.onSelection.opacity(0.75) : Theme.muted)
                }
            }
            .foregroundStyle(highlighted ? Theme.onSelection : Theme.ink)
            .accessibilityHidden(true)
    }
}

// MARK: - 选中态

extension Theme {
    /// 深色模式保持低亮度，避免选中行和分段控件反转成大片白色。
    static let selection = Color(light: 0x121212, dark: 0x4A4A52)
    static let onSelection = Color(hex: 0xFFFFFF)
    /// 选中行上的琥珀提示，在两种外观下都与选中底色保持足够对比。
    static let attentionOnSelection = Color(hex: 0xF2C66B)
}

/// 页面顶部：大标题（28 / 800，可带说明）+ 右侧操作。页边距用 `Space.pageEdge`，与总览对齐。
struct PageHeader<Trailing: View>: View {
    var title: String
    var subtitle: String? = nil
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            PageTitle(title: title, subtitle: subtitle)
            Spacer(minLength: 12)
            trailing
        }
    }
}
