import SwiftUI

/// 设置 → 档案条目：按法域维护每家公司要管理的条目。新建公司时自动套用，之后可逐家调整。
/// 布局：左栏为法域选择和条目清单，右栏为所选条目的编辑表单。
struct ArchiveItemsSettings: View {
    @Environment(AppStore.self) private var store
    static let personScope = "__person"
    @State private var code: String?
    @State private var selectedType: String?
    @State private var addingJurisdiction = false
    @State private var jCode = ""
    @State private var jName = ""
    @State private var jAttempted = false
    @State private var creatingIn: String?
    @State private var draft = ArchiveItemDraft()
    @State private var allJurisdictions = false
    @State private var deletingType: String?

    var body: some View {
        let pendingDelete = deletingType
        HStack(alignment: .top, spacing: 20) {
            listPane
                .frame(width: 340)
                .frame(maxHeight: .infinity, alignment: .top)
            typeEditor
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.canvas)
        .onAppear { if code == nil { code = store.library.jurisdictions.first?.code } }
        .onChange(of: code) { selectedType = nil }
        .sheet(isPresented: $addingJurisdiction) { jurisdictionForm }
        .sheet(isPresented: Binding(get: { creatingIn != nil }, set: { if !$0 { creatingIn = nil } })) {
            if let scope = creatingIn { newItemSheet(scope) }
        }
        .confirmSheet("删除这个条目类型？", isPresented: Binding(get: { deletingType != nil }, set: { if !$0 { deletingType = nil } }),
                      message: "会从所有法域的档案条目中去掉，之后不能恢复。",
                      details: ["目前没有文件使用这个类型", "各公司单独添加的此条目也会一并删除"],
                      confirmTitle: "删除", destructive: true) {
            if let id = pendingDelete { deleteType(id) }
        }
    }

    // MARK: 左栏：法域选择 + 条目清单

    private var scopeOptions: [(String, String)] {
        store.library.jurisdictions.map { ($0.code, "\($0.name)（\(store.templateItems(for: $0.code).count)）") }
            + [(Self.personScope, "人员文件（\(personTypes.count)）")]
    }

    private var listPane: some View {
        VStack(alignment: .leading, spacing: 14) {
            SettingsPaneHeader(title: "档案条目",
                               detail: "每个法域的公司默认管理哪些文件。新建公司时自动套用。")
            HStack(spacing: 8) {
                SelectField(options: scopeOptions,
                            selection: Binding(get: { code ?? "" }, set: { code = $0 }),
                            placeholder: "选择法域", minWidth: 200)
                Spacer(minLength: 0)
                Button { jAttempted = false; addingJurisdiction = true } label: { Label("新建法域", systemImage: "plus") }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
            }
            if let code {
                itemList(code)
            } else {
                Text("选择法域后查看它的档案条目。")
                    .font(TypeStyle.body).foregroundStyle(Theme.muted)
                    .surfaceCard(padding: 18, radius: 18)
            }
        }
    }

    private var personTypes: [DocumentType] { store.library.documentTypes.filter { $0.owner == .person } }

