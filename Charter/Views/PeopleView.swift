import SwiftUI
import AppKit

/// 人员：一个人在哪些公司任职、直接持有什么、替谁代持或由谁代持、穿透后持有多少。
struct PeopleView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @State private var query = ""
    @State private var showingNewPerson = false
    @FocusState private var searchFocused: Bool
    @Namespace private var railNS
    @State private var highlightID: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var list: [Person] {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        return store.people.filter { q.isEmpty || ([$0.name] + $0.aliases).joined(separator: " ").lowercased().contains(q) }
            .sorted { $0.name < $1.name }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PageHeader(title: "人员") {
                Button { showingNewPerson = true } label: { Label("新建人员", systemImage: "plus") }
                    .buttonStyle(PillButtonStyle(.primary))
            }
            .padding(.horizontal, Space.pageEdge).padding(.top, Space.xl24).padding(.bottom, Space.xl24)
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: Space.s8) {
                    HStack(spacing: Space.s8) {
                        Button { searchFocused = true } label: { Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted) }
                            .buttonStyle(.plain).keyboardShortcut("f", modifiers: [.command]).help("搜索人员（⌘F）")
                        TextField("搜索姓名或别名", text: $query).textFieldStyle(.plain).focused($searchFocused)
                        if !query.isEmpty {
                            Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted) }
                                .buttonStyle(.plain)
                        }
                    }
                    .font(TypeStyle.body)
                    .padding(.horizontal, 14).frame(height: 38)
                    .background(Theme.band, in: .capsule)
                    ScrollView {
                        LazyVStack(spacing: 2) {
                            ForEach(list) { p in row(p) }
                        }
                        .padding(.top, Space.xs4)
                    }
                    .scrollIndicators(.never)
                    .overlay {
                        if list.isEmpty {
                            Text(query.isEmpty ? "还没有人员" : "没有找到“\(query)”")
                                .font(TypeStyle.body).foregroundStyle(Theme.muted)
                                .padding()
                        }
                    }
                }
                .padding(Space.m12)
                .frame(width: 300)
                .frame(maxHeight: .infinity, alignment: .top)
                .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
                .padding(.leading, Space.pageEdge).padding(.bottom, Space.pageEdge)

                Group {
                    if let id = router.selectedPersonID, let p = store.person(id) {
                        PersonDetail(person: p).id(p.id)
                    } else {
                        EmptyStateView(symbol: "person.crop.rectangle.stack", title: "选择人员",
                                       message: "查看此人的任职、直接与间接持股，以及代持情况。")
                            .frame(maxHeight: .infinity)
                            .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
                            .padding(.leading, Space.l16).padding(.trailing, Space.pageEdge).padding(.bottom, Space.pageEdge)
                    }
                }
                .frame(minWidth: 480, maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .navigationTitle("人员")
        .onAppear {
            if router.selectedPersonID == nil { router.selectedPersonID = list.first?.id }
            highlightID = router.selectedPersonID
        }
        .onChange(of: router.selectedPersonID) { _, new in
            withAnimation(Motion.resolved(Motion.standard, reduceMotion: reduceMotion)) { highlightID = new }
        }
        .onMoveCommand { direction in
            switch direction {
            case .up: moveSelection(by: -1)
            case .down: moveSelection(by: 1)
            default: break
            }
        }
        .onChange(of: router.newPersonRequest) { _, _ in showingNewPerson = true }
        .sheet(isPresented: $showingNewPerson) {
            NewPersonSheet { person in router.selectedPersonID = person.id }
        }
    }

    private func row(_ p: Person) -> some View {
        let on = router.selectedPersonID == p.id
        let ref = NodeRef(kind: .person, id: p.id)
        let roles = Set(store.appointments.filter { $0.personID == p.id && $0.isActive(on: store.today) }.map(\.companyID)).count
        let held = store.holdings.filter { $0.holder == ref && $0.isActive(on: store.today) }
        let caption = [roles > 0 ? "任职 \(roles) 家" : nil,
                       held.isEmpty ? nil : "持股 \(held.count) 家",
                       held.contains(where: \.isNominee) ? "名义股东" : nil].compactMap { $0 }.joined(separator: "，")
        // 同名的人靠所在公司区分：优先现任职务的公司，其次直接持股的公司
        let anchor = store.anchorCompanyName(person: p.id)
        let summary = anchor.map { caption.isEmpty ? $0 : "\(caption)，\($0)" } ?? "未关联"
        return Button { router.selectedPersonID = p.id } label: {
            HStack(spacing: 10) {
                Avatar(name: p.name, size: 34, dashed: held.contains(where: \.isNominee), highlighted: on)
                VStack(alignment: .leading, spacing: 1) {
                    Text(p.name).font(TypeStyle.rowTitle).lineLimit(1)
                    HStack(spacing: 0) {
                        if let anchor {
                            if !caption.isEmpty { Text("\(caption)，").fixedSize() }
                            Text(anchor).opacity(0.8).truncationMode(.tail)
                        } else {
                            Text("未关联")
                        }
                    }
                    .font(.system(size: 12)).lineLimit(1).opacity(0.65)
                }
                Spacer(minLength: 0)
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
        .accessibilityLabel(p.name)
        .accessibilityValue(summary)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func moveSelection(by offset: Int) {
        guard !list.isEmpty else { return }
        let current = router.selectedPersonID.flatMap { id in list.firstIndex { $0.id == id } }
            ?? (offset > 0 ? -1 : list.count)
        let next = min(max(current + offset, 0), list.count - 1)
        router.selectedPersonID = list[next].id
    }

}

/// 新建人员：打开即聚焦姓名；空名在行内提示，同名只提醒不阻止。
private struct NewPersonSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var onCreate: (Person) -> Void
    @State private var name = ""
    @State private var attempted = false
    @FocusState private var focused: Bool

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        let duplicate = !trimmed.isEmpty && store.people.contains { $0.name == trimmed }
        SheetScaffold(title: "新建人员", subtitle: "先填姓名，任职和持股在公司档案里添加。", width: 460) {
            FormGroup {
                FieldRow(label: "姓名",
                         hint: duplicate ? "已有同名的人员。新建后，列表里会用所在公司区分两人。" : nil,
                         error: attempted && trimmed.isEmpty ? "请填写姓名" : nil) {
                    TextField("例如：张三", text: $name).textFieldStyle(KitFieldStyle())
                        .focused($focused)
                }
            }
        } leading: {
            EmptyView()
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button("新建") {
                attempted = true
                guard !trimmed.isEmpty else { focused = true; return }
                let person = store.createPerson(name: trimmed)
                onCreate(person)
                store.showToast("已新建人员 \(person.name)")
                dismiss()
            }
            .buttonStyle(PillButtonStyle(.primary))
            .keyboardShortcut(.defaultAction)
        }
        .onAppear { focused = true }
    }
}

