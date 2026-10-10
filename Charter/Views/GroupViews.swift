import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// 选择已有的人/公司，或者新建一个（保存时才真正创建）。
enum NodeChoice: Hashable {
    case existing(NodeRef)
    case newPerson(String)
    case newCompany(String, String)   // 名称、法域

    var isValid: Bool {
        switch self {
        case .existing: true
        case .newPerson(let n): !n.trimmingCharacters(in: .whitespaces).isEmpty
        case .newCompany(let n, _): !n.trimmingCharacters(in: .whitespaces).isEmpty
        }
    }
}

extension AppStore {
    /// 把选择变成真实的节点；新建的人或公司在这里才写入。
    func resolve(_ c: NodeChoice) -> NodeRef {
        switch c {
        case .existing(let r): return r
        case .newPerson(let n): return NodeRef(kind: .person, id: createPerson(name: n.trimmingCharacters(in: .whitespaces)).id)
        case .newCompany(let n, let j): return NodeRef(kind: .company, id: createCompany(name: n.trimmingCharacters(in: .whitespaces), jurisdiction: j).id)
        }
    }

    func label(_ c: NodeChoice) -> String {
        switch c {
        case .existing(let r): return name(of: r)
        case .newPerson(let n): return "\(n)（新建自然人）"
        case .newCompany(let n, let j): return "\(n)（新建 \(jurisdictionName(j)) 公司）"
        }
    }
}

/// 选择或新建一个节点的表单片段。
struct NodePicker: View {
    @Environment(AppStore.self) private var store
    var title: String
    @Binding var choice: NodeChoice?
    var allowPerson = true
    var allowCompany = true
    var exclude: Set<NodeRef> = []

    @State private var kind: NodeKind = .company
    @State private var existingID: String = ""
    @State private var newName = ""
    @State private var newJurisdiction = "HK"

    private var existingOptions: [(String, String)] {
        let head: (String, String) = ("", kind == .company ? "新建一家公司…" : "新建一位自然人…")
        var rows: [(String, String)] = []
        if kind == .company {
            for c in store.companies.sorted(by: { $0.name < $1.name }) where !exclude.contains(NodeRef(kind: .company, id: c.id)) {
                rows.append((c.id, c.name))
            }
        } else {
            for p in store.people.sorted(by: { $0.name < $1.name }) where !exclude.contains(NodeRef(kind: .person, id: p.id)) {
                rows.append((p.id, p.name))
            }
        }
        return [head] + rows
    }

    private var jurisdictionOptions: [(String, String)] {
        store.library.jurisdictions.map { ($0.code, $0.name) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if allowPerson && allowCompany {
                FieldRow(label: title) {
                    PillSegmented(options: [(NodeKind.company, "公司"), (NodeKind.person, "自然人")], selection: $kind)
                }
            }
            FieldRow(label: allowPerson && allowCompany ? "选择" : title) {
                SelectField(options: existingOptions, selection: $existingID, minWidth: 260)
            }
            if existingID.isEmpty {
                FieldRow(label: kind == .company ? "注册名" : "姓名") {
                    TextField(kind == .company ? "公司注册名" : "姓名", text: $newName).textFieldStyle(KitFieldStyle())
                }
                if kind == .company {
                    FieldRow(label: "法域") {
                        SelectField(options: jurisdictionOptions, selection: $newJurisdiction, minWidth: 260)
                    }
                }
            }
        }
        .onAppear {
            if !allowCompany { kind = .person }
            if !allowPerson { kind = .company }
            sync()
        }
        .onChange(of: kind) { existingID = ""; sync() }
        .onChange(of: existingID) { sync() }
        .onChange(of: newName) { sync() }
        .onChange(of: newJurisdiction) { sync() }
    }

    private func sync() {
        if !existingID.isEmpty {
            choice = .existing(NodeRef(kind: kind, id: existingID))
        } else if kind == .company {
            choice = .newCompany(newName, newJurisdiction)
        } else {
            choice = .newPerson(newName)
        }
    }
}

// MARK: - 集团

