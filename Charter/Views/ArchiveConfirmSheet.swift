import SwiftUI

/// 归档确认：列出目标公司、材料类别、签发日期、新旧版本对比；只有点“确认归档”才写入档案。取消或关闭都不改动档案。
struct ArchiveConfirmSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var file: StagedFile
    @State private var typeID: String = ""
    @State private var owner: NodeRef?
    @State private var issued: Day?
    @State private var expiry: Day?
    @State private var note = ""
    @State private var acknowledged = false
    @State private var error: String?
    @State private var working = false

    private var targetCompany: Company? { owner.flatMap { $0.kind == .company ? store.company($0.id) : nil } }

    /// 与识别结果冲突：识别到的公司或法域与目标不一致。
    private var conflicts: [String] {
        var out: [String] = []
        guard let o = owner, o.kind == .company, let c = targetCompany else { return out }
        if let rc = file.recognition.companyID, rc != c.id {
            out.append("文件内容像是“\(store.company(rc)?.name ?? "其他公司")”的文件，不是“\(c.name)”。")
        } else if let g = file.recognition.companyNameGuess, !g.isEmpty, file.recognition.companyID == nil,
                  !([c.name] + c.aliases + c.formerNames).contains(where: { $0.contains(g) || g.contains($0) }) {
            out.append("文件上写的公司名是“\(g)”，与“\(c.name)”不一致。")
        }
        if let j = file.recognition.jurisdiction, j != c.jurisdiction {
            out.append("文件像是\(store.jurisdictionName(j))的材料，目标公司在\(store.jurisdictionName(c.jurisdiction))。")
        }
        return out
    }

    private var canConfirm: Bool {
        !working && typeChoices.contains(where: { $0.id == typeID }) && owner != nil && (conflicts.isEmpty || acknowledged)
    }

    private var typeChoices: [DocumentType] {
        store.library.documentTypes.filter { t in
            if owner?.kind == .person { return t.owner == .person }
            guard let c = targetCompany else { return true }
            return t.owner == .company && t.applies(to: c.jurisdiction)
        }
    }

    private var ownerOptions: [(NodeRef?, String)] {
        let companies: [(NodeRef?, String)] = store.companies.map { c in (Optional(NodeRef(kind: .company, id: c.id)), c.name) }
        let people: [(NodeRef?, String)] = store.people.map { p in (Optional(NodeRef(kind: .person, id: p.id)), "人员：\(p.name)") }
        return companies + people
    }

    var body: some View {
        SheetScaffold(title: "确认归档", subtitle: "确认前不会改动档案。取消会删除这份待确认的副本。", width: 600, height: 760) {
            VStack(alignment: .leading, spacing: 18) {
                if file.recognition.typeID == nil && file.recognition.issueDate == nil {
                    Label("这份文件没有被自动识别。请手动选择类别和日期。", systemImage: "info.circle")
                        .font(TypeStyle.body).foregroundStyle(Theme.muted)
                }

                FormGroup(title: "这份文件将归档为") {
                    FieldRow(label: "文件") {
                        Text(file.originalName).font(TypeStyle.body).foregroundStyle(Theme.ink)
                            .lineLimit(1).truncationMode(.middle)
                            .help(file.originalName)
                    }
                    FieldRow(label: "归属") {
                        SelectField(options: ownerOptions, selection: $owner, minWidth: 280)
                    }
                    FieldRow(label: "材料类别") {
                        SelectField(options: typeChoices.map { ($0.id, $0.name) }, selection: $typeID,
                                    placeholder: "请选择（未识别）", minWidth: 280)
                    }
                    FieldRow(label: "签发日期", hint: issued == nil ? "尚未填写签发日期，建议补充。" : nil) {
                        DateField(day: $issued)
                    }
                    FieldRow(label: "到期日期", hint: "填写到期日后，Charter 会按设置中的天数提前提醒；留空则按条目的有效期规则判断。") {
                        DateField(day: $expiry, placeholder: "可留空", relativeTo: issued)
                    }
                    FieldRow(label: "备注") {
                        TextField("可选", text: $note, axis: .vertical)
                            .lineLimit(1...4)
                            .textFieldStyle(KitFieldStyle())
                    }
                }

                if let old = file.replaces {
                    FormGroup(title: "新旧版本") {
                        HStack(alignment: .top, spacing: 16) {
                            versionCard(title: "旧版（保留）", doc: old)
                            Image(systemName: "arrow.right").foregroundStyle(Theme.muted).padding(.top, 28)
                            versionCard(title: "待归档文件", date: issued, name: file.originalName)
                        }
                    }
                }

                if !conflicts.isEmpty {
                    FormGroup(title: "请核对") {
                        ForEach(conflicts, id: \.self) { c in
                            Label(c, systemImage: "exclamationmark.triangle.fill")
                                .font(TypeStyle.body).foregroundStyle(Theme.amberText)
                        }
                        Toggle("我已核对，仍归到这里", isOn: $acknowledged)
                            .toggleStyle(KitCheckboxStyle())
                    }
                }

                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(TypeStyle.body).foregroundStyle(Theme.amberText)
                }
            }
            .disabled(working)
        } leading: {
            if working {
                ProgressView().controlSize(.small)
                Text("正在归档…").font(TypeStyle.body).foregroundStyle(Theme.muted)
            }
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
                .disabled(working)
            Button(working ? "正在归档…" : "确认归档") { confirm() }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(!canConfirm)
        }
        .onAppear(perform: prefill)
        .onDisappear { store.discardStaged(file.id) }
        .interactiveDismissDisabled(working)
        .onChange(of: owner) {
            acknowledged = false
            if !typeChoices.contains(where: { $0.id == typeID }) { typeID = "" }
        }
        .onChange(of: typeID) { acknowledged = false }
    }

    private func versionCard(title: String, doc: Document) -> some View {
        versionCard(title: title, date: doc.issueDate, name: doc.originalFileName)
    }

    private func versionCard(title: String, date: Day?, name: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(TypeStyle.metadata).foregroundStyle(Theme.muted)
            Text(name).lineLimit(1).font(TypeStyle.rowTitle)
            Text(date.map { "\($0.long)签发" } ?? "签发日期未知").font(TypeStyle.metadata).foregroundStyle(Theme.muted)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: .rect(cornerRadius: 12))
    }

    private func prefill() {
        typeID = file.typeID ?? ""
        owner = file.owner ?? file.replaces.map(\.owner)
        issued = file.recognition.issueDate
        expiry = file.recognition.expiryDate
    }

    private func confirm() {
        guard canConfirm, let owner else { return }
        working = true
        Task {
            defer { working = false }
            do {
                _ = try await store.commitStaged(file.id, typeID: typeID, owner: owner, issued: issued, expiry: expiry, form: file.form, note: note)
                dismiss()
            } catch {
                self.error = "归档未完成：\(error.localizedDescription)"
            }
        }
    }
}
