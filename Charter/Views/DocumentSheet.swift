import SwiftUI
import PDFKit
import AppKit
import UniformTypeIdentifiers

/// 文件详情：左边预览，右边改类型、归属、日期和形态，也可以换成新版本。
struct DocumentSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var document: Document
    @State private var replacing = false
    @State private var confirmDelete = false
    @State private var reissuing = false
    @State private var pending: StagedFile?
    @State private var saveError: String?

    static let forms = ["扫描件", "原件", "核证副本", "公证件", "海牙认证", "翻译件"]

    private var jurisdiction: String? {
        document.owner.kind == .company ? store.company(document.owner.id)?.jurisdiction : nil
    }

    private var typeOptions: [DocumentType] {
        store.library.documentTypes.filter { $0.owner == document.owner.kind && (jurisdiction == nil || $0.applies(to: jurisdiction!)) }
    }

    private var owners: [NodeRef] {
        store.companies.map { NodeRef(kind: .company, id: $0.id) } + store.people.map { NodeRef(kind: .person, id: $0.id) }
    }

    private var typeChoices: [(String, String)] {
        var list = typeOptions.map { ($0.id, $0.name) }
        if !list.contains(where: { $0.0 == document.typeID }) {
            list.append((document.typeID, store.docType(document.typeID)?.name ?? "未知类型"))
        }
        return list
    }

    private var ownerChoices: [(NodeRef, String)] {
        owners.map { ($0, store.name(of: $0)) }
    }

    private var formChoices: [(String, String)] {
        var list = Self.forms.map { ($0, $0) }
        if !Self.forms.contains(document.form) { list.append((document.form, document.form)) }
        return list
    }

    var body: some View {
        let f = Freshness.of(document, type: store.docType(document.typeID), today: store.today)
        let typeName = store.docType(document.typeID)?.name ?? "文件"
        let ruleExpiry: Day? = document.expiryDate == nil ? Freshness.expiry(of: document, type: store.docType(document.typeID)) : nil
        SheetScaffold(title: typeName, subtitle: store.name(of: document.owner), width: 960, height: 780) {
            HStack(alignment: .top, spacing: 22) {
                FilePreview(url: store.fileURL(document))
                    .frame(width: 380, height: 540)
                    .background(Theme.band)
                    .clipShape(.rect(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.hairline))

                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 8) {
                        Pill(text: f.label, kind: f.pillKind)
                        if document.needsUpdate && f != .needsUpdate {
                            Pill(text: "需要更新", kind: .warn)
                        }
                    }

                    FormGroup(title: "文件") {
                        FieldRow(label: "类型") {
                            SelectField(options: typeChoices, selection: $document.typeID, minWidth: 260)
                        }
                        FieldRow(label: "归属") {
                            SelectField(options: ownerChoices, selection: $document.owner, minWidth: 260)
                        }
                        FieldRow(label: "形态") {
                            SelectField(options: formChoices, selection: $document.form, minWidth: 260)
                        }
                    }

                    FormGroup(title: "日期") {
                        FieldRow(label: "签发日期") {
                            DateField(day: $document.issueDate)
                        }
                        FieldRow(label: "到期日期", hint: ruleExpiry.map { "留空时按规则算出：\($0.long)" }) {
                            DateField(day: $document.expiryDate, placeholder: "长期有效可留空", relativeTo: document.issueDate)
                        }
                    }

                    FormGroup(title: "状态与备注") {
                        Toggle("信息有变更，需要重开", isOn: $document.needsUpdate)
                            .toggleStyle(KitSwitchStyle())
                        FieldRow(label: "备注") {
                            TextField("可选", text: $document.notes, axis: .vertical)
                                .lineLimit(1...4)
                                .textFieldStyle(KitFieldStyle())
                        }
                    }

                    FormGroup(title: "记录") {
                        FieldRow(label: "原始文件名") {
                            Text(document.originalFileName.isEmpty ? "—" : document.originalFileName)
                                .font(TypeStyle.body).foregroundStyle(Theme.ink)
                                .lineLimit(1).truncationMode(.middle)
                                .textSelection(.enabled)
                                .help(document.originalFileName)
                        }
                        FieldRow(label: "归档日期") {
                            Text(document.addedOn.long).font(TypeStyle.body).foregroundStyle(Theme.ink)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } leading: {
            ActionMenu(title: "更多", kind: .secondary, entries: [
                .item("打开", systemImage: "arrow.up.forward.app") { store.open(document) },
                .item("在访达中显示", systemImage: "folder") { store.reveal(document) },
                .item("归档新版…", systemImage: "square.and.arrow.up") { replacing = true },
                .item("请补发…", systemImage: "text.bubble") { reissuing = true },
                .divider,
                .item("从 Charter 移除记录", systemImage: "trash", destructive: true) { confirmDelete = true }
            ], arrowEdge: .top)
            if let saveError {
                Label(saveError, systemImage: "exclamationmark.triangle.fill")
                    .font(TypeStyle.metadata)
                    .foregroundStyle(Theme.amberText)
                    .lineLimit(2)
                    .help(saveError)
                    .accessibilityLabel("无法保存：\(saveError)")
            }
        } trailing: {
            Button("取消") { dismiss() }
                .buttonStyle(PillButtonStyle(.secondary))
                .keyboardShortcut(.cancelAction)
            Button("保存") { save() }
                .buttonStyle(PillButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
        }
        .fileImporter(isPresented: $replacing, allowedContentTypes: [.pdf, .image]) { result in
            guard case .success(let url) = result else { return }
            Task { @MainActor in
                do {
                    pending = try await store.stage(url: url, typeID: document.typeID, owner: document.owner, replaces: document, form: document.form) { new in
                        document = new
                    }
                } catch {
                    store.errorMessage = "读取文件失败：\(error.localizedDescription)"
                }
            }
        }
        .sheet(item: $pending) { ArchiveConfirmSheet(file: $0) }
        .sheet(isPresented: $reissuing) {
            CopyTextSheet(title: "请补发：\(typeName)", text: store.reissueText(for: document))
        }
        .confirmSheet("从 Charter 移除这份文件的记录？", isPresented: $confirmDelete,
                      message: "只移除 Charter 里的记录，文件夹里的 PDF 不会被删除。",
                      confirmTitle: "移除", destructive: true) {
            store.delete(document: document)
            dismiss()
        }
    }

    private func save() {
        do {
            try store.updateDocument(document)
            store.showToast("文件信息已保存")
            dismiss()
        } catch {
            saveError = error.localizedDescription
        }
    }
}

/// PDF 或图片预览。
struct FilePreview: NSViewRepresentable {
    var url: URL

    func makeNSView(context: Context) -> NSView {
        if url.pathExtension.lowercased() == "pdf" {
            let v = PDFView()
            v.autoScales = true
            v.displayMode = .singlePageContinuous
            v.backgroundColor = .clear
            v.document = PDFDocument(url: url)
            return v
        }
        let iv = NSImageView()
        iv.imageScaling = .scaleProportionallyUpOrDown
        iv.image = NSImage(contentsOf: url)
        return iv
    }

    func updateNSView(_ view: NSView, context: Context) {
        if let v = view as? PDFView, v.document?.documentURL != url { v.document = PDFDocument(url: url) }
        if let iv = view as? NSImageView { iv.image = NSImage(contentsOf: url) }
    }
}