    @ViewBuilder
    private func itemList(_ code: String) -> some View {
        let person = code == Self.personScope
        let ids = person ? personTypes.map(\.id) : store.templateItems(for: code)
        let candidates = person ? [] : store.library.documentTypes.filter {
            $0.owner == .company && !ids.contains($0.id) && !AppStore.nonArchiveTypeIDs.contains($0.id)
                && ($0.jurisdictions.isEmpty || $0.jurisdictions.contains(code))
        }
        VStack(alignment: .leading, spacing: 12) {
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if ids.isEmpty {
                        Text(person ? "还没有人员文件类型。" : "这个法域还没有条目。")
                            .font(TypeStyle.body).foregroundStyle(Theme.muted)
                            .padding(.horizontal, 10).padding(.vertical, 12)
                    }
                    ForEach(Array(ids.enumerated()), id: \.element) { pair in
                        let id = pair.element
                        let i = pair.offset
                        ArchiveItemRow(title: store.docType(id)?.name ?? id,
                                       detail: detail(id),
                                       selected: selectedType == id,
                                       reorderable: !person,
                                       canMoveUp: i > 0,
                                       canMoveDown: i < ids.count - 1,
                                       removeHelp: "从\(store.jurisdictionName(code))条目中去掉（不删除已有文件）",
                                       onSelect: { selectedType = id },
                                       onMoveUp: { move(ids, i, -1, code) },
                                       onMoveDown: { move(ids, i, 1, code) },
                                       onRemove: { store.setTemplateItems(ids.filter { $0 != id }, for: code); selectedType = nil })
                    }
                    if !candidates.isEmpty {
                        Rectangle().fill(Theme.hairline).frame(height: 1)
                            .padding(.horizontal, 10).padding(.top, 10).padding(.bottom, 6)
                        Text("可添加的已有类型").font(TypeStyle.micro).foregroundStyle(Theme.muted)
                            .padding(.horizontal, 10).padding(.bottom, 4)
                        ForEach(candidates) { t in
                            HStack(spacing: 8) {
                                Text(t.name).font(TypeStyle.body).foregroundStyle(Theme.muted).lineLimit(1)
                                Spacer(minLength: 6)
                                Button { store.setTemplateItems(ids + [t.id], for: code) } label: { Label("添加", systemImage: "plus") }
                                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                                    .help("添加到\(store.jurisdictionName(code))的条目")
                            }
                            .padding(.horizontal, 10).frame(height: 36)
                        }
                    }
                }
                .padding(8)
            }
            .scrollIndicators(.never)
            .frame(maxHeight: .infinity)
            .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))

            Text(person ? "护照、身份证等挂在人名下的文件。"
                        : "内置条目是管理用的起始清单，不代表已核验的法定要求。实际要求请按公司情况与接收方确认。")
                .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)

            HStack(spacing: 8) {
                Button { draft = ArchiveItemDraft(validity: person ? .expiryOnDocument : .permanent); allJurisdictions = false; creatingIn = code } label: { Label("新建条目", systemImage: "plus") }
                    .buttonStyle(PillButtonStyle(.primary))
                Spacer(minLength: 0)
                if !person, store.library.archiveItems?[code] != nil {
                    Button("恢复内置") {
                        var map = store.library.archiveItems ?? [:]
                        map[code] = nil
                        store.library.archiveItems = map
                        store.saveLibrary()
                    }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                    .help("把\(store.jurisdictionName(code))的条目恢复为内置清单")
                }
            }
        }
    }

    private func create(in code: String) {
        let person = code == Self.personScope
        let name = draft.trimmedName
        let months: Int? = draft.validity == .monthsAfterIssue ? draft.months : nil
        if person {
            let t = DocumentType(id: "custom.\(UUID().uuidString.prefix(8).lowercased())", name: name,
                                 category: draft.category.isEmpty ? name : draft.category, localNames: [],
                                 jurisdictions: [], owner: .person, validity: draft.validity, validityMonths: months, hints: [], builtIn: false)
            store.library.documentTypes.append(t)
            store.saveLibrary()
            selectedType = t.id
        } else {
            let t = store.createItem(name: name, category: draft.category, jurisdiction: code, validity: draft.validity, months: months)
            if allJurisdictions, let i = store.library.documentTypes.firstIndex(where: { $0.id == t.id }) {
                store.library.documentTypes[i].jurisdictions = []
                store.saveLibrary()
            }
            selectedType = t.id
        }
        creatingIn = nil
    }

    private func newItemSheet(_ code: String) -> some View {
        let person = code == Self.personScope
        let jName = person ? "人员文件" : store.jurisdictionName(code)
        return SheetScaffold(title: "新建条目",
                             subtitle: person ? "添加到人员文件，例如护照、身份证、住址证明。"
                                              : "添加到\(jName)的档案清单；之后新建\(jName)公司时自动带出。",
                             width: 560) {
            VStack(alignment: .leading, spacing: 18) {
                ArchiveItemFields(draft: $draft)
                if !person {
                    FormGroup(title: "适用范围") {
                        Toggle("其他法域的公司也可以添加这个条目", isOn: $allJurisdictions)
                            .toggleStyle(KitCheckboxStyle())
                    }
                }
            }
        } leading: {
            EmptyView()
        } trailing: {
            Button("取消") { creatingIn = nil }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button("添加") { create(in: code) }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(!draft.isValid)
        }
    }

    // MARK: 右栏：条目详情

    @ViewBuilder
    private var typeEditor: some View {
        if let id = selectedType, let i = store.library.documentTypes.firstIndex(where: { $0.id == id }) {
            let t = store.library.documentTypes[i]
            let used = store.documents.filter { $0.typeID == id }.count
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    SettingsPaneHeader(title: t.name.isEmpty ? "未命名条目" : t.name, detail: detail(id)) {
                        if !t.builtIn {
                            Button("删除类型") { deletingType = id }
                                .buttonStyle(PillButtonStyle(.secondary, size: .small))
                                .disabled(used > 0)
                                .help(used > 0 ? "仍有文件使用这个类型。请先将这些文件改为其他类型，再删除。" : "从所有法域删除这个类型")
                        }
                    }
                    HStack(spacing: 6) {
                        Circle().fill(used > 0 ? Theme.lime : Theme.muted.opacity(0.5)).frame(width: 7, height: 7)
                        Text(used > 0 ? "已有 \(used) 份文件使用这个类型" : "还没有文件使用这个类型")
                            .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                    }
                    .padding(.top, -10)
                    DocumentTypeForm(type: Binding(get: { store.library.documentTypes[i] }, set: { store.library.documentTypes[i] = $0; store.saveLibrary() }),
                                     onCanvas: true)
                }
                .padding(.bottom, 8)
            }
            .scrollIndicators(.never)
        } else {
            EmptyStateView(symbol: "list.bullet.rectangle", title: "选择条目以查看和编辑", message: "可在这里修改名称、当地名称、识别线索和有效期。")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func deleteType(_ id: String) {
        store.library.documentTypes.removeAll { $0.id == id }
        if var map = store.library.archiveItems {
            for k in map.keys { map[k]?.removeAll { $0 == id } }
            store.library.archiveItems = map
        }
        store.saveLibrary()
        selectedType = nil
    }

    private func detail(_ id: String) -> String {
        guard let t = store.docType(id) else { return "" }
        let v: String
        switch t.validity {
        case .monthsAfterIssue: v = "签发后 \(t.validityMonths ?? 6) 个月有效"
        case .expiryOnDocument: v = "按文件上的到期日"
        case .untilChanged: v = "信息变更前有效"
        case .permanent: v = "长期有效"
        }
        return "\(t.category)，\(v)"
    }

    private func move(_ ids: [String], _ i: Int, _ d: Int, _ code: String) {
        var a = ids
        let j = i + d
        guard a.indices.contains(j) else { return }
        a.swapAt(i, j)
        store.setTemplateItems(a, for: code)
    }

    /// 新建法域的代码校验：空（点过“添加”后才提示）或与已有法域重复。
    private var jCodeError: String? {
        let c = jCode.trimmingCharacters(in: .whitespaces).uppercased()
        if c.isEmpty { return jAttempted ? "请填写法域代码" : nil }
        if let j = store.library.jurisdictions.first(where: { $0.code == c }) { return "已有法域 \(j.name)（\(c)）" }
        return nil
    }

    private var jurisdictionForm: some View {
        SheetScaffold(title: "新建法域", subtitle: "新建后可以为这个法域设置档案条目。", width: 460) {
            FormGroup {
                FieldRow(label: "代码", hint: "2–3 个字母，例如 MY", error: jCodeError) {
                    TextField("MY", text: $jCode).textFieldStyle(KitFieldStyle())
                }
                FieldRow(label: "名称") {
                    TextField("例如：马来西亚", text: $jName).textFieldStyle(KitFieldStyle())
                }
            }
        } leading: {
            EmptyView()
        } trailing: {
            Button("取消") { addingJurisdiction = false }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button("添加") {
                jAttempted = true
                guard jCodeError == nil else { return }
                addJurisdiction()
            }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
        }
    }

    private func addJurisdiction() {
        let c = jCode.trimmingCharacters(in: .whitespaces).uppercased()
        guard !c.isEmpty, !store.library.jurisdictions.contains(where: { $0.code == c }) else { return }
        store.library.jurisdictions.append(Jurisdiction(code: c, name: jName.isEmpty ? c : jName, timeZone: TimeZone.current.identifier, entityForms: []))
        store.setTemplateItems([], for: c)
        code = c
        store.showToast("已添加法域 \(store.jurisdictionName(c))")
        jCode = ""; jName = ""; jAttempted = false
        addingJurisdiction = false
    }
}

