import SwiftUI
import AppKit

// MARK: - 请补发

/// 要请负责方补发的对象：某家公司（或某个人）的一组条目。
struct ReissueTarget: Identifiable {
    let id = UUID()
    var owner: NodeRef
    var typeIDs: [String]
}

extension View {
    /// 弹出“请补发”。
    func reissueSheet(_ target: Binding<ReissueTarget?>) -> some View {
        sheet(item: target) { t in ReissueRequestSheet(owner: t.owner, typeIDs: t.typeIDs) }
    }
}

/// 请补发：收件的负责方、要补发的条目、可修改的文字、跟进天数。
/// 主操作“复制并记录”复制文字并记下请求；“用邮件发送”起草邮件，同样记下请求。
struct ReissueRequestSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var owner: NodeRef
    var typeIDs: [String]

    @State private var partyID = ""
    @State private var selected: Set<String> = []
    @State private var message = ""
    @State private var generated = ""
    @State private var days = AppStore.defaultFollowUpDays
    @State private var prepared = false

    private var chosen: [String] { typeIDs.filter { selected.contains($0) } }
    private var chosenParty: String? { partyID.isEmpty ? nil : partyID }

    var body: some View {
        SheetScaffold(title: "请补发", subtitle: "\(store.name(of: owner))。发出后会记在“在等回件”里，到期提醒你催办。", width: 560) {
            VStack(alignment: .leading, spacing: Space.xl24) {
                FormGroup(title: "发给") {
                    FieldRow(label: "负责方", hint: partyHint) {
                        SelectField(options: partyOptions, selection: $partyID, placeholder: "选择负责方")
                    }
                    FieldRow(label: "跟进", hint: "到 \(store.today.adding(days: days).short)还没收到，总览会提醒你催办。") {
                        KitStepper(value: $days, range: 1...90, unit: "天")
                    }
                }

                FormGroup(title: typeIDs.count > 1 ? "要补发的文件" : "文件") {
                    ForEach(typeIDs, id: \.self) { id in
                        Toggle(isOn: binding(for: id)) {
                            HStack(spacing: Space.s8) {
                                Text(store.docType(id)?.name ?? "文件").lineLimit(1)
                                Spacer(minLength: Space.s8)
                                Text(stateText(id)).font(TypeStyle.metadata).foregroundStyle(Theme.muted).lineLimit(1)
                            }
                        }
                        .toggleStyle(KitCheckboxStyle())
                    }
                }

                VStack(alignment: .leading, spacing: Space.s8) {
                    HStack {
                        Text("文字").font(TypeStyle.metadata).fontWeight(.semibold).foregroundStyle(Theme.muted).padding(.leading, 4)
                        Spacer()
                        if message != generated {
                            Button("按所选重新生成") { regenerate(force: true) }
                                .buttonStyle(PillButtonStyle(.quiet, size: .small))
                        }
                    }
                    TextEditor(text: $message)
                        .font(TypeStyle.body)
                        .scrollContentBackground(.hidden)
                        .padding(10)
                        .frame(minHeight: 160)
                        .background(Theme.band, in: .rect(cornerRadius: Kit.fieldRadius))
                        .overlay(RoundedRectangle(cornerRadius: Kit.fieldRadius).strokeBorder(Theme.hairline))
                }
            }
        } leading: {
            Button("用邮件发送") { send(byMail: true) }
                .buttonStyle(PillButtonStyle(.secondary))
                .disabled(chosen.isEmpty)
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button("复制并记录") { send(byMail: false) }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(chosen.isEmpty)
        }
        .onAppear(perform: prepare)
        .onChange(of: partyID) {
            guard prepared else { return }
            days = store.followUpDays(for: chosenParty)
            regenerate(force: false)
        }
        .onChange(of: selected) {
            guard prepared else { return }
            regenerate(force: false)
        }
    }

    private var partyOptions: [(String, String)] {
        [("", "未指定负责方")] + store.parties.map { ($0.id, $0.name) }
    }

    private var partyHint: String? {
        guard let p = store.party(chosenParty) else { return store.parties.isEmpty ? "还没有负责方，可以先复制文字自行发送。" : nil }
        let email = p.email.trimmingCharacters(in: .whitespaces)
        return email.isEmpty ? "这个负责方没有填邮箱，用邮件发送时需要手动填写收件人。" : email
    }

    private func stateText(_ typeID: String) -> String {
        let gap = store.gapDescription(owner: owner, typeID: typeID)
        if let r = store.openRequest(owner: owner, typeID: typeID) {
            return "已在等\(store.party(r.partyID)?.name ?? "负责方")补发"
        }
        return gap.hasFile ? gap.state : "未归档"
    }

    private func binding(for id: String) -> Binding<Bool> {
        Binding(get: { selected.contains(id) },
                set: { on in if on { selected.insert(id) } else { selected.remove(id) } })
    }

    private func prepare() {
        guard !prepared else { return }
        partyID = store.defaultRequestParty(for: owner)?.id ?? ""
        selected = Set(typeIDs)
        days = store.followUpDays(for: chosenParty)
        regenerate(force: true)
        prepared = true
    }

    /// 用户没改过文字时跟着负责方和所选条目更新；改过则保留，提供“按所选重新生成”。
    private func regenerate(force: Bool) {
        let next = store.reissueText(owner: owner, typeIDs: chosen.isEmpty ? typeIDs : chosen, partyID: chosenParty)
        if force || message == generated { message = next }
        generated = next
    }

    private func send(byMail: Bool) {
        let ids = chosen
        guard !ids.isEmpty else { return }
        let text = message
        if byMail {
            store.composeRequestEmail(to: chosenParty, subject: "\(store.name(of: owner))：请补发\(store.typeNames(ids))", body: text)
        } else {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        }
        store.recordRequest(owner: owner, typeIDs: ids, partyID: chosenParty, message: text, followUpDays: days)
        dismiss()
    }
}

