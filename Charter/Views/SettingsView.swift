import SwiftUI
import AppKit

struct SettingsView: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        TabView {
            GeneralSettings().tabItem { Label("通用", systemImage: "gearshape") }
            ArchiveItemsSettings().tabItem { Label("档案条目", systemImage: "list.bullet.rectangle") }
            if store.complianceOn {
                RulesSettings().tabItem { Label("合规规则", systemImage: "calendar.badge.clock") }
            }
            PacketSettings().tabItem { Label("导出用途", systemImage: "shippingbox") }
        }
    }
}

// MARK: - 通用

struct GeneralSettings: View {
    @Environment(AppStore.self) private var store
    @State private var confirmSample = false
    @State private var newDay = ""
    @FocusState private var newDayFocused: Bool

    private var inICloud: Bool { store.store.root.path.contains("Mobile Documents") }

    var body: some View {
        @Bindable var store = store
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                folderCard
                section("提醒") {
                    SettingRow(symbol: "bell.badge", title: "到期前提醒",
                               detail: "文件到期前按这些天数提醒，每天 \(store.settings.notificationHour):00 发出。") {
                        EmptyView()
                    }
                    dayChips
                        .padding(.leading, 52)
                    SettingRow(symbol: "clock", title: "提醒时间", detail: "通知和日历提醒统一在这个时间。") {
                        SelectField(options: (6..<22).map { ($0, "\($0):00") }, selection: $store.settings.notificationHour, minWidth: 110)
                            .onChange(of: store.settings.notificationHour) { store.saveSettings() }
                    }
                    SettingRow(symbol: "laptopcomputer", title: "主 Mac",
                               detail: "只有主 Mac 发送通知和写入日历，避免两台 Mac 重复提醒。") {
                        if store.isPrimaryDevice {
                            Pill(text: "这台 Mac", kind: .valid)
                        } else {
                            HStack(spacing: 8) {
                                Text(store.settings.primaryDeviceName ?? "另一台 Mac").font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                                Button("设为主 Mac") {
                                    store.settings.primaryDeviceID = store.deviceID
                                    store.settings.primaryDeviceName = store.deviceName
                                    store.saveSettings()
                                }
                                .buttonStyle(PillButtonStyle(.secondary, size: .small))
                            }
                        }
                    }
                    if store.complianceOn {
                        SettingRow(symbol: "calendar", title: "同步到 Apple 日历",
                                   detail: "写入“\(store.settings.calendarName)”日历。") {
                            Toggle("", isOn: $store.settings.calendarEnabled).labelsHidden()
                                .toggleStyle(KitSwitchStyle()).fixedSize()
                                .onChange(of: store.settings.calendarEnabled) { store.saveSettings() }
                        }
                    }
                }
                section("模块") {
                    SettingRow(symbol: "checklist", title: "合规申报与交办",
                               detail: "显示“今天”“合规日历”“负责方”，跟踪年报、税表等申报截止日并交办给负责方。关闭后已有数据仍会保留。") {
                        Toggle("", isOn: Binding(get: { store.complianceOn }, set: { store.settings.complianceEnabled = $0; store.saveSettings() }))
                            .labelsHidden().toggleStyle(KitSwitchStyle()).fixedSize()
                    }
                }
                section("示例数据") {
                    SettingRow(symbol: "shippingbox", title: "载入示例数据",
                               detail: "一套虚构的远澜集团数据，会覆盖当前文件夹里的公司、人员和负责方。建议先更换为空文件夹。") {
                        Button("载入…") { confirmSample = true }
                            .buttonStyle(PillButtonStyle(.secondary, size: .small))
                    }
                }
            }
            .padding(28)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.canvas)
        .confirmSheet("载入示例数据？", isPresented: $confirmSample,
                      message: "示例数据会覆盖当前数据文件夹里的公司、人员和负责方。建议先更换为空文件夹。",
                      confirmTitle: "载入", destructive: true) {
            SampleData.install(into: store)
        }
    }

    /// 顶部：数据文件夹。这是整个应用最重要的一项设置，用一张醒目的卡片呈现。
    private var folderCard: some View {
        HStack(alignment: .center, spacing: 18) {
            Image(systemName: inICloud ? "icloud.fill" : "folder.fill")
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(Theme.onInk)
                .frame(width: 64, height: 64)
                .background(Theme.ink, in: .rect(cornerRadius: 18, style: .continuous))
            VStack(alignment: .leading, spacing: 5) {
                Text("数据文件夹").font(TypeStyle.micro).foregroundStyle(Theme.muted)
                Text(store.store.root.lastPathComponent).font(.system(size: 20, weight: .semibold)).tracking(-0.3)
                    .foregroundStyle(Theme.ink).lineLimit(1)
                HStack(spacing: 6) {
                    Circle().fill(inICloud ? Theme.lime : Theme.muted.opacity(0.5)).frame(width: 7, height: 7)
                    Text(inICloud ? "在 iCloud 云盘中，两台 Mac 自动同步" : "仅保存在这台 Mac 上")
                        .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                }
                Text(store.store.root.path).font(.system(size: 11)).foregroundStyle(Theme.muted.opacity(0.8))
                    .lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                    .help(store.store.root.path)
            }
            Spacer(minLength: 12)
            VStack(alignment: .trailing, spacing: 8) {
                Button("在访达中打开") { NSWorkspace.shared.open(store.store.root) }
                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
                Button("更换文件夹…") { chooseFolder() }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
            }
        }
        .padding(20)
        .background(Theme.surface, in: .rect(cornerRadius: 22, style: .continuous))
    }

    /// 提前提醒的天数：每个天数一枚胶囊，可移除；末尾可直接输入新的天数。
    private var dayChips: some View {
        HStack(spacing: 8) {
            ForEach(store.settings.reminderDays.sorted(by: >), id: \.self) { d in
                HStack(spacing: 6) {
                    Text("\(d) 天").font(.system(size: 12.5, weight: .semibold)).monospacedDigit()
                    if store.settings.reminderDays.count > 1 {
                        Button {
                            store.settings.reminderDays.removeAll { $0 == d }
                            store.saveSettings()
                        } label: {
                            Image(systemName: "xmark").font(.system(size: 8.5, weight: .bold))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("移除 \(d) 天")
                    }
                }
                .foregroundStyle(Theme.limeText)
                .padding(.horizontal, 12).frame(height: 28)
                .background(Theme.limeSoft, in: .capsule)
            }
            HStack(spacing: 4) {
                Image(systemName: "plus").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.muted)
                TextField("天数", text: $newDay)
                    .textFieldStyle(.plain).font(.system(size: 12.5))
                    .frame(width: 34)
                    .focused($newDayFocused)
                    .onSubmit(addDay)
                    .onChange(of: newDayFocused) { _, f in if !f { addDay() } }
            }
            .padding(.horizontal, 10).frame(height: 28)
            .overlay(Capsule().strokeBorder(Theme.hairline, style: StrokeStyle(lineWidth: 1, dash: [3, 2.5])))
            .help("输入天数后按回车添加")
        }
    }

    private func addDay() {
        guard let d = Int(newDay.trimmingCharacters(in: .whitespaces)), d > 0, d <= 730 else { newDay = ""; return }
        if !store.settings.reminderDays.contains(d) {
            store.settings.reminderDays = (store.settings.reminderDays + [d]).sorted(by: >)
            store.saveSettings()
        }
        newDay = ""
    }

    private func section<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted).padding(.leading, 6)
            VStack(alignment: .leading, spacing: 16) {
                content()
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: .rect(cornerRadius: 18, style: .continuous))
        }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "使用这个文件夹"
        panel.directoryURL = FolderStore.defaultRoot.deletingLastPathComponent()
        if panel.runModal() == .OK, let url = panel.url { store.changeDataRoot(to: url) }
    }
}

