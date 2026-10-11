import SwiftUI

/// 某家公司按某个用途（开户、审计、KYC…）的文件包准备度。
/// 归档完成页和总览“随时能出哪些材料”共用这一套计算。
struct PurposeReadiness: Identifiable {
    var company: Company
    var template: PacketTemplate
    var got: Int
    var total: Int
    var missing: [String]
    var missingDetail: [String]
    /// 缺件里可以请负责方补发的公司文件类型。
    var missingTypeIDs: [String]
    var id: String { company.id + "|" + template.id }
    var complete: Bool { missing.isEmpty }

    /// 这些公司 × 全部用途；没有适用条目的组合跳过。顺序：公司（按传入顺序）→ 用途（按文件包库顺序）。
    @MainActor
    static func compute(companyIDs: [String], store: AppStore) -> [PurposeReadiness] {
        var out: [PurposeReadiness] = []
        for cid in companyIDs {
            guard let c = store.company(cid) else { continue }
            let archive = store.archive(of: c)
            for t in store.library.packets {
                let items = Packager.items(for: t, company: c, store: store)
                guard !items.isEmpty else { continue }
                let summary = PacketSummary(items: items)
                var typeIDs: [String] = []
                for item in summary.missing where !item.isPersonal && item.problem != nil {
                    let id = item.document?.typeID ?? archive.first { $0.type?.category == item.category }?.typeID
                    if let id, !typeIDs.contains(id) { typeIDs.append(id) }
                }
                out.append(PurposeReadiness(company: c, template: t,
                                            got: items.count - summary.missing.count, total: items.count,
                                            missing: summary.missing.map { $0.title(typeName: nil) },
                                            missingDetail: summary.missing.map { "\($0.title(typeName: nil))：\(summary.reason($0))" },
                                            missingTypeIDs: typeIDs))
            }
        }
        return out
    }
}

/// 一行准备度的操作：齐全 → 准备文件包；缺件 → 请负责方补发（已在等或无法补发时显示说明）。
struct PurposeReadinessAction: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    var row: PurposeReadiness
    var onReissue: (ReissueTarget) -> Void

    var body: some View {
        Group {
            if row.complete {
                Button("准备文件包") { router.sheet = .packet(companyID: row.company.id) }
            } else {
                let owner = NodeRef(kind: .company, id: row.company.id)
                let toAsk = row.missingTypeIDs.filter { store.openRequest(owner: owner, typeID: $0) == nil }
                if toAsk.isEmpty {
                    Text(row.missingTypeIDs.isEmpty ? "需要自行补齐" : "已在等负责方补发")
                        .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                } else {
                    Button("请负责方补发") {
                        onReissue(ReissueTarget(owner: owner, typeIDs: toAsk))
                    }
                }
            }
        }
        .buttonStyle(PillButtonStyle(.secondary, size: .small))
    }
}
