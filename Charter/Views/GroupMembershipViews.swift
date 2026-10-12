import SwiftUI

// MARK: - 公司页上的集团标签

/// 集团标签：点开说明这家公司为什么在这个集团里，并给出对应的调整入口。
struct GroupTag: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var group: CorporateGroup
    var companyID: String
    @State private var showing = false

    var body: some View {
        let m = store.membership(of: companyID, in: group)
        Button { showing.toggle() } label: {
            HStack(spacing: 4) {
                Text(group.name)
                if m == .manual { Image(systemName: "hand.point.up.left").font(.system(size: 9, weight: .semibold)) }
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.limeText)
            .padding(.horizontal, 10).frame(height: 24)
            .background(Theme.limeSoft, in: .capsule)
        }
        .buttonStyle(.plain)
        .help("\(group.name)：\(m.sourceLabel)")
        .popover(isPresented: $showing, arrowEdge: .bottom) { detail(m) }
    }

    private func detail(_ m: GroupMembership) -> some View {
        VStack(alignment: .leading, spacing: Space.s8) {
            HStack(spacing: 8) {
                Text(group.name).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.ink)
                Pill(text: m.sourceLabel, kind: m == .manual ? .outline : .neutral)
            }
            Text(store.membershipExplanation(of: companyID, in: group))
                .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
            if case .derived = m {
                Text("这是按持股关系自动纳入的。移出后会记为“已排除”，之后股权变化也不会再把它加回来。")
                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: Space.s8) {
                Button("在结构中查看") {
                    showing = false
                    router.selectedCompanyID = companyID
                    router.openStructure(group: group.id)
                }
                .buttonStyle(PillButtonStyle(.secondary, size: .small))
                if m != .top {
                    Button("移出集团") {
                        showing = false
                        let gid = group.id, cid = companyID, appStore = store
                        var text = ""
                        let undoID = appStore.undoable("移出集团") { text = appStore.moveOut(companyID: cid, from: gid) }
                        appStore.showToast(text) { [weak appStore] in if let undoID { appStore?.undo(undoID) } }
                    }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                }
                Button("管理成员…") {
                    showing = false
                    router.sheet = .groupMembers(group.id)
                }
                .buttonStyle(PillButtonStyle(.quiet, size: .small))
            }
            .padding(.top, 4)
        }
        .padding(Space.l16)
        .frame(width: 320, alignment: .leading)
    }
}

// MARK: - 集中管理集团成员