// MARK: - 文件类型

struct DocumentTypesSettings: View {
    @Environment(AppStore.self) private var store
    @State private var selection: String?
    @State private var jurisdiction = "全部"

    private var list: [DocumentType] {
        store.library.documentTypes.filter { jurisdiction == "全部" || ($0.jurisdictions.isEmpty && jurisdiction == "通用") || $0.jurisdictions.contains(jurisdiction) }
    }

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                SelectField(options: [("全部", "全部"), ("通用", "通用")] + store.library.jurisdictions.map { ($0.code, $0.name) },
                            selection: $jurisdiction, minWidth: 200)
                    .padding(8)
                List(selection: $selection) {
                    ForEach(list) { t in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(t.name).fontWeight(.medium)
                            Text("\(t.category)，\(t.jurisdictions.isEmpty ? "通用" : t.jurisdictions.joined(separator: "、"))").font(.caption).foregroundStyle(.secondary)
                        }
                        .tag(t.id)
                    }
                }
                HStack {
                    Button { add() } label: { Image(systemName: "plus") }
                    Button { remove() } label: { Image(systemName: "minus") }.disabled(selection == nil)
                    Spacer()
                }
                .buttonStyle(.borderless).padding(8)
            }
            .frame(minWidth: 240, maxWidth: 300)

            if let i = store.library.documentTypes.firstIndex(where: { $0.id == selection }) {
                DocumentTypeForm(type: Binding(get: { store.library.documentTypes[i] }, set: { store.library.documentTypes[i] = $0; store.saveLibrary() }))
            } else {
                Text("选择要编辑的文件类型").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private func add() {
        let j = jurisdiction == "全部" || jurisdiction == "通用" ? [] : [jurisdiction]
        let t = DocumentType(id: "custom.\(UUID().uuidString.prefix(8))", name: "新文件类型", category: "其他", localNames: [], jurisdictions: j,
                             owner: .company, validity: .permanent, validityMonths: nil, hints: [], builtIn: false)
        store.library.documentTypes.append(t)
        store.saveLibrary()
        selection = t.id
    }

    private func remove() {
        guard let id = selection else { return }
        if store.documents.contains(where: { $0.typeID == id }) {
            store.errorMessage = "仍有文件使用这个类型。请先将这些文件改为其他类型，再删除。"
            return
        }
        store.library.documentTypes.removeAll { $0.id == id }
        store.saveLibrary()
        selection = nil
    }
}

