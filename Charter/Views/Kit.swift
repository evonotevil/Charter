import SwiftUI
import AppKit

// Charter 组件规范（第二版）
//
// 一个按钮、一个菜单、一个下拉、一个输入框、一个日期、一个弹窗外壳、一个确认框。
// 所有页面都从这里取，不再直接用系统的 Menu / Picker(.menu) / DatePicker / .alert / .confirmationDialog。
//
// 层级：
// - 主要：黑色胶囊（每个区域最多一个）
// - 次要：白底描边胶囊
// - 轻量：无底，悬停出浅灰底（表格行内、工具类操作）
// - 危险：红色，只用于删除等不可撤销操作的最终确认
// - 强调：柠檬绿，只用于“复制摘要”这类非提交型的便捷操作
//
// 尺寸：小 30（表格行内）、常规 38（页面与弹窗）、大 44（页面主操作）。
// 弹窗底部：左侧放次要的辅助操作，右侧依次“取消（次要）→ 主操作（主要）”。

extension EnvironmentValues {
    /// 输入类控件的底色：页面上为浅灰；放进浅灰的表单分组后改为白色，避免和分组底色融在一起。
    @Entry var kitFieldFill: Color = Theme.band
}

enum Kit {
    static let fieldHeight: CGFloat = 38
    static let fieldRadius: CGFloat = Radius.field
    static let popoverRadius: CGFloat = 14
    static let labelWidth: CGFloat = 92
}

// MARK: - 输入框

/// 输入框：浅灰底、圆角 12、聚焦时深色描边；`invalid` 时红色描边、白底（配合 `FieldError` 显示原因）。
struct KitFieldStyle: TextFieldStyle {
    var invalid = false

    func _body(configuration: TextField<Self._Label>) -> some View {
        FieldBody(invalid: invalid) { configuration }
    }

    private struct FieldBody<Content: View>: View {
        var invalid: Bool
        @ViewBuilder var content: Content
        @FocusState private var focused: Bool
        @Environment(\.kitFieldFill) private var fill
        var body: some View {
            content
                .textFieldStyle(.plain)
                .font(TypeStyle.body)
                .focused($focused)
                .padding(.horizontal, 12)
                .frame(minHeight: Kit.fieldHeight)
                .background(invalid ? Theme.surface : fill, in: .rect(cornerRadius: Kit.fieldRadius))
                .overlay(RoundedRectangle(cornerRadius: Kit.fieldRadius)
                    .strokeBorder(invalid ? Theme.danger : (focused ? Theme.ink.opacity(0.7) : Theme.hairline), lineWidth: 1.5))
                .animation(Motion.fast, value: focused)
                .animation(Motion.fast, value: invalid)
        }
    }
}

/// 表单行：左侧固定宽度的标签，右侧控件；可选一行说明；`error` 非空时在控件下方显示红色原因（替代说明）。
struct FieldRow<Content: View>: View {
    var label: String
    var hint: String?
    var error: String?
    @ViewBuilder var content: Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(label: String, hint: String? = nil, error: String? = nil, @ViewBuilder content: () -> Content) {
        self.label = label
        self.hint = hint
        self.error = error
        self.content = content()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).font(TypeStyle.body).foregroundStyle(Theme.muted)
                .frame(width: Kit.labelWidth, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                content
                if let error {
                    FieldError(text: error)
                } else if let hint {
                    Text(hint).font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .animation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion), value: error)
        }
    }
}

/// 行内校验错误：红色 12.5 点文字，出现时淡入。
struct FieldError: View {
    var text: String
    var body: some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: "exclamationmark.circle.fill")
        }
        .labelStyle(.titleAndIcon)
        .font(TypeStyle.meta)
        .foregroundStyle(Theme.danger)
        .fixedSize(horizontal: false, vertical: true)
        .transition(.opacity)
        .accessibilityLabel("错误：\(text)")
    }
}

// MARK: - 复选、单选、开关

/// 复选与单选共用的选择标记：18 点圆形；选中为实心圆加勾，未选为空心圆环。
struct ChoiceMark: View {
    var on: Bool
    var body: some View {
        Circle()
            .fill(on ? Theme.controlOn : Theme.surface)
            .overlay(Circle().strokeBorder(on ? .clear : Theme.muted.opacity(0.6), lineWidth: 1.5))
            .overlay {
                if on {
                    Image(systemName: "checkmark").font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.onControlOn)
                }
            }
            .frame(width: 18, height: 18)
            .animation(.snappy(duration: 0.15), value: on)
    }
}