struct PersonDetail: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var person: Person
    @State private var editing = false
    @State private var merging = false

    private var ref: NodeRef { NodeRef(kind: .person, id: person.id) }

    var body: some View {
        let current = store.appointments.filter { $0.personID == person.id && $0.isActive(on: store.today) }
        let past = store.appointments.filter { $0.personID == person.id && !$0.isActive(on: store.today) }
            .sorted { ($0.to ?? $0.from ?? store.today) > ($1.to ?? $1.from ?? store.today) }
        let direct = store.holdings.filter { $0.holder == ref && $0.isActive(on: store.today) }
        let heldForMe = store.holdings.filter { $0.isNominee && $0.beneficialOwner == ref && $0.isActive(on: store.today) }
        let portfolio = Ownership.portfolio(of: ref, companies: store.companies, holdings: store.holdings, on: store.today)
        let byCompany = Dictionary(grouping: current, by: \.companyID)
        let companyIDs = byCompany.keys.sorted { companyName($0) < companyName($1) }
        let blockers = store.deletionBlockers(person: person.id)
        let missing = [byCompany.isEmpty ? "现任职务" : nil,
                       direct.isEmpty ? "直接持股" : nil,
                       portfolio.isEmpty ? "穿透后持股" : nil,
                       heldForMe.isEmpty ? "由他人代持记录" : nil,
                       past.isEmpty ? "曾任职务" : nil].compactMap { $0 }
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero(blockers: blockers, nominee: direct.contains(where: \.isNominee))
                hairline
                HStack(alignment: .top, spacing: 0) {
                    fact("现任职务", companyIDs.count)
                    factDivider
                    fact("直接持股", direct.count)
                    factDivider
                    fact("穿透后持有", portfolio.count)
                    Spacer(minLength: 0)
                }
                .fixedSize(horizontal: false, vertical: true)

                // 一个承载面，模块之间用细线分隔；没有内容的模块不出现，统一在最后一句话说明
                if !companyIDs.isEmpty {
                    section("现任职务", count: companyIDs.count) {
                        ForEach(companyIDs, id: \.self) { cid in
                            let roles = byCompany[cid] ?? []
                            HStack(spacing: Space.m12) {
                                companyLine(cid, trailing: Self.titles(roles),
                                            detail: roles.compactMap(\.from).min().map { "自 \($0.description)" })
                                ChangeRowMenu(companyID: cid, appointmentID: roles.first?.id)
                            }
                        }
                    }
                }
                if !direct.isEmpty {
                    section("直接持股", count: direct.count) {
                        ForEach(direct) { h in
                            HStack(spacing: Space.m12) {
                                companyLine(h.companyID, trailing: Ownership.percentLabel(h.percent),
                                            detail: h.isNominee ? "名义股东，代\(h.beneficialOwner.map { store.name(of: $0) } ?? "他人")持有" : nil,
                                            warn: h.isNominee, numeric: true)
                                ChangeRowMenu(companyID: h.companyID, holdingID: h.id)
                            }
                        }
                    }
                }
                if !portfolio.isEmpty {
                    section("穿透后持有", count: portfolio.count) {
                        ForEach(portfolio, id: \.company.id) { item in
                            companyLine(item.company.id, trailing: Ownership.percentLabel(item.percent),
                                        detail: item.viaNominee ? "含代持部分" : nil, numeric: true)
                        }
                    }
                }
                if !heldForMe.isEmpty {
                    section("由他人代持", count: heldForMe.count) {
                        ForEach(heldForMe) { h in
                            companyLine(h.companyID, trailing: Ownership.percentLabel(h.percent),
                                        detail: "由 \(store.name(of: h.holder)) 代为持有", warn: true, numeric: true)
                        }
                    }
                }
                if !past.isEmpty {
                    section("曾任职务", count: past.count) {
                        ForEach(past) { a in
                            companyLine(a.companyID, trailing: a.title, detail: Self.period(a.from, a.to))
                        }
                    }
                }
                if !missing.isEmpty {
                    hairline
                    Text(Self.missingSentence(missing))
                        .font(TypeStyle.body).foregroundStyle(Theme.muted)
                        .padding(.horizontal, Space.xl24).padding(.vertical, Space.l16)
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
        .sheet(isPresented: $editing) {
            EditPersonSheet(draft: person)
        }
        .sheet(isPresented: $merging) {
            MergePersonSheet(person: person)
        }
    }

    // MARK: 顶部

    private func hero(blockers: [String], nominee: Bool) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 16) {
                Avatar(name: person.name, size: 56, dashed: nominee)
                VStack(alignment: .leading, spacing: 6) {
                    Text(person.name).font(TypeStyle.title).tracking(Tracking.title).textSelection(.enabled)
                    if !person.aliases.isEmpty || nominee {
                        HStack(spacing: 6) {
                            ForEach(person.aliases, id: \.self) { Pill(text: $0) }
                            if nominee { Pill(text: "名义股东", kind: .warn) }
                        }
                    }
                    if !person.notes.isEmpty {
                        Text(person.notes).font(TypeStyle.body).foregroundStyle(Theme.muted)
                    }
                }
                Spacer(minLength: 12)
                HStack(spacing: 8) {
                    Button("复制摘要") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(store.personSummary(person), forType: .string)
                        store.showToast("人员摘要已复制。")
                    }
                    .buttonStyle(PillButtonStyle(.accent))
                    Button("编辑") { editing = true }
                        .buttonStyle(PillButtonStyle(.secondary))
                    Button("合并…") { merging = true }
                        .buttonStyle(PillButtonStyle(.secondary))
                        .help("把这个人合并到另一个人名下（重复录入时使用）")
                    Button("删除") {
                        let next = store.people.first(where: { $0.id != person.id })?.id
                        store.deletePerson(person.id)
                        router.selectedPersonID = next
                    }
                        .buttonStyle(PillButtonStyle(.secondary))
                        .disabled(!blockers.isEmpty)
                        .help(blockers.isEmpty ? "删除这个人" : "不能删除：\(blockers.joined(separator: "，"))")
                }
                .fixedSize()
            }
            if !blockers.isEmpty {
                HStack(alignment: .center, spacing: 12) {
                    Text("不能删除：\(blockers.joined(separator: "，"))。可以先把记录合并到另一个人。")
                        .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    Button("合并到…") { merging = true }
                        .buttonStyle(PillButtonStyle(.quiet, size: .small))
                        .fixedSize()
                }
            }
        }
        .padding(Space.xl24)
    }

    private var hairline: some View {
        Rectangle().fill(Theme.hairline).frame(height: 1)
    }

    private var factDivider: some View {
        Rectangle().fill(Theme.hairline).frame(width: 1).frame(maxHeight: .infinity)
    }

    private func fact(_ label: String, _ count: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(TypeStyle.meta).foregroundStyle(Theme.muted)
            Text(count == 0 ? "无" : "\(count) 家")
                .font(.mono(15, .medium)).numericTransition()
                .foregroundStyle(count == 0 ? Theme.muted : Theme.ink)
        }
        .padding(.horizontal, Space.xl24).padding(.vertical, Space.l16)
        .frame(minWidth: 140, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: 模块

    private func section<Content: View>(_ title: String, count: Int, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            hairline
            VStack(alignment: .leading, spacing: Space.s8) {
                HStack {
                    Text(title).font(TypeStyle.section).tracking(Tracking.section)
                    Spacer()
                    CountBadge(count: count)
                }
                VStack(spacing: 0) { content() }
            }
            .padding(.horizontal, Space.xl24).padding(.top, Space.xl24).padding(.bottom, Space.l16)
        }
    }

    private func companyName(_ id: String) -> String {
        store.name(of: NodeRef(kind: .company, id: id))
    }

    /// 同一公司的多个职务合并成“董事、秘书”，去掉重复。
    private static func titles(_ roles: [Appointment]) -> String {
        var out: [String] = []
        for r in roles where !out.contains(r.title) { out.append(r.title) }
        return out.joined(separator: "、")
    }

    private static func period(_ from: Day?, _ to: Day?) -> String? {
        switch (from, to) {
        case (let f?, let t?): return "\(f.description) 至 \(t.description)"
        case (let f?, nil): return "\(f.description) 起"
        case (nil, let t?): return "至 \(t.description)"
        default: return nil
        }
    }

    /// “没有直接持股、由他人代持记录和曾任职务。”
    private static func missingSentence(_ names: [String]) -> String {
        guard let last = names.last else { return "" }
        if names.count == 1 { return "没有\(last)。" }
        return "没有" + names.dropLast().joined(separator: "、") + "和" + last + "。"
    }

    private func companyLine(_ id: String, trailing: String, detail: String?, warn: Bool = false, numeric: Bool = false) -> some View {
        Button { router.companyTab = 0; router.open(company: id) } label: {
            HStack(alignment: .center, spacing: 10) {
                JurisdictionBadge(code: store.company(id)?.jurisdiction ?? "?", size: 30)
                VStack(alignment: .leading, spacing: 1) {
                    Text(store.company(id)?.name ?? "未知公司").font(.system(size: 13.5, weight: .medium)).lineLimit(1)
                    if let detail {
                        Text(detail).font(.system(size: 11.5)).monospacedDigit()
                            .foregroundStyle(warn ? Theme.amberText : Theme.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(trailing)
                    .font(.system(size: 13, weight: .semibold)).monospacedDigit()
                    .lineLimit(numeric ? 1 : 2)
                    .multilineTextAlignment(.trailing)
                    .frame(minWidth: numeric ? 64 : nil, alignment: .trailing)
            }
            .padding(.vertical, 8).padding(.horizontal, Space.s8).contentShape(.rect)
        }
        .buttonStyle(RowButtonStyle())
        .padding(.horizontal, -Space.s8)
    }
}

// MARK: - 编辑人员

private struct EditPersonSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var draft: Person

    private var trimmedName: String { draft.name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        SheetScaffold(title: "编辑人员", subtitle: "别名用于搜索，也能帮助区分同名的人。", width: 520) {
            FormGroup {
                FieldRow(label: "姓名", error: trimmedName.isEmpty ? "姓名不能为空" : nil) {
                    TextField("姓名", text: $draft.name).textFieldStyle(KitFieldStyle(invalid: trimmedName.isEmpty))
                }
                FieldRow(label: "别名", hint: "多个别名用逗号分隔") {
                    ListField(title: "例如：Zhang San", values: $draft.aliases).textFieldStyle(KitFieldStyle())
                }
                FieldRow(label: "邮箱") {
                    TextField("可选", text: $draft.email).textFieldStyle(KitFieldStyle())
                }
                FieldRow(label: "备注") {
                    TextField("可选", text: $draft.notes, axis: .vertical)
                        .lineLimit(1...4)
                        .textFieldStyle(KitFieldStyle())
                }
            }
        } leading: {
            EmptyView()
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button("保存") {
                var p = draft
                p.name = trimmedName
                store.upsert(p)
                store.showToast("已保存 \(p.name)")
                dismiss()
            }
            .buttonStyle(PillButtonStyle(.primary))
            .keyboardShortcut(.defaultAction)
            .disabled(trimmedName.isEmpty)
        }
    }
}

// MARK: - 合并人员

private struct MergePersonSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    var person: Person
    @State private var target = ""

    var body: some View {
        let others = store.people.filter { $0.id != person.id }.sorted { $0.name < $1.name }
        let options: [(String, String)] = others.map { ($0.id, "\($0.name)（\(store.personHint(person: $0.id))）") }
        let targetLabel: String = store.person(target).map { "“\($0.name)”" } ?? "所选人员"
        let moves: [String] = store.mergeEffects(person: person.id).map { "\($0)改到\(targetLabel)名下" }
        let details: [String] = moves + ["“\(person.name)”记为\(targetLabel)的别名", "删除“\(person.name)”这条重复记录"]
        SheetScaffold(title: "把“\(person.name)”合并到…",
                      subtitle: "任职、持股、代持关系、文件和集团顶层都会改到所选人员名下，然后删除这条重复记录。",
                      width: 540) {
            VStack(alignment: .leading, spacing: 18) {
                FormGroup {
                    FieldRow(label: "合并到", hint: others.isEmpty ? "还没有其他人员可以合并。" : "括号里是现任职务和持股，用来区分同名的人。") {
                        SelectField(options: options, selection: $target, minWidth: 260)
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("合并后").font(TypeStyle.metadata).fontWeight(.semibold).foregroundStyle(Theme.muted)
                        .padding(.leading, 4)
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(details, id: \.self) { d in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Circle().fill(Theme.muted).frame(width: 4, height: 4).offset(y: -2)
                                Text(d).font(TypeStyle.body).foregroundStyle(Theme.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.band, in: .rect(cornerRadius: 12))
                }
            }
        } leading: {
            EmptyView()
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button("合并") {
                let t = target
                dismiss()
                store.mergePerson(person.id, into: t)
                router.selectedPersonID = t
            }
            .buttonStyle(PillButtonStyle(.primary))
            .keyboardShortcut(.defaultAction)
            .disabled(target.isEmpty)
        }
    }
}
