import SwiftUI
import UniformTypeIdentifiers

// MARK: - 公司编辑

struct CompanyEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    let original: Company?
    @State private var draft: Company
    @State private var holdings: [Holding] = []
    @State private var appointments: [Appointment] = []
    @State private var aliasText = ""
    @State private var formerText = ""
    @State private var newPersonName = ""
    @State private var askChange = false
    @State private var saveError: String?
    @State private var attempted = false
    @FocusState private var nameFocused: Bool

    @State private var groupID: String?
    /// 编辑已有公司时：勾选它应属于的集团。取消勾选即移出。
    @State private var memberGroups: Set<String> = []
    @State private var parentRef: NodeRef?
    @State private var parentPercent: Double = 100
    @State private var parentNominee = false

    /// 新建时可拖入注册证书：读出公司资料预填，保存后把这份文件归档到新公司。
    @State private var seedURL: URL?
    @State private var seedReading = false
    @State private var seedNote: String?
    @State private var seedFailed = false
    @State private var seedTargeted = false
    @State private var seedPicking = false

    init(company: Company?, groupID: String? = nil) {
        original = company
        _draft = State(initialValue: company ?? Company(name: "", jurisdiction: "HK", trackingSince: .today()))
        _groupID = State(initialValue: groupID)
    }

    private var jurisdictionChoices: [(String, String)] {
        store.library.jurisdictions.map { j in (j.code, "\(j.name)（\(j.code)）") }
    }

    private var entityFormChoices: [(String, String)] {
        let forms = store.jurisdiction(draft.jurisdiction)?.entityForms ?? []
        var list: [(String, String)] = [("", "未指定")] + forms.map { f in (f, f) }
        if !draft.entityForm.isEmpty && !forms.contains(draft.entityForm) {
            list.append((draft.entityForm, draft.entityForm))
        }
        return list
    }

    private var groupChoices: [(String?, String)] {
        let none: [(String?, String)] = [(nil, "不归入")]
        return none + store.corporateGroups.map { g in (Optional(g.id), g.name) }
    }

    private var partyChoices: [(String?, String)] {
        let none: [(String?, String)] = [(nil, "未指定")]
        return none + store.parties.map { p in (Optional(p.id), "\(p.name)（\(p.kind.label)）") }
    }

    private var nameError: String? {
        attempted && draft.name.trimmingCharacters(in: .whitespaces).isEmpty ? "请填写注册名" : nil
    }

    /// 同一法域里注册编号重复（只提示，不阻止保存）。
    private var registrationError: String? {
        let reg = draft.registrationNumber.trimmingCharacters(in: .whitespaces)
        // 新建时由下方“可能已存在”提示负责
        guard !reg.isEmpty, original != nil else { return nil }
        let dup = store.companies.first {
            $0.id != draft.id && $0.jurisdiction == draft.jurisdiction
                && $0.registrationNumber.trimmingCharacters(in: .whitespaces).caseInsensitiveCompare(reg) == .orderedSame
        }
        return dup.map { "与 \($0.name) 的注册编号相同，请核对" }
    }

    /// 新建时：名称或注册编号与已有公司相同（忽略大小写和空格），可能是同一家公司。
    private var possibleDuplicate: Company? {
        guard original == nil else { return nil }
        let name = Self.normalized(draft.name)
        let reg = Self.normalized(draft.registrationNumber)
        guard !name.isEmpty || !reg.isEmpty else { return nil }
        return store.companies.first { c in
            (!name.isEmpty && (Self.normalized(c.name) == name || c.aliases.contains { Self.normalized($0) == name }))
                || (!reg.isEmpty && Self.normalized(c.registrationNumber) == reg)
        }
    }

    private static func normalized(_ s: String) -> String {
        s.lowercased().filter { !$0.isWhitespace }
    }

    private func duplicateNotice(_ c: Company) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Label("可能已存在：\(c.name)", systemImage: "exclamationmark.triangle.fill")
                .font(TypeStyle.meta)
                .foregroundStyle(Theme.amberText)
                .fixedSize(horizontal: false, vertical: true)
            Button("打开这家公司") {
                router.companyTab = 0
                router.open(company: c.id)
                dismiss()
            }
            .buttonStyle(PillButtonStyle(.quiet, size: .small))
            Spacer(minLength: 0)
        }
        .padding(.leading, Kit.labelWidth + 12)
        .transition(.opacity)
    }

    /// 集团里排在最前的顶层公司（新公司默认挂在它下面）。
    private func topCompany(of groupID: String?) -> NodeRef? {
        guard let gid = groupID, let g = store.group(gid) else { return nil }
        return g.tops.first { $0.kind == .company && store.company($0.id) != nil }
    }

    /// 跟踪起始日不能为空：清空时保留原值。
    private var trackingSince: Binding<Day?> {
        Binding<Day?>(get: { draft.trackingSince }, set: { if let d = $0 { draft.trackingSince = d } })
    }

    var body: some View {
        SheetScaffold(title: original == nil ? "新建公司" : "编辑公司资料",
                      subtitle: original?.name,
                      width: 720, height: 860) {
            VStack(alignment: .leading, spacing: 18) {
                if original == nil {
                    FormGroup(title: "从文件开始（可选）") {
                        seedWell
                    }
                }
                FormGroup(title: "基本信息") {
                    FieldRow(label: "注册名", error: nameError) {
                        TextField("注册名（原文）", text: $draft.name).textFieldStyle(KitFieldStyle())
                            .focused($nameFocused)
                    }
                    FieldRow(label: "别名", hint: "中文简称等，用逗号分隔，仅用于搜索") {
                        TextField("可选", text: $aliasText).textFieldStyle(KitFieldStyle())
                    }
                    FieldRow(label: "曾用名", hint: "用逗号分隔") {
                        TextField("可选", text: $formerText).textFieldStyle(KitFieldStyle())
                    }
                    FieldRow(label: "法域") {
                        SelectField(options: jurisdictionChoices, selection: $draft.jurisdiction, minWidth: 220)
                    }
                    FieldRow(label: "公司类型") {
                        SelectField(options: entityFormChoices, selection: $draft.entityForm, minWidth: 220)
                    }
                    FieldRow(label: "注册编号", error: registrationError) {
                        TextField("可选", text: $draft.registrationNumber).textFieldStyle(KitFieldStyle())
                    }
                    if let dup = possibleDuplicate {
                        duplicateNotice(dup)
                    }
                    FieldRow(label: "成立日期") {
                        DateField(day: $draft.incorporationDate)
                    }
                    FieldRow(label: "财年结束日") {
                        HStack(spacing: 8) {
                            SelectField(options: (1...12).map { m in (m, "\(m) 月") }, selection: $draft.fiscalYearEnd.month, minWidth: 100)
                            SelectField(options: (1...31).map { d in (d, "\(d) 日") }, selection: $draft.fiscalYearEnd.day, minWidth: 100)
                        }
                    }
                    FieldRow(label: "状态") {
                        SelectField(options: CompanyStatus.allCases.map { s in (s, s.label) }, selection: $draft.status, minWidth: 160)
                    }
                    FieldRow(label: "注册地址") {
                        TextField("可选", text: $draft.registeredAddress, axis: .vertical)
                            .lineLimit(1...3)
                            .textFieldStyle(KitFieldStyle())
                    }
                }

                FormGroup(title: "集团") {
                    if let o = original {
                        if store.corporateGroups.isEmpty {
                            Text("还没有集团。").font(TypeStyle.body).foregroundStyle(Theme.muted)
                        }
                        ForEach(store.corporateGroups) { g in
                            let m = store.membership(of: o.id, in: g)
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Toggle(g.name, isOn: Binding(
                                    get: { memberGroups.contains(g.id) },
                                    set: { if $0 { memberGroups.insert(g.id) } else { memberGroups.remove(g.id) } }))
                                    .toggleStyle(KitCheckboxStyle())
                                if m != .none { Pill(text: m.sourceLabel, kind: m == .excluded ? .outline : .neutral) }
                                Spacer(minLength: 0)
                            }
                            .help(store.membershipExplanation(of: o.id, in: g))
                        }
                        Text("取消勾选即移出。按股权推导出的公司移出后记为“已排除”，之后股权变化也不会再自动纳入。")
                            .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        FieldRow(label: "归入集团") {
                            SelectField(options: groupChoices, selection: $groupID, minWidth: 220)
                        }
                    }
                    if original == nil, let gid = groupID, let g = store.group(gid) {
                        let parents: [(NodeRef?, String)] = parentChoices(g)
                        FieldRow(label: "上级公司", hint: "默认挂在集团顶层公司下面，保存后出现在股权结构图里。") {
                            SelectField(options: parents, selection: $parentRef, minWidth: 220)
                        }
                        if parentRef != nil {
                            FieldRow(label: "持股比例",
                                     error: parentPercent <= 0 || parentPercent > 100 ? "持股比例需大于 0、不超过 100%" : nil) {
                                HStack(spacing: 6) {
                                    TextField("", value: $parentPercent, format: .number)
                                        .multilineTextAlignment(.trailing)
                                        .textFieldStyle(KitFieldStyle(invalid: parentPercent <= 0 || parentPercent > 100))
                                        .frame(width: 90)
                                    Text("%").font(TypeStyle.body).foregroundStyle(Theme.muted)
                                }
                            }
                            FieldRow(label: "代持") {
                                Toggle("上级公司代他人持有", isOn: $parentNominee).toggleStyle(KitCheckboxStyle())
                            }
                        }
                    }
                }

                FormGroup(title: "负责方与提醒") {
                    FieldRow(label: "默认负责方") {
                        SelectField(options: partyChoices, selection: $draft.defaultPartyID, minWidth: 220)
                    }
                    FieldRow(label: "开始跟踪", hint: "此日期之前的截止日不再提醒。补录已有公司时，可设为今天。") {
                        DateField(day: trackingSince, allowsClear: false)
                    }
                }

                FormGroup(title: "股东") {
                    ForEach($holdings) { $h in
                        HoldingRow(holding: $h, companyID: draft.id) { holdings.removeAll { $0.id == h.id } }
                    }
                    Button {
                        let first = store.people.first.map { NodeRef(kind: .person, id: $0.id) } ?? NodeRef(kind: .company, id: store.companies.first?.id ?? "")
                        holdings.append(Holding(holder: first, companyID: draft.id, percent: 100, from: draft.incorporationDate))
                    } label: {
                        Label("添加股东", systemImage: "plus")
                    }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                }

                FormGroup(title: "任职人员") {
                    ForEach($appointments) { $a in
                        AppointmentRow(appointment: $a) { appointments.removeAll { $0.id == a.id } }
                    }
                    Button {
                        if let p = store.people.first { appointments.append(Appointment(personID: p.id, companyID: draft.id,
                                                                                         title: AppStore.roleSuggestions(entityForm: draft.entityForm).first ?? "", from: nil)) }
                    } label: {
                        Label("添加任职人员", systemImage: "plus")
                    }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                    .disabled(store.people.isEmpty)
                    let dupes = store.possibleDuplicates(of: newPersonName)
                    FieldRow(label: "新建人员",
                             hint: dupes.isEmpty ? "新建人员后，可在上方的任职中选择"
                                                 : "已有同名或别名一致的人员：\(dupes.map { store.personLabel($0) }.joined(separator: "；"))。请直接在上方选择，避免重复。") {
                        HStack(spacing: 8) {
                            TextField("姓名", text: $newPersonName).textFieldStyle(KitFieldStyle())
                            Button(dupes.isEmpty ? "添加" : "仍然新建") {
                                let name = newPersonName.trimmingCharacters(in: .whitespaces)
                                guard !name.isEmpty else { return }
                                store.upsert(Person(name: name))
                                newPersonName = ""
                            }
                            .buttonStyle(PillButtonStyle(.secondary))
                            .disabled(newPersonName.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                }

                FormGroup(title: "备注") {
                    TextField("可选", text: $draft.notes, axis: .vertical)
                        .lineLimit(3...8)
                        .textFieldStyle(KitFieldStyle())
                }
            }
        } leading: {
            if original != nil {
                Button("删除公司") {
                    // 直接删除，提示条和 ⌘Z 可撤销
                    if let c = original { store.delete(company: c) }
                    router.selectedCompanyID = nil
                    dismiss()
                }
                    .buttonStyle(PillButtonStyle(.secondary))
            }
            if let saveError {
                Label(saveError, systemImage: "exclamationmark.triangle.fill")
                    .font(TypeStyle.metadata)
                    .foregroundStyle(Theme.amberText)
                    .lineLimit(2)
                    .help(saveError)
                    .accessibilityLabel("无法保存：\(saveError)")
            }
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button(original == nil ? "添加" : "保存") {
                attempted = true
                guard nameError == nil else { nameFocused = true; return }
                if original != nil && !(appointmentDiff.isEmpty && holdingDiff.isEmpty) { askChange = true } else { save(asChange: false) }
            }
            .buttonStyle(PillButtonStyle(.primary))
            .keyboardShortcut(.defaultAction)
        }
        .onAppear {
            if original == nil { nameFocused = true }
            aliasText = draft.aliases.joined(separator: "，")
            formerText = draft.formerNames.joined(separator: "，")
            holdings = store.holdings.filter { $0.companyID == draft.id }
            appointments = store.appointments.filter { $0.companyID == draft.id }
            if original == nil, parentRef == nil { parentRef = topCompany(of: groupID) }
            if let o = original { memberGroups = Set(store.groups(containing: o.id).map(\.id)) }
        }
        .onChange(of: groupID) { _, g in
            if original == nil { parentRef = topCompany(of: g) }
        }
        .animation(.snappy, value: possibleDuplicate?.id)
        .sheet(isPresented: $askChange) {
            RecordChangePrompt(changes: appointmentDiff + holdingDiff,
                               onRecord: { save(asChange: true) },
                               onCorrect: { save(asChange: false) })
        }
    }

    private func parentChoices(_ g: CorporateGroup) -> [(NodeRef?, String)] {
        let none: [(NodeRef?, String)] = [(nil, "暂不设置")]
        return none + parentOptions(g).map { r in (Optional(r), store.name(of: r)) }
    }

    /// 新公司可以挂在集团顶层或集团里任何一家公司下面。
    private func parentOptions(_ g: CorporateGroup) -> [NodeRef] {
        var out: [NodeRef] = []
        for t in g.tops where !out.contains(t) { out.append(t) }
        for r in store.rows(of: g) where !r.unconnected {
            let ref = NodeRef(kind: .company, id: r.companyID)
            if !out.contains(ref) { out.append(ref) }
        }
        return out
    }

    private func split(_ s: String) -> [String] {
        s.split(whereSeparator: { ",，、".contains($0) }).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    private var originalAppointments: [Appointment] { store.appointments.filter { $0.companyID == draft.id } }
    private var originalHoldings: [Holding] { store.holdings.filter { $0.companyID == draft.id } }

    /// 和已保存的任职相比改了什么。
    private var appointmentDiff: [String] {
        var out: [String] = []
        let old = Dictionary(uniqueKeysWithValues: originalAppointments.map { ($0.id, $0) })
        for a in appointments {
            let n = store.person(a.personID)?.name ?? "未知"
            if let o = old[a.id] {
                if o.to == nil, let t = a.to { out.append("\(n) 离任\(a.title)（\(t.long)）") }
                else if o.personID != a.personID || o.title != a.title { out.append("\(n) 任\(a.title)") }
            } else {
                out.append("\(n) 就任\(a.title)")
            }
        }
        for o in originalAppointments where !appointments.contains(where: { $0.id == o.id }) {
            out.append("删除了 \(store.person(o.personID)?.name ?? "未知") 的\(o.title)任职")
        }
        return out
    }

    private var holdingDiff: [String] {
        var out: [String] = []
        let old = Dictionary(uniqueKeysWithValues: originalHoldings.map { ($0.id, $0) })
        for h in holdings where !h.holder.id.isEmpty {
            let n = store.name(of: h.holder)
            if let o = old[h.id] {
                if o.to == nil, h.to != nil { out.append("\(n) 不再持股") }
                else if o.percent != h.percent || o.holder != h.holder { out.append("\(n) 持股改为 \(Ownership.percentLabel(h.percent))") }
            } else {
                out.append("\(n) 新增持股 \(Ownership.percentLabel(h.percent))")
            }
        }
        for o in originalHoldings where !holdings.contains(where: { $0.id == o.id }) {
            out.append("删除了 \(store.name(of: o.holder)) 的持股记录")
        }
        return out
    }

    /// 变更生效日：取改动里最早的就任或离任日期，没有就用今天。
    private func changeDate(_ items: [(Day?, Day?)]) -> Day {
        items.flatMap { [$0.0, $0.1] }.compactMap { $0 }.filter { $0 <= .today() }.max() ?? .today()
    }

    private func save(asChange: Bool) {
        do {
            try validateHoldings()
            saveError = nil
        } catch {
            saveError = error.localizedDescription
            return
        }
        if asChange {
            let ad = appointmentDiff, hd = holdingDiff
            let oldA = Dictionary(uniqueKeysWithValues: originalAppointments.map { ($0.id, $0) })
            let oldH = Dictionary(uniqueKeysWithValues: originalHoldings.map { ($0.id, $0) })
            if !ad.isEmpty {
                let d = changeDate(appointments.filter { oldA[$0.id] != $0 }.map { ($0.from, $0.to) })
                var c = ChangeRecord(companyID: draft.id, kind: .directorChange, effectiveOn: d, recordedOn: .today(), summary: ad.prefix(2).joined(separator: "；"))
                c.details = ad
                store.record(change: c)
            }
            if !hd.isEmpty {
                let d = changeDate(holdings.filter { oldH[$0.id] != $0 }.map { ($0.from, $0.to) })
                var c = ChangeRecord(companyID: draft.id, kind: .shareholderChange, effectiveOn: d, recordedOn: .today(), summary: hd.prefix(2).joined(separator: "；"))
                c.details = hd
                store.record(change: c)
            }
        }
        saveValidated()
    }

    private func candidateHoldings() -> [Holding] {
        var candidate = store.holdings.filter { $0.companyID != draft.id }
        candidate.append(contentsOf: holdings)
        if original == nil, let parentRef {
            candidate.append(Holding(holder: parentRef, companyID: draft.id, percent: parentPercent,
                                     isNominee: parentNominee, from: draft.incorporationDate))
        }
        return candidate
    }

    private func validateHoldings() throws {
        try HoldingValidation.validate(candidateHoldings(),
                                       companyIDs: Set(store.companies.map(\.id)).union([draft.id]),
                                       personIDs: Set(store.people.map(\.id)),
                                       changedCompanyIDs: [draft.id])
    }

    private func saveValidated() {
        draft.name = draft.name.trimmingCharacters(in: .whitespaces)
        draft.aliases = split(aliasText)
        draft.formerNames = split(formerText)
        if let o = original, o.name != draft.name, !draft.formerNames.contains(o.name) {
            draft.formerNames.append(o.name)
            store.record(change: ChangeRecord(companyID: draft.id, kind: .nameChange, effectiveOn: .today(), recordedOn: .today(), summary: "由 \(o.name) 更名为 \(draft.name)"))
        }
        store.upsert(draft)
        store.holdings = candidateHoldings()
        store.saveHoldings()
        store.appointments.removeAll { $0.companyID == draft.id }
        store.appointments.append(contentsOf: appointments)
        store.saveAppointments()
        var groupNote: String?
        if original == nil {
            if let g = groupID { store.add(companyID: draft.id, to: g) }
        } else {
            let before = Set(store.groups(containing: draft.id).map(\.id))
            for gid in memberGroups.subtracting(before) { store.add(companyID: draft.id, to: gid) }
            for gid in before.subtracting(memberGroups) { groupNote = store.moveOut(companyID: draft.id, from: gid) }
            let added = memberGroups.subtracting(before).compactMap { store.group($0)?.name }
            if groupNote == nil, !added.isEmpty { groupNote = "已归入" + added.joined(separator: "、") }
        }
        store.tidyGroups()
        store.refreshDerived()
        store.showToast(groupNote ?? (original == nil ? "已添加 \(draft.name)" : "已保存 \(draft.name)"))
        if original == nil {
            router.companyTab = 0
            router.open(company: draft.id)
        } else {
            router.selectedCompanyID = draft.id
        }
        dismiss()
        if original == nil, let url = seedURL {
            // 等这张表收起后，再把拖入的那份文件归档到新公司
            let id = draft.id
            let r = router
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(400))
                r.startImport(urls: [url], context: .company(id))
            }
        }
    }

    // MARK: 从文件开始

    private var seedWell: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Image(systemName: seedURL == nil ? "arrow.down.doc" : "doc.text")
                    .font(.system(size: 18, weight: .semibold))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(seedURL?.lastPathComponent ?? "拖入注册证书，自动填写名称、编号和成立日期")
                        .font(TypeStyle.rowTitle)
                        .lineLimit(1).truncationMode(.middle)
                    Text(seedURL == nil ? "也可以点这里选择文件。保存后这份文件会归档到新公司。" : "保存后这份文件会归档到新公司。")
                        .font(TypeStyle.metadata).opacity(0.75)
                }
                Spacer(minLength: 8)
                if seedReading {
                    ProgressView().controlSize(.small)
                } else if seedURL != nil {
                    Button("移除") { clearSeed() }
                        .buttonStyle(PillButtonStyle(.quiet, size: .small))
                }
            }
            .foregroundStyle(Theme.onLime)
            .padding(.horizontal, 18).padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.lime.opacity(seedTargeted ? 1 : 0.85), in: .rect(cornerRadius: 16, style: .continuous))
            .overlay {
                if seedTargeted {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Theme.onLime.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                        .padding(5)
                }
            }
            .contentShape(.rect(cornerRadius: 16))
            .onTapGesture { if !seedReading { seedPicking = true } }
            .dropDestination(for: URL.self) { urls, _ in
                guard let url = urls.first, !seedReading else { return false }
                readSeed(url)
                return true
            } isTargeted: { seedTargeted = $0 }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { seedPicking = true }
            .help("拖入注册证书，或点按选择文件")

            if seedFailed {
                Text("未能读出公司信息，请手动填写。")
                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
            } else if let seedNote {
                Text(seedNote)
                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .fileImporter(isPresented: $seedPicking, allowedContentTypes: [.pdf, .image]) { result in
            if case .success(let url) = result { readSeed(url) }
        }
    }

    private func clearSeed() {
        seedURL = nil
        seedNote = nil
        seedFailed = false
    }

    /// 识别在后台进行；读到的名称、法域、编号、成立日期填进表单。
    private func readSeed(_ url: URL) {
        seedURL = url
        seedReading = true
        seedFailed = false
        seedNote = nil
        let context = store.recognitionContext
        Task { @MainActor in
            let access = url.startAccessingSecurityScopedResource()
            let r = await Recognizer.recognize(file: url, context: context)
            if access { url.stopAccessingSecurityScopedResource() }
            var filled: [String] = []
            if let name = r.companyNameGuess?.trimmingCharacters(in: .whitespaces), name.count > 2 {
                draft.name = name; filled.append("名称")
            }
            if let j = r.jurisdiction, store.jurisdiction(j) != nil {
                draft.jurisdiction = j
                let forms = store.jurisdiction(j)?.entityForms ?? []
                if !draft.entityForm.isEmpty && !forms.contains(draft.entityForm) { draft.entityForm = "" }
                filled.append("法域")
            }
            if let n = r.registrationNumber, !n.isEmpty {
                draft.registrationNumber = n; filled.append("注册编号")
            }
            if let d = r.incorporationDate {
                draft.incorporationDate = d; filled.append("成立日期")
            }
            seedReading = false
            if filled.isEmpty {
                seedFailed = true
            } else {
                let basis = r.evidence.isEmpty ? "" : "依据：" + r.evidence.joined(separator: "，") + "。"
                seedNote = "已填写" + filled.joined(separator: "、") + "，请核对。" + basis
            }
        }
    }
}

