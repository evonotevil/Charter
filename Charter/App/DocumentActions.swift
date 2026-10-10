import Foundation
import AppKit

enum DocumentUpdateError: LocalizedError, Equatable {
    case missingRecord
    case missingType
    case missingOwner
    case ownerTypeMismatch
    case jurisdictionMismatch
    case duplicateCurrent

    var errorDescription: String? {
        switch self {
        case .missingRecord:
            "这份文件记录已经不存在，请关闭窗口后重新打开。"
        case .missingType:
            "所选文件类型已经不存在，请选择其他类型。"
        case .missingOwner:
            "所选归属对象已经不存在，请选择其他公司或人员。"
        case .ownerTypeMismatch:
            "这个文件类型与归属对象不匹配。公司文件只能归属公司，人员文件只能归属人员。"
        case .jurisdictionMismatch:
            "这个文件类型不适用于所选公司的法域，请选择适用的类型。"
        case .duplicateCurrent:
            "该归属对象已经有一份同类型的现行文件。请打开现有文件并使用“归档新版”。"
        }
    }
}

extension AppStore {

    /// 保存文件详情前统一校验类型与归属，避免文件从档案清单中消失或产生两个现行版本。
    func updateDocument(_ edited: Document) throws {
        guard let index = documents.firstIndex(where: { $0.id == edited.id }) else {
            throw DocumentUpdateError.missingRecord
        }
        guard let type = docType(edited.typeID) else {
            throw DocumentUpdateError.missingType
        }
        switch edited.owner.kind {
        case .company:
            guard let company = company(edited.owner.id) else { throw DocumentUpdateError.missingOwner }
            guard type.owner == .company else { throw DocumentUpdateError.ownerTypeMismatch }
            guard type.applies(to: company.jurisdiction) else { throw DocumentUpdateError.jurisdictionMismatch }
        case .person:
            guard person(edited.owner.id) != nil else { throw DocumentUpdateError.missingOwner }
            guard type.owner == .person else { throw DocumentUpdateError.ownerTypeMismatch }
        }
        if edited.supersededBy == nil,
           documents.contains(where: {
               $0.id != edited.id && $0.supersededBy == nil
                   && $0.owner == edited.owner && $0.typeID == edited.typeID
           }) {
            throw DocumentUpdateError.duplicateCurrent
        }
        var updated = documents
        updated[index] = edited
        let data = try FolderStore.encoder.encode(updated)
        try persistCollections([("documents", data)])
        documents = updated
        refreshDerived()
    }

    /// 旧 API 保留给兼容用途；新流程用 stage(...) + ArchiveConfirmSheet。

    /// 负责这份文件的一方：公司文件找公司的默认负责方；个人文件找其任职公司的默认负责方。
    func reissueParty(for d: Document) -> Party? {
        switch d.owner.kind {
        case .company: return party(company(d.owner.id)?.defaultPartyID)
        case .person:
            let cid = appointments.first { $0.personID == d.owner.id && $0.to == nil }?.companyID
            return party(company(cid)?.defaultPartyID)
        }
    }

    /// 请负责方补发新版文件的一段文字（用户可以先改再复制）。没有负责方时用通用称呼。
    func reissueText(for d: Document) -> String {
        let typeName = docType(d.typeID)?.name ?? "文件"
        let owner = name(of: d.owner)
        let contact = reissueParty(for: d)?.contactName.trimmingCharacters(in: .whitespaces) ?? ""
        let greeting = contact.isEmpty ? "您好：" : "\(contact)，您好："
        // 英文名后面接“的”时补一个空格：“Yuanlan Group Ltd. 的”
        let ownerPart: String
        if let last = owner.last, last.isASCII, last.isLetter || last.isNumber || last == "." || last == ")" {
            ownerPart = owner + " "
        } else {
            ownerPart = owner
        }
        let issued = d.issueDate.map { "（\($0.long)签发）" } ?? ""
        let state: String
        switch freshness(d) {
        case .expired: state = "已过期"
        case .expiring(let days): state = "将在 \(days) 天后到期"
        default: state = "需要更新"
        }
        return """
        \(greeting)

        \(ownerPart)的\(typeName)\(issued)\(state)，麻烦补发一份新的，谢谢。
        """
    }
}