/// 复选框（多选）：与单选同一种圆形标记。
struct KitCheckboxStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(spacing: 8) {
                ChoiceMark(on: configuration.isOn)
                configuration.label.font(TypeStyle.body).foregroundStyle(Theme.ink)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
    }
}

/// 开关：选中时黑色轨道（深色模式为柠檬绿），白色圆钮。
struct KitSwitchStyle: ToggleStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.18)) { configuration.isOn.toggle() }
        } label: {
            HStack(spacing: 10) {
                configuration.label.font(TypeStyle.body).foregroundStyle(Theme.ink)
                Spacer(minLength: 8)
                Capsule()
                    .fill(configuration.isOn ? Theme.controlOn : Theme.hairline)
                    .frame(width: 38, height: 22)
                    .overlay(alignment: configuration.isOn ? .trailing : .leading) {
                        Circle().fill(.white).frame(width: 18, height: 18).padding(2)
                            .shadow(color: .black.opacity(0.2), radius: 1.5, y: 1)
                    }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
    }
}

/// 单选组：竖排或横排的圆点。
struct RadioGroup<Value: Hashable>: View {
    var options: [(Value, String)]
    @Binding var selection: Value
    var horizontal = false

    var body: some View {
        let layout = horizontal ? AnyLayout(HStackLayout(spacing: 18)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
        layout {
            ForEach(options, id: \.0) { opt in
                let on = opt.0 == selection
                Button { selection = opt.0 } label: {
                    HStack(spacing: 8) {
                        ChoiceMark(on: on)
                        Text(opt.1).font(TypeStyle.body).foregroundStyle(Theme.ink)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
            }
        }
    }
}

extension Theme {
    /// 复选、单选、开关的“开”：浅色为黑，深色为柠檬绿（深色下黑灰不够醒目）。
    static let controlOn = Color(light: 0x121212, dark: 0xD9F46B)
    static let onControlOn = Color(light: 0xFFFFFF, dark: 0x121212)
}

// MARK: - 浮层外壳

private struct PopoverPanel: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(Kit.popoverPadding)
            .frame(minWidth: 200, alignment: .leading)
            // 浮层统一白底（深色为深灰），不随窗口材质变暗或变透明
            .presentationBackground(Theme.surface)
    }
}

extension Kit {
    /// 浮层（菜单、下拉、日历）统一外观：系统弹出窗口自带阴影，这里只统一底色与内边距。
    /// 自绘浮层（不在 popover 里）用 `.floatingShadow()`。
    static let popoverPadding: CGFloat = 6
}

/// 浮层里的一行：图标 + 文字 + 可选快捷键/勾选；悬停浅灰底。
struct PopoverRow: View {
    var title: String
    var systemImage: String?
    var trailing: String?
    var checked = false
    var destructive = false
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let systemImage {
                    Image(systemName: systemImage).font(.system(size: 13, weight: .medium))
                        .frame(width: 18).foregroundStyle(destructive ? Theme.danger : Theme.muted)
                }
                Text(title).font(TypeStyle.body).foregroundStyle(destructive ? Theme.danger : Theme.ink)
                    .lineLimit(1)
                Spacer(minLength: 16)
                if let trailing { Text(trailing).font(TypeStyle.metadata).foregroundStyle(Theme.muted) }
                if checked {
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.ink)
                }
            }
            .padding(.horizontal, 10).frame(height: 30)
            .background(hover ? Theme.band : .clear, in: .rect(cornerRadius: Radius.row))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

// MARK: - 菜单

/// 菜单项。用 `.divider` 分组，`.header` 加小标题。
enum MenuEntry {
    case item(String, systemImage: String? = nil, shortcut: String? = nil, destructive: Bool = false, disabled: Bool = false, action: () -> Void)
    case divider
    case header(String)
}

/// 主题化的弹出菜单。按钮外观沿用胶囊按钮；展开后是圆角浮层，选项悬停高亮，危险项为红色。
struct ActionMenu: View {
    var title: String?
    var systemImage: String?
    var kind: PillButtonStyle.Kind = .secondary
    var size: PillButtonStyle.Size = .regular
    var showsChevron = true
    var entries: [MenuEntry]
    /// 弹出方向：.bottom 向下展开；放在弹窗底栏时用 .top，向上展开，避免超出窗口。
    var arrowEdge: Edge = .bottom
    @State private var open = false