// MARK: - 等回件

/// 等回件的一行：公司、条目、负责方、已等天数；到了跟进日显示“该催办了”和“催办”。
struct WaitingRequestRow: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var request: DocumentRequest
    var showsParty = true
    var showsOwner = true
    @State private var nudging = false

    var body: some View {
        let due = store.isFollowUpDue(request)
        let waited = store.daysWaiting(request)
        HStack(spacing: Space.m12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(showsOwner ? store.name(of: request.owner) : store.typeNames(request.pendingTypeIDs))
                    .font(TypeStyle.rowTitle).lineLimit(1)
                    .help(store.name(of: request.owner))
                Text(showsOwner ? store.typeNames(request.pendingTypeIDs) : "\(Day(date: request.createdAt).display(relativeTo: store.today))发出")
                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if showsParty {
                Text(store.party(request.partyID)?.name ?? "未指定负责方")
                    .font(.system(size: 13.5)).lineLimit(1)
                    .foregroundStyle(request.partyID == nil ? Theme.muted : Theme.ink)
                    .frame(width: 170, alignment: .leading)
            }

            VStack(alignment: .trailing, spacing: 2) {
                if due {
                    Text("该催办了").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Theme.amberText)
                } else {
                    Text("\(request.followUpOn.short)跟进").font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                }
                Text(waited == 0 ? "今天发出" : "已等 \(waited) 天").font(TypeStyle.metadata).monospacedDigit()
                    .foregroundStyle(due ? Theme.amberText : Theme.muted)
            }
            .frame(width: 96, alignment: .trailing)

            HStack(spacing: 6) {
                if due {
                    Button("催办") { nudging = true }
                        .buttonStyle(PillButtonStyle(.secondary, size: .small))
                }
                ActionMenu(systemImage: "ellipsis", kind: .quiet, size: .small, entries: menuEntries)
                    .fixedSize()
                    .help("更多操作")
            }
            .frame(width: 104, alignment: .trailing)
        }
        .padding(.horizontal, Space.l16).frame(minHeight: 56)
        .accessibilityElement(children: .combine)
        .sheet(isPresented: $nudging) {
            CopyTextSheet(title: "催办：\(store.typeNames(request.pendingTypeIDs))",
                          subtitle: "复制后，下次跟进顺延 \(store.followUpDays(for: request.partyID)) 天。",
                          text: store.followUpText(for: request),
                          onCopy: { store.markNudged(request.id) })
        }
    }

    private var menuEntries: [MenuEntry] {
        let id = request.id
        let owner = request.owner
        var entries: [MenuEntry] = []
        entries.append(.item("催办…", systemImage: "bell") {
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(250))
                nudging = true
            }
        })
        if owner.kind == .company {
            entries.append(.item("打开公司", systemImage: "building.2") { router.companyTab = 0; router.open(company: owner.id) })
        }
        if !store.parties.isEmpty {
            entries.append(.divider)
            entries.append(.header("改由谁补发"))
            for p in store.parties where p.id != request.partyID {
                let pid = p.id
                entries.append(.item(p.name, systemImage: "person.crop.circle") { store.reassignRequest(id, to: pid) })
            }
        }
        entries.append(.divider)
        entries.append(.item("不再等了", systemImage: "xmark.circle") { store.cancelRequest(id) })
        return entries
    }
}

