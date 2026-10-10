import Foundation
import AppKit

/// 文件包里的一项（一个要求）。
struct PacketItem: Identifiable, Hashable {
    var id: String { category + "|" + ownerName }
    var category: String
    var ownerName: String
    var isPersonal: Bool            // 董事护照等个人文件
    var document: Document?
    var problem: String?            // 缺少、已过期、签发太久、信息变更
    var included: Bool
    var maxAgeMonths: Int?          // 该项适用的签发时限；nil 表示不受文件包时限约束

    /// 屏幕和目录里显示的名称，如“护照（李四）”。
    func title(typeName: String?) -> String {
        let base = typeName ?? category
        return isPersonal ? "\(base)（\(ownerName)）" : base
    }

    /// 文件包预览与目录共用，避免把“没有签发日期”误写成满足时限。
    func recencyText() -> String {
        guard let maxAgeMonths else {
            return document?.issueDate.map { "\($0.long)签发，无签发时限要求" } ?? "未注明签发日期，无签发时限要求"
        }
        guard let issued = document?.issueDate else {
            return "要求 \(maxAgeMonths) 个月内签发，未注明签发日期，无法确认"
        }
        return "要求 \(maxAgeMonths) 个月内签发，\(issued.long)签发" + (problem == nil ? "，符合" : "")
    }
}

/// 一份文件包的完整性：屏幕、目录、文件名都用它，保证三处一致。
struct PacketSummary {
    var items: [PacketItem]
    var included: [PacketItem] { items.filter { $0.included && $0.document != nil } }
    var missing: [PacketItem] { items.filter { !($0.included && $0.document != nil) } }
    var isComplete: Bool { missing.isEmpty }

    /// 缺件的原因：没选上的有文件但被取消勾选的，写“未选入”。
    func reason(_ item: PacketItem) -> String {
        if let p = item.problem { return p }
        if item.document == nil { return "还没有这份文件" }
        return "未选入"
    }
}

enum Packager {

    /// 按文件包模板列出一家公司需要的全部文件。
    @MainActor
    static func items(for template: PacketTemplate, company: Company, store: AppStore) -> [PacketItem] {
        var out: [PacketItem] = []
        let owner = NodeRef(kind: .company, id: company.id)
        let docs = store.ownedDocuments(of: owner)
        let archive = store.archive(of: company)

        func check(_ doc: Document?) -> String? {
            guard let doc else { return "还没有这份文件" }
            switch store.freshness(doc) {
            case .expired(let d): return "已过期 \(d) 天"
            case .needsUpdate: return "信息有变更，需要重开"
            default: break
            }
            if let max = template.maxAgeMonths, store.docType(doc.typeID)?.validity == .monthsAfterIssue {
                guard let issued = doc.issueDate else { return "未注明签发日期，无法确认是否在 \(max) 个月内" }
                if issued.adding(months: max) < store.today { return "签发已超过 \(max) 个月" }
            }
            return nil
        }

        for cat in template.categories {
            let doc = docs.first { store.docType($0.typeID)?.category == cat }
            let problem: String?
            if doc == nil {
                let matching = archive.filter { $0.type?.category == cat }
                let marked = matching.filter { if case .marked = $0.state { true } else { false } }
                problem = marked.isEmpty ? "还没有这份文件" : marked.map {
                    "\($0.name)：\($0.state.label)\($0.note.isEmpty ? "" : "，\($0.note)")"
                }.joined(separator: "；")
            } else {
                problem = check(doc)
            }
            let maxAge = doc.flatMap { store.docType($0.typeID)?.validity == .monthsAfterIssue ? template.maxAgeMonths : nil }
            out.append(PacketItem(category: cat, ownerName: company.name, isPersonal: false, document: doc, problem: problem,
                                  included: doc != nil && problem == nil, maxAgeMonths: maxAge))
        }
        if template.includeDirectorsPassports {
            for p in store.directors(of: company.id) {
                let doc = store.ownedDocuments(of: NodeRef(kind: .person, id: p.id)).first { store.docType($0.typeID)?.category == "护照" }
                let problem = check(doc)
                let maxAge = doc.flatMap { store.docType($0.typeID)?.validity == .monthsAfterIssue ? template.maxAgeMonths : nil }
                out.append(PacketItem(category: "护照", ownerName: p.name, isPersonal: true, document: doc, problem: problem,
                                      included: doc != nil && problem == nil, maxAgeMonths: maxAge))
            }
        }
        return out
    }