    /// 胶囊按钮左右各有内边距，图标按钮的标签宽度 = 高度 − 两侧内边距。
    private var iconOnlyWidth: CGFloat {
        max(0, size.height - 2 * size.horizontalPadding)
    }

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 6) {
                if let systemImage { Image(systemName: systemImage) }
                if let title { Text(title) }
                if showsChevron && title != nil {
                    Image(systemName: arrowEdge == .top ? "chevron.up" : "chevron.down").font(.system(size: 9, weight: .bold)).opacity(0.6)
                }
            }
            // 只有图标时做成正圆，和按钮高度一致
            .frame(width: title == nil ? iconOnlyWidth : nil)
        }
        .buttonStyle(PillButtonStyle(kind, size: size))
        .popover(isPresented: $open, arrowEdge: arrowEdge) {
            VStack(alignment: .leading, spacing: 1) {
                ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                    switch entry {
                    case .item(let t, let icon, let shortcut, let destructive, let disabled, let action):
                        PopoverRow(title: t, systemImage: icon, trailing: shortcut, destructive: destructive) {
                            open = false
                            action()
                        }
                        .disabled(disabled)
                        .opacity(disabled ? 0.4 : 1)
                    case .divider:
                        Divider().padding(.vertical, 4).padding(.horizontal, 8)
                    case .header(let t):
                        Text(t).font(TypeStyle.micro).foregroundStyle(Theme.muted)
                            .padding(.horizontal, 10).padding(.top, 6).padding(.bottom, 2)
                    }
                }
            }
            .modifier(PopoverPanel())
        }
        .accessibilityLabel(title ?? "更多操作")
    }
}

// MARK: - 下拉选择

/// 主题化的下拉选择：外观与输入框一致，展开为带勾选的浮层列表；选项多于 8 个时带搜索。
struct SelectField<Value: Hashable>: View {
    var options: [(Value, String)]
    @Binding var selection: Value
    var placeholder = "请选择"
    var minWidth: CGFloat = 180
    /// 设定后宽度固定在 minWidth…maxWidth 之间，过长的选项截断（用于表格固定列）。
    var maxWidth: CGFloat? = nil
    @State private var open = false
    @State private var query = ""
    @State private var hover = false
    @Environment(\.kitFieldFill) private var fill

    private var currentLabel: String? { options.first { $0.0 == selection }?.1 }

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 8) {
                Text(currentLabel ?? placeholder)
                    .font(TypeStyle.body)
                    .foregroundStyle(currentLabel == nil ? Theme.muted : Theme.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 12)
            .frame(minWidth: minWidth, maxWidth: maxWidth ?? .infinity, minHeight: Kit.fieldHeight)
            .background(hover ? Theme.hairline.opacity(0.6) : fill, in: .rect(cornerRadius: Kit.fieldRadius))
            .overlay(RoundedRectangle(cornerRadius: Kit.fieldRadius).strokeBorder(open ? Theme.ink.opacity(0.7) : Theme.hairline, lineWidth: open ? 1.5 : 1))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .fixedSize(horizontal: maxWidth == nil, vertical: false)
        .onHover { hover = $0 }
        .popover(isPresented: $open, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 4) {
                if options.count > 8 {
                    TextField("搜索", text: $query).textFieldStyle(KitFieldStyle()).padding(.bottom, 2)
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 1) {
                        ForEach(filtered, id: \.0) { opt in
                            PopoverRow(title: opt.1, checked: opt.0 == selection) {
                                selection = opt.0
                                open = false
                                query = ""
                            }
                        }
                    }
                }
                .frame(maxHeight: 320)
            }
            .modifier(PopoverPanel())
            .frame(minWidth: max(minWidth, 220))
        }
        .accessibilityLabel(currentLabel ?? placeholder)
    }

    private var filtered: [(Value, String)] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? options : options.filter { $0.1.lowercased().contains(q) }
    }
}

// MARK: - 日期

