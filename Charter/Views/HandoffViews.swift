import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: - 下一步

/// 事项的下一步操作。主按钮永远对应“现在该做的那一步”：
/// 待交办 → 交给X办理；待发送 → 确认已发送；已交办 → 收到回执并完成（逾期或太久没回音时为催办）；已完成 → 查看回执。
struct NextStepControls: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var obligation: Obligation
    /// 大按钮（今天页焦点卡片、事项详情）或小按钮（列表行）。
    var large = true
    /// false 时主按钮降为次要样式（同一处还有更要紧的按钮时）。
    var emphasized = true
    @State private var attaching = false
    @State private var pendingReceipt: StagedFile?

    private var o: Obligation { obligation }
    private var party: Party? { store.party(o.record?.partyID) ?? store.responsibleParty(for: o) }

    private var size: PillButtonStyle.Size { large ? .large : .regular }
    /// 主按钮：同一处还有更要紧的按钮时降为次要。
    private var mainKind: PillButtonStyle.Kind { emphasized ? .primary : .secondary }

    var body: some View {
        HStack(spacing: 8) {
            switch o.status.normalized {
            case .pending: pending
            case .drafted: drafted
            case .handedOff, .waiting: handedOff
            case .done: done
            }
        }
        .fixedSize()
        .fileImporter(isPresented: $attaching, allowedContentTypes: [.pdf, .image, .emailMessage]) { result in
            guard case .success(let url) = result else { return }
            Task { @MainActor in
                do {
                    pendingReceipt = try await store.stage(url: url, typeID: "common.receipt", owner: NodeRef(kind: .company, id: o.company.id)) { doc in
                        store.complete(o, receipt: doc)
                    }
                } catch {
                    store.errorMessage = "读取回执失败：\(error.localizedDescription)"
                }
            }
        }
        .sheet(item: $pendingReceipt) { ArchiveConfirmSheet(file: $0) }
    }

    /// 主按钮旁的“其他方式”菜单（只有图标）。
    private func moreMenu(_ entries: [MenuEntry]) -> some View {
        ActionMenu(systemImage: "chevron.down", kind: .secondary, size: size, entries: entries)
            .help("其他方式")
    }

    // 待交办
    @ViewBuilder private var pending: some View {
        if let p = party {
            Button("交给\(latinPad(p.name))办理") { sendDraft(to: p) }
                .buttonStyle(PillButtonStyle(mainKind, size: size))
                .help("起草发给\(p.name)的邮件；发出后点“确认已发送”")
            moreMenu(pendingEntries(p))
        } else {
            Button("指定负责方…") { router.sheet = .obligation(o.key) }
                .buttonStyle(PillButtonStyle(mainKind, size: size))
        }
    }

    private func pendingEntries(_ p: Party) -> [MenuEntry] {
        var e: [MenuEntry] = [
            .item("起草邮件给\(latinPad(p.name))", systemImage: "envelope") { sendDraft(to: p) },
            .item("复制消息（贴到企业微信、飞书等）", systemImage: "doc.on.doc") { copy(to: p) },
            .item("已通过其他方式交办", systemImage: "paperplane") { store.confirmSent([o], to: p, channel: "其他") },
        ]
        let others = store.parties.filter { $0.id != p.id }
        if !others.isEmpty {
            e.append(.divider)
            e.append(.header("交给其他负责方"))
            for q in others {
                e.append(.item("\(q.name)（\(q.kind.label)）") { sendDraft(to: q) })
            }
        }
        e.append(.divider)
        e.append(.item("已自行完成", systemImage: "checkmark") { store.complete(o) })
        return e
    }

    // 待发送
    @ViewBuilder private var drafted: some View {
        Button("确认已发送") { store.confirmSent([o], channel: o.record?.log?.last?.channel) }
            .buttonStyle(PillButtonStyle(mainKind, size: size))
            .help("邮件或消息发出后点此确认，Charter 将开始计算等待回件的天数")
        ActionMenu(systemImage: "ellipsis", kind: .quiet, size: size, entries: draftedEntries)
    }

    private var draftedEntries: [MenuEntry] {
        var e: [MenuEntry] = []
        if let p = party {
            e.append(.item("重新起草邮件", systemImage: "envelope") { sendDraft(to: p) })
            e.append(.item("重新复制消息", systemImage: "doc.on.doc") { copy(to: p) })
            e.append(.divider)
        }
        e.append(.item("退回待交办", systemImage: "arrow.uturn.backward") { store.revertToPending(o) })
        return e
    }

    // 已交办
    @ViewBuilder private var handedOff: some View {
        let overdue = o.daysLeft(from: store.today) < 0
        if overdue || store.waitingTooLong(o) {
            Button("催办") { nudgeMail() }
                .buttonStyle(PillButtonStyle(mainKind, size: size))
            moreMenu([
                .item("起草催办邮件", systemImage: "envelope") { nudgeMail() },
                .item("复制催办消息", systemImage: "doc.on.doc") { Mailer.copyMessage(obligation: o, nudge: true); store.nudge(o, channel: "消息") },
                .divider,
                .item("收到回执并完成…", systemImage: "paperclip") { attaching = true },
                .item("没有回执，直接完成", systemImage: "checkmark") { store.complete(o) },
                .item("退回待交办", systemImage: "arrow.uturn.backward") { store.revertToPending(o) },
            ])
        } else {
            Button("收到回执并完成…") { attaching = true }
                .buttonStyle(PillButtonStyle(mainKind, size: size))
                .help("回执可选；也可以在菜单里直接完成")
            moreMenu([
                .item("收到回执并完成…", systemImage: "paperclip") { attaching = true },
                .item("没有回执，直接完成", systemImage: "checkmark") { store.complete(o) },
                .divider,
                .item("起草催办邮件", systemImage: "envelope") { nudgeMail() },
                .item("退回待交办", systemImage: "arrow.uturn.backward") { store.revertToPending(o) },
            ])
        }
    }

    // 已完成
    @ViewBuilder private var done: some View {
        if let r = store.receipt(o) {
            Button("查看回执") { store.open(r) }
                .buttonStyle(PillButtonStyle(.secondary, size: size))
        } else {
            Text("已完成\(o.record?.completedOn.map { "于 \($0.short)" } ?? "")")
                .font(TypeStyle.body).foregroundStyle(Theme.muted)
        }
    }

    private func sendDraft(to p: Party) {
        Mailer.draft(to: p, obligation: o, store: store)
        store.draft([o], to: p, channel: "邮件")
    }

    private func copy(to p: Party) {
        Mailer.copyMessage(obligation: o)
        store.draft([o], to: p, channel: "消息")
    }

    private func nudgeMail() {
        guard let p = party else { return }
        Mailer.draft(to: p, obligation: o, store: store, nudge: true)
        store.nudge(o, channel: "邮件")
    }
}

// MARK: - 状态说明

extension AppStore {
    /// 一句话说明这件事现在在谁手上、卡在哪一步。
    func stateLine(_ o: Obligation) -> String {
        let p = party(o.record?.partyID) ?? responsibleParty(for: o)
        let who = latinPad(p?.name ?? "负责方")
        switch o.status.normalized {
        case .pending:
            return p == nil ? "还没有指定负责方。" : "通常由\(who)办理，尚未交办。"
        case .drafted:
            let when = o.record?.draftedOn.map { $0.ago(from: today) } ?? ""
            return "\(when)给\(who)起草了消息，尚未确认发出。"
        case .handedOff, .waiting:
            guard let since = o.record?.handedOffOn else { return "已交给\(who)。" }
            let days = since.days(until: today)
            if waitingTooLong(o) { return "\(since.ago(from: today))交给\(who)，\(days) 天未回复。" }
            return days == 0 ? "今天交给了\(who)，等回件。" : "\(since.ago(from: today))交给\(who)，等回件。"
        case .done:
            return "已完成。"
        }
    }
}