struct GroupEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    let original: CorporateGroup?
    /// 新建时预先定好 ID，图标文件按它命名。
    private let groupID: String
    @State private var name: String
    @State private var tops: [NodeChoice]
    @State private var adding: NodeChoice?
    @State private var notes: String
    @State private var confirmDelete = false
    @State private var pickerToken = 0
    /// 选好、还没保存的图标（已裁成正方形的 PNG）。
    @State private var pendingIcon: Data?
    @State private var iconRemoved = false
    @State private var pickingIcon = false
    @State private var iconError: String?

    init(group: CorporateGroup?) {
        original = group
        groupID = group?.id ?? UUID().uuidString
        _name = State(initialValue: group?.name ?? "")
        _tops = State(initialValue: group?.tops.map { NodeChoice.existing($0) } ?? [])
        _notes = State(initialValue: group?.notes ?? "")
    }

    private var hasIcon: Bool {
        pendingIcon != nil || (!iconRemoved && original?.iconFileName != nil)
    }

    var body: some View {
        SheetScaffold(title: original == nil ? "新建集团" : "编辑集团",
                      subtitle: "顶层可以是最终实际控制人，也可以是已知的最顶层公司。下面的公司会按持股关系自动排层。",
                      width: 580, height: 760) {
            VStack(alignment: .leading, spacing: 18) {
                FormGroup(title: "基本信息") {
                    FieldRow(label: "集团名称") {
                        TextField("例如：远澜集团", text: $name).textFieldStyle(KitFieldStyle())
                    }
                    FieldRow(label: "集团图标", hint: iconError ?? "PNG 或 JPEG，会裁成正方形；未设置时显示名称首字。") {
                        HStack(spacing: 12) {
                            iconPreview
                            Button("选择图片…") { iconError = nil; pickingIcon = true }
                                .buttonStyle(PillButtonStyle(.secondary, size: .small))
                            if hasIcon {
                                Button("移除") { pendingIcon = nil; iconRemoved = true; iconError = nil }
                                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                            }
                        }
                    }
                    FieldRow(label: "备注") {
                        TextField("可选", text: $notes, axis: .vertical).textFieldStyle(KitFieldStyle())
                    }
                }

                FormGroup(title: "顶层") {
                    if tops.isEmpty {
                        Text("还没有顶层。").font(TypeStyle.body).foregroundStyle(Theme.muted)
                    }
                    ForEach(Array(tops.enumerated()), id: \.offset) { pair in
                        let i = pair.offset
                        let t = pair.element
                        HStack(spacing: 10) {
                            Image(systemName: icon(t)).font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Theme.muted).frame(width: 18)
                            Text(store.label(t)).font(TypeStyle.body).foregroundStyle(Theme.ink).lineLimit(1)
                            Spacer(minLength: 8)
                            Button("移除") { tops.remove(at: i) }
                                .buttonStyle(PillButtonStyle(.quiet, size: .small))
                        }
                    }
                }

                FormGroup(title: "添加顶层") {
                    NodePicker(title: "类型", choice: $adding, exclude: Set(tops.compactMap { if case .existing(let r) = $0 { return r } else { return nil } }))
                        .id(pickerToken)
                    HStack {
                        Spacer()
                        Button("加为顶层") {
                            if let a = adding, a.isValid { tops.append(a); adding = nil; pickerToken += 1 }
                        }
                        .buttonStyle(PillButtonStyle(.secondary, size: .small))
                        .disabled(!(adding?.isValid ?? false))
                    }
                }
            }
        } leading: {
            if original != nil {
                Button("删除集团") { confirmDelete = true }
                    .buttonStyle(PillButtonStyle(.secondary))
            }
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button(original == nil ? "创建" : "保存") { save() }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .fileImporter(isPresented: $pickingIcon, allowedContentTypes: [.png, .jpeg]) { result in
            guard case .success(let url) = result else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            if let image = NSImage(contentsOf: url), let png = GroupIconStore.squarePNG(from: image) {
                pendingIcon = png
                iconRemoved = false
                iconError = nil
            } else {
                iconError = "无法读取这张图片，请换一张 PNG 或 JPEG。"
            }
        }
        .confirmSheet("删除集团“\(name)”？", isPresented: $confirmDelete,
                      message: "只删除集团本身。公司、人员、持股关系和文件都不受影响。",
                      confirmTitle: "删除", destructive: true) {
            if let g = original {
                store.delete(group: g)
                if let file = g.iconFileName { GroupIconStore.remove(fileName: file, root: store.store.root) }
            }
            if router.groupFilter == original?.id { router.groupFilter = nil }
            dismiss()
        }
    }

    /// 图标预览：新选的图片 → 已保存的图标 → 名称首字。
    @ViewBuilder
    private var iconPreview: some View {
        if let data = pendingIcon, let image = NSImage(data: data) {
            Image(nsImage: image)
                .resizable().interpolation(.high)
                .frame(width: 40, height: 40)
                .clipShape(.rect(cornerRadius: 40 * 0.28))
        } else if let g = original, g.iconFileName != nil, !iconRemoved {
            GroupIcon(groupID: g.id, size: 40)
        } else {
            GroupMonogram(text: String(name.trimmingCharacters(in: .whitespaces).prefix(1)).ifEmpty("集"), size: 40,
                          fill: Theme.surface)
        }
    }

    private func icon(_ c: NodeChoice) -> String {
        switch c {
        case .existing(let r): r.kind == .person ? "person.fill" : "building.2"
        case .newPerson: "person.fill"
        case .newCompany: "building.2"
        }
    }

    private func save() {
        // 输入框里填了但没点“加为顶层”的，也一并加上
        var all = tops
        if all.isEmpty, let a = adding, a.isValid { all.append(a) }
        let refs = all.map { store.resolve($0) }
        var g = original ?? CorporateGroup(id: groupID, name: "", tops: [])
        g.name = name.trimmingCharacters(in: .whitespaces)
        g.tops = refs
        g.notes = notes
        if let png = pendingIcon {
            do {
                g.iconFileName = try GroupIconStore.write(png, groupID: g.id, root: store.store.root)
            } catch {
                store.errorMessage = "集团图标没有保存：\(error.localizedDescription)"
            }
        } else if iconRemoved, let file = g.iconFileName {
            GroupIconStore.remove(fileName: file, root: store.store.root)
            g.iconFileName = nil
        }
        store.update(g)
        store.tidyGroups()
        router.groupFilter = g.id
        router.section = .overview
        dismiss()
    }
}

