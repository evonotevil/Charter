import Foundation
import Vision
import PDFKit
import AppKit
#if canImport(FoundationModels)
import FoundationModels
#endif

/// 识别结果：文件类型、所属公司、日期。全部在本机完成。
struct Recognition: Hashable {
    var text: String = ""
    var typeID: String?
    var companyID: String?
    var companyNameGuess: String?
    var jurisdiction: String?
    var registrationNumber: String?
    var incorporationDate: Day?
    var issueDate: Day?
    var expiryDate: Day?
    var usedModel = false
}

/// 识别时需要的上下文（从 AppStore 复制出来，便于在后台线程使用）。
struct RecognitionContext: Sendable {
    struct TypeInfo: Sendable { var id: String; var name: String; var localNames: [String]; var hints: [String]; var jurisdictions: [String] }
    struct CompanyInfo: Sendable { var id: String; var names: [String]; var jurisdiction: String }
    var types: [TypeInfo]
    var companies: [CompanyInfo]
    var jurisdictionCodes: [String]
    var today: Day
}

enum Recognizer {

    static func recognize(file url: URL, context: RecognitionContext) async -> Recognition {
        let text = await Task.detached(priority: .userInitiated) { Recognizer.extractText(url) }.value
        var r = heuristic(text: text, fileName: url.deletingPathExtension().lastPathComponent, context: context)
        r.text = text
        #if canImport(FoundationModels)
        if let m = await modelGuess(text: text, fileName: url.lastPathComponent, context: context) {
            r.usedModel = true
            if let t = m.typeID, context.types.contains(where: { $0.id == t }) { r.typeID = t }
            if let n = m.companyName, !n.isEmpty {
                r.companyNameGuess = n
                if let c = matchCompany(n, context: context) { r.companyID = c }
            }
            if let j = m.jurisdiction, context.jurisdictionCodes.contains(j) { r.jurisdiction = j }
            r.issueDate = m.issueDate ?? r.issueDate
            r.expiryDate = m.expiryDate ?? r.expiryDate
            r.registrationNumber = m.registrationNumber ?? r.registrationNumber
            r.incorporationDate = m.incorporationDate ?? r.incorporationDate
        }
        #endif
        return r
    }

    // MARK: 文字提取

