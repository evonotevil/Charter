import SwiftUI

/// 柠檬绿拖放区：首次使用页和空公司档案共用。点按或回车选择文件，拖入文件直接交给 onDrop。
struct ArchiveDropZone: View {
    var title: String
    var subtitle: String
    var action: () -> Void
    var onDrop: ([URL]) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var targeted = false
    @State private var hovering = false
    @FocusState private var focused: Bool

    init(title: String, subtitle: String, action: @escaping () -> Void, onDrop: @escaping ([URL]) -> Void) {
        self.title = title
        self.subtitle = subtitle
        self.action = action
        self.onDrop = onDrop
    }

    var body: some View {
        let lifted = (hovering || targeted) && !reduceMotion
        return HStack(alignment: .center, spacing: 24) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 26, weight: .heavy)).tracking(-0.5)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(TypeStyle.body).opacity(0.75)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            PaperStack().frame(width: 150, height: 110)
        }
        .foregroundStyle(Theme.onLime)
        .padding(40)
        .background(Theme.lime, in: .rect(cornerRadius: 24, style: .continuous))
        .overlay {
            if targeted {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Theme.onLime.opacity(0.5), style: StrokeStyle(lineWidth: 2, dash: [6, 5]))
                    .padding(10)
            }
        }
        .overlay {
            if focused {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(Theme.ink, lineWidth: 3)
                    .padding(-3)
            }
        }
        .shadow(color: Color(hex: 0x6E8C0A).opacity(lifted ? 0.25 : 0), radius: 15, y: 14)
        .offset(y: lifted ? -2 : 0)
        .animation(Motion.standard, value: lifted)
        .contentShape(.rect(cornerRadius: 24))
        .onHover { hovering = $0 }
        .onTapGesture { action() }
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(.return) { action(); return .handled }
        .onKeyPress(.space) { action(); return .handled }
        .dropDestination(for: URL.self) { urls, _ in
            guard !urls.isEmpty else { return false }
            onDrop(urls)
            return true
        } isTargeted: { targeted = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("\(title)。拖入文件或文件夹，或按回车选择文件")
        .accessibilityAction { action() }
        .help("拖入文件或文件夹，或点按选择文件")
    }
}

/// 拖放区右侧的三张纸。
struct PaperStack: View {
    var body: some View {
        ZStack(alignment: .topLeading) {
            paper.rotationEffect(.degrees(-8)).offset(x: 0, y: 3)
            paper.rotationEffect(.degrees(2)).offset(x: 32, y: 3)
            paper.rotationEffect(.degrees(10)).offset(x: 64, y: 3)
        }
        .frame(width: 150, height: 110, alignment: .topLeading)
        .accessibilityHidden(true)
    }

    private var paper: some View {
        VStack(alignment: .leading, spacing: 4) {
            Capsule().fill(Theme.emphasis.opacity(0.8)).frame(height: 6)
            Capsule().fill(Color(hex: 0xDDDDDD)).frame(height: 6).padding(.top, 2)
            Capsule().fill(Color(hex: 0xDDDDDD)).frame(height: 6)
            Capsule().fill(Color(hex: 0xDDDDDD)).frame(height: 6)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.top, 16)
        .frame(width: 84, height: 104)
        .background(Color.white, in: .rect(cornerRadius: 10, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 6)
    }
}

/// 整块区域接受拖入：拖到上方时盖一层柠檬绿，提示“松开即可归档到…”。
private struct ArchiveDropTarget: ViewModifier {
    var message: String
    var cornerRadius: CGFloat
    var perform: ([URL]) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var targeted = false

    func body(content: Content) -> some View {
        content
            .overlay {
                if targeted {
                    ZStack {
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .fill(Theme.lime.opacity(0.92))
                        RoundedRectangle(cornerRadius: max(cornerRadius - 8, 4), style: .continuous)
                            .strokeBorder(Theme.onLime.opacity(0.6), style: StrokeStyle(lineWidth: 2, dash: [7, 6]))
                            .padding(10)
                        Text(message)
                            .font(.system(size: 22, weight: .heavy)).tracking(-0.4)
                            .foregroundStyle(Theme.onLime)
                            .multilineTextAlignment(.center)
                            .padding(32)
                    }
                    .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.opacity.combined(with: .scale(scale: 0.98)))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
            }
            .animation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion), value: targeted)
            .dropDestination(for: URL.self) { urls, _ in
                guard !urls.isEmpty else { return false }
                perform(urls)
                return true
            } isTargeted: { targeted = $0 }
    }
}

extension View {
    /// 让这块区域接受拖入的文件；message 例如“松开即可归档到 某公司”。
    func archiveDropTarget(_ message: String, cornerRadius: CGFloat = Radius.surface, perform: @escaping ([URL]) -> Void) -> some View {
        modifier(ArchiveDropTarget(message: message, cornerRadius: cornerRadius, perform: perform))
    }
}