    /// 生成 ZIP：目录页（含缺件）＋ 按顺序编号的文件。返回 ZIP 路径。
    @MainActor
    static func build(
        items: [PacketItem],
        template: PacketTemplate,
        company: Company,
        store: AppStore,
        progress: @escaping @Sendable (Int, Int) -> Void
    ) async throws -> URL {
        let summary = PacketSummary(items: items)
        let stamp = store.today.description.replacingOccurrences(of: "-", with: "")
        let partial = summary.isComplete ? "" : "_部分"
        let base = FolderStore.safe("\(company.name)_\(template.name)\(partial)_\(stamp)")

        var entries: [ExportEntry] = []
        var included: [String] = []
        for (i, item) in summary.included.enumerated() {
            guard let doc = item.document else { continue }
            let title = item.title(typeName: store.docType(doc.typeID)?.name)
            let num = String(format: "%02d", i + 1)
            let src = store.fileURL(doc)
            let ext = src.pathExtension.isEmpty ? "pdf" : src.pathExtension
            let name = FolderStore.safe("\(num) \(title)") + "." + ext
            entries.append(ExportEntry(path: "\(base)/\(name)", payload: .file(src)))
            included.append("\(num)  \(title)：\(item.recencyText())")
        }
        let missing = summary.missing.map { "—  \($0.title(typeName: nil))：\(summary.reason($0))" }

        let tocURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        defer { try? FileManager.default.removeItem(at: tocURL) }
        var sections: [PDFWriter.Section] = [PDFWriter.Section(heading: "已包含（\(included.count) 份）", lines: included, alert: false)]
        if !missing.isEmpty {
            sections.append(PDFWriter.Section(heading: "尚缺（\(missing.count) 项）", lines: missing, alert: true))
        }
        try PDFWriter.write(
            to: tocURL,
            title: company.name,
            subtitle: summary.isComplete ? "\(template.name)文件包　\(store.today.long)" : "\(template.name)文件包（部分材料，缺 \(missing.count) 项）　\(store.today.long)",
            sections: sections,
            footer: summary.isComplete ? nil : "这是部分材料包。缺少的文件补齐后会另行发送。")
        entries.insert(ExportEntry(path: "\(base)/00 目录.pdf", payload: .file(tocURL)), at: 0)

        try FileManager.default.createDirectory(at: store.store.packetsDir, withIntermediateDirectories: true)
        var zip = store.store.packetsDir.appendingPathComponent(base + ".zip")
        var n = 2
        while FileManager.default.fileExists(atPath: zip.path) {
            zip = store.store.packetsDir.appendingPathComponent("\(base) (\(n)).zip"); n += 1
        }
        guard FileManager.default.createFile(atPath: zip.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
        do {
            try await ExportIO.writeZIP(entries: entries, to: zip, progress: progress)
        } catch {
            try? FileManager.default.removeItem(at: zip)
            throw error
        }
        return zip
    }
}

/// 最简单的 ZIP 写入：不压缩（PDF 本身已压缩），文件名按 UTF-8 并标记，不带 macOS 的隐藏元数据。
/// Windows 资源管理器、7-Zip、Python 都能正确显示中文文件名。
enum ZipWriter {
    private enum WriterError: LocalizedError {
        case zip32Limit

        var errorDescription: String? { "导出内容超过 ZIP32 的 4 GB 上限，请拆分后再导出。" }
    }

    static func write(entries: [(String, Data)], to url: URL) throws {
        try write(entries: entries.map { ExportEntry(path: $0.0, payload: .data($0.1)) }, to: url) { _, _ in }
    }