    static func extractText(_ url: URL) -> String {
        let ext = url.pathExtension.lowercased()
        if ext == "pdf", let pdf = PDFDocument(url: url) {
            var out = ""
            let pages = min(pdf.pageCount, 4)
            for i in 0..<pages {
                guard let page = pdf.page(at: i) else { continue }
                let s = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if s.count > 40 {
                    out += s + "\n"
                } else {
                    let img = page.thumbnail(of: NSSize(width: 1700, height: 2200), for: .mediaBox)
                    if let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) { out += ocr(cg) + "\n" }
                }
            }
            return out
        }
        if let img = NSImage(contentsOf: url), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) {
            return ocr(cg)
        }
        return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }

    static func ocr(_ image: CGImage) -> String {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US", "ja-JP", "ko-KR"]
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        do { try handler.perform([request]) } catch { return "" }
        let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        return lines.joined(separator: "\n")
    }

    // MARK: 关键词规则（没有端侧模型时也能用）

    static func heuristic(text: String, fileName: String, context: RecognitionContext) -> Recognition {
        var r = Recognition()
        let hay = (fileName + "\n" + text).lowercased()

        var best: (String, Int)?
        for t in context.types {
            var score = 0
            for k in t.localNames + t.hints + [t.name] where !k.isEmpty {
                if hay.contains(k.lowercased()) { score += k.count > 6 ? 3 : 2 }
            }
            if score > 0, score > (best?.1 ?? 0) { best = (t.id, score) }
        }
        r.typeID = best?.0

        var bestCompany: (String, Int)?
        for c in context.companies {
            for n in c.names where n.count >= 3 {
                if hay.contains(n.lowercased()), n.count > (bestCompany?.1 ?? 0) { bestCompany = (c.id, n.count) }
            }
        }
        r.companyID = bestCompany?.0
        if let cid = r.companyID { r.jurisdiction = context.companies.first { $0.id == cid }?.jurisdiction }

        let dates = findDates(in: text)
        let issueWords = ["date of issue", "issued", "dated", "签发", "簽發", "发出日期", "發出日期", "発行", "証明する", "this day", "발급", "date:"]
        let expiryWords = ["expiry", "expires", "expiration", "valid until", "有效期至", "届满", "屆滿", "到期", "有効期限", "만료"]
        r.issueDate = dateNear(issueWords, in: text, dates: dates) ?? dates.filter { $0.day <= context.today }.map(\.day).max()
        r.expiryDate = dateNear(expiryWords, in: text, dates: dates)
        if r.expiryDate == r.issueDate { r.expiryDate = nil }
        return r
    }

    static func matchCompany(_ name: String, context: RecognitionContext) -> String? {
        let n = name.lowercased()
        return context.companies.first { c in
            c.names.contains { let m = $0.lowercased(); return m.count >= 3 && (n.contains(m) || m.contains(n)) }
        }?.id
    }

    struct FoundDate { var day: Day; var offset: Int }

    static func findDates(in text: String) -> [FoundDate] {
        var out: [FoundDate] = []
        let ns = text as NSString
        func add(_ d: Day?, _ loc: Int) { if let d, d.year > 1950, d.year < 2100 { out.append(FoundDate(day: d, offset: loc)) } }

        let months = ["jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12]
        let patterns: [(String, (NSTextCheckingResult) -> Day?)] = [
            (#"(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})"#, { m in
                guard let y = Int(ns.substring(with: m.range(at: 1))), let mo = Int(ns.substring(with: m.range(at: 2))), let d = Int(ns.substring(with: m.range(at: 3))), (1...12).contains(mo) else { return nil }
                return Day(y, mo, d) }),
            (#"令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日"#, { m in
                let yy = ns.substring(with: m.range(at: 1))
                guard let mo = Int(ns.substring(with: m.range(at: 2))), let d = Int(ns.substring(with: m.range(at: 3))) else { return nil }
                return Day(2018 + (yy == "元" ? 1 : (Int(yy) ?? 1)), mo, d) }),
            (#"(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?([A-Za-z]{3,9})[,]?\s+(\d{4})"#, { m in
                guard let d = Int(ns.substring(with: m.range(at: 1))), let mo = months[String(ns.substring(with: m.range(at: 2)).lowercased().prefix(3))], let y = Int(ns.substring(with: m.range(at: 3))) else { return nil }
                return Day(y, mo, d) }),
            (#"([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})"#, { m in
                guard let mo = months[String(ns.substring(with: m.range(at: 1)).lowercased().prefix(3))], let d = Int(ns.substring(with: m.range(at: 2))), let y = Int(ns.substring(with: m.range(at: 3))) else { return nil }
                return Day(y, mo, d) })
        ]
        for (p, make) in patterns {
            guard let re = try? NSRegularExpression(pattern: p) else { continue }
            for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) { add(make(m), m.range.location) }
        }
        return out.sorted { $0.offset < $1.offset }
    }

    static func dateNear(_ words: [String], in text: String, dates: [FoundDate]) -> Day? {
        let lower = text.lowercased() as NSString
        var best: (Day, Int)?
        for w in words {
            var search = NSRange(location: 0, length: lower.length)
            while true {
                let r = lower.range(of: w, options: [], range: search)
                if r.location == NSNotFound { break }
                for d in dates where d.offset >= r.location && d.offset - r.location < 80 {
                    let dist = d.offset - r.location
                    if dist < (best?.1 ?? .max) { best = (d.day, dist) }
                }
                let next = r.location + r.length
                search = NSRange(location: next, length: lower.length - next)
            }
        }
        return best?.0
    }

    // MARK: 端侧模型

    struct ModelGuess {
        var typeID: String?
        var companyName: String?
        var jurisdiction: String?
        var registrationNumber: String?
        var incorporationDate: Day?
        var issueDate: Day?
        var expiryDate: Day?
    }

    static func modelGuess(text: String, fileName: String, context: RecognitionContext) async -> ModelGuess? {
        #if canImport(FoundationModels)
        guard case .available = SystemLanguageModel.default.availability else { return nil }
        let types = context.types.map { "\($0.id)：\($0.name)（\($0.localNames.prefix(3).joined(separator: "、"))）" }.joined(separator: "\n")
        let names = context.companies.map { $0.names.first ?? "" }.joined(separator: "；")
        let instructions = """
        你负责识别公司文件。只输出一个 JSON 对象，不要输出别的内容。字段：
        typeID（必须是给定列表中的编号，无法判断时为 null），companyName（文件上的公司名称原文），
        jurisdiction（HK、SG、VG、KY、VI、JP、KR 之一或 null），registrationNumber，
        incorporationDate、issueDate、expiryDate（格式 yyyy-MM-dd，没有则为 null）。
        """
        let prompt = """
        文件类型列表：
        \(types)

        已有公司：\(names)

        文件名：\(fileName)
        文件内容（节选）：
        \(String(text.prefix(2200)))
        """
        do {
            let session = LanguageModelSession(instructions: instructions)
            let response = try await session.respond(to: prompt)
            return parse(response.content)
        } catch {
            return nil
        }
        #else
        return nil
        #endif
    }

    static func parse(_ s: String) -> ModelGuess? {
        guard let a = s.firstIndex(of: "{"), let b = s.lastIndex(of: "}"), a < b,
              let data = String(s[a...b]).data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        func str(_ k: String) -> String? {
            guard let v = obj[k] as? String else { return nil }
            let t = v.trimmingCharacters(in: .whitespaces)
            return t.isEmpty || t.lowercased() == "null" ? nil : t
        }
        return ModelGuess(typeID: str("typeID"), companyName: str("companyName"), jurisdiction: str("jurisdiction"),
                          registrationNumber: str("registrationNumber"),
                          incorporationDate: str("incorporationDate").flatMap(Day.init(string:)),
                          issueDate: str("issueDate").flatMap(Day.init(string:)),
                          expiryDate: str("expiryDate").flatMap(Day.init(string:)))
    }
}

extension AppStore {
    var recognitionContext: RecognitionContext {
        RecognitionContext(
            types: library.documentTypes.map { RecognitionContext.TypeInfo(id: $0.id, name: $0.name, localNames: $0.localNames, hints: $0.hints, jurisdictions: $0.jurisdictions) },
            companies: companies.map { RecognitionContext.CompanyInfo(id: $0.id, names: [$0.name] + $0.formerNames + $0.aliases, jurisdiction: $0.jurisdiction) },
            jurisdictionCodes: library.jurisdictions.map(\.code),
            today: today)
    }
}