/// 条目清单的一行：名称和有效期摘要；排序和移除按钮只在悬停或选中时出现。
private struct ArchiveItemRow: View {
    var title: String
    var detail: String
    var selected: Bool
    var reorderable: Bool
    var canMoveUp: Bool
    var canMoveDown: Bool
    var removeHelp: String
    var onSelect: () -> Void
    var onMoveUp: () -> Void
    var onMoveDown: () -> Void
    var onRemove: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(TypeStyle.rowTitle).lineLimit(1)
                    .foregroundStyle(selected ? Theme.onSelection : Theme.ink)
                Text(detail).font(TypeStyle.metadata).lineLimit(1)
                    .foregroundStyle(selected ? Theme.onSelection.opacity(0.7) : Theme.muted)
            }
            Spacer(minLength: 4)
            if reorderable && (selected || hovering) {
                HStack(spacing: 4) {
                    tool("chevron.up", help: "上移", enabled: canMoveUp, action: onMoveUp)
                    tool("chevron.down", help: "下移", enabled: canMoveDown, action: onMoveDown)
                    tool("minus", help: removeHelp, enabled: true, action: onRemove)
                }
            }
        }
        .padding(.horizontal, 10).frame(height: 48)
        .background(selected ? Theme.selection : (hovering ? Theme.band : Color.clear),
                    in: .rect(cornerRadius: 12, style: .continuous))
        .contentShape(.rect)
        .onTapGesture(perform: onSelect)
        .onHover { hovering = $0 }
    }

    private func tool(_ symbol: String, help: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 10, weight: .bold))
                .frame(width: 24, height: 24)
                .foregroundStyle(selected ? Theme.onSelection : Theme.ink)
                .background(selected ? Theme.onSelection.opacity(0.16) : Theme.surface, in: .circle)
                .overlay(Circle().strokeBorder(selected ? Color.clear : Theme.hairline))
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
        .help(help)
    }
}

