import SwiftUI
import AppKit


extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: opacity)
    }
    /// 随浅色/深色模式变化的颜色。
    init(light: UInt32, dark: UInt32) {
        self.init(nsColor: NSColor(name: nil) { a in
            let h = a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: CGFloat((h >> 16) & 0xFF) / 255, green: CGFloat((h >> 8) & 0xFF) / 255,
                           blue: CGFloat(h & 0xFF) / 255, alpha: 1)
        })
    }
}

/// 设计规范：浅灰画布 + 白色圆角卡片；黑色为主强调，柠檬绿用于品牌入口、有效状态和完成度；琥珀色表示需要处理，红色只用于已过期。
enum Theme {
    static let canvas = Color(light: 0xECECEF, dark: 0x0F0F11)
    static let surface = Color(light: 0xFFFFFF, dark: 0x1C1C1F)
    /// 表头带、次级填充、未选中的分段。
    static let band = Color(light: 0xF3F3F5, dark: 0x27272B)
    static let hairline = Color(light: 0xE6E6EA, dark: 0x303035)
    static let ink = Color(light: 0x121212, dark: 0xF2F2F3)
    static let onInk = Color(light: 0xFFFFFF, dark: 0x121212)
    /// Emphasis panels retain a dark surface in both appearances.
    static let emphasis = Color(hex: 0x121212)
    static let onEmphasis = Color.white
    static let muted = Color(light: 0x6E6E76, dark: 0x9C9CA3)
    /// 股权图默认连线：比 hairline 深，比文字浅，两种外观下都清楚。
    static let edge = Color(light: 0x9A9AA3, dark: 0x6C6C74)
    static let lime = Color(hex: 0xD9F46B)
    static let limeSoft = Color(light: 0xF1FBCB, dark: 0x3A4318)
    /// 柠檬绿浅底上的文字（浅色约 7:1，深色约 8:1）。
    static let limeText = Color(light: 0x4D5B12, dark: 0xD9F46B)
    static let onLime = Color(hex: 0x121212)
    static let danger = Color(hex: 0xE2553D)
    static let amber = Color(hex: 0xF2B441)
    static let amberSoft = Color(light: 0xFCEFD3, dark: 0x4A3A16)
    static let amberText = Color(light: 0x8A5A00, dark: 0xF2C66B)

    static let radius: CGFloat = 24

    // 旧名称：红色只表示“过期/告警”
    static var red: Color { danger }
    static var redTint: Color { danger.opacity(0.1) }
    static var card: Color { band }
    static var fill: Color { band }
    static var secondary: Color { muted }
}

// MARK: - 字体

extension Font {
    static func display(_ size: CGFloat, _ weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .default)
    }
    /// 注册号、日期等等宽数字。
    static func mono(_ size: CGFloat = 13, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

// MARK: - 法域徽章

struct JurisdictionBadge: View {
    var code: String
    var size: CGFloat = 36
    var highlighted = false

    var body: some View {
        Text(code)
            .font(.system(size: size * 0.32, weight: .bold))
            .tracking(0.3)
            .frame(width: size, height: size)
            .background(highlighted ? Theme.ink : Theme.band, in: .rect(cornerRadius: size * 0.3))
            .foregroundStyle(highlighted ? Theme.onInk : Theme.ink)
    }
}

// MARK: - 状态标签

enum PillKind { case neutral, valid, warn, bad, strong, lime, outline }

struct Pill: View {
    var text: String
    var kind: PillKind = .neutral

    var body: some View {
        Text(text)
            .font(.system(size: 11.5, weight: .semibold))
            .padding(.horizontal, 9)
            .frame(height: 22)
            .background(background, in: .capsule)
            .overlay { if kind == .outline { Capsule().strokeBorder(Theme.muted.opacity(0.5), lineWidth: 1) } }
            .foregroundStyle(foreground)
            .fixedSize()
    }

    private var background: Color {
        switch kind {
        case .neutral: Theme.band
        case .valid: Theme.limeSoft
        case .warn: Theme.amberSoft
        case .bad: Theme.danger
        case .strong: Theme.ink
        case .lime: Theme.lime
        case .outline: .clear
        }
    }
    private var foreground: Color {
        switch kind {
        case .neutral: Theme.muted
        case .valid: Theme.limeText
        case .warn: Theme.amberText
        case .bad: .white
        case .strong: Theme.onInk
        case .lime: Theme.onLime
        case .outline: Theme.muted
        }
    }
}

extension Freshness {
    var pillKind: PillKind {
        switch self {
        case .expired: .bad
        case .expiring, .needsUpdate, .unknown: .warn
        case .valid: .valid
        default: .neutral
        }
    }
}

extension ObligationStatus {
    var pillKind: PillKind {
        switch self {
        case .pending: .neutral
        case .drafted: .warn
        case .handedOff, .waiting: .strong
        case .done: .neutral
        }
    }
}

// MARK: - 卡片与分组

struct Card<Content: View>: View {
    var padding: CGFloat = 22
    var radius: CGFloat = 26
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: .rect(cornerRadius: radius))
    }
}