    /// 流式写入“仅存储”ZIP。使用 data descriptor，只读取一次源文件且不把附件或完整 ZIP 留在内存。
    static func write(
        entries: [ExportEntry],
        to url: URL,
        progress: @escaping @Sendable (Int, Int) -> Void
    ) throws {
        guard entries.count <= Int(UInt16.max) else { throw CocoaError(.fileWriteOutOfSpace) }
        let fm = FileManager.default
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let temporary = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
        guard fm.createFile(atPath: temporary.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
        let output = try FileHandle(forWritingTo: temporary)
        defer {
            try? output.close()
            try? fm.removeItem(at: temporary)
        }

        var central = Data()
        let (dosTime, dosDate) = dosDateTime(Date())

        for (index, entry) in entries.enumerated() {
            try Task.checkCancellation()
            let name = Data(entry.path.utf8)
            guard name.count <= Int(UInt16.max), output.offsetInFile <= UInt64(UInt32.max) else {
                throw WriterError.zip32Limit
            }
            let offset = UInt32(output.offsetInFile)
            let flags: UInt16 = 0x0808 // UTF-8 文件名 + 尾随 data descriptor
            // 本地文件头
            var local = Data()
            local.append(le32(0x04034b50))
            local.append(le16(20))
            local.append(le16(flags))
            local.append(le16(0))
            local.append(le16(dosTime)); local.append(le16(dosDate))
            local.append(le32(0)); local.append(le32(0)); local.append(le32(0))
            local.append(le16(UInt16(name.count))); local.append(le16(0))
            local.append(name)
            try output.write(contentsOf: local)

            var crc = CRC32()
            var byteCount: UInt64 = 0
            func consume(_ data: Data) throws {
                try Task.checkCancellation()
                byteCount += UInt64(data.count)
                guard byteCount <= UInt64(UInt32.max) else { throw WriterError.zip32Limit }
                crc.update(data)
                try output.write(contentsOf: data)
            }
            switch entry.payload {
            case .data(let data):
                try consume(data)
            case .file(let source):
                let input = try FileHandle(forReadingFrom: source)
                defer { try? input.close() }
                while let chunk = try input.read(upToCount: 1_048_576), !chunk.isEmpty { try consume(chunk) }
            }
            let size = UInt32(byteCount)
            let checksum = crc.finalized
            var descriptor = Data()
            descriptor.append(le32(0x08074b50))
            descriptor.append(le32(checksum)); descriptor.append(le32(size)); descriptor.append(le32(size))
            try output.write(contentsOf: descriptor)

            // 中央目录
            central.append(le32(0x02014b50))
            central.append(le16(0x031E))
            central.append(le16(20))
            central.append(le16(flags))
            central.append(le16(0))
            central.append(le16(dosTime)); central.append(le16(dosDate))
            central.append(le32(checksum))
            central.append(le32(size)); central.append(le32(size))
            central.append(le16(UInt16(name.count)))
            central.append(le16(0)); central.append(le16(0))  // 扩展字段、注释长度
            central.append(le16(0)); central.append(le16(0))  // 磁盘号、内部属性
            central.append(le32(UInt32(0o100644) << 16))      // 外部属性：普通文件 rw-r--r--
            central.append(le32(offset))
            central.append(name)
            progress(index + 1, entries.count)
        }
        guard output.offsetInFile <= UInt64(UInt32.max), central.count <= Int(UInt32.max) else { throw WriterError.zip32Limit }
        let centralOffset = UInt32(output.offsetInFile)
        try output.write(contentsOf: central)
        var end = Data()
        end.append(le32(0x06054b50))
        end.append(le16(0)); end.append(le16(0))
        end.append(le16(UInt16(entries.count))); end.append(le16(UInt16(entries.count)))
        end.append(le32(UInt32(central.count)))
        end.append(le32(centralOffset))
        end.append(le16(0))
        try output.write(contentsOf: end)
        try output.synchronize()
        try output.close()
        if fm.fileExists(atPath: url.path) { try fm.removeItem(at: url) }
        try fm.moveItem(at: temporary, to: url)
    }

    fileprivate static let crcTable: [UInt32] = (0..<256).map { i -> UInt32 in
        var c = UInt32(i)
        for _ in 0..<8 { c = (c & 1) != 0 ? (0xEDB88320 ^ (c >> 1)) : (c >> 1) }
        return c
    }

    private static func le16(_ v: UInt16) -> Data { Data([UInt8(v & 0xff), UInt8(v >> 8)]) }
    private static func le32(_ v: UInt32) -> Data { Data([UInt8(v & 0xff), UInt8((v >> 8) & 0xff), UInt8((v >> 16) & 0xff), UInt8(v >> 24)]) }

    private static func dosDateTime(_ d: Date) -> (UInt16, UInt16) {
        let c = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: d)
        let time = UInt16((c.hour ?? 0) << 11 | (c.minute ?? 0) << 5 | ((c.second ?? 0) / 2))
        let date = UInt16(max((c.year ?? 1980) - 1980, 0) << 9 | (c.month ?? 1) << 5 | (c.day ?? 1))
        return (time, date)
    }
}

private struct CRC32 {
    private var value: UInt32 = 0xFFFFFFFF

