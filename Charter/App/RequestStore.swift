import Foundation
import AppKit

/// 请负责方补发与等回件：记录请求、生成文字、催办、收到文件后自动关闭。
extension AppStore {

    /// 负责方没有设置催办天数时的默认值。
    static let defaultFollowUpDays = 7

    // MARK: 查询

    /// 还在等的请求，最早该跟进的在前。
    var openRequests: [DocumentRequest] {
        requests.filter { $0.status == .open }.sorted { $0.followUpOn < $1.followUpOn }
    }

    func openRequests(for owner: NodeRef) -> [DocumentRequest] {
        openRequests.filter { $0.owner == owner }
    }

    func openRequests(partyID: String) -> [DocumentRequest] {
        openRequests.filter { $0.partyID == partyID }
    }

    /// 某个条目是否已经在等负责方补发。
    func openRequest(owner: NodeRef, typeID: String) -> DocumentRequest? {
        openRequests.first { $0.owner == owner && $0.pendingTypeIDs.contains(typeID) }
    }

    func followUpDays(for partyID: String?) -> Int {
        let days = party(partyID)?.followUpDays ?? Self.defaultFollowUpDays
        return days > 0 ? days : Self.defaultFollowUpDays
    }

    /// 默认收件的负责方：公司的默认负责方；个人文件找其任职公司的默认负责方。
    func defaultRequestParty(for owner: NodeRef) -> Party? {
        switch owner.kind {
        case .company:
            return party(company(owner.id)?.defaultPartyID)
        case .person:
            let cid = appointments.first { $0.personID == owner.id && $0.to == nil }?.companyID
            return party(company(cid)?.defaultPartyID)
        }
    }

    func daysWaiting(_ r: DocumentRequest) -> Int {
        max(0, Day(date: r.createdAt).days(until: today))
    }

    func isFollowUpDue(_ r: DocumentRequest) -> Bool {
        r.status == .open && r.followUpOn <= today
    }

    func typeNames(_ ids: [String]) -> String {
        ids.map { docType($0)?.name ?? "文件" }.joined(separator: "、")
    }

    // MARK: 文字

    /// 英文名后面接“的”时补一个空格：“Yuanlan Group Ltd. 的”
    func ownerPhrase(_ owner: NodeRef) -> String {
        let n = name(of: owner)
        if let last = n.last, last.isASCII, last.isLetter || last.isNumber || last == "." || last == ")" {
            return n + " "
        }
        return n
    }

    private func greeting(_ partyID: String?) -> String {
        let contact = party(partyID)?.contactName.trimmingCharacters(in: .whitespaces) ?? ""
        return contact.isEmpty ? "您好：" : "\(contact)，您好："
    }

    /// 某个条目现在的情况：签发日（可能没有）和状态说明。没有存档时 issued 为 nil、state 为“目前没有存档”。
    func gapDescription(owner: NodeRef, typeID: String) -> (issued: Day?, state: String, hasFile: Bool) {
        let current = documents.filter { $0.owner == owner && $0.typeID == typeID && $0.supersededBy == nil }
            .max { ($0.issueDate ?? $0.addedOn) < ($1.issueDate ?? $1.addedOn) }
        guard let d = current else { return (nil, "目前没有存档", false) }
        let state: String
        switch freshness(d) {
        case .expired: state = "已过期"
        case .expiring(let days): state = "将在 \(days) 天后到期"
        default: state = "需要更新"
        }
        return (d.issueDate, state, true)
    }

    /// 请补发的文字。一份时沿用单份文件的说法；多份时合并成一封，逐条列出。
    func reissueText(owner: NodeRef, typeIDs: [String], partyID: String?) -> String {
        let o = ownerPhrase(owner)
        let hello = greeting(partyID)
        if typeIDs.count == 1, let id = typeIDs.first {
            let name = typeNames([id])
            let gap = gapDescription(owner: owner, typeID: id)
            if !gap.hasFile {
                return "\(hello)\n\n\(o)的\(name)目前没有存档，麻烦提供一份，谢谢。"
            }
            let issued = gap.issued.map { "（\($0.long)签发）" } ?? ""
            return "\(hello)\n\n\(o)的\(name)\(issued)\(gap.state)，麻烦补发一份新的，谢谢。"
        }
        let lines = typeIDs.enumerated().map { pair -> String in
            let gap = gapDescription(owner: owner, typeID: pair.element)
            let issued = gap.issued.map { "\($0.long)签发，" } ?? ""
            return "\(pair.offset + 1). \(typeNames([pair.element]))：\(issued)\(gap.state)"
        }
        return """
        \(hello)

        \(o)的以下文件需要补发，麻烦各提供一份新的：
        \(lines.joined(separator: "\n"))

        谢谢。
        """
    }