// MARK: - 新建条目的表单（设置与公司“自定义清单”共用）

struct ArchiveItemDraft {
    var name = ""
    /// 空 = 新类别，与名称相同。
    var category = ""
    var validity: ValidityKind = .permanent
    var months = 6

    var trimmedName: String { name.trimmingCharacters(in: .whitespaces) }
    var isValid: Bool { !trimmedName.isEmpty }

    static let monthChoices = [1, 3, 6, 12, 24, 36]
}

struct ArchiveItemFields: View {
    @Environment(AppStore.self) private var store
    @Binding var draft: ArchiveItemDraft

    private var categoryOptions: [(String, String)] {
        let cats = Array(Set(store.library.documentTypes.map(\.category).filter { !$0.isEmpty })).sorted()
        return [("", "新类别（与名称相同）")] + cats.map { ($0, $0) }
    }

    private var monthOptions: [(Int, String)] {
        var values = ArchiveItemDraft.monthChoices
        if !values.contains(draft.months) { values.append(draft.months); values.sort() }
        return values.map { ($0, "\($0) 个月") }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            FormGroup(title: "基本信息") {
                FieldRow(label: "名称") {
                    TextField("例如：开曼注册办事处地址证明", text: $draft.name).textFieldStyle(KitFieldStyle())
                }
                FieldRow(label: "类别", hint: "用于矩阵的列，跨法域把同类文件放在一起") {
                    SelectField(options: categoryOptions, selection: $draft.category, minWidth: 220)
                }
            }
            FormGroup(title: "有效期") {
                RadioGroup(options: [(ValidityKind.permanent, "长期有效"),
                                     (.monthsAfterIssue, "签发后若干个月"),
                                     (.expiryOnDocument, "按文件上的到期日")],
                           selection: $draft.validity)
                if draft.validity == .monthsAfterIssue {
                    FieldRow(label: "有效月数", hint: "从签发日起算") {
                        SelectField(options: monthOptions, selection: $draft.months, minWidth: 140)
                    }
                }
            }
        }
    }
}
