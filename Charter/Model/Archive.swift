import Foundation

/// 档案条目的人工标记：没有文件时说明原因。
enum ItemMark: String, Codable, CaseIterable, Identifiable {
    case notObtained, external, restricted, unverified, notApplicable
    var id: String { rawValue }
    var label: String {
        switch self {
        case .notObtained: "未取得"
        case .external: "外部保管"
        case .restricted: "权限受限"
        case .unverified: "待核对"
        case .notApplicable: "不适用"
        }
    }
    var explanation: String {
        switch self {
        case .notObtained: "尚未取得材料，可在备注中记录跟进情况。"
        case .external: "材料由代理、同事或其他机构保管，本地没有副本。"
        case .restricted: "材料可能存在，但目前没有权限取得或查看。"
        case .unverified: "尚未确认材料是否存在或是否需要管理。"
        case .notApplicable: "此公司不适用该条目；不纳入本公司的归档比例。"
        }
    }
}

/// 一家公司在法域模板之外的调整：多加的条目、去掉的条目、标记和备注。
struct CompanyArchive: Codable, Hashable {
    var added: [String] = []
    var removed: [String] = []
    var marks: [String: ItemMark] = [:]
    var notes: [String: String] = [:]
}

/// 档案清单上的一行。
struct ArchiveItem: Identifiable, Hashable {
    enum State: Hashable {
        case valid
        case expiring(Int)
        case expired(Int)
        case needsUpdate
        case noDate              // 已归档，但没有日期可判断
        case marked(ItemMark)
        case missing             // 未归档，也没标记原因

        var label: String {
            switch self {
            case .valid: "有效"
            case .expiring(let d): "\(d) 天后到期"
            case .expired(let d): "已过期 \(d) 天"
            case .needsUpdate: "需要更新"
            case .noDate: "日期待核对"
            case .marked(let m): m.label
            case .missing: "未归档"
            }
        }
        var hasFile: Bool {
            switch self {
            case .valid, .expiring, .expired, .needsUpdate, .noDate: true
            default: false
            }
        }
        var needsAttention: Bool {
            switch self {
            case .expiring, .expired, .needsUpdate, .noDate: true
            default: false
            }
        }
        /// 排序和合并时用：数字越小越要紧。
        var rank: Int {
            switch self {
            case .expired: 0
            case .needsUpdate: 1
            case .expiring: 2
            case .missing: 3
            case .marked(.notObtained): 4
            case .marked(.external): 5
            case .marked(.restricted), .marked(.unverified): 5
            case .noDate: 6
            case .valid: 7
            case .marked(.notApplicable): 8
            }
        }
    }

    var typeID: String
    var type: DocumentType?
    var document: Document?
    var olderVersions: Int
    var state: State
    var note: String
    /// 不在法域模板里（单独给这家公司加的，或已有文件但模板里没有）。
    var isExtra: Bool
    var id: String { typeID }
    var name: String { type?.name ?? "未知条目" }
}