/// 日期输入：可以直接键入 2026-10-27，也可以点开主题日历；可选“签发后 N 个月”快捷项。
struct DateField: View {
    @Binding var day: Day?
    var placeholder = "选择日期"
    /// 设定后，日历底部出现“签发后 3 / 6 / 12 个月”。
    var relativeTo: Day? = nil
    var relativeLabel = "签发后"
    var allowsClear = true
    var minWidth: CGFloat = 170

    @State private var text = ""
    @State private var invalid = false
    @State private var open = false
    @FocusState private var focused: Bool
    @Environment(\.kitFieldFill) private var fill

    var body: some View {
        HStack(spacing: 6) {
            Button { open.toggle() } label: {
                Image(systemName: "calendar").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.muted)
                    .frame(width: 22, height: 22).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .help("打开日历")
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(TypeStyle.body).monospacedDigit()
                .focused($focused)
                .onSubmit(commit)
            if allowsClear && day != nil {
                Button { day = nil; text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted.opacity(0.7))
                }
                .buttonStyle(.plain).help("清除日期")
            }
        }
        .padding(.leading, 8).padding(.trailing, 10)
        .frame(minWidth: minWidth, minHeight: Kit.fieldHeight)
        .background(fill, in: .rect(cornerRadius: Kit.fieldRadius))
        .overlay(RoundedRectangle(cornerRadius: Kit.fieldRadius)
            .strokeBorder(invalid ? Theme.danger : (focused || open ? Theme.ink.opacity(0.7) : Theme.hairline), lineWidth: focused || open || invalid ? 1.5 : 1))
        .fixedSize(horizontal: true, vertical: false)
        .onAppear { text = day?.description ?? "" }
        .onChange(of: day) { text = day?.description ?? ""; invalid = false }
        .onChange(of: focused) { if !focused { commit() } }
        .popover(isPresented: $open, arrowEdge: .bottom) {
            CalendarPanel(day: Binding(get: { day }, set: { day = $0; open = false }),
                          relativeTo: relativeTo, relativeLabel: relativeLabel, allowsClear: allowsClear)
        }
        .help(invalid ? "日期格式应为 2026-10-27" : "")
    }

    private func commit() {
        let t = text.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { if allowsClear { day = nil }; invalid = false; return }
        let normalized = t.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ".", with: "-")
        if let d = Day(string: normalized) { day = d; invalid = false } else { invalid = true }
    }
}

/// 日历浮层：周一开头；选中为深色圆，今天为柠檬绿圆环。
/// 点标题可切换到“选年份”→“选月份”，方便跳到多年前的成立日期。
struct CalendarPanel: View {
    @Binding var day: Day?
    var relativeTo: Day?
    var relativeLabel = "签发后"
    var allowsClear = true
    enum Mode { case days, months, years }
    @State private var shown: Day = .today()
    @State private var mode: Mode = .days
    @State private var yearPage = 0          // 年份页的起始年

