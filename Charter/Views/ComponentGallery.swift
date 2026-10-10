import SwiftUI

/// “组件样板”窗口：把规范里的每个组件和状态摆出来，浅色、深色可切换，用来确认样式。
/// 从菜单“帮助 → 组件样板”打开；不影响任何数据。
struct ComponentGallery: View {
    enum Appearance: Hashable { case system, light, dark }
    @State private var appearance: Appearance = .system

    // 演示用的状态
    @State private var text = "Yuanlan Group Ltd."
    @State private var empty = ""
    @State private var bad = "2026-13-40"
    @State private var check1 = true
    @State private var check2 = false
    @State private var switch1 = true
    @State private var switch2 = false
    @State private var radio = 1
    @State private var select = "kyc"
    @State private var selectMany = "HK"
    @State private var issue: Day? = Day(2026, 4, 27)
    @State private var expiry: Day? = nil
    @State private var segment = 0
    @State private var showSheet = false
    @State private var showConfirm = false
    @State private var showDelete = false
    @State private var showCopy = false
    @State private var demoToast: ToastView.Kind? = nil
    @State private var toastToken = UUID()
    @State private var motionOn = false
    @State private var counter = 12
    @State private var loading = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                section("字体层级", note: "系统字体，四档字号：Display 44/800、Title 28/750、Section 17/650、Body 14；Meta 12.5/500。标题收紧字距，数字等宽。") { typeScale }
                section("颜色", note: "中性色带冷灰，墨黑与柠檬绿为主。红色只表示过期或逾期，琥珀表示需要处理。") { colours }
                section("间距与圆角", note: "4 点网格；页边 32，区块间距 40。按钮为胶囊，输入框 12，行高亮 10，承载面 20。页面内不加阴影，只有浮层共用一层阴影。") { spacing }
                section("主指标", note: "每页一个主角：柠檬绿底、Display 数字、墨黑小按钮。") { hero }
                section("按钮", note: "主要（黑）每个区域最多一个；次要为白底描边；轻量用于表格行内与工具操作；危险只用于不可撤销操作的最终确认；强调（柠檬绿）只用于复制摘要这类便捷操作。") { buttons }
                section("菜单", note: "替代系统菜单。展开为圆角浮层，悬停浅灰，危险项为红色；“…”菜单用轻量图标按钮。") { menus }
                section("下拉选择", note: "替代系统下拉框。外观与输入框一致；选项多于 8 个时自动出现搜索。") { selects }
                section("输入框", note: "浅灰底、圆角 10；聚焦时深色描边，格式错误时红色描边。表单统一用左标签、右控件。") { fields }
                section("日期", note: "可直接键入 2026-10-27，也可点日历图标选择。今天为柠檬绿圆环，选中为深色圆；签发日已知时可一键“签发后 3 / 6 / 12 个月”。") { dates }
                section("复选、单选、开关") { toggles }
                section("状态与分段", note: "绿色只表示有效；琥珀表示需要处理；红色只表示已过期。") { states }
                section("总览方块（按状态变色）", note: "健康时中性；30 天内有到期为琥珀，有已过期为红；已归档比例带柠檬绿进度。") { statCards }
                section("加载、空、失败", note: "加载用骨架占位（减少动态效果时静止）；空状态说明下一步；失败说明原因并给“重试”。") { stateViews }
                section("提示条", note: "底部居中的墨黑胶囊。成功为柠檬绿圆点，可带“撤销”；失败为红色圆点，可带“重试”。3 秒后自动消失。") { toasts }
                section("动效", note: "一条缓动曲线 cubic-bezier(.2,.8,.2,1)；按下 120ms、切换 200ms、浮层 280ms。减少动态效果时只淡入淡出。") { motion }
                section("弹窗与确认框", note: "弹窗统一为标题区、内容区、底部操作栏；底部左侧放辅助操作，右侧“取消 → 主操作”。确认框替代系统弹框，危险操作逐条列出影响。") { dialogs }
            }
            .padding(Space.pageEdge)
            .frame(maxWidth: 980, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.canvas)
        .preferredColorScheme(appearance == .system ? nil : (appearance == .dark ? .dark : .light))
        .frame(minWidth: 860, minHeight: 640)
        .overlay(alignment: .bottom) {
            if let kind = demoToast {
                ToastView(text: kind == .success ? "已归档 3 份文件" : "保存失败：文件夹不可写",
                          kind: kind, actionTitle: kind == .success ? "撤销" : "重试") { demoToast = nil }
                    .padding(.bottom, Space.xxl32)
                    .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                    .id(toastToken)
            }
        }
        .animation(Motion.resolved(Motion.panel, reduceMotion: reduceMotion), value: demoToast)
        .animation(Motion.resolved(Motion.panel, reduceMotion: reduceMotion), value: toastToken)
        .sheet(isPresented: $showSheet) { demoSheet }
        .confirmSheet("合并“张三”到“佐藤健”？", isPresented: $showConfirm,
                      message: "任职、持股、代持关系、文件和集团顶层都会改到佐藤健名下，“张三”记为其别名。",
                      confirmTitle: "合并") {}
        .confirmSheet("删除“李四”？", isPresented: $showDelete,
                      message: "删除后可以在 6 秒内撤销。",
                      details: ["没有任职、持股或文件引用", "不会影响其他人员"],
                      confirmTitle: "删除", destructive: true) {}
        .sheet(isPresented: $showCopy) {
            CopyTextSheet(title: "请补发：董事在职证明",
                          text: "您好：\n\nYuanlan Group Ltd. 的董事在职证明（2026 年 4 月 27 日签发）需要更新，麻烦补发一份新的，谢谢。")
        }
    }

    // MARK: 顶部

    private var header: some View {
        HStack(alignment: .bottom) {
            PageTitle(title: "组件样板", subtitle: "Charter 的按钮、菜单、表单控件、日期、弹窗。确认后全应用统一替换。")
            Spacer()
            PillSegmented(options: [(Appearance.system, "跟随系统"), (.light, "浅色"), (.dark, "深色")], selection: $appearance)
        }
    }

    private func section<C: View>(_ title: String, note: String? = nil, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(TypeStyle.section).tracking(Tracking.section)
                if let note { Text(note).font(TypeStyle.body).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true) }
            }
            content()
        }
        .surfaceCard(padding: Space.xl24, radius: Radius.surface)
    }

    private func caption(_ t: String) -> some View {
        Text(t).font(TypeStyle.micro).foregroundStyle(Theme.muted).frame(width: 72, alignment: .leading)
    }

    // MARK: 按钮

    private var buttons: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach([(PillButtonStyle.Size.large, "大 44"), (.regular, "常规 38"), (.small, "小 30")], id: \.1) { size, label in
                HStack(spacing: 10) {
                    caption(label)
                    Button("准备文件包") {}.buttonStyle(PillButtonStyle(.primary, size: size))
                    Button("编辑") {}.buttonStyle(PillButtonStyle(.secondary, size: size))
                    Button("取消") {}.buttonStyle(PillButtonStyle(.quiet, size: size))
                    Button("删除") {}.buttonStyle(PillButtonStyle(.danger, size: size))
                    Button { } label: { Label("复制摘要", systemImage: "doc.on.doc") }.buttonStyle(PillButtonStyle(.accent, size: size))
                }
            }
            HStack(spacing: 10) {
                caption("带图标")
                Button { } label: { Label("导入文件", systemImage: "square.and.arrow.down") }.buttonStyle(PillButtonStyle(.primary))
                Button { } label: { Label("导出全部档案", systemImage: "archivebox") }.buttonStyle(PillButtonStyle(.secondary))
                Button { } label: { Image(systemName: "plus") }.buttonStyle(PillButtonStyle(.secondary)).help("新建")
            }
            HStack(spacing: 10) {
                caption("不可用")
                Button("准备文件包") {}.buttonStyle(PillButtonStyle(.primary)).disabled(true)
                Button("删除") {}.buttonStyle(PillButtonStyle(.secondary)).disabled(true)
                Text("不可用时说明原因：是“测试集团”的顶层").font(TypeStyle.metadata).foregroundStyle(Theme.muted)
            }
            Text("按下时缩到 97%（120ms）；用 Tab 键移到按钮上时出现柠檬绿焦点圈（需开启“全键盘控制”）。")
                .font(TypeStyle.meta).foregroundStyle(Theme.muted)
            Divider()
            HStack(spacing: 10) {
                caption("操作栏")
                Button("向负责方询问材料") {}.buttonStyle(PillButtonStyle(.secondary))
                Spacer()
                Button("关闭") {}.buttonStyle(PillButtonStyle(.secondary))
                Button("生成部分材料包") {}.buttonStyle(PillButtonStyle(.primary))
            }
            .padding(12)
            .background(Theme.band, in: .rect(cornerRadius: 14))
        }
    }

    // MARK: 菜单

    private var menus: some View {
        HStack(spacing: 12) {
            ActionMenu(title: "编辑与上下级", entries: [
                .item("编辑公司资料", systemImage: "pencil") {},
                .item("记录变更…", systemImage: "arrow.triangle.2.circlepath") {},
                .divider,
                .header("上下级"),
                .item("添加上级（股东）…", systemImage: "arrow.up") {},
                .item("添加下级公司…", systemImage: "arrow.down") {},
                .divider,
                .item("删除公司", systemImage: "trash", destructive: true) {}
            ])
            ActionMenu(title: "新建", systemImage: "plus", kind: .primary, entries: [
                .item("新建公司", systemImage: "building.2", shortcut: "⇧⌘N") {},
                .item("新建集团", systemImage: "square.stack.3d.up") {},
                .divider,
                .item("导入文件…", systemImage: "square.and.arrow.down", shortcut: "⌘I") {}
            ])
            ActionMenu(systemImage: "ellipsis", kind: .quiet, size: .small, entries: [
                .item("查看与编辑", systemImage: "doc.text.magnifyingglass") {},
                .item("打开文件", systemImage: "arrow.up.forward.app") {},
                .item("在访达中显示", systemImage: "folder") {},
                .divider,
                .item("标记为外部保管", systemImage: "building.columns") {},
                .item("本公司不再管理此条目", systemImage: "minus.circle", destructive: true) {}
            ])
            Text("← 行内“…”").font(TypeStyle.metadata).foregroundStyle(Theme.muted)
        }
    }

    // MARK: 下拉

    private var selects: some View {
        VStack(alignment: .leading, spacing: 12) {
            FieldRow(label: "用途") {
                SelectField(options: [("bank", "银行开户"), ("audit", "年度审计"), ("kyc", "KYC 更新")], selection: $select)
            }
            FieldRow(label: "法域", hint: "选项多于 8 个时带搜索") {
                SelectField(options: [("HK", "香港"), ("SG", "新加坡"), ("JP", "日本"), ("KR", "韩国"), ("TW", "台湾"),
                                      ("KY", "开曼群岛"), ("VG", "英属维尔京群岛"), ("VI", "美属维尔京群岛"), ("US", "美国")],
                            selection: $selectMany)
            }
        }
    }

    // MARK: 输入框

    private var fields: some View {
        VStack(alignment: .leading, spacing: 12) {
            FieldRow(label: "注册名") { TextField("公司注册名称", text: $text).textFieldStyle(KitFieldStyle()) }
            FieldRow(label: "备注", hint: "例如：由代理保管，需申请副本") { TextField("可选", text: $empty).textFieldStyle(KitFieldStyle()) }
            FieldRow(label: "格式错误", hint: "日期格式应为 2026-10-27",
                     error: Day(string: bad) == nil ? "日期格式应为 2026-10-27" : nil) {
                TextField("", text: $bad).textFieldStyle(KitFieldStyle(invalid: Day(string: bad) == nil))
            }
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
                TextField("搜索公司、编号或法域", text: $empty).textFieldStyle(.plain)
            }
            .padding(.horizontal, 14).frame(height: 36)
            .background(Theme.band, in: .capsule)
            .frame(maxWidth: 320)
        }
    }

    // MARK: 日期

    private var dates: some View {
        VStack(alignment: .leading, spacing: 12) {
            FieldRow(label: "签发日") { DateField(day: $issue) }
            FieldRow(label: "到期日", hint: "签发日已知时，日历底部可选“签发后 3 / 6 / 12 个月”") {
                DateField(day: $expiry, placeholder: "长期有效可留空", relativeTo: issue)
            }
        }
    }

    // MARK: 复选、单选、开关

    private var toggles: some View {
        HStack(alignment: .top, spacing: 40) {
            VStack(alignment: .leading, spacing: 10) {
                caption("复选")
                Toggle("注册证书", isOn: $check1).toggleStyle(KitCheckboxStyle())
                Toggle("董事名册", isOn: $check2).toggleStyle(KitCheckboxStyle())
            }
            VStack(alignment: .leading, spacing: 10) {
                caption("单选")
                RadioGroup(options: [(0, "长期有效"), (1, "签发后若干个月"), (2, "按文件上的到期日")], selection: $radio)
            }
            VStack(alignment: .leading, spacing: 10) {
                caption("开关")
                Toggle("附上董事护照", isOn: $switch1).toggleStyle(KitSwitchStyle()).frame(width: 200)
                Toggle("合规申报与交办", isOn: $switch2).toggleStyle(KitSwitchStyle()).frame(width: 200)
            }
        }
    }

    // MARK: 状态

    private var states: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                caption("状态胶囊")
                Pill(text: "有效", kind: .valid)
                Pill(text: "25 天后到期", kind: .warn)
                Pill(text: "需要更新", kind: .warn)
                Pill(text: "已过期 3 天", kind: .bad)
                Pill(text: "未归档", kind: .outline)
                Pill(text: "外部保管", kind: .neutral)
                Pill(text: "远澜集团", kind: .lime)
            }
            HStack(spacing: 8) {
                caption("分段")
                PillSegmented(options: [(0, "档案"), (1, "变更记录"), (2, "历史版本")], selection: $segment)
            }
            HStack(spacing: 8) {
                caption("进度")
                ProgressCapsule(value: 0.62).frame(width: 220)
                Text("档案 5/8").font(TypeStyle.metadata).foregroundStyle(Theme.muted)
            }
        }
    }

    private var statCards: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                StatCard(title: "公司", value: "13", caption: "7 个法域", style: .ink)
                StatCard(title: "已归档比例", value: "19%", caption: "已归档 18 / 93 条", progress: 0.19)
                StatCard(title: "30 天内到期", value: "2", caption: "点按查看即将到期的文件", style: .warn)
                StatCard(title: "未取得", value: "0", caption: "已明确标记暂未取得")
            }
            .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 12) {
                caption("有已过期时")
                StatCard(title: "30 天内到期", value: "2", caption: "另有 1 份已过期", style: .danger)
                StatCard(title: "未取得", value: "3", caption: "已明确标记暂未取得", style: .warn)
                Spacer()
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: 设计语言

    private var typeScale: some View {
        VStack(alignment: .leading, spacing: 0) {
            typeRow("Display 44 / 800") { Text("2 份文件需处理").font(TypeStyle.display).tracking(Tracking.display) }
            typeRow("Title 28 / 750") { Text("Yuanlan Group Ltd.").font(TypeStyle.title).tracking(Tracking.title) }
            typeRow("Section 17 / 650") { Text("档案清单").font(TypeStyle.section).tracking(Tracking.section) }
            typeRow("Body 14 / 400") { Text("董事在职证明，2026 年 4 月 27 日签发，3 个月内有效。").font(TypeStyle.body) }
            typeRow("Meta 12.5 / 500") { Text("开曼群岛，注册号 391245").font(TypeStyle.meta).foregroundStyle(Theme.muted) }
        }
    }

    private func typeRow<C: View>(_ label: String, @ViewBuilder _ sample: () -> C) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.l16) {
            Text(label).font(.mono(12)).foregroundStyle(Theme.muted).frame(width: 140, alignment: .leading)
            sample().lineLimit(1).minimumScaleFactor(0.5)
            Spacer(minLength: 0)
        }
        .padding(.vertical, Space.m12)
        .overlay(alignment: .top) { Rectangle().fill(Theme.hairline).frame(height: 1) }
    }

    private var colours: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: Space.m12)], spacing: Space.m12) {
            swatch("墨黑", "主按钮、选中", Theme.ink, Theme.onInk)
            swatch("柠檬绿", "主指标、进度、完成", Theme.lime, Theme.onLime)
            swatch("承载面", "每页一层", Theme.surface, Theme.ink)
            swatch("画布", "窗口底色", Theme.canvas, Theme.ink)
            swatch("琥珀", "即将到期、需更新", Theme.amber, Theme.onLime)
            swatch("红色", "仅过期、逾期", Theme.danger, Color.white)
        }
    }

    private func swatch(_ name: String, _ use: String, _ fill: Color, _ fg: Color) -> some View {
        VStack(alignment: .leading, spacing: Space.xs4) {
            Spacer(minLength: 0)
            Text(name).font(TypeStyle.rowTitle)
            Text(use).font(TypeStyle.meta).opacity(0.75)
        }
        .foregroundStyle(fg)
        .padding(Space.l16)
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .leading)
        .background(fill, in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.hairline))
    }

    private var spacing: some View {
        VStack(alignment: .leading, spacing: Space.l16) {
            HStack(alignment: .bottom, spacing: Space.l16) {
                ForEach([("4", Space.xs4), ("8", Space.s8), ("12", Space.m12), ("16", Space.l16), ("24", Space.xl24),
                         ("32", Space.xxl32), ("40", Space.section40), ("48", Space.xxxl48)], id: \.0) { label, v in
                    VStack(spacing: Space.xs4) {
                        Rectangle().fill(Theme.lime).frame(width: v, height: v)
                        Text(label).font(.mono(11)).foregroundStyle(Theme.muted)
                    }
                }
            }
            HStack(spacing: Space.l16) {
                radiusSample("胶囊 按钮", Capsule())
                radiusSample("12 输入框", RoundedRectangle(cornerRadius: Radius.field))
                radiusSample("10 行高亮", RoundedRectangle(cornerRadius: Radius.row))
                radiusSample("20 承载面", RoundedRectangle(cornerRadius: Radius.surface))
                VStack(spacing: Space.xs4) {
                    RoundedRectangle(cornerRadius: Radius.field).fill(Theme.surface).frame(width: 96, height: 56).floatingShadow()
                    Text("浮层阴影").font(TypeStyle.meta).foregroundStyle(Theme.muted)
                }
            }
        }
    }

    private func radiusSample<S: Shape>(_ label: String, _ shape: S) -> some View {
        VStack(spacing: Space.xs4) {
            shape.fill(Theme.band).overlay(shape.stroke(Theme.hairline)).frame(width: 96, height: 56)
            Text(label).font(TypeStyle.meta).foregroundStyle(Theme.muted)
        }
    }

    private var hero: some View {
        HStack(alignment: .bottom, spacing: Space.l16) {
            VStack(alignment: .leading, spacing: Space.xs4) {
                Text("需要处理").font(TypeStyle.meta).foregroundStyle(Theme.onLime.opacity(0.7))
                Text("\(counter) 份文件").font(TypeStyle.display).tracking(Tracking.display)
                    .numericTransition()
                    .foregroundStyle(Theme.onLime)
            }
            Spacer()
            Button("处理下一件") { Motion.perform { counter = max(0, counter - 1) } }
                .buttonStyle(InkOnLimeButtonStyle())
        }
        .padding(Space.xl24)
        .background(Theme.lime, in: .rect(cornerRadius: Radius.surface))
    }

    private var stateViews: some View {
        VStack(alignment: .leading, spacing: Space.l16) {
            HStack {
                caption("加载")
                Toggle("显示骨架", isOn: $loading).toggleStyle(KitSwitchStyle()).frame(width: 160)
            }
            if loading {
                VStack(alignment: .leading, spacing: Space.s8) {
                    SkeletonBlock(width: 220, height: 18)
                    SkeletonBlock(height: 12)
                    SkeletonBlock(width: 320, height: 12)
                }
                .padding(Space.l16)
                .background(Theme.canvas, in: .rect(cornerRadius: 16))
                .transition(.opacity)
            } else {
                Text("董事在职证明，2026 年 4 月 27 日签发。").font(TypeStyle.body)
                    .padding(Space.l16).appear()
            }
            HStack(alignment: .top, spacing: Space.m12) {
                EmptyStateView(symbol: "tray", title: "还没有文件", message: "把注册证书、董事名册拖进来，Charter 会自动归档。",
                               actionTitle: "导入文件") {}
                    .background(Theme.canvas, in: .rect(cornerRadius: 16))
                ErrorStateView(title: "读取失败", message: "数据文件夹暂时无法访问，检查网盘是否已登录。") {}
                    .background(Theme.canvas, in: .rect(cornerRadius: 16))
            }
        }
        .animation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion), value: loading)
    }

    private var toasts: some View {
        VStack(alignment: .leading, spacing: Space.m12) {
            HStack(spacing: Space.m12) {
                ToastView(text: "已归档 3 份文件", kind: .success, actionTitle: "撤销") {}
                ToastView(text: "保存失败：文件夹不可写", kind: .failure, actionTitle: "重试") {}
            }
            HStack(spacing: Space.s8) {
                Button("弹出成功提示") { showDemoToast(.success) }.buttonStyle(PillButtonStyle(.secondary, size: .small))
                Button("弹出失败提示") { showDemoToast(.failure) }.buttonStyle(PillButtonStyle(.secondary, size: .small))
            }
        }
    }

    private func showDemoToast(_ kind: ToastView.Kind) {
        let token = UUID()
        toastToken = token
        demoToast = kind
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            if toastToken == token { demoToast = nil }
        }
    }

    private var motion: some View {
        VStack(alignment: .leading, spacing: Space.m12) {
            ForEach([("按下 120ms", Motion.fast), ("切换 200ms", Motion.standard), ("浮层 280ms", Motion.panel)], id: \.0) { label, anim in
                HStack(spacing: Space.m12) {
                    caption(label)
                    ZStack(alignment: motionOn ? .trailing : .leading) {
                        Capsule().fill(Theme.band)
                        Capsule().fill(Theme.ink).frame(width: 80)
                    }
                    .frame(width: 320, height: 8)
                    .animation(Motion.resolved(anim, reduceMotion: reduceMotion), value: motionOn)
                }
            }
            HStack(spacing: Space.s8) {
                Button("播放") { motionOn.toggle() }.buttonStyle(PillButtonStyle(.primary, size: .small))
                Text(reduceMotion ? "已开启减少动态效果：只淡入淡出" : "数字变化：\(counter)")
                    .font(TypeStyle.meta).foregroundStyle(Theme.muted).numericTransition()
            }
        }
    }

    // MARK: 弹窗

    private var dialogs: some View {
        HStack(spacing: 10) {
            Button("打开示例弹窗") { showSheet = true }.buttonStyle(PillButtonStyle(.secondary))
            Button("合并确认") { showConfirm = true }.buttonStyle(PillButtonStyle(.secondary))
            Button("删除确认") { showDelete = true }.buttonStyle(PillButtonStyle(.secondary))
            Button("请补发（复制文本）") { showCopy = true }.buttonStyle(PillButtonStyle(.secondary))
        }
    }

    private var demoSheet: some View {
        SheetScaffold(title: "新建条目", subtitle: "加进开曼群岛的档案清单；以后新建开曼公司时自动带出。", width: 560) {
            VStack(alignment: .leading, spacing: 18) {
                FormGroup(title: "基本信息") {
                    FieldRow(label: "名称") { TextField("例如：商业登记证（BR）", text: $empty).textFieldStyle(KitFieldStyle()) }
                    FieldRow(label: "类别", hint: "用于矩阵的列，跨法域把同类文件放在一起") {
                        SelectField(options: [("cert", "注册证书"), ("good", "存续证明"), ("reg", "董事名册")], selection: $select)
                    }
                }
                FormGroup(title: "有效期") {
                    RadioGroup(options: [(0, "长期有效"), (1, "签发后若干个月"), (2, "按文件上的到期日")], selection: $radio)
                    FieldRow(label: "参考签发日") { DateField(day: $issue) }
                }
                FormGroup(title: "适用范围") {
                    Toggle("所有开曼公司", isOn: $check1).toggleStyle(KitCheckboxStyle())
                    Toggle("仅本公司", isOn: $check2).toggleStyle(KitCheckboxStyle())
                }
            }
        } leading: {
            Button("恢复内置条目") {}.buttonStyle(PillButtonStyle(.secondary))
        } trailing: {
            Button("取消") { showSheet = false }.buttonStyle(PillButtonStyle(.secondary)).keyboardShortcut(.cancelAction)
            Button("添加") { showSheet = false }.buttonStyle(PillButtonStyle(.primary)).keyboardShortcut(.defaultAction)
        }
    }
}

/// 柠檬绿主指标块上的墨黑小按钮（两种外观下都保持墨黑，保证在柠檬绿上的对比）。
private struct InkOnLimeButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .padding(.horizontal, 14).frame(height: PillButtonStyle.Size.small.height)
            .background(Theme.emphasis.opacity(configuration.isPressed ? 0.85 : 1), in: .capsule)
            .foregroundStyle(Theme.onEmphasis)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(Motion.resolved(Motion.fast, reduceMotion: reduceMotion), value: configuration.isPressed)
            .contentShape(.capsule)
    }
}

/// 菜单“帮助 → 组件样板”。
struct ComponentGalleryCommand: View {
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Button("组件样板") { openWindow(id: "component-gallery") }
    }
}