/// 保存公司资料时，任职或持股有改动：问是记为一次变更，还是只更正资料。
struct RecordChangePrompt: View {
    var changes: [String]
    var onRecord: () -> Void
    var onCorrect: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SheetScaffold(title: "要记为一次变更吗？",
                      subtitle: "如果这是一次真实的董事或股东变更，记为变更会写入变更记录、把相关文件标为需要更新，并生成需要申报的事项。如果只是补录或更正错误，选“只更正资料”。",
                      width: 520) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(changes.prefix(6).enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Circle().fill(Theme.muted).frame(width: 4, height: 4).offset(y: -2)
                        Text(line).font(TypeStyle.body).foregroundStyle(Theme.ink)
                    }
                }
                if changes.count > 6 {
                    Text("另有 \(changes.count - 6) 处改动").font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.band, in: .rect(cornerRadius: 12))
        } leading: {
            Button("只更正资料") { dismiss(); onCorrect() }
                .buttonStyle(PillButtonStyle(.secondary))
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button("记为变更") { dismiss(); onRecord() }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
                .help("写入变更记录并生成申报事项")
        }
    }
}

struct HoldingRow: View {
    @Environment(AppStore.self) private var store
    @Binding var holding: Holding
    var companyID: String
    var onDelete: () -> Void