// MARK: - 添加上级 / 下级

struct RelationSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var companyID: String
    var upward: Bool

    @State private var other: NodeChoice?
    @State private var percent: Double = 100
    @State private var nominee = false
    @State private var beneficial: NodeChoice?
    @State private var from: Day?
    @State private var promoteTop = true

    private var company: Company? { store.company(companyID) }
    private var self_: NodeRef { NodeRef(kind: .company, id: companyID) }
    /// 以这家公司为顶层的集团（添加上级后可以把新上级设为顶层）。
    private var topOf: [CorporateGroup] { store.corporateGroups.filter { $0.tops.contains(self_) } }

    var body: some View {
        let companyName = company?.name ?? ""
        SheetScaffold(title: upward ? "添加上级（股东）" : "添加下级公司",
                      subtitle: upward ? "为 \(companyName) 添加一位股东。" : "为 \(companyName) 添加一家下级公司。",
                      width: 580, height: 760) {
            VStack(alignment: .leading, spacing: 18) {
                FormGroup(title: upward ? "股东" : "下级公司") {
                    NodePicker(title: "类型", choice: $other, allowPerson: upward, allowCompany: true, exclude: [self_])
                }
                FormGroup(title: "持股") {
                    FieldRow(label: upward ? "持有本公司" : "本公司持有") {
                        HStack(spacing: 6) {
                            TextField("", value: $percent, format: .number)
                                .textFieldStyle(KitFieldStyle(invalid: percent <= 0 || percent > 100))
                                .multilineTextAlignment(.trailing)
                                .frame(width: 96)
                            Text("%").font(TypeStyle.body).foregroundStyle(Theme.muted)
                        }
                    }
                    FieldRow(label: "生效日期", hint: "未知时可留空") {
                        DateField(day: $from, placeholder: "可留空")
                    }
                    if upward {
                        Toggle("这位股东是名义股东，代他人持有", isOn: $nominee).toggleStyle(KitCheckboxStyle())
                    }
                }
                if upward && nominee {
                    FormGroup(title: "实际受益人") {
                        NodePicker(title: "类型", choice: $beneficial, exclude: [self_])
                    }
                }
                if upward && !topOf.isEmpty {
                    FormGroup(title: "集团顶层") {
                        VStack(alignment: .leading, spacing: 6) {
                            Toggle("把新上级设为「\(topOf.map(\.name).joined(separator: "、"))」的顶层", isOn: $promoteTop)
                                .toggleStyle(KitSwitchStyle())
                            Text("\(companyName) 现在是这个集团的顶层。打开后，集团顶层改为新上级，\(companyName) 排到它下面。")
                                .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                Text("保存后，集团层级和股权结构图会按新的持股关系自动重新排列。")
                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
            }
        } leading: {
            EmptyView()
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button("添加") { save() }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(!canSave)
        }
    }

    private var canSave: Bool {
        guard let o = other, o.isValid, percent > 0, percent <= 100 else { return false }
        if nominee { return beneficial?.isValid ?? false }
        return true
    }

    private func save() {
        guard let o = other else { return }
        let node = store.resolve(o)
        if upward {
            let b = nominee ? beneficial.map { store.resolve($0) } : nil
            guard store.addHolding(holder: node, companyID: companyID, percent: percent, nominee: nominee, beneficialOwner: b, from: from) else { return }
            if promoteTop {
                for var g in topOf {
                    g.tops = g.tops.map { $0 == self_ ? (b ?? node) : $0 }
                    store.update(g)
                }
            }
        } else {
            guard store.addHolding(holder: self_, companyID: node.id, percent: percent, nominee: false, beneficialOwner: nil, from: from) else { return }
        }
        store.tidyGroups()
        store.showToast(upward ? "已添加上级，层级已重新排列。" : "已添加下级公司，层级已重新排列。")
        dismiss()
    }
}