    private let weekdays = ["一", "二", "三", "四", "五", "六", "日"]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            switch mode {
            case .days: dayGrid
            case .months: monthGrid
            case .years: yearGrid
            }
            Divider()
            footer
        }
        .padding(14)
        .frame(width: 300)
        .presentationBackground(Theme.surface)
        .onAppear {
            let d = day ?? .today()
            shown = Day(d.year, d.month, 1)
            yearPage = d.year - (d.year % 12)
        }
    }

    // MARK: 标题：点它切换年/月视图；箭头按当前视图翻页

    private var header: some View {
        HStack(spacing: 4) {
            Button {
                withAnimation(.snappy(duration: 0.18)) {
                    switch mode {
                    case .days: mode = .years; yearPage = shown.year - (shown.year % 12)
                    case .months: mode = .years
                    case .years: mode = .days
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(verbatim: title).font(.system(size: 14, weight: .semibold)).lineLimit(1).fixedSize()
                    Image(systemName: mode == .days ? "chevron.down" : "chevron.up").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 8).frame(height: 28)
                .contentShape(.rect)
            }
            .buttonStyle(PillButtonStyle(.quiet, size: .small))
            .help(mode == .days ? "选择年份和月份" : "回到日历")
            Spacer(minLength: 4)
            Button { page(-1) } label: { Image(systemName: "chevron.left") }
                .buttonStyle(PillButtonStyle(.quiet, size: .small)).help(mode == .years ? "前 12 年" : mode == .months ? "上一年" : "上个月")
            Button { page(1) } label: { Image(systemName: "chevron.right") }
                .buttonStyle(PillButtonStyle(.quiet, size: .small)).help(mode == .years ? "后 12 年" : mode == .months ? "下一年" : "下个月")
        }
    }

    private var title: String {
        switch mode {
        case .days: "\(shown.year) 年 \(shown.month) 月"
        case .months: "\(shown.year) 年"
        case .years: "\(yearPage) – \(yearPage + 11)"
        }
    }

    private func page(_ step: Int) {
        switch mode {
        case .days: shown = shown.adding(months: step)
        case .months: shown = Day(shown.year + step, shown.month, 1)
        case .years: yearPage += step * 12
        }
    }

    // MARK: 日

    private var dayGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(36), spacing: 2), count: 7), spacing: 2) {
            ForEach(weekdays, id: \.self) { w in
                Text(w).font(TypeStyle.micro).foregroundStyle(Theme.muted).frame(height: 22)
            }
            ForEach(cells, id: \.self) { d in dayCell(d) }
        }
    }

    /// 当月格子，前后用相邻月份补齐到整周。
    private var cells: [Day] {
        let first = Day(shown.year, shown.month, 1)
        let lead = (first.weekday + 5) % 7          // 周一 = 0
        let start = first.adding(days: -lead)
        let count = Int((Double(lead + Day.daysIn(year: shown.year, month: shown.month)) / 7).rounded(.up)) * 7
        return (0..<count).map { start.adding(days: $0) }
    }

    private func dayCell(_ d: Day) -> some View {
        let inMonth = d.month == shown.month
        let selected = d == day
        let today = d == Day.today()
        return Button { day = d } label: {
            Text("\(d.day)")
                .font(.system(size: 12.5, weight: selected ? .semibold : .regular)).monospacedDigit()
                .foregroundStyle(selected ? Theme.onSelection : (inMonth ? Theme.ink : Theme.muted.opacity(0.5)))
                .frame(width: 30, height: 30)
                .background(selected ? Theme.selection : .clear, in: .circle)
                .overlay { if today && !selected { Circle().strokeBorder(Theme.lime, lineWidth: 2) } }
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(d.long)
    }

    // MARK: 月、年

    private var monthGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
            ForEach(1...12, id: \.self) { m in
                let on = day.map { $0.year == shown.year && $0.month == m } ?? false
                let now = Day.today().year == shown.year && Day.today().month == m
                pickCell("\(m) 月", on: on, current: now) {
                    shown = Day(shown.year, m, 1)
                    withAnimation(.snappy(duration: 0.18)) { mode = .days }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var yearGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
            ForEach(yearPage..<(yearPage + 12), id: \.self) { y in
                pickCell(String(y), on: day?.year == y, current: Day.today().year == y) {
                    shown = Day(y, shown.month, 1)
                    withAnimation(.snappy(duration: 0.18)) { mode = .months }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func pickCell(_ text: String, on: Bool, current: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(.system(size: 13, weight: on ? .semibold : .medium)).monospacedDigit()
                .foregroundStyle(on ? Theme.onSelection : Theme.ink)
                .frame(maxWidth: .infinity).frame(height: 40)
                .background(on ? Theme.selection : Theme.band, in: .rect(cornerRadius: 10))
                .overlay { if current && !on { RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.lime, lineWidth: 2) } }
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    // MARK: 底部：今天、快捷项、清除

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let base = relativeTo {
                HStack(spacing: 6) {
                    Text(relativeLabel).font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                    ForEach([(3, "3 个月"), (6, "6 个月"), (12, "1 年")], id: \.0) { m, label in
                        Button(label) { day = base.adding(months: m) }
                            .buttonStyle(PillButtonStyle(.secondary, size: .small))
                            .fixedSize()
                            .help("\(relativeLabel) \(label)：\(base.adding(months: m).description)")
                    }
                    Spacer(minLength: 0)
                }
            }
            HStack(spacing: 6) {
                Button("今天") { day = .today() }
                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
                Spacer(minLength: 0)
                if allowsClear && day != nil {
                    Button("清除") { day = nil }.buttonStyle(PillButtonStyle(.quiet, size: .small))
                }
            }
        }
    }
}

// MARK: - 弹窗外壳

/// 统一的弹窗外壳：标题区、内容区、底部操作栏。高度随内容，超过屏幕可用高度时内容区滚动。
/// 底部：`leading` 放辅助操作（次要按钮），`trailing` 放“取消 + 主操作”。
struct SheetScaffold<Content: View, Leading: View, Trailing: View>: View {
    var title: String
    var subtitle: String?
    var width: CGFloat = 560
    /// 最高高度（会再按屏幕可用高度收紧）。
    var height: CGFloat? = nil
    @ViewBuilder var content: Content
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: Space.xs4 + 2) {
                Text(title)
                    .font(.system(size: 22, weight: .heavy)).tracking(-0.44)
                    .lineLimit(2).truncationMode(.tail)
                    .help(title)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle).font(TypeStyle.body).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 28).padding(.top, 28).padding(.bottom, Space.xl24)

            ViewThatFits(in: .vertical) {
                padded(content)
                ScrollView { padded(content) }.scrollBounceBehavior(.basedOnSize)
            }

            HStack(spacing: Space.s8 + 2) {
                leading
                Spacer(minLength: Space.m12)
                trailing
            }
            .padding(.horizontal, 28).padding(.vertical, Space.l16)
            .background(Theme.surface)
            .overlay(alignment: .top) { Rectangle().fill(Theme.hairline).frame(height: 1) }
        }
        .frame(width: width)
        .frame(maxHeight: SheetMetrics.height(height ?? 720))
        .fixedSize(horizontal: false, vertical: true)
        .background(Theme.surface)
    }

    private func padded(_ content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 28).padding(.bottom, 28)
    }
}