struct DocumentTypeForm: View {
    @Environment(AppStore.self) private var store
    @Binding var type: DocumentType
    /// 放在设置画布上时，由外层负责滚动和边距，分组用白底卡片。
    var onCanvas = false

    private var monthOptions: [(Int, String)] {
        var values = ArchiveItemDraft.monthChoices
        let current = type.validityMonths ?? 6
        if !values.contains(current) { values.append(current); values.sort() }
        return values.map { ($0, "\($0) 个月") }
    }

    @ViewBuilder
    var body: some View {
        if onCanvas {
            fields
        } else {
            ScrollView {
                fields.padding(20)
            }
            .scrollIndicators(.never)
            .frame(minWidth: 420)
        }
    }

    private var fields: some View {
            VStack(alignment: .leading, spacing: 18) {
                FormGroup(title: "基本信息", onCanvas: onCanvas) {
                    FieldRow(label: "显示名称") {
                        TextField("例如：商业登记证", text: $type.name).textFieldStyle(KitFieldStyle())
                    }
                    FieldRow(label: "通用类别", hint: "跨法域归并同类文件，例如“存续证明”；也用作矩阵的列") {
                        TextField("例如：存续证明", text: $type.category).textFieldStyle(KitFieldStyle())
                    }
                    FieldRow(label: "归属") {
                        RadioGroup(options: [(NodeKind.company, "公司"), (.person, "人")], selection: $type.owner, horizontal: true)
                    }
                }
                FormGroup(title: "识别", onCanvas: onCanvas) {
                    FieldRow(label: "当地名称", hint: "当地叫法与别名，用逗号分隔") {
                        ListField(title: "例如：Certificate of Incumbency", values: $type.localNames).textFieldStyle(KitFieldStyle())
                    }
                    FieldRow(label: "识别线索", hint: "文件里常出现的词，用逗号分隔") {
                        ListField(title: "例如：incumbency, registered agent", values: $type.hints).textFieldStyle(KitFieldStyle())
                    }
                    FieldRow(label: "适用法域", hint: "法域代码，用逗号分隔；留空表示所有法域") {
                        ListField(title: "例如：KY, BVI", values: $type.jurisdictions).textFieldStyle(KitFieldStyle())
                    }
                }
                FormGroup(title: "有效期", onCanvas: onCanvas) {
                    RadioGroup(options: ValidityKind.allCases.map { ($0, $0.label) }, selection: $type.validity)
                    if type.validity == .monthsAfterIssue {
                        FieldRow(label: "有效月数", hint: "从签发日起算") {
                            SelectField(options: monthOptions,
                                        selection: Binding(get: { type.validityMonths ?? 6 }, set: { type.validityMonths = $0 }),
                                        minWidth: 140)
                        }
                    }
                }
                if type.builtIn {
                    Text("内置类型，可以修改。名称和有效期请按负责方和银行的要求核对。")
                        .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 4)
                }
            }
    }
}

