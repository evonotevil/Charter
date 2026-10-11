import Foundation

// MARK: - 补发请求（等回件）

enum DocumentRequestStatus: String, Codable, CaseIterable {
    case open        // 已发出，等回件
    case received    // 所有条目都已收到
    case cancelled   // 不再等了
}

/// 请负责方补发的一次请求：一家公司（或一个人）的若干份文件，发给一个负责方。
/// 存在 数据/requests.json；旧数据没有这个文件时按空数组载入。
struct DocumentRequest: Codable, Hashable, Identifiable {
    var id: String = UUID().uuidString
    var owner: NodeRef                     // 通常是公司；个人文件时是人员
    var typeIDs: [String]                  // 请补发的文件类型
    var partyID: String?                   // 发给谁
    var createdAt: Date
    var followUpOn: Day                    // 到这天还没收到就提醒催办
    var status: DocumentRequestStatus = .open
    var receivedDocumentIDs: [String] = [] // 收到后归档的文件
    var receivedTypeIDs: [String]? = nil   // 已收到的类型（部分收到时用）
    var note: String = ""                  // 发出的文字
    var nudgedCount: Int? = nil            // 催办过几次

    /// 还在等的类型。
    var pendingTypeIDs: [String] {
        let got = Set(receivedTypeIDs ?? [])
        return typeIDs.filter { !got.contains($0) }
    }

    var companyID: String? { owner.kind == .company ? owner.id : nil }
}