struct SectionTitle: View {
    var title: String
    var trailing: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.display(19))
            Spacer()
            if let trailing {
                if let action {
                    Button(trailing, action: action).buttonStyle(.plain).foregroundStyle(Theme.ink).underline().font(.system(size: 13, weight: .semibold))
                } else {
                    Text(trailing).font(.system(size: 12.5)).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 4)
    }
}

struct FactRow: View {
    var label: String
    var value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(label).foregroundStyle(.secondary).frame(width: 96, alignment: .leading)
            Text(value.isEmpty ? "—" : value).fontWeight(.medium).textSelection(.enabled)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
    }
}

struct EmptyState: View {
    var symbol: String
    var title: String
    var message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 34, weight: .light)).foregroundStyle(.secondary)
            Text(title).font(.display(20))
            Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 380)
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(PillButtonStyle(.primary, size: .large)).padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(40)
    }
}

// MARK: - 主按钮（标记完成：收成圆并画出对勾）

struct MorphingDoneButton: View {
    var title: String = "标记完成"
    var action: () -> Void
    @State private var done = false

    var body: some View {
        Button {
            guard !done else { return }
            withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { done = true }
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(0.6))
                action()
                done = false
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "checkmark").font(.system(size: 14, weight: .bold))
                    .symbolEffect(.bounce, value: done)
                if !done { Text(title).transition(.opacity.combined(with: .scale(scale: 0.8))) }
            }
            .foregroundStyle(Theme.onInk)
            .frame(width: done ? 44 : nil, height: 44)
            .padding(.horizontal, done ? 0 : 20)
            .background(Theme.ink, in: .capsule)
        }
        .buttonStyle(.plain)
        .fontWeight(.semibold)
    }
}

struct CapsuleButtonStyle: ButtonStyle {
    var prominent = false
    var crimson = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .fontWeight(.semibold)
            .padding(.horizontal, 18)
            .frame(height: crimson ? 44 : 40)
            .background(prominent || crimson ? Theme.ink : Theme.surface, in: .capsule)
            .foregroundStyle(prominent || crimson ? Theme.onInk : Theme.ink)
            .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: prominent || crimson ? 0 : 1))
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

// MARK: - 提示条

struct ToastOverlay: View {
    @Environment(AppStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack {
            Spacer()
            if let t = store.toast {
                HStack(spacing: 14) {
                    Image(systemName: "checkmark").fontWeight(.bold)
                    Text(t.text).fontWeight(.medium)
                    if let undo = t.undo {
                        Button("撤销") { undo(); store.toast = nil }
                            .buttonStyle(.plain)
                            .padding(.horizontal, 14).frame(height: 32)
                            .background(.white.opacity(0.16), in: .capsule)
                    }
                }
                .foregroundStyle(.white)
                .padding(.leading, 18).padding(.trailing, t.undo == nil ? 18 : 6)
                .frame(height: 46)
                .background(Color.black.opacity(0.82), in: .capsule)
                .shadow(color: .black.opacity(0.3), radius: 20, y: 10)
                .padding(.bottom, 92)
                .transition(.move(edge: .bottom).combined(with: .opacity).combined(with: .scale(scale: 0.92)))
                .id(t.id)
            }
        }
        .animation(reduceMotion ? .easeOut(duration: 0.15) : .snappy(duration: 0.25), value: store.toast)
        .allowsHitTesting(store.toast != nil)
    }
}

// MARK: - Day 与 DatePicker 的桥接

extension Binding where Value == Day {
    var date: Binding<Date> {
        Binding<Date>(get: { wrappedValue.date(hour: 12) }, set: { wrappedValue = Day(date: $0) })
    }
}

extension View {
    /// 浮在内容上方的玻璃胶囊。
    func floatingGlass(cornerRadius: CGFloat = 28) -> some View {
        self.glassEffect(.regular, in: .rect(cornerRadius: cornerRadius))
    }
}

extension String {
    /// 为空时用替代文字。
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}
