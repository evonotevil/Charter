import SwiftUI
import UniformTypeIdentifiers
import AppKit

// MARK: - 待核对标签

/// 规则可信度标签：待核对、需复核；已确认时不显示（除非 showConfirmed）。
struct TrustBadge: View {
    var trust: RuleTrust
    var showConfirmed = false

    var body: some View {
        switch trust {
        case .draft:
            badge("待核对", symbol: "questionmark.circle")
                .help("这条规则尚未向负责方或官方来源核对，截止日仅供参考")
        case .needsReview(let on):
            badge("需复核", symbol: "clock.arrow.circlepath")
                .help("上次确认于 \(on?.long ?? "未知日期")，已超过 12 个月")
        case .confirmed(let scope, let on):
            if showConfirmed {
                badge("已确认", symbol: "checkmark.seal")
                    .help("\(scope)，\(on?.long ?? "")确认")
            }
        }
    }

    private func badge(_ text: String, symbol: String) -> some View {
        let confirmed = text == "已确认"
        return Label(text, systemImage: symbol)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(confirmed ? Theme.limeText : (text == "需复核" ? Theme.amberText : Theme.muted))
            .padding(.horizontal, 8).frame(height: 22)
            .background(confirmed ? Theme.limeSoft : (text == "需复核" ? Theme.amberSoft : Color.clear), in: .capsule)
            .overlay { if !confirmed && text != "需复核" { Capsule().strokeBorder(Theme.muted.opacity(0.5), lineWidth: 1) } }
            .fixedSize()
    }
}

// MARK: - 截止日依据

