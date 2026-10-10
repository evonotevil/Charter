import SwiftUI
import AppKit

/// 一键导出：先列出会包含什么、不包含什么，确认后在后台生成 ZIP。
struct ExportSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    var companyID: String
    @State private var includeOld = false
    @State private var result: URL?
    @State private var working = false
    @State private var completedEntries = 0
    @State private var totalEntries = 0
    @State private var failure: String?

    var body: some View {
        if let c = store.company(companyID) {
            let p = ArchiveExporter.plan(for: c, store: store)
            SheetScaffold(title: "导出全部档案", subtitle: "\(c.name)。导出为一个 ZIP，附目录和公司资料摘要。", width: 580, height: 680) {
                VStack(alignment: .leading, spacing: 18) {
                    status
                    FormGroup(title: "将包含 \(p.included.count) 份现行文件") {
                        if p.included.isEmpty {
                            Text("还没有可以导出的文件。").font(TypeStyle.body).foregroundStyle(Theme.muted)
                        }
                        ForEach(Array(p.included.enumerated()), id: \.offset) { pair in
                            let item = pair.element
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(item.name).font(TypeStyle.body).foregroundStyle(Theme.ink)
                                Spacer(minLength: 8)
                                if item.state.needsAttention {
                                    Pill(text: item.state.label, kind: item.state.pillKind)
                                }
                                Text(item.document?.issueDate.map { "\($0.description) 签发" } ?? "未注明签发日期")
                                    .font(TypeStyle.metadata).monospacedDigit().foregroundStyle(Theme.muted)
                            }
                        }
                    }
                    if !p.excluded.isEmpty {
                        FormGroup(title: "不包含 \(p.excluded.count) 项，目录里会注明原因") {
                            ForEach(Array(p.excluded.enumerated()), id: \.offset) { pair in
                                let item = pair.element
                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                    Text(item.name).font(TypeStyle.body).foregroundStyle(Theme.ink)
                                    Spacer(minLength: 8)
                                    Text(item.note.isEmpty ? item.state.label : "\(item.state.label)，\(item.note)")
                                        .font(TypeStyle.metadata).foregroundStyle(Theme.amberText)
                                        .multilineTextAlignment(.trailing)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }
                    if p.oldVersions > 0 {
                        FormGroup(title: "选项") {
                            Toggle("同时导出 \(p.oldVersions) 份旧版文件（放在“旧版”文件夹）", isOn: $includeOld)
                                .toggleStyle(KitCheckboxStyle())
                                .disabled(working || result != nil)
                        }
                    }
                    Text("另附：目录（PDF 和 Excel 各一份），以及根据已录入的公司、董事和持股关系生成的公司资料摘要。")
                        .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } leading: {
                if let result {
                    Button("在访达中显示") { NSWorkspace.shared.activateFileViewerSelecting([result]) }
                        .buttonStyle(PillButtonStyle(.secondary))
                } else {
                    Button("按用途挑选导出…") { router.sheet = .packet(companyID: c.id) }
                        .buttonStyle(PillButtonStyle(.secondary))
                        .disabled(working)
                        .help("例如银行开户、审计、KYC：按清单挑选文件")
                }
            } trailing: {
                if result != nil {
                    Button("完成") { dismiss() }
                        .buttonStyle(PillButtonStyle(.primary))
                        .keyboardShortcut(.defaultAction)
                } else {
                    Button("取消") { dismiss() }
                        .buttonStyle(PillButtonStyle(.secondary))
                        .keyboardShortcut(.cancelAction)
                        .disabled(working)
                    Button(working ? "正在导出…" : (failure == nil ? "导出 ZIP" : "重试")) { run(c) }
                        .buttonStyle(PillButtonStyle(.primary))
                        .keyboardShortcut(.defaultAction)
                        .disabled(working || p.included.isEmpty)
                }
            }
            .interactiveDismissDisabled(working)
        } else {
            Text("找不到这家公司").padding(40)
        }
    }

    /// 进度、结果或失败原因，显示在内容顶部。
    @ViewBuilder
    private var status: some View {
        if working {
            VStack(alignment: .leading, spacing: 8) {
                Text(totalEntries == 0 ? "正在准备目录…" : "正在写入 \(completedEntries) / \(totalEntries)…")
                    .font(TypeStyle.body).fontWeight(.semibold).monospacedDigit()
                ProgressView(value: Double(completedEntries), total: Double(max(totalEntries, 1)))
                    .tint(Theme.ink)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.band, in: .rect(cornerRadius: 14))
        } else if let result {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.limeText)
                VStack(alignment: .leading, spacing: 2) {
                    Text("已导出").font(TypeStyle.body).fontWeight(.semibold).foregroundStyle(Theme.limeText)
                    Text(result.lastPathComponent).font(TypeStyle.metadata).foregroundStyle(Theme.ink).textSelection(.enabled)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.limeSoft, in: .rect(cornerRadius: 14))
        } else if let failure {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.amberText)
                VStack(alignment: .leading, spacing: 2) {
                    Text("导出失败").font(TypeStyle.body).fontWeight(.semibold).foregroundStyle(Theme.amberText)
                    Text(failure).font(TypeStyle.metadata).foregroundStyle(Theme.ink).textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.amberSoft, in: .rect(cornerRadius: 14))
        }
    }

    private func run(_ c: Company) {
        working = true
        failure = nil
        completedEntries = 0
        totalEntries = 0
        let frozenIncludeOld = includeOld
        Task { @MainActor in
            defer { working = false }
            do {
                result = try await ArchiveExporter.export(company: c, store: store, includeOld: frozenIncludeOld) { done, total in
                    Task { @MainActor in
                        completedEntries = done
                        totalEntries = total
                    }
                }
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}