    private var options: [NodeRef] {
        store.people.map { NodeRef(kind: .person, id: $0.id) } + store.companies.filter { $0.id != companyID }.map { NodeRef(kind: .company, id: $0.id) }
    }

    private func label(_ r: NodeRef) -> String { r.kind == .person ? store.personLabel(r.id) : store.name(of: r) }

    private var holderChoices: [(NodeRef, String)] {
        options.map { r in (r, label(r)) }
    }

    private var beneficialChoices: [(NodeRef?, String)] {
        let none: [(NodeRef?, String)] = [(nil, "未指定")]
        return none + options.map { r in (Optional(r), label(r)) }
    }

    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 10) {
                FieldRow(label: "股东") {
                    SelectField(options: holderChoices, selection: $holding.holder, minWidth: 240)
                }
                FieldRow(label: "持股比例") {
                    HStack(spacing: 6) {
                        TextField("", value: $holding.percent, format: .number)
                            .multilineTextAlignment(.trailing)
                            .textFieldStyle(KitFieldStyle())
                            .frame(width: 90)
                        Text("%").font(TypeStyle.body).foregroundStyle(Theme.muted)
                    }
                }
                FieldRow(label: "股份数") {
                    TextField("可选", text: $holding.shares).textFieldStyle(KitFieldStyle())
                }
                FieldRow(label: "股份类别") {
                    TextField("可选", text: $holding.shareClass).textFieldStyle(KitFieldStyle())
                }
                FieldRow(label: "代持") {
                    Toggle("这是一笔代持", isOn: $holding.isNominee).toggleStyle(KitCheckboxStyle())
                }
                if holding.isNominee {
                    FieldRow(label: "实际受益人") {
                        SelectField(options: beneficialChoices, selection: $holding.beneficialOwner, minWidth: 240)
                    }
                }
                FieldRow(label: "生效日期") {
                    DateField(day: $holding.from)
                }
                FieldRow(label: "结束日期") {
                    DateField(day: $holding.to, placeholder: "仍持有可留空")
                }
                HStack {
                    Spacer()
                    Button(role: .destructive, action: onDelete) {
                        Label("删除这条持股", systemImage: "trash")
                    }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                }
            }
            .padding(.top, 8)
        } label: {
            HStack(spacing: 8) {
                Text(store.name(of: holding.holder)).font(TypeStyle.body).fontWeight(.medium)
                if holding.isNominee { Pill(text: "代持", kind: .neutral) }
                Spacer()
                Text(Ownership.percentLabel(holding.percent)).font(TypeStyle.body).fontWeight(.bold).monospacedDigit()
                Text(holding.to == nil ? "自 \(holding.from?.description ?? "?")" : "\(holding.from?.description ?? "?") 至 \(holding.to!.description)")
                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted).monospacedDigit()
            }
        }
    }
}