/// 事项详情里的“截止日依据”：怎么算的、依据什么、谁确认的。放在 FormGroup 里，每个子视图是一行。
struct DeadlineBasisSection: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var obligation: Obligation

    var body: some View {
        let o = obligation
        let trust = store.trust(o)
        let v = store.verification(ruleID: o.rule.id, company: o.company)
        VStack(alignment: .leading, spacing: 4) {
            ForEach(store.explain(o), id: \.self) { line in
                Text(line).font(TypeStyle.body).foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        FieldRow(label: "核对状态") {
            TrustBadge(trust: trust, showConfirmed: true)
        }
        if let v, v.status == .confirmed {
            FieldRow(label: "依据") { valueText(v.source.isEmpty ? v.sourceKind : "\(v.sourceKind)：\(v.source)") }
            if !v.conditions.isEmpty { FieldRow(label: "适用条件") { valueText(v.conditions) } }
            FieldRow(label: "核对人") { valueText(v.confirmedBy.isEmpty ? "—" : v.confirmedBy) }
            FieldRow(label: "核对日期") { valueText(v.confirmedOn?.long ?? "—") }
        } else {
            Text("这条规则尚未核对。截止日按草稿算法得出，请向负责方或官方来源确认后记录。")
                .font(TypeStyle.body).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        HStack(spacing: 8) {
            if let v, v.status == .confirmed, let id = v.evidenceDocumentID, let d = store.documents.first(where: { $0.id == id }) {
                Button("打开确认文件") { store.open(d) }
                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
            }
            Button(trust.isConfirmed ? "修改核对信息…" : "确认这条规则…") {
                router.sheet = .confirmRule(ruleID: o.rule.id, companyID: o.company.id)
            }
            .buttonStyle(PillButtonStyle(.secondary, size: .small))
            Spacer(minLength: 8)
            SettingsJumpLink(title: "截止日算法不对？", pane: .rules)
        }
    }

    private func valueText(_ s: String) -> some View {
        Text(s).font(TypeStyle.body).foregroundStyle(Theme.ink)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }
}

// MARK: - 截止日算法编辑

/// 截止日算法：输出若干 FieldRow，放在 FormGroup 里使用。
struct ScheduleEditor: View {
    @Environment(AppStore.self) private var store
    @Binding var schedule: Schedule

    private func intBinding(_ kp: WritableKeyPath<Schedule, Int?>) -> Binding<Int> {
        Binding(get: { schedule[keyPath: kp] ?? 0 }, set: { schedule[keyPath: kp] = $0 })
    }

    var body: some View {
        FieldRow(label: "方式") {
            SelectField(options: ScheduleKind.allCases.map { ($0, $0.label) }, selection: $schedule.kind, minWidth: 220)
        }
        switch schedule.kind {
        case .annualFixed:
            MonthDayField(title: "每年", value: Binding(get: { schedule.date ?? MonthDay(12, 31) }, set: { schedule.date = $0 }))
        case .afterAnniversary:
            FieldRow(label: "周年日后") { KitStepper(value: intBinding(\.days), range: 0...365, unit: "天") }
        case .afterFiscalYearEnd:
            FieldRow(label: "财年结束后") { KitStepper(value: intBinding(\.months), range: 0...24, unit: "个月") }
            FieldRow(label: "再加") { KitStepper(value: intBinding(\.days), range: 0...60, unit: "天") }
        case .incorporationHalf:
            MonthDayField(title: "1–6 月成立", value: Binding(get: { schedule.firstHalf ?? MonthDay(5, 31) }, set: { schedule.firstHalf = $0 }))
            MonthDayField(title: "7–12 月成立", value: Binding(get: { schedule.secondHalf ?? MonthDay(11, 30) }, set: { schedule.secondHalf = $0 }))
        case .documentExpiry:
            FieldRow(label: "文件类型") {
                SelectField(options: [("", "未选择")] + store.library.documentTypes.map { ($0.id, $0.name) },
                            selection: Binding(get: { schedule.documentTypeID ?? "" }, set: { schedule.documentTypeID = $0 }),
                            minWidth: 220)
            }
        case .event:
            FieldRow(label: "变更类型") {
                SelectField(options: ChangeKind.allCases.map { ($0, $0.label) },
                            selection: Binding(get: { schedule.event ?? .directorChange }, set: { schedule.event = $0 }),
                            minWidth: 220)
            }
            FieldRow(label: "变更后") { KitStepper(value: intBinding(\.days), range: 0...180, unit: "天内") }
        }
    }
}

/// 数字输入：输入框加减号按钮，限制在范围内。
struct KitStepper: View {
    @Binding var value: Int
    var range: ClosedRange<Int>
    var unit: String = ""

    var body: some View {
        HStack(spacing: 6) {
            Button { value = max(range.lowerBound, value - 1) } label: { Image(systemName: "minus") }
                .buttonStyle(PillButtonStyle(.quiet, size: .small))
                .disabled(value <= range.lowerBound)
            TextField("0", value: Binding(get: { value }, set: { value = min(max($0, range.lowerBound), range.upperBound) }), format: .number)
                .textFieldStyle(KitFieldStyle())
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .frame(width: 72)
            Button { value = min(range.upperBound, value + 1) } label: { Image(systemName: "plus") }
                .buttonStyle(PillButtonStyle(.quiet, size: .small))
                .disabled(value >= range.upperBound)
            if !unit.isEmpty { Text(unit).font(TypeStyle.body).foregroundStyle(Theme.muted) }
        }
    }
}

// MARK: - 确认规则

struct RuleConfirmSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var ruleID: String
    var companyID: String?

    @State private var companyOnly = false
    @State private var differentSchedule = false
    @State private var schedule = Schedule(kind: .annualFixed, date: MonthDay(12, 31))
    @State private var v = RuleVerification()
    @State private var attaching = false
    @State private var evidenceName = ""
    @State private var pendingEvidence: StagedFile?

    private var rule: RuleTemplate? { store.library.rules.first { $0.id == ruleID } }
    private var company: Company? { store.company(companyID) }

    private var canConfirm: Bool {
        !v.confirmedBy.trimmingCharacters(in: .whitespaces).isEmpty && !(v.source.isEmpty && v.evidenceDocumentID == nil)
    }

    var body: some View {
        SheetScaffold(title: "确认截止日规则", subtitle: rule?.name, width: 580, height: 680) {
            VStack(alignment: .leading, spacing: 18) {
                FormGroup(title: "规则") {
                    FieldRow(label: "当前算法") {
                        Text(rule?.schedule.summary ?? "").font(TypeStyle.body).foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let c = company {
                        FieldRow(label: "确认范围") {
                            RadioGroup(options: [(false, "\(store.jurisdictionName(c.jurisdiction))所有公司"), (true, "仅 \(c.name)")],
                                       selection: $companyOnly)
                        }
                        if companyOnly {
                            Toggle("负责方给出的截止日与通用规则不同", isOn: $differentSchedule)
                                .toggleStyle(KitCheckboxStyle())
                            if differentSchedule { ScheduleEditor(schedule: $schedule) }
                        }
                    }
                }

                FormGroup(title: "依据") {
                    FieldRow(label: "来源类型") {
                        SelectField(options: RuleVerification.sourceKinds.map { ($0, $0) }, selection: $v.sourceKind, minWidth: 200)
                    }
                    FieldRow(label: "来源") {
                        TextField("链接或说明，例如代理邮件日期、官网网址", text: $v.source, axis: .vertical)
                            .lineLimit(1...4).textFieldStyle(KitFieldStyle())
                    }
                    FieldRow(label: "适用条件") {
                        TextField("适用条件与例外（可选）", text: $v.conditions, axis: .vertical)
                            .lineLimit(1...4).textFieldStyle(KitFieldStyle())
                    }
                    if company != nil {
                        FieldRow(label: "确认文件") {
                            HStack(spacing: 10) {
                                Text(evidenceName.isEmpty ? "可选" : evidenceName)
                                    .font(TypeStyle.body).foregroundStyle(evidenceName.isEmpty ? Theme.muted : Theme.ink)
                                    .lineLimit(1).truncationMode(.middle)
                                Spacer(minLength: 8)
                                Button("附上…") { attaching = true }
                                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
                            }
                        }
                    }
                }

                FormGroup(title: "核对人") {
                    FieldRow(label: "核对人") {
                        TextField("核对人及方式，例如“张三，与 Lime Tree 邮件确认”", text: $v.confirmedBy)
                            .textFieldStyle(KitFieldStyle())
                    }
                    FieldRow(label: "核对日期") {
                        DateField(day: $v.confirmedOn, allowsClear: false)
                    }
                }
            }
        } leading: {
            if let c = company, let p = store.party(c.rulePartyIDs[ruleID] ?? c.defaultPartyID) {
                Button("起草邮件请\(latinPad(p.name))确认") { draftAsk(p, c) }
                    .buttonStyle(PillButtonStyle(.secondary))
            }
            if currentVerification?.status == .confirmed {
                Button("改回待核对") { save(status: .draft) }
                    .buttonStyle(PillButtonStyle(.secondary))
            }
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button("确认") { save(status: .confirmed) }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(!canConfirm)
        }
        .onAppear(perform: prefill)
        .fileImporter(isPresented: $attaching, allowedContentTypes: [.pdf, .image, .emailMessage, .plainText]) { result in
            guard case .success(let url) = result, let c = company else { return }
            Task { @MainActor in
                do {
                    pendingEvidence = try await store.stage(url: url, typeID: "common.confirmation", owner: NodeRef(kind: .company, id: c.id)) { d in
                        v.evidenceDocumentID = d.id
                        evidenceName = d.originalFileName
                    }
                } catch {
                    store.errorMessage = "读取附件失败：\(error.localizedDescription)"
                }
            }
        }
        .sheet(item: $pendingEvidence) { ArchiveConfirmSheet(file: $0) }
    }

    private var currentVerification: RuleVerification? {
        if let c = company, let ov = c.ruleOverrides?[ruleID]?.verification { return ov }
        return rule?.verification
    }

    private func prefill() {
        if let c = company, let ov = c.ruleOverrides?[ruleID] {
            companyOnly = true
            if let s = ov.schedule { differentSchedule = true; schedule = s }
            if let ver = ov.verification { v = ver }
        } else if let ver = rule?.verification {
            v = ver
        }
        if !differentSchedule, let r = rule { schedule = r.schedule }
        if v.confirmedOn == nil { v.confirmedOn = store.today }
        if let id = v.evidenceDocumentID, let d = store.documents.first(where: { $0.id == id }) { evidenceName = d.originalFileName }
    }

    private func save(status: VerificationStatus) {
        var ver = v
        ver.status = status
        if companyOnly, let c = company {
            store.confirmRule(ruleID: ruleID, companyID: c.id, verification: ver, schedule: differentSchedule ? schedule : nil)
        } else {
            store.confirmRule(ruleID: ruleID, companyID: nil, verification: ver, schedule: nil)
        }
        dismiss()
    }

    private func draftAsk(_ p: Party, _ c: Company) {
        guard let r = rule, let s = NSSharingService(named: .composeEmail) else { return }
        let next = store.openObligations.first { $0.rule.id == r.id && $0.company.id == c.id }
        let body = """
        \(p.contactName.isEmpty ? "您好：" : "\(p.contactName)，您好：")

        想请您确认 \(c.name) 的「\(r.name)」\(r.localName.isEmpty ? "" : "（\(r.localName)）")截止日规则。
        我们目前的理解是：\(r.schedule.summary)\(next.map { "，下一次截止日为 \($0.due.long)" } ?? "")。
        如有不同，或有例外情况，烦请告知，谢谢。
        """
        s.recipients = p.email.isEmpty ? [] : [p.email]
        s.subject = "请确认截止日：\(c.name) \(r.name)"
        s.perform(withItems: [body])
    }
}