    /// 催办的短文字。
    func followUpText(for r: DocumentRequest) -> String {
        let sent = Day(date: r.createdAt)
        return """
        \(greeting(r.partyID))

        \(sent.display(relativeTo: today))请您补发的\(ownerPhrase(r.owner))的\(typeNames(r.pendingTypeIDs))还没有收到，想跟您确认一下进度，方便的话请告知预计什么时候可以提供，谢谢。
        """
    }

    // MARK: 记录

    /// 记录一次补发请求：直接生效，提示条可撤销。同一条目原来在等的请求如果被完全覆盖，改为取消，免得重复催办。
    @discardableResult
    func recordRequest(owner: NodeRef, typeIDs: [String], partyID: String?, message: String, followUpDays days: Int) -> DocumentRequest? {
        guard !typeIDs.isEmpty else { return nil }
        let r = DocumentRequest(owner: owner, typeIDs: typeIDs, partyID: partyID, createdAt: Date(),
                                followUpOn: today.adding(days: max(1, days)), note: message)
        let covered = Set(typeIDs)
        performUndoable("记录补发请求", toast: "已记录请求，将在 \(r.followUpOn.short)提醒跟进") {
            for i in requests.indices where requests[i].status == .open && requests[i].owner == owner
                && requests[i].pendingTypeIDs.allSatisfy({ covered.contains($0) }) {
                requests[i].status = .cancelled
            }
            requests.append(r)
            saveRequests()
        }
        return r
    }

    /// 催办后：下次跟进日顺延负责方的催办天数。
    func markNudged(_ id: String) {
        guard let i = requests.firstIndex(where: { $0.id == id }) else { return }
        let next = today.adding(days: followUpDays(for: requests[i].partyID))
        performUndoable("催办", toast: "已复制催办文字，将在 \(next.short)再次提醒") {
            requests[i].followUpOn = next
            requests[i].nudgedCount = (requests[i].nudgedCount ?? 0) + 1
            saveRequests()
        }
    }

    /// 不再等了（例如自己拿到了，或改为别的渠道）。
    func cancelRequest(_ id: String) {
        guard let i = requests.firstIndex(where: { $0.id == id }) else { return }
        performUndoable("取消等回件", toast: "已不再等这份补发") {
            requests[i].status = .cancelled
            saveRequests()
        }
    }

    /// 改负责方：记录保留，跟进日不变。
    func reassignRequest(_ id: String, to partyID: String?) {
        guard let i = requests.firstIndex(where: { $0.id == id }) else { return }
        performUndoable("改负责方", toast: "已改由\(party(partyID)?.name ?? "未指定负责方")补发") {
            requests[i].partyID = partyID
            saveRequests()
        }
    }

    /// 用邮件发送：系统邮件写好收件人、主题和正文。
    func composeRequestEmail(to partyID: String?, subject: String, body: String) {
        let email = party(partyID)?.email.trimmingCharacters(in: .whitespaces) ?? ""
        if let s = NSSharingService(named: .composeEmail) {
            s.recipients = email.isEmpty ? [] : [email]
            s.subject = subject
            s.perform(withItems: [body])
            return
        }
        var c = URLComponents()
        c.scheme = "mailto"
        c.path = email
        c.queryItems = [URLQueryItem(name: "subject", value: subject), URLQueryItem(name: "body", value: body)]
        if let url = c.url { NSWorkspace.shared.open(url) }
    }

    // MARK: 收到文件后自动关闭

    /// 归档之后调用：把正在等这些文件的请求标为已收到。返回追加在提示条后面的一句话（没有匹配时为空）。
    /// 在同一步撤销里调用，撤销归档时请求会一起回到“等回件”。
    @discardableResult
    func closeRequests(receiving archived: [Document]) -> String {
        guard !archived.isEmpty, requests.contains(where: { $0.status == .open }) else { return "" }
        var phrases: [String] = []
        var changed = false
        for d in archived {
            guard let i = requests.indices
                .filter({ requests[$0].status == .open && requests[$0].owner == d.owner && requests[$0].pendingTypeIDs.contains(d.typeID) })
                .min(by: { requests[$0].createdAt < requests[$1].createdAt }) else { continue }
            var got = requests[i].receivedTypeIDs ?? []
            got.append(d.typeID)
            requests[i].receivedTypeIDs = got
            requests[i].receivedDocumentIDs.append(d.id)
            if requests[i].pendingTypeIDs.isEmpty { requests[i].status = .received }
            changed = true
            let who = party(requests[i].partyID)?.name ?? "负责方"
            phrases.append("\(who) 补发的\(docType(d.typeID)?.name ?? "文件")")
        }
        guard changed else { return "" }
        saveRequests()
        if phrases.count > 2 { return "，已收到 \(phrases.count) 份补发的文件" }
        return "，已收到" + phrases.joined(separator: "和")
    }
}
