import SwiftUI
import AppKit

struct PacketView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var companyID: String?
    /// 从公司页打开时公司已定，不再显示公司选择。
    private let companyLocked: Bool
    @State private var templateID: String = ""
    @State private var items: [PacketItem] = []
    @State private var phase: Phase = .choosing
    @State private var confirmPartial = false
    @State private var completedEntries = 0
    @State private var totalEntries = 0
    @State private var editingPurpose: PurposeEditTarget?
    @State private var reissue: ReissueTarget?
    @State private var sendingNote = false

    init(companyID: String?, purposeID: String? = nil) {
        _companyID = State(initialValue: companyID)
        _templateID = State(initialValue: purposeID ?? "")
        companyLocked = companyID != nil
    }

    /// 每家公司上一次生成文件包用的用途（打开时默认选它）。
    static func lastPurpose(companyID: String) -> String? {
        UserDefaults.standard.string(forKey: "charter.packet.lastPurpose.\(companyID)")
    }

    static func rememberPurpose(_ purposeID: String, companyID: String) {
        UserDefaults.standard.set(purposeID, forKey: "charter.packet.lastPurpose.\(companyID)")
    }

    enum Phase: Equatable {
        case choosing
        case building
        case failed(String)
        case done(URL, complete: Bool, missing: Int)
    }

    private var company: Company? { store.company(companyID) }
    private var template: PacketTemplate? { store.library.packets.first { $0.id == templateID } }
    private var summary: PacketSummary { PacketSummary(items: items) }

    private var subtitle: String {
        if companyLocked, let c = company {
            return "\(c.name)。按用途挑选每类文件的最新版本，并标出缺少的文件。"
        }
        return "按用途挑选每类文件的最新版本，并标出缺少的文件。"
    }

    var body: some View {
        let s = summary
        SheetScaffold(title: "准备文件包", subtitle: subtitle, width: 1000, height: 780) {
            HStack(alignment: .top, spacing: 24) {
                chooser
                    .frame(width: 420)
                VStack(alignment: .leading, spacing: 12) {
                    statusBanner
                    tocPreview
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        } leading: {
            footerLeading(s)
        } trailing: {
            footerTrailing(s)
        }
        .interactiveDismissDisabled(phase == .building)
        // 完成后只剩“完成”按钮，Esc 同样关闭
        .onExitCommand { if case .done = phase { dismiss() } }
        .onAppear {
            if companyID == nil { companyID = store.companies.first?.id }
            if templateID.isEmpty || template == nil {
                let last = companyID.flatMap { Self.lastPurpose(companyID: $0) }
                if let last, store.library.packets.contains(where: { $0.id == last }) {
                    templateID = last
                } else {
                    templateID = store.library.packets.first?.id ?? ""
                }
            }
            reload()
        }
        .onChange(of: companyID) { reload() }
        .onChange(of: templateID) { reload() }
        .sheet(item: $editingPurpose) { target in
            PurposeEditor(purposeID: target.purposeID,
                          onSaved: { id in
                              if templateID == id { reload() } else { templateID = id }
                          },
                          onDeleted: {
                              templateID = store.library.packets.first?.id ?? ""
                              reload()
                          })
        }
        .reissueSheet($reissue)
        .sheet(isPresented: $sendingNote) {
            CopyTextSheet(title: "发送说明", subtitle: "可直接粘贴进邮件正文，列出包含的文件和尚缺的材料。", text: sendNote())
        }
        .confirmSheet("生成部分材料包？", isPresented: $confirmPartial,
                      message: "目录和文件名会标明“部分材料包”，并列出缺少的 \(s.missing.count) 项。",
                      confirmTitle: "生成部分材料包") {
            build()
        }
    }

    // MARK: 左：公司、用途、清单

    private var chooser: some View {
        VStack(alignment: .leading, spacing: 18) {
            if !companyLocked {
                VStack(alignment: .leading, spacing: 8) {
                    Text("公司").font(TypeStyle.rowTitle)
                    SelectField(options: store.companies.map { ($0.id, $0.name) },
                                selection: Binding(get: { companyID ?? "" }, set: { companyID = $0 }),
                                placeholder: "选择公司", minWidth: 300)
                        .disabled(phase != .choosing)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Text("用途").font(TypeStyle.rowTitle)
                    Spacer()
                    Button { editingPurpose = PurposeEditTarget(purposeID: templateID) } label: {
                        Label("编辑", systemImage: "pencil")
                    }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                    .disabled(template == nil || phase != .choosing)
                    .help("修改这个用途需要的文件类别和签发时限")
                    Button { editingPurpose = PurposeEditTarget(purposeID: nil) } label: {
                        Label("新建用途", systemImage: "plus")
                    }
                    .buttonStyle(PillButtonStyle(.quiet, size: .small))
                    .disabled(phase != .choosing)
                }
                purposeSelector
                    .disabled(phase != .choosing)
                if let t = template {
                    Text(PurposeEditor.summary(of: t))
                        .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text("清单").font(TypeStyle.rowTitle)
                    Spacer()
                    Text("需要 \(items.count) 项，已选 \(summary.included.count) 项")
                        .font(TypeStyle.metadata).fontWeight(.semibold)
                        .foregroundStyle(summary.isComplete ? Theme.muted : Theme.amberText)
                }
                if items.isEmpty {
                    Text(template == nil ? "请先选择用途。" : company == nil ? "请先选择公司。" : "这个用途没有要求任何文件。")
                        .font(TypeStyle.body).foregroundStyle(Theme.muted)
                        .padding(.vertical, 6)
                } else {
                    VStack(spacing: 0) {
                        ForEach($items) { $item in
                            if item.id != items.first?.id {
                                Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, 14)
                            }
                            checklistRow($item)
                        }
                    }
                    .background(Theme.band.opacity(0.55), in: .rect(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.hairline))
                }
            }
        }
    }

    @ViewBuilder
    private var purposeSelector: some View {
        let packets = store.library.packets
        if packets.isEmpty {
            Text("还没有用途。点击“新建用途”，选择所需的文件类别。")
                .font(TypeStyle.body).foregroundStyle(Theme.muted)
        } else if packets.count <= 4 {
            PillSegmented(options: packets.map { ($0.id, $0.name) }, selection: $templateID)
        } else {
            SelectField(options: packets.map { ($0.id, $0.name) }, selection: $templateID, placeholder: "选择用途", minWidth: 260)
        }
    }

    private func checklistRow(_ item: Binding<PacketItem>) -> some View {
        let it = item.wrappedValue
        let hasFile = it.document != nil
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Toggle(isOn: item.included) {
                Text(it.title(typeName: it.document.flatMap { store.docType($0.typeID)?.name }))
                    .fontWeight(.medium)
                    .lineLimit(2)
            }
            .toggleStyle(KitCheckboxStyle())
            .disabled(!hasFile || phase != .choosing)
            .opacity(hasFile ? 1 : 0.55)
            Spacer(minLength: 8)
            Text(it.problem ?? (it.included ? it.recencyText() : "未选入"))
                .font(TypeStyle.metadata).fontWeight(it.problem == nil ? .regular : .semibold)
                .foregroundStyle(it.problem == nil ? Theme.muted : Theme.amberText)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .frame(minHeight: 44)
    }

    private func reload() {
        guard let c = company, let t = template else { items = []; return }
        withAnimation(.snappy) {
            items = Packager.items(for: t, company: c, store: store)
            phase = .choosing
        }
    }

    // MARK: 右：与导出目录一致的预览

    @ViewBuilder
    private var statusBanner: some View {
        switch phase {
        case .choosing:
            EmptyView()
        case .building:
            banner(symbol: "shippingbox", tint: Theme.ink, background: Theme.band) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(totalEntries == 0 ? "正在准备目录…" : "正在打包 \(completedEntries) / \(totalEntries)…")
                        .font(TypeStyle.body).fontWeight(.semibold).monospacedDigit()
                    ProgressView(value: Double(completedEntries), total: Double(max(totalEntries, 1)))
                        .tint(Theme.ink)
                }
            }
        case .failed(let message):
            banner(symbol: "exclamationmark.triangle.fill", tint: Theme.amberText, background: Theme.amberSoft) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("文件包生成失败").font(TypeStyle.body).fontWeight(.semibold).foregroundStyle(Theme.amberText)
                    Text(message).font(TypeStyle.metadata).foregroundStyle(Theme.ink).textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        case .done(let url, let complete, let missing):
            banner(symbol: complete ? "checkmark.circle.fill" : "exclamationmark.triangle.fill",
                   tint: complete ? Theme.limeText : Theme.amberText,
                   background: complete ? Theme.limeSoft : Theme.amberSoft) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(complete ? "已生成完整材料包" : "已生成部分材料包，缺 \(missing) 项。目录里已列出缺件。")
                        .font(TypeStyle.body).fontWeight(.semibold)
                        .foregroundStyle(complete ? Theme.limeText : Theme.amberText)
                    Text(url.lastPathComponent).font(TypeStyle.metadata).foregroundStyle(Theme.ink).textSelection(.enabled)
                }
            }
        }
    }

    private func banner<C: View>(symbol: String, tint: Color, background: Color, @ViewBuilder _ content: () -> C) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).font(.system(size: 15, weight: .semibold)).foregroundStyle(tint)
            content()
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(background, in: .rect(cornerRadius: 14))
    }

    private var tocPreview: some View {
        let s = summary
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Text("目录预览").font(TypeStyle.metadata).fontWeight(.semibold).foregroundStyle(Theme.muted)
                Spacer()
                if !s.isComplete && !items.isEmpty {
                    Text("部分材料包，缺 \(s.missing.count) 项")
                        .font(.system(size: 11.5, weight: .bold)).foregroundStyle(Theme.amberText)
                        .padding(.horizontal, 9).frame(height: 22).background(Theme.amberSoft, in: .capsule)
                }
            }
            Text(company?.name ?? "未选公司").font(.system(size: 22, weight: .semibold)).tracking(-0.3).padding(.top, 14)
            Text("\(template?.name ?? "")文件包，\(store.today.long)").font(TypeStyle.body).foregroundStyle(Theme.muted)

            Text("已包含（\(s.included.count) 份）").font(TypeStyle.rowTitle).padding(.top, 20)
            ForEach(Array(s.included.enumerated()), id: \.element.id) { pair in
                let item = pair.element
                HStack(alignment: .top, spacing: 10) {
                    Text(String(format: "%02d", pair.offset + 1)).font(TypeStyle.body).monospacedDigit().foregroundStyle(Theme.muted)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title(typeName: item.document.flatMap { store.docType($0.typeID)?.name }))
                            .font(TypeStyle.body).foregroundStyle(Theme.ink)
                        Text(item.recencyText())
                            .font(TypeStyle.metadata)
                            .foregroundStyle(item.problem == nil ? Theme.muted : Theme.amberText)
                    }
                    Spacer()
                }
                .padding(.vertical, 5)
            }
            if s.included.isEmpty {
                Text("还没有选入任何文件。").font(TypeStyle.body).foregroundStyle(Theme.muted).padding(.vertical, 5)
            }

            if !s.missing.isEmpty {
                Text("尚缺（\(s.missing.count) 项）").font(TypeStyle.rowTitle).foregroundStyle(Theme.amberText).padding(.top, 18)
                ForEach(s.missing) { item in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("—").foregroundStyle(Theme.amberText)
                        Text(item.title(typeName: nil)).font(TypeStyle.body).foregroundStyle(Theme.ink)
                        Spacer()
                        Text(s.reason(item)).font(TypeStyle.metadata).fontWeight(.semibold).foregroundStyle(Theme.amberText)
                            .multilineTextAlignment(.trailing)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.vertical, 5)
                }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: .rect(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.hairline, lineWidth: 1))
    }

    // MARK: 底部
    // 左：向负责方询问材料（次要）；右：关闭（次要）+ 生成（主要）。都用常规 34 高，按钮行垂直居中。

    @ViewBuilder
    private func footerLeading(_ s: PacketSummary) -> some View {
        switch phase {
        case .choosing, .building:
            if !s.isComplete && !items.isEmpty {
                let gaps = requestableTypeIDs(s)
                let waiting = gaps.filter { id in company.map { store.openRequest(owner: NodeRef(kind: .company, id: $0.id), typeID: id) != nil } ?? false }
                let toAsk = gaps.filter { !waiting.contains($0) }
                if gaps.isEmpty {
                    EmptyView()
                } else if toAsk.isEmpty {
                    Label("缺的 \(gaps.count) 份已在等负责方补发", systemImage: "hourglass")
                        .font(TypeStyle.metadata).foregroundStyle(Theme.muted)
                } else {
                    // 一次合并成一封请求，记在“在等回件”里
                    Button("请负责方补发缺少的 \(toAsk.count) 份") {
                        guard let c = company else { return }
                        reissue = ReissueTarget(owner: NodeRef(kind: .company, id: c.id), typeIDs: toAsk)
                    }
                    .buttonStyle(PillButtonStyle(.secondary))
                    .disabled(phase != .choosing)
                    .help("生成一封合并的补发请求，跟进日到了会在总览提醒")
                }
            }
        case .failed:
            Button("返回清单") { phase = .choosing }
                .buttonStyle(PillButtonStyle(.secondary))
        case .done(let url, let complete, let missing):
            Button("在访达中显示") { NSWorkspace.shared.activateFileViewerSelecting([url]) }
                .buttonStyle(PillButtonStyle(.secondary))
            Button("复制发送说明") { sendingNote = true }
                .buttonStyle(PillButtonStyle(.accent))
                .help("一段可直接粘贴进邮件的文字：包含哪些文件、还缺什么、预计何时补齐")
            Button("用邮件发送") {
                guard let service = NSSharingService(named: .composeEmail) else { return }
                service.subject = url.deletingPathExtension().lastPathComponent
                service.perform(withItems: [complete ? "附件是材料包，请查收。" : "附件是部分材料，缺少的 \(missing) 项已列在目录中，补齐后另行发送。", url])
            }
            .buttonStyle(PillButtonStyle(.secondary))
        }
    }

    @ViewBuilder
    private func footerTrailing(_ s: PacketSummary) -> some View {
        switch phase {
        case .choosing, .building:
            Button("关闭") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
                .disabled(phase == .building)
            Button(phase == .building ? "正在生成…" : (s.isComplete ? "生成材料包" : "生成部分材料包")) {
                if s.isComplete { build() } else { confirmPartial = true }
            }
            .buttonStyle(PillButtonStyle(.primary))
            .keyboardShortcut(.defaultAction)
            .disabled(s.included.isEmpty || phase != .choosing)
            .help(s.isComplete ? "" : "缺 \(s.missing.count) 项，目录里会注明")
        case .failed:
            Button("关闭") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button("重试") { build() }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
        case .done:
            Button("完成") { dismiss() }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
        }
    }

    /// 缺件里可以请负责方补发的公司文件类型（个人护照和“未选入”的不算）。
    private func requestableTypeIDs(_ s: PacketSummary) -> [String] {
        guard let c = company else { return [] }
        let archive = store.archive(of: c)
        var out: [String] = []
        for item in s.missing where !item.isPersonal && item.problem != nil {
            let id = item.document?.typeID ?? archive.first { $0.type?.category == item.category }?.typeID
            if let id, !out.contains(id) { out.append(id) }
        }
        return out
    }

    /// 完成后的发送说明：公司、用途、包含的文件（签发日）、尚缺的材料和预计补齐时间。
    private func sendNote() -> String {
        let s = summary
        let name = company?.name ?? ""
        var lines: [String] = []
        lines.append("\(name) \(template?.name ?? "")文件包（\(store.today.long)）")
        lines.append("")
        lines.append("已包含（\(s.included.count) 份）：")
        for (i, item) in s.included.enumerated() {
            let title = item.title(typeName: item.document.flatMap { store.docType($0.typeID)?.name })
            let issued = item.document?.issueDate.map { "，\($0.long)签发" } ?? ""
            lines.append(String(format: "%02d", i + 1) + " " + title + issued)
        }
        if !s.missing.isEmpty {
            lines.append("")
            lines.append("尚缺（\(s.missing.count) 项）：")
            for item in s.missing {
                lines.append("— \(item.title(typeName: nil))：\(s.reason(item))")
            }
            if let c = company {
                let owner = NodeRef(kind: .company, id: c.id)
                let pending = requestableTypeIDs(s).compactMap { store.openRequest(owner: owner, typeID: $0) }
                if let latest = pending.map(\.followUpOn).max() {
                    var names: [String] = []
                    for r in pending {
                        let n = store.party(r.partyID)?.name ?? "负责方"
                        if !names.contains(n) { names.append(n) }
                    }
                    lines.append("")
                    lines.append("已请 \(names.joined(separator: "、")) 补发，预计 \(latest.short)前补齐，收到后另行发送。")
                } else {
                    lines.append("")
                    lines.append("缺少的文件补齐后另行发送。")
                }
            }
        }
        return lines.joined(separator: "\n")
    }

    private func build() {
        guard let c = company, let t = template else { return }
        let s = summary
        let frozenItems = items
        completedEntries = 0
        totalEntries = s.included.count + 1
        phase = .building
        Task { @MainActor in
            do {
                let url = try await Packager.build(items: frozenItems, template: t, company: c, store: store) { done, total in
                    Task { @MainActor in
                        completedEntries = done
                        totalEntries = total
                    }
                }
                Self.rememberPurpose(t.id, companyID: c.id)
                withAnimation(.snappy) { phase = .done(url, complete: s.isComplete, missing: s.missing.count) }
            } catch {
                phase = .failed(error.localizedDescription)
            }
        }
    }
}
