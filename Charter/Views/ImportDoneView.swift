import SwiftUI

/// 归档完成：印章动画、归档数量，以及每家公司按用途“随时能出哪些材料”。
struct ImportDoneView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    var result: ImportResult
    /// 从公司页上传时，只看这一家公司。
    var focusCompanyID: String? = nil

    @State private var reissue: ReissueTarget?

    private typealias Row = PurposeReadiness

    private func rows() -> [Row] {
        let ids = focusCompany.map { [$0.id] } ?? result.companyIDs
        let out = PurposeReadiness.compute(companyIDs: ids, store: store)
        // 缺件的在前，缺得少的更靠前
        return out.enumerated().sorted { a, b in
            if a.element.complete != b.element.complete { return !a.element.complete }
            if a.element.missing.count != b.element.missing.count { return a.element.missing.count < b.element.missing.count }
            return a.offset < b.offset
        }.map { $0.element }
    }

    private var focusCompany: Company? { focusCompanyID.flatMap { store.company($0) } }

    private func subline(_ rows: [Row]) -> String {
        let n = result.companyIDs.count
        var s: String
        if let c = focusCompany {
            let p = store.archiveProgress(of: c)
            s = "\(c.name)的档案清单已归档 \(p.have)/\(p.total) 项。"
        } else if n == 0 {
            s = "文件已归入人员档案。"
        } else if result.newCompanyCount > 0 {
            s = "建立了 \(result.newCompanyCount) 家公司的档案" + (n > result.newCompanyCount ? "，并更新了 \(n - result.newCompanyCount) 家公司。" : "。")
        } else {
            s = "更新了 \(n) 家公司的档案。"
        }
        var readyPurposes: [String] = []
        for r in rows where r.complete && !readyPurposes.contains(r.template.name) { readyPurposes.append(r.template.name) }
        let incomplete = rows.filter { !$0.complete }.count
        if !readyPurposes.isEmpty { s += readyPurposes.joined(separator: "、") + "材料已经可以随时导出" + (incomplete > 0 ? "；" : "。") }
        if incomplete > 0 { s += "还有 \(incomplete) 项用途缺文件。" }
        return s
    }

    var body: some View {
        let list = rows()
        SheetScaffold(title: focusCompany.map { "已归档到 \($0.name)" } ?? "归档完成", width: 860, height: 820) {
            VStack(alignment: .leading, spacing: Space.xxl32) {
                HStack(alignment: .center, spacing: 28) {
                    ArchiveSeal(size: 120)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(result.count) 份已归档")
                            .font(.system(size: 56, weight: .heavy)).tracking(-2.2)
                            .lineLimit(1).minimumScaleFactor(0.6)
                        Text(subline(list))
                            .font(.system(size: 15))
                            .opacity(0.8)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .foregroundStyle(Theme.onLime)
                .padding(32)
                .background(Theme.lime, in: .rect(cornerRadius: Theme.radius, style: .continuous))
                .accessibilityElement(children: .combine)

                if !list.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("随时能出哪些材料").font(TypeStyle.section).tracking(Tracking.section)
                        Text(focusCompany == nil ? "按用途检查每家公司缺什么，缺的那份可以直接请负责方补发。" : "按用途检查还缺什么，缺的那份可以直接请负责方补发。")
                            .font(TypeStyle.body).foregroundStyle(Theme.muted)
                    }
                    VStack(spacing: 0) {
                        ForEach(list) { r in
                            readinessRow(r)
                            if r.id != list.last?.id {
                                Rectangle().fill(Theme.hairline).frame(height: 1)
                            }
                        }
                    }
                    .background(Theme.band, in: .rect(cornerRadius: Radius.surface, style: .continuous))
                }
            }
        } leading: {
            Text(focusCompany == nil ? "下一步：补齐缺失文件，或打开总览查看全部公司。" : "下一步：在档案清单里补齐缺失文件。")
                .font(TypeStyle.body).foregroundStyle(Theme.muted)
        } trailing: {
            Button("完成") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            if let c = focusCompany {
                Button("查看档案") {
                    router.companyTab = 0
                    router.open(company: c.id)
                    dismiss()
                }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
            } else {
                Button("打开总览") {
                    router.go(.overview)
                    dismiss()
                }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
            }
        }
        .reissueSheet($reissue)
    }

    private func readinessRow(_ r: Row) -> some View {
        HStack(spacing: Space.l16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(r.template.name).font(TypeStyle.rowTitle)
                Text(r.company.name).font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                    .lineLimit(1).truncationMode(.tail)
            }
            .frame(width: 220, alignment: .leading)
            VStack(alignment: .leading, spacing: 6) {
                ReadinessTrack(fraction: r.total == 0 ? 0 : Double(r.got) / Double(r.total))
                Text(r.complete ? "齐全，可随时导出" : "还缺：" + r.missing.joined(separator: "、"))
                    .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                    .lineLimit(2)
                    .help(r.complete ? "" : r.missingDetail.joined(separator: "\n"))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            PurposeReadinessAction(row: r) { reissue = $0 }
            .frame(width: 140, alignment: .trailing)
        }
        .padding(.horizontal, 22).padding(.vertical, 18)
        .accessibilityElement(children: .contain)
    }
}

/// 用途准备度进度条（柠檬绿）。
struct ReadinessTrack: View {
    var fraction: Double

    var body: some View {
        Capsule().fill(Theme.hairline)
            .frame(height: 6)
            .overlay(alignment: .leading) {
                GeometryReader { g in
                    Capsule().fill(Theme.lime).frame(width: g.size.width * min(max(fraction, 0), 1))
                }
            }
            .accessibilityElement()
            .accessibilityLabel("准备度")
            .accessibilityValue("\(Int((fraction * 100).rounded()))%")
    }
}

/// Charter 的印章：先画出圆环，再弹出中心圆点。减少动态效果时直接显示完成状态。
struct ArchiveSeal: View {
    var size: CGFloat = 120
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawn = false
    @State private var popped = false

    var body: some View {
        let u = size / 1024
        ZStack {
            RoundedRectangle(cornerRadius: 230 * u, style: .continuous)
                .fill(Theme.emphasis)
            Circle()
                .trim(from: 0, to: drawn ? 1520.0 / 1885.0 : 0)
                .stroke(Theme.lime, style: StrokeStyle(lineWidth: 96 * u, lineCap: .round))
                .rotationEffect(.degrees(28))
                .frame(width: 600 * u, height: 600 * u)
            Circle()
                .stroke(Color.white.opacity(0.16), lineWidth: 18 * u)
                .frame(width: 300 * u, height: 300 * u)
            Circle()
                .fill(Theme.lime)
                .frame(width: 104 * u, height: 104 * u)
                .scaleEffect(popped ? 1 : 0.001)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
        .onAppear {
            if reduceMotion {
                drawn = true; popped = true
            } else {
                withAnimation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.9).delay(0.1)) { drawn = true }
                withAnimation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.3).delay(0.8)) { popped = true }
            }
        }
    }
}
