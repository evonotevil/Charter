import SwiftUI

/// 工作界面的语义字号。保持系统字体，只收敛重复角色，避免各页面用相邻字号制造层级。
enum TypeStyle {
    static let entityTitle = Font.system(size: 26, weight: .semibold)
    static let sectionTitle = Font.system(size: 20, weight: .semibold)
    /// 页面大标题（与总览“下午好”一致）。
    static let pageTitle = Font.system(size: 26, weight: .semibold)
    static let rowTitle = Font.system(size: 14, weight: .semibold)
    static let body = Font.system(size: 13)
    static let metadata = Font.system(size: 12)
    static let micro = Font.system(size: 11, weight: .medium)
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
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @State private var hover = false

        var body: some View {
            configuration.label
                .font(.system(size: size == .small ? 12 : size == .large ? 14.5 : 13.5, weight: .semibold))
                .lineLimit(1)
                .padding(.horizontal, size == .small ? 12 : size == .large ? 20 : 16)
                .frame(height: size == .small ? 28 : size == .large ? 42 : 34)
                .background(background, in: .capsule)
                .overlay { if kind == .secondary { Capsule().strokeBorder(Theme.hairline, lineWidth: 1) } }
                .foregroundStyle(foreground)
                .opacity(enabled ? 1 : 0.4)
                .scaleEffect(configuration.isPressed ? 0.97 : 1)
                .animation(reduceMotion ? nil : .snappy(duration: 0.15), value: configuration.isPressed)
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
            .padding(.horizontal, 8).frame(minWidth: 26, minHeight: 22)
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
            Text(title).font(TypeStyle.pageTitle).tracking(-0.5)
                .lineLimit(1).minimumScaleFactor(0.6)
            if let subtitle { Text(subtitle).font(.system(size: 14)).foregroundStyle(Theme.muted) }
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

/// 页面顶部：大标题（可带说明）+ 右侧操作。各页统一 24 点页边距，与总览对齐。
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