/// 表单分组：浅灰圆角底，行与行之间细线分隔（与系统设置的分组表单一致）。
struct FormGroup<Content: View>: View {
    var title: String?
    /// 放在灰色画布上（设置页等）时用白底卡片；放在弹窗里时用浅灰底。
    var onCanvas = false
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                Text(title).font(TypeStyle.metadata).fontWeight(.semibold).foregroundStyle(Theme.muted).padding(.leading, 4)
            }
            VStack(alignment: .leading, spacing: 0) {
                Group(subviews: content) { rows in
                    ForEach(rows) { row in
                        if row.id != rows.first?.id {
                            Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, 14)
                        }
                        row.padding(.horizontal, 14).padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .environment(\.kitFieldFill, onCanvas ? Theme.band : Theme.surface)
            .background(onCanvas ? Theme.surface : Theme.band.opacity(0.55), in: .rect(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.hairline))
        }
    }
}

// MARK: - 确认框

/// 统一的确认框，替代系统 alert。危险操作使用红色主按钮，并逐条列出影响。
struct ConfirmSheet: View {
    var title: String
    var message: String
    var details: [String] = []
    var confirmTitle: String
    var destructive = false
    var onConfirm: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: destructive ? "exclamationmark.triangle.fill" : "questionmark")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(destructive ? Theme.danger : Theme.ink)
                    .frame(width: 38, height: 38)
                    .background(destructive ? Theme.danger.opacity(0.12) : Theme.band, in: .circle)
                VStack(alignment: .leading, spacing: 6) {
                    Text(title).font(.system(size: 22, weight: .heavy)).tracking(-0.44)
                        .lineLimit(2).help(title)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(message).font(TypeStyle.body).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !details.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(details, id: \.self) { d in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Circle().fill(Theme.muted).frame(width: 4, height: 4).offset(y: -2)
                            Text(d).font(TypeStyle.body).foregroundStyle(Theme.ink)
                        }
                    }
                }
                .padding(Space.l16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.band, in: .rect(cornerRadius: Radius.field))
            }
            HStack(spacing: Space.s8 + 2) {
                Spacer()
                Button("取消") { dismiss() }
                    .buttonStyle(PillButtonStyle(.secondary))
                    .keyboardShortcut(.cancelAction)
                Button(confirmTitle) { dismiss(); onConfirm() }
                    .buttonStyle(PillButtonStyle(destructive ? .danger : .primary))
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(28)
        .frame(width: 460)
        .background(Theme.surface)
    }
}

extension View {
    /// 用统一样式的确认框替代 `.alert` / `.confirmationDialog`。
    func confirmSheet(_ title: String, isPresented: Binding<Bool>, message: String, details: [String] = [],
                      confirmTitle: String, destructive: Bool = false, action: @escaping () -> Void) -> some View {
        sheet(isPresented: isPresented) {
            ConfirmSheet(title: title, message: message, details: details, confirmTitle: confirmTitle,
                         destructive: destructive, onConfirm: action)
        }
    }
}

