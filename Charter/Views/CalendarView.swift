import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// 合规日历：按月排列所有截止日，可按时间、负责方、法域、集团、状态筛选，
/// 筛出来的结果可以一次交办或导出成清单。
struct CalendarView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @State private var range: Router.CalendarRange = .all
    @State private var customFrom = Day.today()
    @State private var customTo = Day.today().adding(months: 1)
    @State private var group: String?
    @State private var jurisdiction: String?
    @State private var partyID: String?
    @State private var status: ObligationStatus?
    @State private var showDone = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct MonthKey: Hashable, Comparable {
        var year: Int
        var month: Int
        static func < (a: MonthKey, b: MonthKey) -> Bool { (a.year, a.month) < (b.year, b.month) }
        var title: String { "\(year) 年 \(month) 月" }
        var id: String { "\(year)-\(month)" }
    }

    private var effectiveRange: Router.CalendarRange {
        if case .custom = range { return .custom(min(customFrom, customTo), max(customFrom, customTo)) }
        return range
    }

    private var groupScope: Set<String>? { store.companyIDs(forFilter: group) }

    /// 当前筛选下的全部事项。逾期未办的事项在“本月”和“未来 12 个月”里也算。
    private var filtered: [Obligation] {
        let (from, to) = effectiveRange.bounds(today: store.today)
        let scope = groupScope
        return store.allObligations.filter { o in
            let inRange: Bool = {
                if o.due > to { return false }
                if let from { return o.due >= from }
                return o.due >= store.today || !o.isDone
            }()
            return inRange
                && (showDone || status == .done || !o.isDone)
                && (scope == nil || scope!.contains(o.company.id))
                && (jurisdiction == nil || o.company.jurisdiction == jurisdiction)
                && (partyID == nil || store.responsibleParty(for: o)?.id == partyID)
                && (status == nil || o.status.normalized == status)
        }
    }

    private var party: Party? { store.party(partyID) }
    private var hasFilters: Bool { range != .all || group != nil || jurisdiction != nil || partyID != nil || status != nil }

    var body: some View {
        let list = filtered
        let overdue = list.filter { !$0.isDone && $0.due < store.today }
        let months = monthGroups(list.filter { !overdue.contains($0) })
        let blocks = monthBlocks(overdue: overdue, months: months)
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    VStack(alignment: .leading, spacing: Space.l16) {
                        PageHeader(title: "合规日历", subtitle: "按月排列所有截止日。筛选出的事项可一并交办或导出为清单。") {
                            EmptyView()
                        }
                        .padding(.bottom, Space.s8)
                        filterBar
                        summary(list, overdue: overdue.count)
                        if !list.isEmpty { actionBar(list) }
                    }
                    .padding(.bottom, Space.xl24)
                    if range == .all && !list.isEmpty {
                        monthStrip(list, proxy).padding(.bottom, Space.section40)
                    }

                    // 所有月份是同一个承载面：月份标题吸顶，行之间用细线分隔
                    ForEach(Array(blocks.enumerated()), id: \.element.id) { i, block in
                        Section {
                            rows(block.rows, last: i == blocks.count - 1)
                        } header: {
                            monthHeader(block.title, count: block.rows.count, alert: block.alert, first: i == 0)
                                .id(block.id)
                        }
                    }
                    if list.isEmpty {
                        EmptyStateView(symbol: "calendar", title: "没有符合筛选条件的事项",
                                       message: hasFilters ? "试试放宽时间范围，或清除筛选。" : "接下来没有需要办理的合规事项。",
                                       actionTitle: hasFilters ? "清除筛选" : nil,
                                       action: { clearFilters() })
                            .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
                    }
                }
                .padding(Space.pageEdge)
                .frame(maxWidth: 1240)
                .frame(maxWidth: .infinity)
            }
        }
        .background(Theme.canvas)
        .onAppear(perform: applyPreset)
        .onChange(of: router.calendarPreset) { applyPreset() }
    }

    private func applyPreset() {
        guard let p = router.calendarPreset else { return }
        clearFilters()
        partyID = p.partyID
        range = p.range
        status = p.status
        router.calendarPreset = nil
    }

    private func clearFilters() {
        range = .all; group = nil; jurisdiction = nil; partyID = nil; status = nil
    }

    // MARK: 筛选

    private var rangeOptions: [(Router.CalendarRange, String)] {
        [(.all, "未来 12 个月"), (.thisMonth, "本月"), (.nextMonth, "下月"), (.next3Months, "未来 3 个月"),
         (.custom(customFrom, customTo), "自定义")]
    }

    private var filterBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            PillSegmented(options: rangeOptions, selection: $range)
                .onChange(of: customFrom) { if case .custom = range { range = .custom(customFrom, customTo) } }
                .onChange(of: customTo) { if case .custom = range { range = .custom(customFrom, customTo) } }

            HStack(spacing: 8) {
                if case .custom = range {
                    Text("从").font(TypeStyle.body).foregroundStyle(Theme.muted)
                    DateField(day: dayBinding($customFrom), allowsClear: false, minWidth: 140)
                    Text("到").font(TypeStyle.body).foregroundStyle(Theme.muted)
                    DateField(day: dayBinding($customTo), allowsClear: false, minWidth: 140)
                }
                SelectField(options: [(String?.none, "全部负责方")] + store.parties.map { (Optional($0.id), $0.name) },
                            selection: $partyID, minWidth: 130)
                SelectField(options: [(String?.none, "全部法域")] + store.library.jurisdictions.map { (Optional($0.code), $0.name) },
                            selection: $jurisdiction, minWidth: 110)
                if store.corporateGroups.count > 1 {
                    SelectField(options: [(String?.none, "全部集团")] + store.corporateGroups.map { (Optional($0.id), $0.name) },
                                selection: $group, minWidth: 110)
                }
                SelectField(options: [(ObligationStatus?.none, "全部状态")] + ObligationStatus.visible.map { (Optional($0), $0.label) },
                            selection: $status, minWidth: 110)
                Toggle("含已完成", isOn: $showDone)
                    .toggleStyle(KitCheckboxStyle())
                    .disabled(status == .done)
                    .fixedSize()
                Spacer(minLength: 0)
            }
        }
    }

    private func dayBinding(_ d: Binding<Day>) -> Binding<Day?> {
        Binding<Day?>(get: { d.wrappedValue }, set: { if let v = $0 { d.wrappedValue = v } })
    }

    private func summary(_ list: [Obligation], overdue: Int) -> some View {
        let open = list.filter { !$0.isDone }
        func n(_ s: ObligationStatus) -> Int { open.filter { $0.status.normalized == s }.count }
        var parts: [String] = []
        if n(.pending) > 0 { parts.append("待交办 \(n(.pending))") }
        if n(.drafted) > 0 { parts.append("待发送 \(n(.drafted))") }
        if n(.handedOff) > 0 { parts.append("已交办 \(n(.handedOff))") }
        let done = list.count - open.count
        if done > 0 { parts.append("已完成 \(done)") }
        if overdue > 0 { parts.append("逾期 \(overdue)") }
        let scope = [party.map { latinPad($0.name) + "名下" }, rangeText].compactMap { $0 }.joined()
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(scope)共 \(list.count) 件").font(TypeStyle.rowTitle).foregroundStyle(Theme.ink)
            if !parts.isEmpty { Text(parts.joined(separator: "，")).font(TypeStyle.body).foregroundStyle(Theme.muted) }
            Spacer()
            if hasFilters {
                Button("清除筛选", action: clearFilters)
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
            }
        }
    }

    private var rangeText: String? {
        switch effectiveRange {
        case .all: return "未来 12 个月"
        case .custom(let a, let b): return "\(a.short)–\(b.short)"
        default:
            let (from, to) = effectiveRange.bounds(today: store.today)
            return "\(effectiveRange.label)（\(from.map { $0.short } ?? "含逾期")–\(to.short)）"
        }
    }

    // MARK: 批量操作

    @ViewBuilder
    private func actionBar(_ list: [Obligation]) -> some View {
        let pending = list.filter { $0.status.normalized == .pending }
        let drafted = list.filter { $0.status.normalized == .drafted }
        HStack(spacing: 8) {
            if let p = party {
                if !pending.isEmpty {
                    Button("交给\(latinPad(p.name))办理（\(pending.count) 件）") {
                        Mailer.draft(to: p, obligations: pending, store: store)
                        store.draft(pending, to: p, channel: "邮件")
                    }
                    .buttonStyle(PillButtonStyle(.primary))
                    .help("起草发给\(p.name)的邮件；发出后点“确认已发送”")
                    ActionMenu(systemImage: "chevron.down", entries: [
                        .item("起草邮件（\(pending.count) 件）", systemImage: "envelope") {
                            Mailer.draft(to: p, obligations: pending, store: store)
                            store.draft(pending, to: p, channel: "邮件")
                        },
                        .item("复制清单消息（贴到企业微信、飞书等）", systemImage: "doc.on.doc") {
                            Mailer.copyMessage(obligations: pending)
                            store.draft(pending, to: p, channel: "消息")
                        },
                        .item("已通过其他方式交办（\(pending.count) 件）", systemImage: "paperplane") {
                            store.confirmSent(pending, to: p, channel: "其他")
                        },
                    ])
                    .help("其他交办方式")
                }
                if !drafted.isEmpty {
                    Button("确认已发送（\(drafted.count) 件）") { store.confirmSent(drafted, channel: drafted.first?.record?.log?.last?.channel) }
                        .buttonStyle(PillButtonStyle(pending.isEmpty ? .primary : .secondary))
                }
            } else if !pending.isEmpty {
                Text("选择负责方后，可将筛选出的事项一并交办。").font(TypeStyle.body).foregroundStyle(Theme.muted)
            }
            Spacer()
            ActionMenu(title: "导出清单", systemImage: "square.and.arrow.up", entries: [
                .item("PDF…", systemImage: "doc.richtext") { export(list, csv: false) },
                .item("CSV（可用 Excel 打开）…", systemImage: "tablecells") { export(list, csv: true) },
            ])
        }
    }

    private func export(_ list: [Obligation], csv: Bool) {
        let panel = NSSavePanel()
        let title = "合规事项清单_" + [party?.name, rangeText].compactMap { $0 }.joined(separator: "_")
        panel.nameFieldStringValue = title.replacingOccurrences(of: "/", with: "-") + (csv ? ".csv" : ".pdf")
        panel.allowedContentTypes = [csv ? .commaSeparatedText : .pdf]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let sorted = list.sorted { ($0.due, $0.company.name) < ($1.due, $1.company.name) }
        do {
            if csv {
                func q(_ s: String) -> String { "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
                var rows = ["截止日,公司,法域,事项,负责方,状态,规则核对"]
                for o in sorted {
                    rows.append([o.due.description, o.company.name, store.jurisdictionName(o.company.jurisdiction), o.rule.name,
                                 store.responsibleParty(for: o)?.name ?? "", o.status.label, store.trust(o).label].map(q).joined(separator: ","))
                }
                // 带 BOM，Excel 才能正确识别中文
                try ("\u{FEFF}" + rows.joined(separator: "\r\n")).write(to: url, atomically: true, encoding: .utf8)
            } else {
                let grouped = Dictionary(grouping: sorted) { MonthKey(year: $0.due.year, month: $0.due.month) }
                let sections = grouped.keys.sorted().map { k in
                    PDFWriter.Section(heading: "\(k.title)（\(grouped[k]!.count) 件）", lines: grouped[k]!.map { o in
                        let flag = store.trust(o).isConfirmed ? "" : "　〔规则待核对〕"
                        let late = !o.isDone && o.due < store.today ? "　〔已逾期〕" : ""
                        return "\(o.due.short)　\(o.company.name)　\(o.rule.name)　\(store.responsibleParty(for: o)?.name ?? "未指定")　\(o.status.label)\(late)\(flag)"
                    }, alert: false)
                }
                try PDFWriter.write(to: url, title: "合规事项清单", subtitle: "\([party?.name, rangeText].compactMap { $0 }.joined(separator: "，"))，共 \(sorted.count) 件，\(store.today.long)导出",
                                    sections: sections, footer: "标注“规则待核对”的截止日按草稿规则计算，请以负责方确认为准。")
            }
            store.showToast("已导出 \(sorted.count) 件事项。")
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } catch {
            store.errorMessage = "导出失败：\(error.localizedDescription)"
        }
    }

    // MARK: 月份

    private func monthGroups(_ list: [Obligation]) -> [(MonthKey, [Obligation])] {
        let grouped = Dictionary(grouping: list) { MonthKey(year: $0.due.year, month: $0.due.month) }
        return grouped.keys.sorted().map { ($0, grouped[$0]!.sorted { $0.due < $1.due }) }
    }

    private func monthStrip(_ list: [Obligation], _ proxy: ScrollViewProxy) -> some View {
        let counts = Dictionary(grouping: list.filter { !$0.isDone && $0.due >= store.today }) { MonthKey(year: $0.due.year, month: $0.due.month) }.mapValues(\.count)
        let strip: [(MonthKey, Int)] = (0..<12).map { i in
            let d = Day(store.today.year, store.today.month, 1).adding(months: i)
            let k = MonthKey(year: d.year, month: d.month)
            return (k, counts[k] ?? 0)
        }
        let maxCount = max(strip.map(\.1).max() ?? 1, 1)
        return HStack(alignment: .bottom, spacing: 6) {
            ForEach(strip, id: \.0) { item in
                Button {
                    withAnimation(Motion.resolved(Motion.panel, reduceMotion: reduceMotion)) { proxy.scrollTo(item.0.id, anchor: .top) }
                } label: {
                    VStack(spacing: 5) {
                        Text(item.1 == 0 ? "" : "\(item.1)").font(.system(size: 11, weight: .bold)).monospacedDigit()
                            .foregroundStyle(Theme.ink)
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(item.1 == 0 ? Theme.band : Theme.ink.opacity(0.8))
                            .frame(height: 6 + 30 * CGFloat(item.1) / CGFloat(maxCount))
                        Text(verbatim: "\(item.0.month)月").font(.system(size: 11)).foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(item.1 == 0)
                .help(item.1 == 0 ? "" : "\(item.0.title)：\(item.1) 件")
            }
        }
        .frame(height: 70)
        .padding(.horizontal, Space.xl24).padding(.vertical, Space.l16)
        .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("未来 12 个月事项分布")
    }

    private struct MonthBlock: Identifiable {
        var id: String
        var title: String
        var rows: [Obligation]
        var alert: Bool
    }

    private func monthBlocks(overdue: [Obligation], months: [(MonthKey, [Obligation])]) -> [MonthBlock] {
        var out: [MonthBlock] = []
        if !overdue.isEmpty { out.append(MonthBlock(id: "overdue", title: "已逾期", rows: overdue, alert: true)) }
        for (k, rows) in months { out.append(MonthBlock(id: k.id, title: k.title, rows: rows, alert: false)) }
        return out
    }

    private func monthHeader(_ title: String, count: Int, alert: Bool, first: Bool) -> some View {
        let r = first ? Radius.surface : 0
        return VStack(spacing: 0) {
            if !first { Rectangle().fill(Theme.hairline).frame(height: 1) }
            HStack(alignment: .firstTextBaseline, spacing: Space.s8) {
                Text(title).font(TypeStyle.section).tracking(Tracking.section)
                    .foregroundStyle(alert ? Theme.danger : Theme.ink)
                Text("\(count) 件").font(TypeStyle.meta).foregroundStyle(Theme.muted)
                Spacer()
            }
            .padding(.horizontal, Space.xl24).padding(.top, first ? Space.xl24 : Space.l16).padding(.bottom, Space.s8)
        }
        .background(Theme.surface, in: UnevenRoundedRectangle(topLeadingRadius: r, bottomLeadingRadius: 0,
                                                              bottomTrailingRadius: 0, topTrailingRadius: r,
                                                              style: .continuous))
        .accessibilityAddTraits(.isHeader)
    }

    private func rows(_ list: [Obligation], last: Bool) -> some View {
        let r = last ? Radius.surface : 0
        return VStack(spacing: 0) {
            ForEach(Array(list.enumerated()), id: \.element.id) { i, o in
                if i > 0 { Rectangle().fill(Theme.hairline).frame(height: 1).padding(.horizontal, Space.m12) }
                CalendarRow(obligation: o) { router.sheet = .obligation(o.key) }
            }
        }
        .padding(.horizontal, 6).padding(.bottom, last ? Space.s8 : Space.xs4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: r,
                                                              bottomTrailingRadius: r, topTrailingRadius: 0,
                                                              style: .continuous))
    }
}

struct CalendarRow: View {
    @Environment(AppStore.self) private var store
    var obligation: Obligation
    var onTap: () -> Void
    @State private var hover = false

    var body: some View {
        let o = obligation
        let left = o.daysLeft(from: store.today)
        HStack(spacing: 14) {
            Button(action: onTap) {
                HStack(spacing: 14) {
                    VStack(spacing: 0) {
                        Text(verbatim: "\(o.due.day)").font(.system(size: 20, weight: .semibold)).monospacedDigit()
                            .foregroundStyle(Theme.ink)
                        Text(o.due.weekdayName.replacingOccurrences(of: "星期", with: "周")).font(.system(size: 10.5)).foregroundStyle(Theme.muted)
                    }
                    .frame(width: 44)
                    JurisdictionBadge(code: o.company.jurisdiction, size: 34)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 6) {
                            Text(o.rule.name).font(TypeStyle.rowTitle).foregroundStyle(Theme.ink).strikethrough(o.isDone)
                            TrustBadge(trust: store.trust(o))
                        }
                        Text("\(o.company.name)，\(store.responsibleParty(for: o)?.name ?? "未指定负责方")")
                            .font(TypeStyle.metadata).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                    Spacer()
                    if o.status.normalized != .pending { Pill(text: o.status.label, kind: o.status.pillKind) }
                    Text(o.isDone ? (o.record?.completedOn.map { "\($0.short)完成" } ?? "") : left < 0 ? "逾期 \(-left) 天" : left == 0 ? "今天" : "\(left) 天后")
                        .font(.system(size: 13, weight: .semibold)).monospacedDigit()
                        .foregroundStyle(o.isDone ? Theme.muted : left < 0 ? Theme.danger : left <= 7 ? Theme.amberText : Theme.muted)
                        .frame(width: 80, alignment: .trailing)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if o.isDone, let r = store.receipt(o) {
                Button("回执") { store.open(r) }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                    .help("打开存档的回执")
            }
        }
        .padding(.horizontal, 12).frame(height: 58)
        .background(hover ? Theme.band.opacity(0.6) : .clear, in: .rect(cornerRadius: Radius.row))
        .opacity(o.isDone ? 0.6 : 1)
        .onHover { h in withAnimation(Motion.fast) { hover = h } }
        .contextMenu { ObligationContextMenu(obligation: o) }
    }
}
