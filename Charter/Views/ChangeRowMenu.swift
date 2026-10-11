import SwiftUI

/// 人员行、股东行末尾的“…”：从这一行直接发起“记录变更”，并预选这个人或这家股东。
struct ChangeRowMenu: View {
    @Environment(Router.self) private var router
    var companyID: String
    /// 董事或高管的任职（预选为“离任或变更”）。
    var appointmentID: String? = nil
    /// 股东的持股（预选为“转出或结束”）。
    var holdingID: String? = nil
    /// 额外的菜单项（放在“记录变更…”之后）。
    var extra: [MenuEntry] = []

    var body: some View {
        ActionMenu(systemImage: "ellipsis", kind: .quiet, size: .small, entries: entries)
            .fixedSize()
            .help("更多操作")
    }

    private var entries: [MenuEntry] {
        let kind: ChangeKind = holdingID != nil ? .shareholderChange : .directorChange
        let title = holdingID != nil ? "记录变更（股权转让）…" : "记录变更（离任或变更）…"
        let cid = companyID, a = appointmentID, h = holdingID
        var list: [MenuEntry] = [
            .item(title, systemImage: "arrow.triangle.2.circlepath") {
                router.sheet = .changeFrom(companyID: cid, kind: kind, appointmentID: a, holdingID: h)
            },
        ]
        if !extra.isEmpty {
            list.append(.divider)
            list.append(contentsOf: extra)
        }
        return list
    }
}