/// 逗号分隔编辑字符串数组。
struct ListField: View {
    var title: String
    @Binding var values: [String]
    @State private var text = ""

    var body: some View {
        TextField(title, text: $text, axis: .vertical)
            .onAppear { text = values.joined(separator: ", ") }
            .onChange(of: values) { if parse(text) != values { text = values.joined(separator: ", ") } }
            .onChange(of: text) { commit() }
    }

    private func parse(_ t: String) -> [String] {
        t.split(whereSeparator: { ",，".contains($0) }).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    private func commit() {
        let v = parse(text)
        if v != values { values = v }
    }
}

// MARK: - 合规规则

struct RulesSettings: View {
    @Environment(AppStore.self) private var store
    @State private var selection: String?
    @State private var jurisdiction = "全部"
    @State private var draftsOnly = false
    @State private var confirming: String?
    @State private var deleting = false

    private func isDraft(_ r: RuleTemplate) -> Bool { r.verification?.status != .confirmed }

    private var list: [RuleTemplate] {
        store.library.rules.filter { (jurisdiction == "全部" || $0.jurisdictions.contains(jurisdiction)) && (!draftsOnly || isDraft($0)) }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 20) {
            VStack(alignment: .leading, spacing: 14) {
                SettingsPaneHeader(title: "合规规则",
                                   detail: "各法域申报截止日的计算方式。只有核对过的规则才按确定日期提醒。")
                HStack(spacing: 8) {
                    SelectField(options: [("全部", "全部法域")] + store.library.jurisdictions.map { ($0.code, $0.name) },
                                selection: $jurisdiction, minWidth: 150)
                    Spacer(minLength: 0)
                    Toggle("只看待核对（\(store.library.rules.filter(isDraft).count)）", isOn: $draftsOnly)
                        .toggleStyle(KitCheckboxStyle())
                }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(list) { r in
                            RuleListRow(title: r.name.isEmpty ? "未命名规则" : r.name,
                                        detail: "\(r.jurisdictions.joined(separator: "、"))，\(r.schedule.summary)",
                                        enabled: r.enabled,
                                        draft: isDraft(r),
                                        selected: r.id == selection) { selection = r.id }
                        }
                    }
                    .padding(8)
                }
                .scrollIndicators(.never)
                .frame(maxHeight: .infinity)
                .background(Theme.surface, in: .rect(cornerRadius: 18, style: .continuous))
                .overlay {
                    if list.isEmpty {
                        Text("没有符合条件的规则。").font(TypeStyle.body).foregroundStyle(Theme.muted)
                    }
                }
                HStack {
                    Button { add() } label: { Label("新建规则", systemImage: "plus") }
                        .buttonStyle(PillButtonStyle(.primary))
                    Spacer(minLength: 0)
                }
            }
            .frame(width: 340)
            .frame(maxHeight: .infinity, alignment: .top)

            if let i = store.library.rules.firstIndex(where: { $0.id == selection }) {
                ScrollView {
                    RuleForm(rule: Binding(get: { store.library.rules[i] }, set: { store.updateRule($0) }),
                             onConfirm: { confirming = store.library.rules[i].id },
                             onDelete: { deleting = true })
                        .id(store.library.rules[i].id)
                        .padding(.bottom, 8)
                }
                .scrollIndicators(.never)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.system(size: 22, weight: .medium)).foregroundStyle(Theme.ink)
                        .frame(width: 52, height: 52)
                        .background(Theme.surface, in: .rect(cornerRadius: 15, style: .continuous))
                    Text("选择要编辑的规则").font(TypeStyle.rowTitle).foregroundStyle(Theme.ink)
                    Text("可在这里核对规则、调整截止日算法和提醒。")
                        .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.canvas)
        .sheet(isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } })) {
            if let id = confirming { RuleConfirmSheet(ruleID: id, companyID: nil) }
        }
        .confirmSheet("删除这条规则？", isPresented: $deleting,
                      message: "删除后不再按这条规则生成待办事项。已完成事项的记录会保留。",
                      confirmTitle: "删除", destructive: true) {
            remove()
        }
    }

    private func add() {
        let j = jurisdiction == "全部" ? [store.library.jurisdictions.first?.code ?? "HK"] : [jurisdiction]
        let r = RuleTemplate(id: "custom.\(UUID().uuidString.prefix(8))", name: "新规则", localName: "", jurisdictions: j, entityForms: [],
                             schedule: Schedule(kind: .annualFixed, date: MonthDay(12, 31)), adjust: .none, reminders: nil,
                             requiredDocTypeIDs: [], responsibleHint: "", penalty: "", notes: "", needsReview: false, enabled: true, builtIn: false)
        store.library.rules.append(r)
        store.saveLibrary()
        selection = r.id
    }

    private func remove() {
        guard let id = selection else { return }
        store.library.rules.removeAll { $0.id == id }
        store.saveLibrary()
        selection = nil
    }
}

