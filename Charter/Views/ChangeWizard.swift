import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// 记录变更：三步——改了什么、证明文件、预览。只有最后点“确认变更”才写入；取消不留任何痕迹。
struct ChangeWizard: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var companyID: String

    @State private var plan: ChangePlan
    @State private var step = 0
    @State private var newPersonName = ""
    @State private var newPersonID: String = ""
    @State private var newTitle = "董事"
    @State private var newHolder: NodeRef?
    @State private var newPercent: Double = 100
    @State private var newNominee = false
    @State private var newBeneficialOwner: NodeRef?
    @State private var picking = false
    @State private var working = false

    init(companyID: String, kind: ChangeKind = .directorChange) {
        self.companyID = companyID
        _plan = State(initialValue: ChangePlan(companyID: companyID, kind: kind))
    }

    private var company: Company? { store.company(companyID) }
    private let steps = ["改了什么", "证明文件", "确认"]

    /// 生效日期不能为空：清空时保留原值。
    private var effectiveOn: Binding<Day?> {
        Binding<Day?>(get: { plan.effectiveOn }, set: { if let d = $0 { plan.effectiveOn = d } })
    }

    var body: some View {
        SheetScaffold(title: "记录变更", subtitle: company?.name, width: 640, height: 780) {
            VStack(alignment: .leading, spacing: 18) {
                stepper
                Group {
                    switch step {
                    case 0: contentStep
                    case 1: evidenceStep
                    default: previewStep
                    }
                }
                .disabled(working)
            }
        } leading: {
            if step > 0 {
                Button("上一步") { withAnimation(.snappy) { step -= 1 } }
                    .buttonStyle(PillButtonStyle(.secondary))
                    .disabled(working)
            }
        } trailing: {
            if working { ProgressView().controlSize(.small) }
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
                .disabled(working)
            if step < 2 {
                Button(step == 1 && plan.evidenceURL == nil ? "跳过" : "下一步") { withAnimation(.snappy) { step += 1 } }
                    .buttonStyle(PillButtonStyle(.primary))
                    .keyboardShortcut(.defaultAction)
                    .disabled(step == 0 && !hasContent)
            } else {
                Button(working ? "正在保存…" : "确认变更") { commit() }
                    .buttonStyle(PillButtonStyle(.primary))
                    .keyboardShortcut(.defaultAction)
                    .disabled(working)
            }
        }
        .interactiveDismissDisabled(working)
        .onAppear(perform: prefill)
        .fileImporter(isPresented: $picking, allowedContentTypes: [.pdf, .image]) { result in
            if case .success(let url) = result { plan.evidenceURL = url }
        }
    }

    // MARK: 步骤条

    private var stepper: some View {
        HStack(spacing: 10) {
            ForEach(0..<steps.count, id: \.self) { i in
                let title = steps[i]
                HStack(spacing: 6) {
                    Text("\(i + 1)").font(.system(size: 11, weight: .bold))
                        .frame(width: 20, height: 20)
                        .background(i <= step ? Theme.selection : Theme.band, in: .circle)
                        .foregroundStyle(i <= step ? Theme.onSelection : Theme.muted)
                    Text(title).font(.system(size: 13, weight: i == step ? .semibold : .regular))
                        .foregroundStyle(i == step ? Theme.ink : Theme.muted)
                }
                if i < steps.count - 1 { Rectangle().fill(Theme.hairline).frame(height: 1) }
            }
        }
    }

    // MARK: 第 1 步

    private var statusSelection: Binding<CompanyStatus> {
        Binding(get: { plan.newStatus ?? company?.status ?? .active }, set: { plan.newStatus = $0 })
    }

    private var contentStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            FormGroup(title: "变更") {
                FieldRow(label: "变更类型") {
                    SelectField(options: ChangeKind.allCases.map { k in (k, k.label) }, selection: $plan.kind, minWidth: 220)
                }
                FieldRow(label: "生效日期") {
                    DateField(day: effectiveOn, allowsClear: false)
                }
            }
            switch plan.kind {
            case .directorChange: directorFields
            case .shareholderChange: holdingFields
            case .addressChange:
                FormGroup(title: "新的注册地址") {
                    TextField("注册地址", text: Binding(get: { plan.newAddress ?? "" }, set: { plan.newAddress = $0 }), axis: .vertical)
                        .lineLimit(2...5)
                        .textFieldStyle(KitFieldStyle())
                }
            case .nameChange:
                FormGroup(title: "新名称") {
                    FieldRow(label: "注册名", hint: "原名称会自动记为曾用名。") {
                        TextField("注册名（原文）", text: Binding(get: { plan.newName ?? "" }, set: { plan.newName = $0 }))
                            .textFieldStyle(KitFieldStyle())
                    }
                }
            case .statusChange:
                FormGroup(title: "新状态") {
                    FieldRow(label: "状态") {
                        SelectField(options: CompanyStatus.allCases.map { s in (s, s.label) }, selection: statusSelection, minWidth: 180)
                    }
                }
            case .other:
                EmptyView()
            }
            FormGroup(title: "说明") {
                FieldRow(label: "说明", hint: "可留空，Charter 会根据以上内容自动生成。") {
                    TextField(store.autoSummary(plan), text: $plan.summary, axis: .vertical)
                        .lineLimit(1...4)
                        .textFieldStyle(KitFieldStyle())
                }
            }
        }
        .onChange(of: plan.kind) { resetForKind() }
    }

    private var currentAppointments: [Appointment] {
        store.appointments.filter { $0.companyID == companyID && $0.isActive(on: plan.effectiveOn) }
    }

    private var personChoices: [(String, String)] {
        let none: [(String, String)] = [("", "新建人员…")]
        return none + store.people.map { p in (p.id, p.name) }
    }

    @ViewBuilder private var directorFields: some View {
        FormGroup(title: "现任：勾选离任人员") {
            if currentAppointments.isEmpty {
                Text("还没有记录现任董事。").font(TypeStyle.body).foregroundStyle(Theme.muted)
            }
            ForEach(currentAppointments) { a in
                Toggle(isOn: Binding(get: { plan.endingAppointmentIDs.contains(a.id) },
                                     set: { if $0 { plan.endingAppointmentIDs.insert(a.id) } else { plan.endingAppointmentIDs.remove(a.id) } })) {
                    HStack {
                        Text(store.person(a.personID)?.name ?? "未知").fontWeight(.medium)
                        Text(a.title).foregroundStyle(Theme.muted)
                        Spacer()
                        if plan.endingAppointmentIDs.contains(a.id) { Text("离任").foregroundStyle(Theme.amberText).fontWeight(.semibold) }
                    }
                }
                .toggleStyle(KitCheckboxStyle())
            }
        }
        FormGroup(title: "新任") {
            ForEach(plan.newAppointments) { a in
                HStack {
                    Text(store.personName(a.personID, plan: plan)).font(TypeStyle.body).fontWeight(.medium)
                    Text(a.title).font(TypeStyle.body).foregroundStyle(Theme.muted)
                    Spacer()
                    Button("移除") { removeAppointment(a) }
                        .buttonStyle(PillButtonStyle(.quiet, size: .small))
                }
            }
            FieldRow(label: "人员") {
                SelectField(options: personChoices, selection: $newPersonID, minWidth: 220)
            }
            if newPersonID.isEmpty {
                FieldRow(label: "姓名") {
                    TextField("新人员的姓名", text: $newPersonName).textFieldStyle(KitFieldStyle())
                }
            }
            FieldRow(label: "职位") {
                TextField("例如：董事", text: $newTitle).textFieldStyle(KitFieldStyle())
            }
            Button("加入新任名单") { addAppointment() }
                .buttonStyle(PillButtonStyle(.secondary, size: .small))
                .disabled(newPersonID.isEmpty && newPersonName.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private var currentHoldings: [Holding] {
        store.holdings.filter { $0.companyID == companyID && $0.isActive(on: plan.effectiveOn) }
    }

    private var holderOptions: [NodeRef] {
        store.people.map { NodeRef(kind: .person, id: $0.id) } + plan.newPeople.map { NodeRef(kind: .person, id: $0.id) }
            + store.companies.filter { $0.id != companyID }.map { NodeRef(kind: .company, id: $0.id) }
    }

    private var holderChoices: [(NodeRef?, String)] {
        let none: [(NodeRef?, String)] = [(nil, "新建人员…")]
        return none + holderOptions.map { r in (Optional(r), store.holderName(r, plan: plan)) }
    }

    private var beneficialChoices: [(NodeRef?, String)] {
        let none: [(NodeRef?, String)] = [(nil, "尚未确认")]
        return none + holderOptions.filter { $0 != newHolder }.map { r in (Optional(r), store.holderName(r, plan: plan)) }
    }

    @ViewBuilder private var holdingFields: some View {
        let kept = currentHoldings.filter { !plan.endingHoldingIDs.contains($0.id) }.map(\.percent).reduce(0, +)
        let total = kept + plan.newHoldings.map(\.percent).reduce(0, +)
        FormGroup(title: "现有股东：勾选转出或结束的持股") {
            if currentHoldings.isEmpty {
                Text("还没有记录股东。").font(TypeStyle.body).foregroundStyle(Theme.muted)
            }
            ForEach(currentHoldings) { h in
                Toggle(isOn: Binding(get: { plan.endingHoldingIDs.contains(h.id) },
                                     set: { if $0 { plan.endingHoldingIDs.insert(h.id) } else { plan.endingHoldingIDs.remove(h.id) } })) {
                    HStack {
                        Text(store.name(of: h.holder)).fontWeight(.medium)
                        Spacer()
                        Text(Ownership.percentLabel(h.percent)).monospacedDigit()
                            .strikethrough(plan.endingHoldingIDs.contains(h.id))
                    }
                }
                .toggleStyle(KitCheckboxStyle())
            }
        }
        VStack(alignment: .leading, spacing: 8) {
            FormGroup(title: "新增或调整后的持股") {
                ForEach(plan.newHoldings) { h in
                    HStack {
                        Text(store.holderName(h.holder, plan: plan)).font(TypeStyle.body).fontWeight(.medium)
                        if h.isNominee { Pill(text: "代持", kind: .neutral) }
                        Spacer()
                        Text(Ownership.percentLabel(h.percent)).font(TypeStyle.body).monospacedDigit()
                        Button("移除") { plan.newHoldings.removeAll { $0.id == h.id } }
                            .buttonStyle(PillButtonStyle(.quiet, size: .small))
                    }
                }
                FieldRow(label: "股东") {
                    SelectField(options: holderChoices, selection: $newHolder, minWidth: 240)
                }
                if newHolder == nil {
                    FieldRow(label: "姓名") {
                        TextField("新人员的姓名", text: $newPersonName).textFieldStyle(KitFieldStyle())
                    }
                }
                FieldRow(label: "持股比例") {
                    HStack(spacing: 6) {
                        TextField("", value: $newPercent, format: .number)
                            .multilineTextAlignment(.trailing)
                            .textFieldStyle(KitFieldStyle())
                            .frame(width: 90)
                        Text("%").font(TypeStyle.body).foregroundStyle(Theme.muted)
                    }
                }
                FieldRow(label: "代持") {
                    Toggle("这是一笔代持", isOn: $newNominee).toggleStyle(KitCheckboxStyle())
                }
                if newNominee {
                    FieldRow(label: "实际受益人",
                             hint: newBeneficialOwner == nil ? "这部分持股会计入未识别比例，不会算作名义股东的最终受益。" : nil) {
                        SelectField(options: beneficialChoices, selection: $newBeneficialOwner, minWidth: 240)
                    }
                }
                Button("加入新持股") { addHolding() }
                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
                    .disabled(!newPercent.isFinite || newPercent <= 0 || newPercent > 100
                              || (newHolder == nil && newPersonName.trimmingCharacters(in: .whitespaces).isEmpty))
            }
            Text("变更后合计 \(Ownership.percentLabel(total))" + (abs(total - 100) > 0.01 ? "，不是 100%，请检查。" : "。"))
                .font(TypeStyle.metadata)
                .foregroundStyle(abs(total - 100) > 0.01 ? Theme.amberText : Theme.muted)
                .padding(.leading, 4)
        }
    }

    // MARK: 第 2 步

    private var evidenceStep: some View {
        VStack(alignment: .leading, spacing: 8) {
            FormGroup(title: "证明文件（可选）") {
                if let u = plan.evidenceURL {
                    HStack(spacing: 8) {
                        Image(systemName: "doc.fill").foregroundStyle(Theme.muted)
                        Text(u.lastPathComponent).font(TypeStyle.body).lineLimit(1).truncationMode(.middle)
                        Spacer()
                        Button("更换文件…") { picking = true }
                            .buttonStyle(PillButtonStyle(.secondary, size: .small))
                        Button("移除") { plan.evidenceURL = nil }
                            .buttonStyle(PillButtonStyle(.quiet, size: .small))
                    }
                    FieldRow(label: "文件类型") {
                        SelectField(options: evidenceTypes.map { t in (t.id, t.name) }, selection: $plan.evidenceTypeID, minWidth: 240)
                    }
                } else {
                    Button("选择文件…") { picking = true }
                        .buttonStyle(PillButtonStyle(.secondary))
                }
            }
            Text("例如董事会决议、辞任函或股份转让文书。确认变更时才会归档；暂时没有可以跳过，之后在“文件”中补充。")
                .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 4)
        }
    }

    private var evidenceTypes: [DocumentType] {
        store.library.documentTypes.filter { $0.jurisdictions.isEmpty || $0.jurisdictions.contains(company?.jurisdiction ?? "") }
            .filter { $0.owner == .company && $0.id != "common.receipt" && $0.id != "common.confirmation" }
    }

    // MARK: 第 3 步

    private var previewStep: some View {
        let effects = store.effects(plan)
        return VStack(alignment: .leading, spacing: 16) {
            Text("确认后会一次完成以下 \(effects.count) 项").font(TypeStyle.sectionTitle)
            group("变更记录", effects.filter { $0.kind == .record }, "clock.arrow.circlepath")
            group("董事与任期", effects.filter { $0.kind == .appointment }, "person.crop.circle")
            group("股东", effects.filter { $0.kind == .holding }, "chart.pie")
            group("公司资料", effects.filter { $0.kind == .company }, "building.2")
            group("文件状态", effects.filter { $0.kind == .document }, "doc.badge.clock")
            group("申报事项", effects.filter { $0.kind == .obligation }, "calendar.badge.plus")
            group("证明文件", effects.filter { $0.kind == .evidence }, "paperclip")
            if store.complianceOn && !effects.contains(where: { $0.kind == .obligation }) {
                Text("这类变更在\(store.jurisdictionName(company?.jurisdiction ?? ""))没有对应的申报规则，不会生成事项。")
                    .font(TypeStyle.body).foregroundStyle(Theme.muted)
            }
            Text("确认后可以在提示条里撤销。").font(TypeStyle.body).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func group(_ title: String, _ items: [ChangeEffect], _ symbol: String) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Label(title, systemImage: symbol).font(TypeStyle.metadata).fontWeight(.semibold).foregroundStyle(Theme.muted)
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(items, id: \.self) { e in
                        Text(e.text).font(TypeStyle.body).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.band, in: .rect(cornerRadius: 14))
            }
        }
    }

    private var hasContent: Bool {
        if plan.kind == .nameChange, (plan.newName ?? "").trimmingCharacters(in: .whitespaces).isEmpty { return false }
        return !store.detailLines(plan).isEmpty || !plan.summary.trimmingCharacters(in: .whitespaces).isEmpty
    }

    // MARK: 操作

    private func prefill() { resetForKind() }

    private func resetForKind() {
        plan.endingAppointmentIDs = []; plan.newAppointments = []
        plan.endingHoldingIDs = []; plan.newHoldings = []
        plan.newPeople = []
        plan.newAddress = plan.kind == .addressChange ? company?.registeredAddress : nil
        plan.newName = plan.kind == .nameChange ? company?.name : nil
        plan.newStatus = plan.kind == .statusChange ? company?.status : nil
        newTitle = "董事"
    }

    private func addAppointment() {
        var pid = newPersonID
        if pid.isEmpty {
            let p = Person(name: newPersonName.trimmingCharacters(in: .whitespaces))
            plan.newPeople.append(p)
            pid = p.id
        }
        plan.newAppointments.append(Appointment(personID: pid, companyID: companyID, title: newTitle.isEmpty ? "董事" : newTitle, from: plan.effectiveOn))
        newPersonName = ""; newPersonID = ""
    }

    private func removeAppointment(_ a: Appointment) {
        plan.newAppointments.removeAll { $0.id == a.id }
        if !plan.newAppointments.contains(where: { $0.personID == a.personID }) && !plan.newHoldings.contains(where: { $0.holder.id == a.personID }) {
            plan.newPeople.removeAll { $0.id == a.personID }
        }
    }

    private func addHolding() {
        var ref = newHolder
        if ref == nil {
            let p = Person(name: newPersonName.trimmingCharacters(in: .whitespaces))
            plan.newPeople.append(p)
            ref = NodeRef(kind: .person, id: p.id)
        }
        guard let holder = ref else { return }
        guard newPercent.isFinite, newPercent > 0, newPercent <= 100 else { return }
        plan.newHoldings.append(Holding(holder: holder, companyID: companyID, percent: newPercent, isNominee: newNominee,
                                       beneficialOwner: newNominee ? newBeneficialOwner : nil, from: plan.effectiveOn))
        newHolder = nil; newPersonName = ""; newNominee = false; newBeneficialOwner = nil
    }

    private func commit() {
        guard !working else { return }
        working = true
        Task {
            defer { working = false }
            do {
                try await store.apply(plan)
                dismiss()
            } catch {
                store.errorMessage = "变更未完成：\(error.localizedDescription)"
            }
        }
    }
}
