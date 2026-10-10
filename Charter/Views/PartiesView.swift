import SwiftUI

struct PartiesView: View {
    @Environment(AppStore.self) private var store
    @State private var selection: String?
    @State private var editing: Party?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
        PageHeader(title: "负责方", subtitle: "管理合规事项和文件补发的办理方。") {
            Button { editing = Party(name: "") } label: { Label("新建负责方", systemImage: "plus") }
                .buttonStyle(PillButtonStyle(.primary))
        }
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 12) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(PartyKind.allCases) { kind in
                            let list = store.parties.filter { $0.kind == kind }
                            if !list.isEmpty {
                                Text(kind.label).font(TypeStyle.micro).foregroundStyle(Theme.muted)
                                    .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 2)
                                ForEach(list) { p in row(p) }
                            }
                        }
                    }
                }
                .scrollIndicators(.never)
            }
            .padding(14)
            .frame(width: 300)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(Theme.surface, in: .rect(cornerRadius: Theme.radius))

            Group {
                if let p = store.party(selection) {
                    PartyDetail(party: p) { editing = p }.id(p.id)
                } else {
                    EmptyState(symbol: "person.2", title: "负责方",
                               message: "负责方可以是外部代理、公司内部的部门，或某个人。事项和文件补发都会交给他们。",
                               actionTitle: "添加负责方") { editing = Party(name: "") }
                        .background(Theme.surface, in: .rect(cornerRadius: Theme.radius))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        }
        .padding(24)
        .background(Theme.canvas)
        .sheet(item: $editing) { p in PartyEditor(party: p) { saved in selection = saved.id } }
        .onAppear { if selection == nil { selection = store.parties.first?.id } }
    }

    private func row(_ p: Party) -> some View {
        let on = selection == p.id
        let caption = p.contactName.isEmpty ? (p.email.isEmpty ? "未填联系人" : p.email) : p.contactName
        return Button { selection = p.id } label: {
            HStack(spacing: 10) {
                Avatar(name: p.name, size: 34, highlighted: on)
                VStack(alignment: .leading, spacing: 1) {
                    Text(p.name).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                    Text(caption).font(.system(size: 12)).lineLimit(1).opacity(0.65)
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(on ? Theme.onSelection : Theme.ink)
            .padding(.horizontal, 10).frame(height: 52)
            .background(on ? Theme.selection : .clear, in: .rect(cornerRadius: 16))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(p.name)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

struct PartyDetail: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var party: Party
    var onEdit: () -> Void

    var body: some View {
        let companies = store.companies.filter { $0.defaultPartyID == party.id || $0.rulePartyIDs.values.contains(party.id) }
        let open = store.openObligations.filter { store.responsibleParty(for: $0)?.id == party.id }
        let contact = [party.contactName, party.email, party.phone].filter { !$0.isEmpty }.joined(separator: "，")
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(party.name).font(TypeStyle.entityTitle)
                        Text(contact.isEmpty ? party.kind.label : "\(party.kind.label)，\(contact)")
                            .font(TypeStyle.body).foregroundStyle(Theme.muted).textSelection(.enabled)
                    }
                    Spacer(minLength: 12)
                    Button("编辑", action: onEdit)
                        .buttonStyle(PillButtonStyle(.secondary))
                    Button("下月事项") { router.openCalendar(.init(partyID: party.id, range: .nextMonth)) }
                        .buttonStyle(PillButtonStyle(.primary))
                        .help("在合规日历中查看\(party.name)下个月的全部事项，可一并交办或导出")
                }

                VStack(alignment: .leading, spacing: 8) {
                    ComplianceSectionHeader(title: "正在负责的事项", trailing: "在日历中查看全部") {
                        router.openCalendar(.init(partyID: party.id))
                    }
                    VStack(spacing: 0) {
                        if open.isEmpty {
                            Text("目前没有正在负责的事项。").font(TypeStyle.body).foregroundStyle(Theme.muted)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                        }
                        ForEach(open) { o in
                            ObligationRow(obligation: o, detail: "\(o.company.name)，\(o.status.label)") { router.sheet = .obligation(o.key) }
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    ComplianceSectionHeader(title: "负责的公司", trailing: "\(companies.count) 家")
                    VStack(spacing: 0) {
                        ForEach(companies) { c in
                            Button { router.open(company: c.id) } label: {
                                HStack(spacing: 12) {
                                    JurisdictionBadge(code: c.jurisdiction, size: 34)
                                    Text(c.name).font(TypeStyle.rowTitle).foregroundStyle(Theme.ink)
                                    Spacer()
                                    Text(c.defaultPartyID == party.id ? "默认负责方" : "部分事项")
                                        .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                                }
                                .padding(.horizontal, 12).frame(height: 52).contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    if !party.notes.isEmpty {
                        Text(party.notes).font(TypeStyle.body).foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text("交办后 \(party.followUpDays) 天未回复时提醒催办。")
                        .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                }
            }
            .padding(24)
            .frame(maxWidth: 860, alignment: .leading)
        }
        .scrollIndicators(.never)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.surface, in: .rect(cornerRadius: Theme.radius))
    }
}

struct PartyEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var party: Party
    var onSave: (Party) -> Void = { _ in }

    var body: some View {
        SheetScaffold(title: store.party(party.id) == nil ? "添加负责方" : "编辑负责方",
                      subtitle: "事项和文件补发会交给负责方办理。", width: 500) {
            VStack(alignment: .leading, spacing: 18) {
                FormGroup {
                    FieldRow(label: "名称") {
                        TextField("例如：Lime Tree 秘书公司", text: $party.name).textFieldStyle(KitFieldStyle())
                    }
                    FieldRow(label: "类型") {
                        SelectField(options: PartyKind.allCases.map { ($0, $0.label) }, selection: $party.kind, minWidth: 180)
                    }
                    FieldRow(label: "联系人") {
                        TextField("可选", text: $party.contactName).textFieldStyle(KitFieldStyle())
                    }
                    FieldRow(label: "邮箱") {
                        TextField("可选", text: $party.email).textFieldStyle(KitFieldStyle())
                    }
                    FieldRow(label: "电话") {
                        TextField("可选", text: $party.phone).textFieldStyle(KitFieldStyle())
                    }
                }
                FormGroup {
                    FieldRow(label: "催办提醒", hint: "交办后超过这个天数未回复，提醒催办。") {
                        KitStepper(value: $party.followUpDays, range: 1...90, unit: "天")
                    }
                    FieldRow(label: "备注") {
                        TextField("服务范围、合同到期日等", text: $party.notes, axis: .vertical)
                            .lineLimit(2...5).textFieldStyle(KitFieldStyle())
                    }
                }
            }
        } leading: {
            EmptyView()
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button("保存") { store.upsert(party); onSave(party); dismiss() }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(party.name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }
}
