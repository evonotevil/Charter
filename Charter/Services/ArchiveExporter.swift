import Foundation

/// 一键导出一家公司的全部现行材料：文件 + 目录（PDF、Excel）+ 公司资料摘要。
@MainActor
enum ArchiveExporter {

    struct Plan {
        var included: [ArchiveItem]
        var excluded: [ArchiveItem]
        var oldVersions: Int
    }

    static func plan(for c: Company, store: AppStore) -> Plan {
        let items = store.archive(of: c)
        let ref = NodeRef(kind: .company, id: c.id)
        let old = store.documents.filter { $0.owner == ref && $0.supersededBy != nil }.count
        return Plan(included: items.filter { $0.document != nil }, excluded: items.filter { $0.document == nil }, oldVersions: old)
    }

    static func export(
        company c: Company,
        store: AppStore,
        includeOld: Bool,
        progress: @escaping @Sendable (Int, Int) -> Void
    ) async throws -> URL {
        let p = plan(for: c, store: store)
        let folder = store.store
        let day = store.today
        let stamp = day.description.replacingOccurrences(of: "-", with: "")
        let base = FolderStore.safe("\(c.name)_全部材料_\(stamp)")
        var entries: [ExportEntry] = []
        var rows: [[String]] = [["序号", "条目", "状态", "签发日期", "到期日期", "文件名", "备注"]]
        var includedLines: [String] = []

        for (i, item) in p.included.enumerated() {
            guard let d = item.document else { continue }
            let num = String(format: "%02d", i + 1)
            let src = store.fileURL(d)
            let ext = src.pathExtension.isEmpty ? "pdf" : src.pathExtension.lowercased()
            let name = FolderStore.safe("\(num) \(item.name)\(d.issueDate.map { "_\($0.description)" } ?? "")") + "." + ext
            entries.append(ExportEntry(path: "\(base)/\(name)", payload: .file(src)))
            let expiry = Freshness.expiry(of: d, type: item.type)
            let note = d.notes.isEmpty ? item.note : d.notes
            rows.append([num, item.name, item.state.label, d.issueDate?.description ?? "", Freshness.expiryLabel(of: d, type: item.type), name, note])
            var line = "\(num)  \(item.name)"
            if let i = d.issueDate { line += "，签发 \(i.description)" }
            if let e = expiry { line += "，到期 \(e.description)" }
            if item.state.needsAttention { line += "〔\(item.state.label)〕" }
            if !note.isEmpty { line += "（\(note)）" }
            includedLines.append(line)
        }

        if includeOld {
            let ref = NodeRef(kind: .company, id: c.id)
            for (i, d) in store.documents.filter({ $0.owner == ref && $0.supersededBy != nil }).enumerated() {
                let src = store.fileURL(d)
                guard FileManager.default.fileExists(atPath: src.path) else { continue }
                let ext = src.pathExtension.isEmpty ? "pdf" : src.pathExtension.lowercased()
                let tname = store.docType(d.typeID)?.name ?? "文件"
                let name = FolderStore.safe("\(String(format: "%04d", i + 1)) \(tname)\(d.issueDate.map { "_\($0.description)" } ?? "")_旧版") + "." + ext
                entries.append(ExportEntry(path: "\(base)/旧版/\(name)", payload: .file(src)))
            }
        }

        var excludedLines: [String] = []
        var naLines: [String] = []
        for item in p.excluded {
            let line = "\(item.name)：\(item.state.label)\(item.note.isEmpty ? "" : "（\(item.note)）")"
            if item.state == .marked(.notApplicable) { naLines.append(line) } else { excludedLines.append(line) }
            rows.append(["", item.name, item.state.label, "", "", "", item.note])
        }

        // 目录 PDF
        let summary = store.companySummary(c)
        var sections: [PDFWriter.Section] = [PDFWriter.Section(heading: "已包含（\(includedLines.count) 份）", lines: includedLines, alert: false)]
        if !excludedLines.isEmpty {
            sections.append(PDFWriter.Section(heading: "未包含（\(excludedLines.count) 项）", lines: excludedLines, alert: true))
        }
        if !naLines.isEmpty {
            sections.append(PDFWriter.Section(heading: "不适用（\(naLines.count) 项）", lines: naLines, alert: false))
        }
        sections.append(PDFWriter.Section(heading: "公司资料摘要", lines: summary.components(separatedBy: "\n"), alert: false))
        let tocURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        defer { try? FileManager.default.removeItem(at: tocURL) }
        try PDFWriter.write(to: tocURL, title: c.name,
                            subtitle: "档案材料　\(store.today.long)　共 \(includedLines.count) 份" + (excludedLines.isEmpty ? "" : "，另有 \(excludedLines.count) 项未包含"),
                            sections: sections,
                            footer: excludedLines.isEmpty ? nil : "“未包含”的条目已在目录中注明原因（未取得、外部保管或尚未归档）。")
        entries.insert(ExportEntry(path: "\(base)/00 目录.pdf", payload: .file(tocURL)), at: 0)

        let frozenRows = rows
        let spreadsheet = try await StorageWorker.perform { try XLSXWriter.workbook(sheet: "目录", rows: frozenRows) }
        entries.insert(ExportEntry(path: "\(base)/00 目录.xlsx", payload: .data(spreadsheet)), at: 1)
        entries.insert(ExportEntry(path: "\(base)/00 公司资料摘要.txt", payload: .data(Data(summary.utf8))), at: 2)

        try FileManager.default.createDirectory(at: folder.packetsDir, withIntermediateDirectories: true)
        var zip = folder.packetsDir.appendingPathComponent(base + ".zip")
        var n = 2
        while FileManager.default.fileExists(atPath: zip.path) {
            zip = folder.packetsDir.appendingPathComponent("\(base) (\(n)).zip"); n += 1
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

/// 最小的 .xlsx：一个工作表，文字单元格（Excel、Numbers、WPS 都能打开）。
enum XLSXWriter {
    static func workbook(sheet: String, rows: [[String]]) throws -> Data {
        func esc(_ s: String) -> String {
            s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
        }
        func col(_ i: Int) -> String {
            var n = i, s = ""
            repeat { s = String(UnicodeScalar(65 + n % 26)!) + s; n = n / 26 - 1 } while n >= 0
            return s
        }
        var sheetXML = #"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="6" customWidth="1"/><col min="2" max="2" width="28" customWidth="1"/><col min="3" max="5" width="14" customWidth="1"/><col min="6" max="6" width="40" customWidth="1"/><col min="7" max="7" width="40" customWidth="1"/></cols><sheetData>"#
        for (r, row) in rows.enumerated() {
            sheetXML += "<row r=\"\(r + 1)\">"
            for (c, v) in row.enumerated() where !v.isEmpty {
                sheetXML += "<c r=\"\(col(c))\(r + 1)\" t=\"inlineStr\"><is><t xml:space=\"preserve\">\(esc(v))</t></is></c>"
            }
            sheetXML += "</row>"
        }
        sheetXML += "</sheetData></worksheet>"

        let parts: [(String, String)] = [
            ("[Content_Types].xml", #"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#),
            ("_rels/.rels", #"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#),
            ("xl/workbook.xml", #"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name=""# + esc(sheet) + #"" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
            ("xl/_rels/workbook.xml.rels", #"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
            ("xl/worksheets/sheet1.xml", sheetXML),
        ]
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".xlsx")
        defer { try? FileManager.default.removeItem(at: url) }
        try ZipWriter.write(entries: parts.map { ($0.0, Data($0.1.utf8)) }, to: url)
        return try Data(contentsOf: url)
    }
}