/// 总览的“在等回件”：一张承载面，细线分行；该催办的排在前面。
/// 开启合规模块时，已交办、正在等回件的合规事项也列在这里（原“今天”页的“等回件”）。
struct WaitingRequestsSection: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    /// 当前集团范围内的公司；nil 表示全部。
    var scope: Set<String>?
    /// 已交办、还在正常等回件的合规事项。
    var obligations: [Obligation] = []

    var body: some View {
        let list = store.openRequests.filter { r in
            guard r.owner.kind == .company, let scope else { return true }
            return scope.contains(r.owner.id)
        }
        .sorted { (store.isFollowUpDue($0) ? 0 : 1, $0.followUpOn) < (store.isFollowUpDue($1) ? 0 : 1, $1.followUpOn) }
        if !list.isEmpty || !obligations.isEmpty {
            let dueCount = list.filter { store.isFollowUpDue($0) }.count
            VStack(alignment: .leading, spacing: Space.m12) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("在等回件").font(TypeStyle.section).tracking(Tracking.section)
                        Text(caption(requests: list.count, due: dueCount))
                            .font(TypeStyle.meta).foregroundStyle(dueCount > 0 ? Theme.amberText : Theme.muted)
                    }
                    Spacer()
                }
                VStack(spacing: 0) {
                    ForEach(Array(list.enumerated()), id: \.element.id) { pair in
                        if pair.offset > 0 { Rectangle().fill(Theme.hairline).frame(height: 1).padding(.horizontal, Space.l16) }
                        WaitingRequestRow(request: pair.element)
                    }
                    ForEach(Array(obligations.enumerated()), id: \.element.id) { pair in
                        if pair.offset > 0 || !list.isEmpty { Rectangle().fill(Theme.hairline).frame(height: 1).padding(.horizontal, Space.l16) }
                        ObligationRow(obligation: pair.element, detail: "\(pair.element.company.name)，\(store.stateLine(pair.element))") {
                            router.sheet = .obligation(pair.element.key)
                        }
                        .padding(.horizontal, Space.xs4)
                    }
                }
                .padding(.vertical, Space.xs4)
                .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
                .clipShape(.rect(cornerRadius: Radius.surface, style: .continuous))
            }
        }
    }

    private func caption(requests: Int, due: Int) -> String {
        var parts: [String] = []
        if requests > 0 {
            parts.append(due > 0 ? "\(requests) 个补发请求，其中 \(due) 个该催办了" : "\(requests) 个补发请求，都还没到跟进日")
        }
        if !obligations.isEmpty { parts.append("\(obligations.count) 件合规事项已交办") }
        return parts.joined(separator: "；")
    }
}

/// 公司页标题下的一行：在等 N 份补发（负责方，已等 X 天）。
struct CompanyWaitingLine: View {
    @Environment(AppStore.self) private var store
    var companyID: String

    var body: some View {
        let list = store.openRequests(for: NodeRef(kind: .company, id: companyID))
        if let oldest = list.min(by: { $0.createdAt < $1.createdAt }) {
            let count = list.reduce(0) { $0 + $1.pendingTypeIDs.count }
            let parties = Set(list.map { $0.partyID ?? "" })
            let who = parties.count > 1 ? "\(parties.count) 个负责方" : (store.party(oldest.partyID)?.name ?? "未指定负责方")
            let waited = store.daysWaiting(oldest)
            let due = list.contains { store.isFollowUpDue($0) }
            HStack(spacing: 6) {
                Image(systemName: "hourglass").font(.system(size: 11, weight: .semibold))
                Text("在等 \(count) 份补发（\(who)，\(waited == 0 ? "今天发出" : "已等 \(waited) 天")）" + (due ? "，该催办了" : ""))
            }
            .font(TypeStyle.meta)
            .foregroundStyle(due ? Theme.amberText : Theme.muted)
            .help(list.map { store.typeNames($0.pendingTypeIDs) }.joined(separator: "、"))
        }
    }
}

/// 负责方详情里：这个负责方正在补发的文件。
struct PartyRequestsList: View {
    @Environment(AppStore.self) private var store
    var partyID: String

    var body: some View {
        let list = store.openRequests(partyID: partyID)
        VStack(alignment: .leading, spacing: Space.s8) {
            Text("等回件").font(TypeStyle.section).tracking(Tracking.section)
            if list.isEmpty {
                Text("没有在等这个负责方补发的文件。").font(TypeStyle.body).foregroundStyle(Theme.muted)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(list.enumerated()), id: \.element.id) { pair in
                        if pair.offset > 0 { Rectangle().fill(Theme.hairline).frame(height: 1) }
                        WaitingRequestRow(request: pair.element, showsParty: false)
                            .padding(.horizontal, -Space.l16)
                    }
                }
            }
        }
    }
}