/// 一屏看清某个集团的全部成员和来源，多选后批量加入、移出或恢复；应用前先列出将发生的变化。
struct GroupMembersSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var groupID: String
    @State private var filter: Filter = .all
    @State private var selection: Set<String> = []
    @State private var plan: [String: Change] = [:]
    @State private var reviewing = false
    @State private var query = ""

    enum Filter: Hashable { case all, members, duplicates, ungrouped }
    enum Change: Hashable {
        case add, remove, restore
        var label: String {
            switch self { case .add: "将加入"; case .remove: "将移出"; case .restore: "将恢复" }
        }
    }

    private var group: CorporateGroup? { store.group(groupID) }

    private var companies: [Company] {
        guard let g = group else { return [] }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return store.companies.filter { c in
            if !q.isEmpty && !c.searchText.contains(q) { return false }
            switch filter {
            case .all: return true
            case .members:
                let m = store.membership(of: c.id, in: g)
                return m.isMember || m == .excluded
            case .duplicates: return store.groups(containing: c.id).count > 1
            case .ungrouped: return store.groups(containing: c.id).isEmpty
            }
        }
        .sorted { a, b in
            let ma = store.membership(of: a.id, in: g).isMember, mb = store.membership(of: b.id, in: g).isMember
            return ma != mb ? ma : a.name < b.name
        }
    }

    var body: some View {
        SheetScaffold(title: reviewing ? "确认集团成员变更" : "管理集团成员",
                      subtitle: reviewing ? "以下变化会应用到\(group?.name ?? "集团")，之后可以撤销。"
                                          : "勾选公司后批量加入、移出或恢复。手动设置优先于股权推导。",
                      width: 760, height: 680) {
            if reviewing { review } else { editor }
        } leading: {
            if !reviewing {
                Text(plan.isEmpty ? "还没有变更" : "\(plan.count) 项待应用")
                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
            }
        } trailing: {
            if reviewing {
                Button("返回修改") { reviewing = false }
                    .buttonStyle(PillButtonStyle(.secondary))
                Button("应用") { apply() }
                    .buttonStyle(PillButtonStyle(.primary))
                    .keyboardShortcut(.defaultAction)
            } else {
                Button("取消") { dismiss() }
                    .buttonStyle(PillButtonStyle(.secondary))
                    .keyboardShortcut(.cancelAction)
                Button("检查变更") { reviewing = true }
                    .buttonStyle(PillButtonStyle(.primary))
                    .disabled(plan.isEmpty)
                    .keyboardShortcut(.defaultAction)
            }
        }
    }

    // MARK: 编辑

    private var editor: some View {
        VStack(alignment: .leading, spacing: Space.m12) {
            HStack(spacing: Space.s8) {
                SelectField(options: store.corporateGroups.map { ($0.id, $0.name) },
                            selection: Binding(get: { groupID }, set: { groupID = $0; plan = [:]; selection = [] }),
                            minWidth: 200)
                PillSegmented(options: [(Filter.all, "全部公司"), (Filter.members, "本集团"),
                                        (Filter.duplicates, "重复归属"), (Filter.ungrouped, "未归入")],
                              selection: $filter)
                Spacer(minLength: 0)
                TextField("筛选", text: $query).textFieldStyle(KitFieldStyle()).frame(width: 140)
            }
            HStack(spacing: Space.s8) {
                Text(selection.isEmpty ? "未选择" : "已选 \(selection.count) 家")
                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                Spacer(minLength: 0)
                Button("加入") { stage(.add) }.buttonStyle(PillButtonStyle(.secondary, size: .small)).disabled(selection.isEmpty)
                Button("移出") { stage(.remove) }.buttonStyle(PillButtonStyle(.secondary, size: .small)).disabled(selection.isEmpty)
                Button("恢复推导") { stage(.restore) }.buttonStyle(PillButtonStyle(.quiet, size: .small)).disabled(selection.isEmpty)
                Button("清除选择") { selection = [] }.buttonStyle(PillButtonStyle(.quiet, size: .small)).disabled(selection.isEmpty)
            }
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(companies) { c in
                        row(c)
                        Rectangle().fill(Theme.hairline).frame(height: 1)
                    }
                    if companies.isEmpty {
                        Text("没有符合条件的公司。").font(TypeStyle.body).foregroundStyle(Theme.muted)
                            .padding(Space.l16)
                    }
                }
            }
            .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
        }
    }

    private func row(_ c: Company) -> some View {
        let g = group!
        let m = store.membership(of: c.id, in: g)
        let others = store.groups(containing: c.id).filter { $0.id != g.id }
        return HStack(spacing: Space.m12) {
            Toggle("", isOn: Binding(get: { selection.contains(c.id) },
                                     set: { if $0 { selection.insert(c.id) } else { selection.remove(c.id) } }))
                .toggleStyle(KitCheckboxStyle()).labelsHidden()
            VStack(alignment: .leading, spacing: 2) {
                Text(c.name).font(TypeStyle.rowTitle).foregroundStyle(Theme.ink).lineLimit(1)
                Text(m == .none ? store.jurisdictionName(c.jurisdiction) : store.membershipExplanation(of: c.id, in: g))
                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            ForEach(others) { o in Pill(text: o.name, kind: .outline) }
            if m != .none { Pill(text: m.sourceLabel, kind: m.isMember ? .neutral : .outline) }
            if let p = plan[c.id] {
                Button { plan[c.id] = nil } label: { Pill(text: p.label, kind: .lime) }
                    .buttonStyle(.plain).help("点按取消这项变更")
            }
        }
        .padding(.horizontal, Space.l16).padding(.vertical, 10)
        .contentShape(.rect)
        .onTapGesture { if selection.contains(c.id) { selection.remove(c.id) } else { selection.insert(c.id) } }
    }

    private func stage(_ change: Change) {
        guard let g = group else { return }
        for id in selection {
            let m = store.membership(of: id, in: g)
            switch change {
            case .add: plan[id] = m.isMember ? nil : .add
            case .remove: plan[id] = (m.isMember && m != .top) ? .remove : nil
            case .restore: plan[id] = m == .excluded ? .restore : nil
            }
        }
        selection = []
    }

    // MARK: 确认

    private var review: some View {
        let nameOf = { (id: String) in store.company(id)?.name ?? id }
        let groups: [(Change, [String])] = [Change.add, .remove, .restore].map { ch in
            (ch, plan.filter { $0.value == ch }.map(\.key).sorted { nameOf($0) < nameOf($1) })
        }.filter { !$0.1.isEmpty }
        return ScrollView {
            VStack(alignment: .leading, spacing: Space.l16) {
                ForEach(groups, id: \.0) { pair in
                    FormGroup(title: "\(pair.0.label.replacingOccurrences(of: "将", with: ""))（\(pair.1.count)）") {
                        ForEach(pair.1, id: \.self) { id in
                            Text(nameOf(id)).font(TypeStyle.body).foregroundStyle(Theme.ink)
                        }
                    }
                }
                Text("移出按股权推导出的公司时，会记为“已排除”，之后股权变化也不会再把它自动纳入。")
                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
            }
        }
    }

    private func apply() {
        let gid = groupID, p = plan, appStore = store
        let name = group?.name ?? "集团"
        let undoID = appStore.undoable("调整集团成员") {
            for (id, ch) in p {
                switch ch {
                case .add: appStore.add(companyID: id, to: gid)
                case .remove: appStore.moveOut(companyID: id, from: gid)
                case .restore: appStore.restore(companyID: id, in: gid)
                }
            }
            appStore.tidyGroups()
            appStore.refreshDerived()
        }
        let count = appStore.group(gid).map { appStore.companyIDs(in: $0).count } ?? 0
        appStore.showToast("已更新\(name)：现有 \(count) 家公司") { [weak appStore] in if let undoID { appStore?.undo(undoID) } }
        dismiss()
    }
}