    mutating func update(_ data: Data) {
        for byte in data { value = ZipWriter.crcTable[Int((value ^ UInt32(byte)) & 0xff)] ^ (value >> 8) }
    }

    var finalized: UInt32 { value ^ 0xFFFFFFFF }
}

/// 生成简单的 PDF（目录页、交办清单、示例文件），内容多时自动分页。
@MainActor
enum PDFWriter {
    struct Section {
        var heading: String
        var lines: [String]
        var alert: Bool
    }

    static let accent = NSColor(calibratedRed: 0.659, green: 0.075, blue: 0.169, alpha: 1)

    /// 旧接口：一段无标题的行。
    static func write(to url: URL, title: String, subtitle: String, lines: [String]) throws {
        try write(to: url, title: title, subtitle: subtitle, sections: [Section(heading: "", lines: lines, alert: false)], footer: nil)
    }

    static func write(to url: URL, title: String, subtitle: String, sections: [Section], footer: String?) throws {
        var box = CGRect(x: 0, y: 0, width: 595, height: 842) // A4
        guard let ctx = CGContext(url as CFURL, mediaBox: &box, nil) else { throw CocoaError(.fileWriteUnknown) }
        let titleAttr: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 24, weight: .bold), .foregroundColor: NSColor.black]
        let subAttr: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: accent]
        let headAttr: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 12, weight: .bold), .foregroundColor: NSColor.black]
        let headAlert: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 12, weight: .bold), .foregroundColor: accent]
        let bodyAttr: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.darkGray]
        let footAttr: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 10.5, weight: .semibold), .foregroundColor: accent]

        var y: CGFloat = 0
        func beginPage(first: Bool) {
            ctx.beginPDFPage(nil)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
            if first {
                accent.setFill()
                NSBezierPath(ovalIn: NSRect(x: 56, y: 760, width: 22, height: 22)).fill()
                NSAttributedString(string: title, attributes: titleAttr).draw(in: NSRect(x: 56, y: 680, width: 483, height: 64))
                NSAttributedString(string: subtitle, attributes: subAttr).draw(in: NSRect(x: 56, y: 640, width: 483, height: 36))
                y = 610
            } else {
                y = 780
            }
        }
        func endPage() {
            NSGraphicsContext.restoreGraphicsState()
            ctx.endPDFPage()
        }
        func ensure(_ h: CGFloat) {
            if y - h < 60 { endPage(); beginPage(first: false) }
        }

        beginPage(first: true)
        for s in sections {
            if !s.heading.isEmpty {
                ensure(36)
                y -= 10
                NSAttributedString(string: s.heading, attributes: s.alert ? headAlert : headAttr).draw(at: NSPoint(x: 56, y: y))
                y -= 22
            }
            for line in s.lines {
                ensure(20)
                NSAttributedString(string: line, attributes: bodyAttr).draw(in: NSRect(x: 56, y: y - 4, width: 483, height: 18))
                y -= 20
            }
        }
        if let footer {
            ensure(40)
            y -= 16
            NSAttributedString(string: footer, attributes: footAttr).draw(in: NSRect(x: 56, y: y - 4, width: 483, height: 32))
        }
        endPage()
        ctx.closePDF()
    }
}

/// 交办邮件与消息：用系统“邮件”起草，附上需要的文件。发出与否由用户回到 Charter 确认。
enum Mailer {
    @MainActor
    static func message(for o: Obligation) -> String {
        "\(o.company.name) 的「\(o.rule.name)」\(o.due.long)截止，麻烦跟进，办妥后把回执发我。"
    }

