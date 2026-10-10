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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                section("按钮", note: "主要（黑）每个区域最多一个；次要为白底描边；轻量用于表格行内与工具操作；危险只用于不可撤销操作的最终确认；强调（柠檬绿）只用于复制摘要这类便捷操作。") { buttons }
                section("菜单", note: "替代系统菜单。展开为圆角浮层，悬停浅灰，危险项为红色；“…”菜单用轻量图标按钮。") { menus }
                section("下拉选择", note: "替代系统下拉框。外观与输入框一致；选项多于 8 个时自动出现搜索。") { selects }
                section("输入框", note: "浅灰底、圆角 10；聚焦时深色描边，格式错误时红色描边。表单统一用左标签、右控件。") { fields }
                section("日期", note: "可直接键入 2026-10-27，也可点日历图标选择。今天为柠檬绿圆环，选中为深色圆；签发日已知时可一键“签发后 3 / 6 / 12 个月”。") { dates }
                section("复选、单选、开关") { toggles }
                section("状态与分段", note: "绿色只表示有效；琥珀表示需要处理；红色只表示已过期。") { states }
                section("总览方块（按状态变色）", note: "健康时中性；30 天内有到期为琥珀，有已过期为红；已归档比例带柠檬绿进度。") { statCards }
                section("弹窗与确认框", note: "弹窗统一为标题区、内容区、底部操作栏；底部左侧放辅助操作，右侧“取消 → 主操作”。确认框替代系统弹框，危险操作逐条列出影响。") { dialogs }
            }
            .padding(28)
            .frame(maxWidth: 980, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.canvas)
        .preferredColorScheme(appearance == .system ? nil : (appearance == .dark ? .dark : .light))
        .frame(minWidth: 860, minHeight: 640)
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
                Text(title).font(TypeStyle.sectionTitle)
                if let note { Text(note).font(TypeStyle.body).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true) }
            }
            content()
        }
        .surfaceCard()
    }

    private func caption(_ t: String) -> some View {
        Text(t).font(TypeStyle.micro).foregroundStyle(Theme.muted).frame(width: 72, alignment: .leading)
    }

    // MARK: 按钮

    private var buttons: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach([(PillButtonStyle.Size.large, "大 42"), (.regular, "常规 34"), (.small, "小 28")], id: \.1) { size, label in
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
            FieldRow(label: "格式错误", hint: "日期格式应为 2026-10-27") { TextField("", text: $bad).textFieldStyle(KitFieldStyle(invalid: true)) }
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

/// 菜单“帮助 → 组件样板”。
struct ComponentGalleryCommand: View {
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Button("组件样板") { openWindow(id: "component-gallery") }
    }
}