/// 规则清单的一行：名称和法域、算法摘要；待核对的规则带标记，停用的规则文字变浅。
private struct RuleListRow: View {
    var title: String
    var detail: String
    var enabled: Bool
    var draft: Bool
    var selected: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(TypeStyle.rowTitle)
                        .foregroundStyle(selected ? Theme.onSelection : (enabled ? Theme.ink : Theme.muted))
                        .lineLimit(1)
                    Text(enabled ? detail : "已停用，\(detail)")
                        .font(TypeStyle.metadata)
                        .foregroundStyle(selected ? Theme.onSelection.opacity(0.7) : Theme.muted)
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
                if draft { TrustBadge(trust: .draft) }
            }
            .padding(.horizontal, 10).frame(minHeight: 48)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? Theme.selection : (hovering ? Theme.band : Color.clear),
                        in: .rect(cornerRadius: 12, style: .continuous))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

struct RuleForm: View {
    @Environment(AppStore.self) private var store
    @Binding var rule: RuleTemplate
    var onConfirm: () -> Void = {}
    var onDelete: () -> Void = {}

    var body: some View {
        let v = rule.verification
        let overrides = store.companies.filter { $0.ruleOverrides?[rule.id] != nil }
        VStack(alignment: .leading, spacing: 20) {
            SettingsPaneHeader(title: rule.name.isEmpty ? "未命名规则" : rule.name, detail: rule.schedule.summary) {
                Button("删除规则", action: onDelete)
                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
            }

            FormGroup(title: "基本信息", onCanvas: true) {
                FieldRow(label: "名称") {
                    TextField("名称", text: $rule.name).textFieldStyle(KitFieldStyle())
                }
                FieldRow(label: "当地名称") {
                    TextField("可选", text: $rule.localName).textFieldStyle(KitFieldStyle())
                }
                FieldRow(label: "适用法域", hint: "法域代码，用逗号分隔，例如 HK, SG。") {
                    ListField(title: "HK, SG", values: $rule.jurisdictions).textFieldStyle(KitFieldStyle())
                }
                FieldRow(label: "公司类型", hint: "只适用于这些公司类型；留空则适用全部。") {
                    ListField(title: "全部", values: $rule.entityForms).textFieldStyle(KitFieldStyle())
                }
                Toggle("启用这条规则", isOn: $rule.enabled)
                    .toggleStyle(KitSwitchStyle())
            }

            FormGroup(title: "核对", onCanvas: true) {
                FieldRow(label: "状态") {
                    TrustBadge(trust: v?.status == .confirmed ? .confirmed(scope: "该法域通用", on: v?.confirmedOn) : .draft, showConfirmed: true)
                }
                if let v, v.status == .confirmed {
                    FieldRow(label: "依据") { valueText(v.source.isEmpty ? v.sourceKind : "\(v.sourceKind)：\(v.source)") }
                    FieldRow(label: "核对人") { valueText(v.confirmedBy) }
                    FieldRow(label: "核对日期") { valueText(v.confirmedOn?.long ?? "—") }
                }
                if !overrides.isEmpty {
                    FieldRow(label: "单独确认") { valueText(overrides.map(\.name).joined(separator: "、")) }
                }
                HStack(spacing: 12) {
                    Button(v?.status == .confirmed ? "修改核对信息…" : "确认这条规则…") { onConfirm() }
                        .buttonStyle(PillButtonStyle(.primary, size: .small))
                    Text("修改下面的算法后，这条规则会退回“待核对”。")
                        .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            FormGroup(title: "截止日计算", onCanvas: true) {
                ScheduleEditor(schedule: $rule.schedule)
                FieldRow(label: "遇周末") {
                    SelectField(options: DateAdjust.allCases.map { ($0, $0.label) }, selection: $rule.adjust, minWidth: 220)
                }
                FieldRow(label: "提前提醒", hint: "到期前几天提醒，用逗号分隔；留空则用通用设置。") {
                    TextField("60, 30, 7", text: Binding(
                        get: { rule.reminders?.map(String.init).joined(separator: ", ") ?? "" },
                        set: { v in
                            let d = v.split(whereSeparator: { ",， ".contains($0) }).compactMap { Int($0) }
                            rule.reminders = d.isEmpty ? nil : d.sorted(by: >)
                        }))
                        .textFieldStyle(KitFieldStyle())
                        .frame(maxWidth: 220)
                }
            }

            FormGroup(title: "说明", onCanvas: true) {
                FieldRow(label: "通常办理方") {
                    TextField("例如公司秘书、税务代理", text: $rule.responsibleHint).textFieldStyle(KitFieldStyle())
                }
                FieldRow(label: "逾期后果") {
                    TextField("可选", text: $rule.penalty, axis: .vertical)
                        .lineLimit(1...4).textFieldStyle(KitFieldStyle())
                }
                FieldRow(label: "备注") {
                    TextField("可选", text: $rule.notes, axis: .vertical)
                        .lineLimit(1...6).textFieldStyle(KitFieldStyle())
                }
            }

            if let revs = rule.revisions, !revs.isEmpty {
                FormGroup(title: "修改记录", onCanvas: true) {
                    ForEach(Array(revs.reversed().enumerated()), id: \.offset) { item in
                        FieldRow(label: item.element.on.long) { valueText(item.element.summary) }
                    }
                }
            }
        }
        .frame(minWidth: 400, maxWidth: .infinity, alignment: .leading)
    }

    private func valueText(_ s: String) -> some View {
        Text(s).font(TypeStyle.body).foregroundStyle(Theme.ink)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }
}

/// 月日选择：放在 FormGroup 里的一行。
struct MonthDayField: View {
    var title: String
    @Binding var value: MonthDay

    var body: some View {
        FieldRow(label: title) {
            HStack(spacing: 8) {
                SelectField(options: (1...12).map { ($0, "\($0) 月") }, selection: $value.month, minWidth: 90)
                SelectField(options: (1...31).map { ($0, "\($0) 日") }, selection: $value.day, minWidth: 90)
            }
        }
    }
}

// MARK: - 导出用途

struct PacketSettings: View {
    @Environment(AppStore.self) private var store
    @State private var editing: PurposeEditTarget?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                SettingsHero(symbol: "shippingbox.fill", label: "导出用途",
                             title: store.library.packets.isEmpty ? "还没有用途" : "\(store.library.packets.count) 个用途",
                             status: "准备文件包时按用途挑选材料，例如银行开户、年度审计、KYC 更新",
                             dot: store.library.packets.isEmpty ? Theme.muted.opacity(0.5) : Theme.lime) {
                    Button { editing = PurposeEditTarget(purposeID: nil) } label: { Label("新建用途", systemImage: "plus") }
                        .buttonStyle(PillButtonStyle(.primary))
                }
                SettingsSection(title: "用途", spacing: 0) {
                    if store.library.packets.isEmpty {
                        Text("还没有用途。新建用途并选择所需的文件类别。")
                            .font(TypeStyle.body).foregroundStyle(Theme.muted)
                    }
                    ForEach(Array(store.library.packets.enumerated()), id: \.element.id) { pair in
                        if pair.offset > 0 {
                            Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, 52).padding(.vertical, 14)
                        }
                        PurposeCard(purpose: pair.element) { editing = PurposeEditTarget(purposeID: pair.element.id) }
                    }
                }
            }
            .padding(28)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.canvas)
        .sheet(item: $editing) { target in
            PurposeEditor(purposeID: target.purposeID)
        }
    }
}