struct AppointmentRow: View {
    @Environment(AppStore.self) private var store
    @Binding var appointment: Appointment
    var onDelete: () -> Void

    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 10) {
                FieldRow(label: "人员") {
                    SelectField(options: store.people.map { p in (p.id, store.personLabel(p)) }, selection: $appointment.personID, minWidth: 220)
                }
                FieldRow(label: "职位", hint: "按实体类型给出常用角色，也可以直接输入。") {
                    HStack(spacing: 6) {
                        TextField(store.roleSuggestions(for: appointment.companyID).first ?? "职位", text: $appointment.title)
                            .textFieldStyle(KitFieldStyle())
                        ActionMenu(title: "常用", kind: .quiet, size: .small,
                                   entries: store.roleSuggestions(for: appointment.companyID).map { r -> MenuEntry in
                                       .item(r, systemImage: appointment.title == r ? "checkmark" : nil) { appointment.title = r }
                                   })
                            .fixedSize()
                    }
                }
                FieldRow(label: "就任日期", hint: "不清楚可留空，会显示为“日期未知”，不会用今天代替。") {
                    DateField(day: $appointment.from, placeholder: "日期未知")
                }
                FieldRow(label: "离任日期") {
                    DateField(day: $appointment.to, placeholder: "在任可留空")
                }
                HStack {
                    Spacer()
                    Button(role: .destructive, action: onDelete) {
                        Label("删除这条任职", systemImage: "trash")
                    }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                }
            }
            .padding(.top, 8)
        } label: {
            HStack(spacing: 8) {
                Text(store.person(appointment.personID)?.name ?? "未选择").font(TypeStyle.body).fontWeight(.medium)
                Text(appointment.title.isEmpty ? "未填职位" : appointment.title).font(TypeStyle.body).foregroundStyle(Theme.muted)
                Spacer()
                if appointment.from == nil { Text("日期未知").font(TypeStyle.metadata).foregroundStyle(Theme.muted) }
                if appointment.to != nil { Pill(text: "已离任") }
            }
        }
    }
}