// MARK: - 可复制文本

/// 生成一段可以先改再复制的文字（请补发、摘要等），复制后提示并关闭。
struct CopyTextSheet: View {
    var title: String
    var subtitle: String?
    @State var text: String
    /// 复制之后（例如催办后顺延跟进日）。
    var onCopy: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        SheetScaffold(title: title, subtitle: subtitle ?? "可先修改，再复制到微信、飞书或邮件中。", width: 520, height: 420) {
            TextEditor(text: $text)
                .font(TypeStyle.body)
                .scrollContentBackground(.hidden)
                .padding(10)
                .frame(minHeight: 220)
                .background(Theme.band, in: .rect(cornerRadius: Kit.fieldRadius))
                .overlay(RoundedRectangle(cornerRadius: Kit.fieldRadius).strokeBorder(Theme.hairline))
        } leading: {
            if copied {
                Label("已复制", systemImage: "checkmark.circle.fill").font(TypeStyle.body).foregroundStyle(Theme.limeText)
            }
        } trailing: {
            Button("取消") { dismiss() }.buttonStyle(PillButtonStyle(.secondary)).keyboardShortcut(.cancelAction)
            Button("复制文本") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
                copied = true
                onCopy?()
                Task { try? await Task.sleep(for: .milliseconds(600)); dismiss() }
            }
            .buttonStyle(PillButtonStyle(.primary)).keyboardShortcut(.defaultAction)
        }
    }
}

// MARK: - 状态：加载、空、失败

/// 骨架占位块：浅灰圆角条，带一道缓慢掠过的高光；减少动态效果时静止。
struct SkeletonBlock: View {
    var width: CGFloat? = nil
    var height: CGFloat = 12
    @State private var phase: CGFloat = -1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        RoundedRectangle(cornerRadius: min(height / 2, Radius.row))
            .fill(Theme.band)
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(colors: [Theme.band, Theme.hairline, Theme.band],
                                       startPoint: .leading, endPoint: .trailing)
                            .frame(width: geo.size.width)
                            .offset(x: phase * geo.size.width)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: min(height / 2, Radius.row)))
                }
            }
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { phase = 1 }
            }
            .accessibilityHidden(true)
    }
}

/// 空状态：图标、标题（17 / 650）、说明（灰）、可选一个小号主按钮。
struct EmptyStateView: View {
    var symbol: String
    var title: String
    var message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: Space.m12) {
            Image(systemName: symbol)
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(Theme.muted)
                .frame(width: 48, height: 48)
                .background(Theme.band, in: .circle)
            VStack(spacing: Space.xs4) {
                Text(title).font(TypeStyle.section).tracking(Tracking.section)
                Text(message).font(TypeStyle.body).foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: 380)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(PillButtonStyle(.primary, size: .small))
                    .padding(.top, Space.xs4)
            }
        }
        .padding(Space.section40)
        .frame(maxWidth: .infinity)
        .appear()
    }
}

/// 整页状态（空、失败）的容器：与正常页面一样放进 ScrollView 并撑满可视高度居中。
/// 详情栏里没有滚动视图时，系统会改变窗口工具栏 / 安全区的计算，
/// 导致侧栏顶部（集团切换）被顶进标题栏、挤到红绿灯旁边；统一容器可避免这一点。
struct FullPageState<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView(.vertical) {
            content
                .frame(maxWidth: .infinity)
                .containerRelativeFrame(.vertical, alignment: .center)
        }
        .scrollBounceBehavior(.basedOnSize)
    }
}

/// 失败状态：说明原因，并给一个“重试”。
struct ErrorStateView: View {
    var title: String
    var message: String
    var retryTitle = "重试"
    var retry: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: Space.m12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.danger)
                .frame(width: 48, height: 48)
                .background(Theme.dangerSoft, in: .circle)
            VStack(spacing: Space.xs4) {
                Text(title).font(TypeStyle.section).tracking(Tracking.section)
                Text(message).font(TypeStyle.body).foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: 380)
            if let retry {
                Button(action: retry) { Label(retryTitle, systemImage: "arrow.clockwise") }
                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
                    .padding(.top, Space.xs4)
            }
        }
        .padding(Space.section40)
        .frame(maxWidth: .infinity)
        .appear()
    }
}