/// 设置里的一个用途：图标方块、名称、所需类别胶囊、附加要求和编辑按钮。
private struct PurposeCard: View {
    var purpose: PacketTemplate
    var onEdit: () -> Void
    private let maxChips = 6

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: "shippingbox")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.ink)
                .frame(width: 38, height: 38)
                .background(Theme.band, in: .rect(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 8) {
                Text(purpose.name.isEmpty ? "未命名用途" : purpose.name)
                    .font(TypeStyle.rowTitle).foregroundStyle(Theme.ink)
                    .frame(minHeight: 20, alignment: .leading)
                SettingsChipFlow(spacing: 6) {
                    if purpose.categories.isEmpty {
                        chip("未选文件类别", muted: true)
                    }
                    ForEach(Array(purpose.categories.prefix(maxChips)), id: \.self) { c in
                        chip(c, muted: false)
                    }
                    if purpose.categories.count > maxChips {
                        chip("+\(purpose.categories.count - maxChips)", muted: false)
                            .help(purpose.categories.dropFirst(maxChips).joined(separator: "、"))
                    }
                    if purpose.includeDirectorsPassports {
                        chip("附董事护照", muted: true, symbol: "person.text.rectangle")
                    }
                    if let m = purpose.maxAgeMonths {
                        chip("\(m) 个月内签发", muted: true, symbol: "clock")
                    }
                }
            }
            Spacer(minLength: 12)
            Button("编辑", action: onEdit)
                .buttonStyle(PillButtonStyle(.secondary, size: .small))
        }
        .contentShape(.rect)
        .onTapGesture(count: 2, perform: onEdit)
        .help(PurposeEditor.summary(of: purpose))
    }

    private func chip(_ text: String, muted: Bool, symbol: String? = nil) -> some View {
        HStack(spacing: 4) {
            if let symbol { Image(systemName: symbol).font(.system(size: 9.5, weight: .semibold)) }
            Text(text).font(.system(size: 12, weight: .semibold)).lineLimit(1)
        }
        .foregroundStyle(muted ? Theme.muted : Theme.limeText)
        .padding(.horizontal, 10).frame(height: 24)
        .background(muted ? Theme.band : Theme.limeSoft, in: .capsule)
    }
}

