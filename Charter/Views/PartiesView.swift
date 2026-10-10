import SwiftUI

struct PartiesView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @State private var selection: String?
    @State private var editing: Party?
    @State private var deleting: Party?
    @State private var hovered: String?
    @State private var highlightID: String?
    @Namespace private var railNS
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PageHeader(title: "负责方", subtitle: "管理合规事项和文件补发的办理方。") {
                Button { editing = Party(name: "") } label: { Label("新建负责方", systemImage: "plus") }
                    .buttonStyle(PillButtonStyle(.primary))
            }
            .padding(.horizontal, Space.pageEdge).padding(.top, Space.xl24).padding(.bottom, Space.xl24)
            HStack(alignment: .top, spacing: 0) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(PartyKind.allCases) { kind in
                            let list = store.parties.filter { $0.kind == kind }
                            if !list.isEmpty {
                                Text(kind.label).font(TypeStyle.micro).foregroundStyle(Theme.muted)
                                    .padding(.horizontal, Space.s8).padding(.top, Space.l16).padding(.bottom, Space.xs4)
                                ForEach(list) { p in row(p) }
                            }
                        }
                    }
                }
                .scrollIndicators(.never)
                .overlay {
                    if store.parties.isEmpty {
                        Text("还没有负责方").font(TypeStyle.body).foregroundStyle(Theme.muted).padding()
                    }
                }
                .padding(Space.m12)
                .frame(width: 300)
                .frame(maxHeight: .infinity, alignment: .top)
                .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
                .padding(.leading, Space.pageEdge).padding(.bottom, Space.pageEdge)

                Group {
                    if let p = store.party(selection) {
                        PartyDetail(party: p, onEdit: { editing = p }, onDelete: { deleting = p }).id(p.id)
                    } else {
                        EmptyStateView(symbol: "person.2", title: "负责方",
                                       message: "负责方可以是外部代理、公司内部的部门，或某个人。事项和文件补发都会交给他们。",
                                       actionTitle: "添加负责方") { editing = Party(name: "") }
                            .frame(maxHeight: .infinity)
                            .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
                            .padding(.leading, Space.l16).padding(.trailing, Space.pageEdge).padding(.bottom, Space.pageEdge)
                    }
                }
                .frame(minWidth: 480, maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .background(Theme.canvas)
        .onChange(of: selection) { _, new in
            withAnimation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion)) { highlightID = new }
        }
        .onChange(of: router.newPartyRequest) { _, _ in editing = Party(name: "") }
        .sheet(item: $editing) { p in PartyEditor(party: p) { saved in selection = saved.id } }
        .onAppear {
            if selection == nil { selection = store.parties.first?.id }
            highlightID = selection
        }
        .confirmSheet(deleting.map { "删除负责方“\($0.name)”？" } ?? "删除负责方？",
                      isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                      message: deleteMessage,
                      details: deleting.map { store.references(toParty: $0.id).lines } ?? [],
                      confirmTitle: "删除", destructive: true) {
            if let p = deleting { delete(p) }
        }
    }

    private var deleteMessage: String {
        guard let p = deleting else { return "" }
        return store.references(toParty: p.id).isEmpty
            ? "没有公司或事项指向这个负责方。删除后无法撤销。"
            : "以下引用会一并清除，相关公司和事项需要重新指定负责方。删除后无法撤销。"
    }

    private func delete(_ p: Party) {
        let list = store.parties
        var next = selection
        if selection == p.id, let i = list.firstIndex(where: { $0.id == p.id }) {
            next = i + 1 < list.count ? list[i + 1].id : (i > 0 ? list[i - 1].id : nil)
        }
        store.delete(party: p)
        if store.party(p.id) == nil { selection = next }
        deleting = nil
    }

    private func row(_ p: Party) -> some View {
        let on = selection == p.id
        let caption = p.contactName.isEmpty ? (p.email.isEmpty ? "未填联系人" : p.email) : p.contactName
        return Button { selection = p.id } label: {
            HStack(spacing: 10) {
                Avatar(name: p.name, size: 34, highlighted: on)
                VStack(alignment: .leading, spacing: 1) {
                    Text(p.name).font(TypeStyle.rowTitle).lineLimit(1)
                    Text(caption).font(.system(size: 12)).lineLimit(1).opacity(0.65)
                }
                Spacer(minLength: 0)
                Button { deleting = p } label: {
                    Image(systemName: "trash").font(.system(size: 12, weight: .medium))
                        .frame(width: 26, height: 26).contentShape(.rect)
                }
                .buttonStyle(.plain)
                .opacity(hovered == p.id ? 1 : 0)
                .allowsHitTesting(hovered == p.id)
                .help("删除负责方")
                .accessibilityHidden(true)
            }
            .foregroundStyle(on ? Theme.onSelection : Theme.ink)
            .padding(.horizontal, 8).frame(height: 52)
            .background {
                if highlightID == p.id {
                    RoundedRectangle(cornerRadius: Radius.row, style: .continuous)
                        .fill(Theme.selection)
                        .matchedGeometryEffect(id: "railSelection", in: railNS)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(RowButtonStyle())
        .onHover { h in
            withAnimation(Motion.resolved(Motion.fast, reduceMotion: reduceMotion)) {
                if h { hovered = p.id } else if hovered == p.id { hovered = nil }
            }
        }
        .contextMenu {
            Button("编辑") { editing = p }
            Divider()
            Button("删除…", role: .destructive) { deleting = p }
        }
        .accessibilityLabel(p.name)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityAction(named: "删除") { deleting = p }
    }
}

struct PartyDetail: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var party: Party
    var onEdit: () -> Void
    var onDelete: () -> Void = {}

    var body: some View {
        let companies = store.companies.filter { $0.defaultPartyID == party.id || $0.rulePartyIDs.values.contains(party.id) }
        let open = store.openObligations.filter { store.responsibleParty(for: $0)?.id == party.id }
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: Space.l16) {
                    Avatar(name: party.name, size: 56)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(party.name).font(TypeStyle.title).tracking(Tracking.title)
                            .lineLimit(2).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                        HStack(spacing: 6) { Pill(text: party.kind.label) }
                    }
                    Spacer(minLength: Space.m12)
                    HStack(spacing: 8) {
                        Button("删除", action: onDelete)
                            .buttonStyle(PillButtonStyle(.secondary))
                            .help("删除这个负责方，并清除指向它的引用")
                        Button("编辑", action: onEdit)
                            .buttonStyle(PillButtonStyle(.secondary))
                        Button("下月事项") { router.openCalendar(.init(partyID: party.id, range: .nextMonth)) }
                            .buttonStyle(PillButtonStyle(.primary))
                            .help("在合规日历中查看\(party.name)下个月的全部事项，可一并交办或导出")
                    }
                    .fixedSize()
                }
                .padding(Space.xl24)
                hairline
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 0) {
                        fact("联系人", party.contactName)
                        factDivider
                        fact("邮箱", party.email)
                        factDivider
                        fact("电话", party.phone)
                        factDivider
                        fact("催办提醒", "\(party.followUpDays) 天")
                        Spacer(minLength: 0)
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(alignment: .top, spacing: 0) {
                            fact("联系人", party.contactName)
                            factDivider
                            fact("催办提醒", "\(party.followUpDays) 天")
                            Spacer(minLength: 0)
                        }
                        hairline
                        HStack(alignment: .top, spacing: 0) {
                            fact("邮箱", party.email)
                            factDivider
                            fact("电话", party.phone)
                            Spacer(minLength: 0)
                        }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                hairline

                VStack(alignment: .leading, spacing: Space.s8) {
                    ComplianceSectionHeader(title: "正在负责的事项", trailing: "在日历中查看全部") {
                        router.openCalendar(.init(partyID: party.id))
                    }
                    VStack(spacing: 0) {
                        if open.isEmpty {
                            Text("目前没有正在负责的事项。").font(TypeStyle.body).foregroundStyle(Theme.muted)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, Space.m12)
                        }
                        ForEach(open) { o in
                            ObligationRow(obligation: o, detail: "\(o.company.name)，\(o.status.label)") { router.sheet = .obligation(o.key) }
                        }
                    }
                }
                .padding(Space.xl24)
                hairline

                VStack(alignment: .leading, spacing: Space.s8) {
                    ComplianceSectionHeader(title: "负责的公司", trailing: "\(companies.count) 家")
                    VStack(spacing: 0) {
                        if companies.isEmpty {
                            Text("还没有公司指定这个负责方。").font(TypeStyle.body).foregroundStyle(Theme.muted)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, Space.m12)
                        }
                        ForEach(Array(companies.enumerated()), id: \.element.id) { i, c in
                            if i > 0 { Rectangle().fill(Theme.hairline).frame(height: 1) }
                            Button { router.open(company: c.id) } label: {
                                HStack(spacing: 12) {
                                    JurisdictionBadge(code: c.jurisdiction, size: 34)
                                    Text(c.name).font(TypeStyle.rowTitle).foregroundStyle(Theme.ink)
                                    Spacer()
                                    Text(c.defaultPartyID == party.id ? "默认负责方" : "部分事项")
                                        .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                                }
                                .padding(.horizontal, Space.s8).frame(height: 52).contentShape(.rect)
                            }
                            .buttonStyle(RowButtonStyle())
                        }
                    }
                    .padding(.horizontal, -Space.s8)
                }
                .padding(Space.xl24)

                if !party.notes.isEmpty {
                    hairline
                    VStack(alignment: .leading, spacing: 6) {
                        Text("备注").font(TypeStyle.meta).foregroundStyle(Theme.muted)
                        Text(party.notes).font(TypeStyle.body).foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                    .padding(Space.xl24)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
            .padding(.leading, Space.l16).padding(.trailing, Space.pageEdge).padding(.bottom, Space.pageEdge)
            .frame(maxWidth: 1000, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .appear()
        }
        .scrollIndicators(.never)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var hairline: some View {
        Rectangle().fill(Theme.hairline).frame(height: 1)
    }

    private var factDivider: some View {
        Rectangle().fill(Theme.hairline).frame(width: 1).frame(maxHeight: .infinity)
    }

    private func fact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(TypeStyle.meta).foregroundStyle(Theme.muted)
            Text(value.isEmpty ? "未填写" : value)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(value.isEmpty ? Theme.muted : Theme.ink)
                .textSelection(.enabled)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, Space.xl24).padding(.vertical, Space.l16)
        .frame(minWidth: 130, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct PartyEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var party: Party
    var onSave: (Party) -> Void = { _ in }
    @State private var attempted = false
    @FocusState private var nameFocused: Bool

    private var isNew: Bool { store.party(party.id) == nil }
    private var nameError: String? {
        attempted && party.name.trimmingCharacters(in: .whitespaces).isEmpty ? "请填写名称" : nil
    }

    var body: some View {
        SheetScaffold(title: isNew ? "添加负责方" : "编辑负责方",
                      subtitle: "事项和文件补发会交给负责方办理。", width: 500) {
            VStack(alignment: .leading, spacing: 18) {
                FormGroup {
                    FieldRow(label: "名称", error: nameError) {
                        TextField("例如：Lime Tree 秘书公司", text: $party.name).textFieldStyle(KitFieldStyle())
                            .focused($nameFocused)
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
            Button(isNew ? "添加" : "保存") {
                attempted = true
                guard nameError == nil else { nameFocused = true; return }
                let wasNew = isNew
                party.name = party.name.trimmingCharacters(in: .whitespaces)
                store.upsert(party)
                onSave(party)
                store.showToast(wasNew ? "已添加负责方 \(party.name)" : "已保存 \(party.name)")
                dismiss()
            }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
        }
        .onAppear { if isNew { nameFocused = true } }
    }
}