// MARK: - 事项详情

struct ObligationSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var obligation: Obligation
    @State private var note = ""
    @State private var overrideDay: Day?
    @State private var partyID: String?
    @State private var attachReceipt = false
    @State private var pendingReceipt: StagedFile?
    @Environment(\.dismiss) private var dismissSelf

    private func partyChoices(_ o: Obligation) -> [(String?, String)] {
        let fallback = store.party(o.company.rulePartyIDs[o.rule.id] ?? o.company.defaultPartyID)?.name ?? "未指定"
        let none: [(String?, String)] = [(nil, "用默认（\(fallback)）")]
        return none + store.parties.map { p in (Optional(p.id), p.name) }
    }

    var body: some View {
        let o = obligation
        SheetScaffold(title: o.rule.name, subtitle: o.company.name, width: 600, height: 780) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 8) {
                    Pill(text: o.status.label, kind: o.status.pillKind)
                    TrustBadge(trust: store.trust(o))
                }

                FormGroup(title: "事项") {
                    FieldRow(label: "截止日") {
                        Text(o.due == o.originalDue ? o.originalDue.long : "\(o.due.long)（原定 \(o.originalDue.long)）")
                            .font(TypeStyle.body).foregroundStyle(Theme.ink)
                    }
                    if !o.rule.penalty.isEmpty {
                        FieldRow(label: "逾期后果") {
                            Text(o.rule.penalty).font(TypeStyle.body).foregroundStyle(Theme.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    if !o.rule.notes.isEmpty {
                        Text(o.rule.notes).font(TypeStyle.body).foregroundStyle(Theme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                FormGroup(title: "截止日依据") {
                    DeadlineBasisSection(obligation: o)
                }

                FormGroup(title: "进度") {
                    ForEach(history(o), id: \.self) { line in
                        Label(line, systemImage: "circle.fill").labelStyle(TimelineLabelStyle())
                            .font(TypeStyle.body)
                    }
                    if let rid = o.record?.receiptDocumentID, let doc = store.documents.first(where: { $0.id == rid }) {
                        Button("打开回执") { store.open(doc) }
                            .buttonStyle(PillButtonStyle(.secondary, size: .small))
                    }
                }

                FormGroup(title: "处理") {
                    FieldRow(label: "负责方") {
                        SelectField(options: partyChoices(o), selection: $partyID, minWidth: 240)
                    }
                    FieldRow(label: "改期到", hint: "留空则按规则算出的截止日") {
                        DateField(day: $overrideDay, placeholder: "不改期")
                    }
                    FieldRow(label: "备注") {
                        TextField("可选", text: $note, axis: .vertical)
                            .lineLimit(1...4)
                            .textFieldStyle(KitFieldStyle())
                    }
                    if !o.isDone {
                        Button("附上回执并标记完成…") { attachReceipt = true }
                            .buttonStyle(PillButtonStyle(.secondary, size: .small))
                    } else if o.record?.receiptDocumentID == nil {
                        Button("补传回执…") { attachReceipt = true }
                            .buttonStyle(PillButtonStyle(.secondary, size: .small))
                    }
                }
            }
        } leading: {
            if o.isDone {
                Button("改回未完成") { store.revertToPending(o); dismiss() }
                    .buttonStyle(PillButtonStyle(.secondary))
            }
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            if o.isDone {
                Button("保存") { saveEdits(o); dismiss() }
                    .buttonStyle(PillButtonStyle(.primary))
                    .keyboardShortcut(.defaultAction)
            } else {
                Button("保存") { saveEdits(o); dismiss() }
                    .buttonStyle(PillButtonStyle(.secondary))
                NextStepControls(obligation: o, large: false)
            }
        }
        .onAppear {
            note = o.record?.note ?? ""
            overrideDay = o.record?.overrideDue
            partyID = o.record?.partyID
        }
        .fileImporter(isPresented: $attachReceipt, allowedContentTypes: [.pdf, .image]) { result in
            guard case .success(let url) = result else { return }
            Task { @MainActor in
                do {
                    pendingReceipt = try await store.stage(url: url, typeID: "common.receipt", owner: NodeRef(kind: .company, id: o.company.id)) { doc in
                        saveEdits(o)
                        if o.isDone { store.attachReceipt(doc, to: o) } else { store.complete(o, receipt: doc) }
                        dismissSelf()
                    }
                } catch {
                    store.errorMessage = "读取回执失败：\(error.localizedDescription)"
                }
            }
        }
        .sheet(item: $pendingReceipt) { ArchiveConfirmSheet(file: $0) }
    }

    private static let logFormatter: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "zh_CN"); f.dateFormat = "M 月 d 日 HH:mm"
        return f
    }()

    private func history(_ o: Obligation) -> [String] {
        var lines: [String] = []
        if let r = o.record {
            if let log = r.log, !log.isEmpty {
                let f = Self.logFormatter
                for e in log {
                    var line = "\(f.string(from: e.at))　\(e.label)"
                    if let p = store.party(e.partyID), [.drafted, .copied, .sent].contains(e.action) { line += "（\(p.name)）" }
                    if let c = e.channel, e.action != .drafted { line += "，通过\(c)" }
                    lines.append(line)
                }
            } else {
                // 1.1 之前的记录没有日志，按字段还原
                if let d = r.handedOffOn { lines.append("\(d.long)交给\(latinPad(store.party(r.partyID)?.name ?? "负责方"))") }
                if let d = r.completedOn { lines.append("\(d.long)标记完成") }
            }
        }
        if lines.isEmpty { lines.append("还没有处理") }
        return lines
    }

    private func saveEdits(_ o: Obligation) {
        if note != (o.record?.note ?? "") { store.setNote(o, note) }
        if overrideDay != o.record?.overrideDue { store.reschedule(o, to: overrideDay) }
        if partyID != o.record?.partyID, let p = store.party(partyID) {
            if let i = store.records.firstIndex(where: { $0.key == o.key }) { store.records[i].partyID = p.id; store.saveRecords() }
            else { store.records.append(ObligationRecord(key: o.key, ruleID: o.rule.id, companyID: o.company.id, dueDate: o.originalDue, partyID: p.id)); store.saveRecords() }
        }
    }
}

/// 进度列表里的小圆点样式。
struct TimelineLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 10) {
            configuration.icon.font(.system(size: 6)).foregroundStyle(Theme.amberText)
            configuration.title
        }
    }
}