// MARK: - 设置页共用

/// 设置里的一行：左侧图标方块，标题和说明，右侧控件。
struct SettingRow<Trailing: View>: View {
    var symbol: String
    var title: String
    var detail: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.ink)
                .frame(width: 38, height: 38)
                .background(Theme.band, in: .rect(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(TypeStyle.rowTitle).foregroundStyle(Theme.ink)
                if let detail {
                    Text(detail).font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 12)
            trailing
        }
    }
}

/// 设置页的分区：上方灰色小标题，下方白色圆角卡片。
struct SettingsSection<Content: View>: View {
    var title: String?
    var spacing: CGFloat = 16
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title {
                Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted).padding(.leading, 6)
            }
            VStack(alignment: .leading, spacing: spacing) {
                content
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: .rect(cornerRadius: 18, style: .continuous))
        }
    }
}

/// 主从布局里每一栏顶部的标题行：标题、一行说明、右侧操作。
struct SettingsPaneHeader<Trailing: View>: View {
    var title: String
    var detail: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 17, weight: .semibold)).tracking(-0.2)
                    .foregroundStyle(Theme.ink).lineLimit(1)
                if let detail {
                    Text(detail).font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            trailing
        }
    }
}

extension SettingsPaneHeader where Trailing == EmptyView {
    init(title: String, detail: String? = nil) {
        self.title = title
        self.detail = detail
        self.trailing = EmptyView()
    }
}

/// 设置页顶部的主卡片：黑色大图标、小标签、标题和带圆点的状态行。
struct SettingsHero<Trailing: View>: View {
    var symbol: String
    var label: String
    var title: String
    var status: String
    var dot: Color
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 18) {
            Image(systemName: symbol)
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(Theme.onInk)
                .frame(width: 64, height: 64)
                .background(Theme.ink, in: .rect(cornerRadius: 18, style: .continuous))
            VStack(alignment: .leading, spacing: 5) {
                Text(label).font(TypeStyle.micro).foregroundStyle(Theme.muted)
                Text(title).font(.system(size: 20, weight: .semibold)).tracking(-0.3)
                    .foregroundStyle(Theme.ink).lineLimit(1)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Circle().fill(dot).frame(width: 7, height: 7)
                    Text(status).font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 12)
            trailing
        }
        .padding(20)
        .background(Theme.surface, in: .rect(cornerRadius: 22, style: .continuous))
    }
}

/// 自动换行的胶囊排布。
struct SettingsChipFlow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(width: bounds.width, subviews: subviews)
        var y = bounds.minY
        for row in rows {
            var x = bounds.minX
            for i in row.indices {
                let size = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for i in subviews.indices {
            let size = subviews[i].sizeThatFits(.unspecified)
            let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            if !current.indices.isEmpty && needed > width {
                rows.append(current)
                current = Row()
            }
            current.width = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
            current.indices.append(i)
        }
        if !current.indices.isEmpty { rows.append(current) }
        return rows
    }
}