    @MainActor
    static func draft(to party: Party, obligation o: Obligation, store: AppStore, nudge: Bool = false) {
        draft(to: party, obligations: [o], store: store, nudge: nudge)
    }

    /// 一封邮件交办多件事项（合规日历的批量交办也用它）。
    @MainActor
    static func draft(to party: Party, obligations list: [Obligation], store: AppStore, nudge: Bool = false) {
        var attachments: [URL] = []
        for o in list {
            for tid in o.rule.requiredDocTypeIDs {
                if let d = store.ownedDocuments(of: NodeRef(kind: .company, id: o.company.id)).first(where: { $0.typeID == tid }) {
                    let u = store.fileURL(d)
                    if !attachments.contains(u) { attachments.append(u) }
                }
            }
        }
        let greeting = party.contactName.isEmpty ? "您好：" : "\(party.contactName)，您好："
        let lines = list.sorted { $0.due < $1.due }.enumerated().map { "\($0.offset + 1). \($0.element.company.name)：\($0.element.rule.name)，\($0.element.due.long)截止" }
        let intro: String
        if nudge {
            intro = list.count == 1 ? "想跟进之前交给您的事项，请问目前进展如何？" : "想跟进之前交给您的以下事项，请问目前进展如何？"
        } else {
            intro = list.count == 1 ? "麻烦协助办理以下事项：" : "麻烦协助办理以下 \(list.count) 件事项："
        }
        let body = """
        \(greeting)

        \(intro)
        \(lines.joined(separator: "\n"))
        \(attachments.isEmpty ? "" : "\n相关文件已附上。")
        办妥后请把回执或新文件发给我，谢谢。
        """
        guard let service = NSSharingService(named: .composeEmail) else { return }
        service.recipients = party.email.isEmpty ? [] : [party.email]
        if list.count == 1, let o = list.first {
            service.subject = (nudge ? "跟进：" : "") + "\(o.company.name)：\(o.rule.name)（\(o.due.short)截止）"
        } else {
            service.subject = (nudge ? "跟进：" : "") + "\(list.count) 件合规事项交办（最早 \(list.map(\.due).min()?.short ?? "") 截止）"
        }
        var items: [Any] = [body]
        items.append(contentsOf: attachments)
        service.perform(withItems: items)
    }

    /// 给不用邮件的部门：复制一段可以贴到企业微信、飞书、Slack 的消息。
    @MainActor
    static func copyMessage(obligation o: Obligation, nudge: Bool = false) {
        copyMessage(obligations: [o], nudge: nudge)
    }

    @MainActor
    static func copyMessage(obligations list: [Obligation], nudge: Bool = false) {
        let text: String
        if list.count == 1, let o = list.first {
            text = nudge ? "跟进：\(o.company.name) 的「\(o.rule.name)」\(o.due.long)截止，进展如何？办妥后把回执发我。" : message(for: o)
        } else {
            let lines = list.sorted { $0.due < $1.due }.enumerated().map { "\($0.offset + 1). \($0.element.company.name)：\($0.element.rule.name)，\($0.element.due.long)截止" }
            text = (nudge ? "想跟进以下事项的进展：\n" : "麻烦协助办理以下 \(list.count) 件事项，办妥后把回执发我：\n") + lines.joined(separator: "\n")
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    /// 请负责方补齐文件包里缺的文件。
    @MainActor
    static func requestMissing(_ missing: [String], company: Company, purpose: String, party: Party) {
        guard let service = NSSharingService(named: .composeEmail) else { return }
        let greeting = party.contactName.isEmpty ? "您好：" : "\(party.contactName)，您好："
        let body = """
        \(greeting)

        我们在准备 \(company.name) 的\(purpose)材料，还缺以下文件，麻烦协助提供：
        \(missing.enumerated().map { "\($0.offset + 1). \($0.element)" }.joined(separator: "\n"))

        谢谢。
        """
        service.recipients = party.email.isEmpty ? [] : [party.email]
        service.subject = "\(company.name)：\(purpose)材料还缺 \(missing.count) 项"
        service.perform(withItems: [body])
    }
}
