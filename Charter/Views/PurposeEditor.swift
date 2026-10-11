import SwiftUI

/// 打开用途编辑器时的目标：purposeID 为空表示新建。
struct PurposeEditTarget: Identifiable {
    var purposeID: String?
    var id: String { purposeID ?? "__new__" }
}

/// 导出用途（文件包模板）的编辑器：名称、需要的文件类别、是否附董事护照、签发时限。
/// “准备文件包”和“设置 → 文件包用途”共用，保存后写回模板库。
struct PurposeEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var purposeID: String?
    var onSaved: (String) -> Void = { _ in }
    var onDeleted: () -> Void = {}

    @State private var draft = PacketTemplate(id: "", name: "", categories: [], includeDirectorsPassports: false, maxAgeMonths: nil)
    @State private var loaded = false
    @State private var confirmDelete = false
    @State private var attempted = false
    @FocusState private var nameFocused: Bool

    static let ageChoices = [1, 3, 6, 12]

    private var isNew: Bool { purposeID == nil || !store.library.packets.contains { $0.id == purposeID } }

    /// 模板库里所有文件类别（去重、排序），再加上这个用途里已有、但库里已经没有的类别，免得保存时丢掉。
    private var allCategories: [String] {
        let library = Set(store.library.documentTypes.map(\.category).filter { !$0.isEmpty })
        return Array(library.union(draft.categories)).sorted()
    }

    private var ageOptions: [(Int, String)] {
        var values = Self.ageChoices
        if let m = draft.maxAgeMonths, !values.contains(m) { values.append(m); values.sort() }
        return [(0, "不限")] + values.map { ($0, "\($0) 个月内") }
    }

    private var trimmedName: String { draft.name.trimmingCharacters(in: .whitespaces) }

    private var nameTaken: Bool {
        store.library.packets.contains { $0.id != draft.id && $0.name == trimmedName }
    }

    private var nameError: String? {
        if nameTaken { return "已有同名用途" }
        return attempted && trimmedName.isEmpty ? "请填写名称" : nil
    }

    private var contentError: String? {
        attempted && draft.categories.isEmpty && !draft.includeDirectorsPassports
            ? "至少选择一个文件类别，或打开“附上现任董事的护照”" : nil
    }

    private var canSave: Bool {
        !trimmedName.isEmpty && !nameTaken && (!draft.categories.isEmpty || draft.includeDirectorsPassports)
    }

    var body: some View {
        SheetScaffold(title: isNew ? "新建用途" : "编辑用途",
                      subtitle: "选择这个用途所需的文件类别。准备文件包时，Charter 会按它挑出每类最新的一份。",
                      width: 600, height: 760) {
            VStack(alignment: .leading, spacing: 18) {
                FormGroup(title: "基本信息") {
                    FieldRow(label: "名称", error: nameError) {
                        TextField("例如：银行开户", text: $draft.name)
                            .textFieldStyle(KitFieldStyle(invalid: nameTaken))
                            .focused($nameFocused)
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    FormGroup(title: "需要的文件类别（已选 \(draft.categories.count) 类）") {
                        if allCategories.isEmpty {
                            Text("模板库里还没有文件类别。先在“设置 → 档案清单”里添加条目。")
                                .font(TypeStyle.body).foregroundStyle(Theme.muted)
                        } else {
                            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12, alignment: .leading),
                                                GridItem(.flexible(), spacing: 12, alignment: .leading)],
                                      alignment: .leading, spacing: 10) {
                                ForEach(allCategories, id: \.self) { cat in
                                    Toggle(cat, isOn: categoryBinding(cat))
                                        .toggleStyle(KitCheckboxStyle())
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }
                        }
                    }
                    if let contentError {
                        FieldError(text: contentError).padding(.leading, 4)
                    } else {
                        Text("类别按条目的“通用类别”划分，跨法域把同类文件放在一起。")
                            .font(TypeStyle.metadata).foregroundStyle(Theme.muted).padding(.leading, 4)
                    }
                }

                FormGroup(title: "其他要求") {
                    Toggle("附上现任董事的护照", isOn: $draft.includeDirectorsPassports)
                        .toggleStyle(KitSwitchStyle())
                    FieldRow(label: "签发时限", hint: "限时文件须在这个时间内签发。只约束“签发后若干个月有效”的文件，例如存续证明。") {
                        SelectField(options: ageOptions,
                                    selection: Binding(get: { draft.maxAgeMonths ?? 0 },
                                                       set: { draft.maxAgeMonths = $0 == 0 ? nil : $0 }),
                                    minWidth: 140)
                    }
                }
            }
        } leading: {
            if !isNew {
                Button("删除用途") { confirmDelete = true }
                    .buttonStyle(PillButtonStyle(.secondary))
            }
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button(isNew ? "创建用途" : "保存") {
                attempted = true
                guard canSave else {
                    if nameError != nil { nameFocused = true }
                    return
                }
                save()
            }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
        }
        .onAppear {
            load()
            if isNew { nameFocused = true }
        }
        .confirmSheet("删除用途“\(trimmedName.isEmpty ? "未命名" : trimmedName)”？", isPresented: $confirmDelete,
                      message: "删除后准备文件包时不再能选这个用途。已经生成的文件包不受影响。",
                      confirmTitle: "删除", destructive: true) {
            delete()
        }
    }

    private func categoryBinding(_ cat: String) -> Binding<Bool> {
        Binding(
            get: { draft.categories.contains(cat) },
            set: { on in
                if on {
                    if !draft.categories.contains(cat) { draft.categories.append(cat) }
                } else {
                    draft.categories.removeAll { $0 == cat }
                }
            })
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let id = purposeID, let p = store.library.packets.first(where: { $0.id == id }) {
            draft = p
        } else {
            draft = PacketTemplate(id: "custom.\(UUID().uuidString.prefix(8).lowercased())", name: "", categories: [],
                                   includeDirectorsPassports: false, maxAgeMonths: nil)
        }
    }

    private func save() {
        var p = draft
        p.name = trimmedName
        let wasNew = isNew
        if let i = store.library.packets.firstIndex(where: { $0.id == p.id }) {
            store.library.packets[i] = p
        } else {
            store.library.packets.append(p)
        }
        store.saveLibrary()
        onSaved(p.id)
        store.showToast(wasNew ? "已创建用途 \(p.name)" : "已保存 \(p.name)")
        dismiss()
    }

    private func delete() {
        let id = draft.id
        store.library.packets.removeAll { $0.id == id }
        store.saveLibrary()
        onDeleted()
        // 先让确认框收起，再关闭编辑器
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            dismiss()
        }
    }

    /// 一句话描述用途的要求，用于设置里的卡片和文件包里的说明。
    static func summary(of p: PacketTemplate) -> String {
        var parts: [String] = []
        parts.append(p.categories.isEmpty ? "未选文件类别" : "需要" + p.categories.joined(separator: "、"))
        if p.includeDirectorsPassports { parts.append("附现任董事护照") }
        if let m = p.maxAgeMonths { parts.append("限时文件须在 \(m) 个月内签发") }
        return parts.joined(separator: "；") + "。"
    }
}
