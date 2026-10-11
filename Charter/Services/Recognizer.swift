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
    /// 识别依据（简短中文说明），按重要性排列。
    var evidence: [String] = []
    /// 把握程度 0–1。
    var confidence: Double = 0
    /// 类型来自文件内容中的关键词（而不只是文件名）。
    var typeFromContent = false
    /// 经过文字识别（OCR）。
    var usedOCR = false

    /// 需要人看一眼：把握不足，或公司、类型没认出来。
    var needsReview: Bool { confidence < 0.8 || companyID == nil || typeID == nil }
}

/// 提取到的文字：按页分开，并记下是否用了 OCR。
struct ExtractedText: Sendable {
    var pages: [String]
    var usedOCR: Bool
    var text: String { pages.joined(separator: "\n") }
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
        let extracted = await Task.detached(priority: .userInitiated) { Recognizer.extract(url) }.value
        let text = extracted.text
        var r = heuristic(pages: extracted.pages, fileName: url.deletingPathExtension().lastPathComponent, context: context)
        r.text = text
        r.usedOCR = extracted.usedOCR
        let heuristicType = r.typeID
        var modelAgrees = false
        var modelDisagrees = false
        #if canImport(FoundationModels)
        if let m = await modelGuess(text: text, fileName: url.lastPathComponent, context: context) {
            r.usedModel = true
            if let t = m.typeID, context.types.contains(where: { $0.id == t }) {
                if heuristicType == t { modelAgrees = true } else if heuristicType != nil { modelDisagrees = true }
                r.typeID = t
            }
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
        if modelAgrees { r.evidence.append("Apple 智能判断一致") }
        if modelDisagrees { r.evidence.append("Apple 智能的判断与关键词不同") }
        if r.usedOCR { r.evidence.append("扫描件，经文字识别（OCR）") }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { r.evidence.append("没有读到文字") }
        r.confidence = confidence(r, textLength: trimmed.count, modelAgrees: modelAgrees, modelDisagrees: modelDisagrees)
        return r
    }

    /// 由各项信号估算把握程度。
    static func confidence(_ r: Recognition, textLength: Int, modelAgrees: Bool, modelDisagrees: Bool) -> Double {
        var c = 0.35
        if r.typeID != nil { c += r.typeFromContent ? 0.3 : 0.12 }
        if r.companyID != nil { c += 0.25 }
        if modelAgrees { c += 0.15 }
        if modelDisagrees { c -= 0.1 }
        if r.usedOCR { c -= 0.1 }
        if textLength == 0 { c -= 0.2 } else if textLength < 80 { c -= 0.12 }
        return min(max(c, 0), 1)
    }

    // MARK: 文字提取

    /// 旧接口：只要文字。
    static func extractText(_ url: URL) -> String { extract(url).text }

    static func extract(_ url: URL) -> ExtractedText {
        let ext = url.pathExtension.lowercased()
        if ext == "pdf", let pdf = PDFDocument(url: url) {
            var pages: [String] = []
            var usedOCR = false
            let count = min(pdf.pageCount, 4)
            for i in 0..<count {
                guard let page = pdf.page(at: i) else { pages.append(""); continue }
                let s = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if s.count > 40 {
                    pages.append(s)
                } else {
                    let img = page.thumbnail(of: NSSize(width: 1700, height: 2200), for: .mediaBox)
                    if let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) {
                        pages.append(ocr(cg)); usedOCR = true
                    } else {
                        pages.append(s)
                    }
                }
            }
            return ExtractedText(pages: pages, usedOCR: usedOCR)
        }
        if let img = NSImage(contentsOf: url), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) {
            return ExtractedText(pages: [ocr(cg)], usedOCR: true)
        }
        return ExtractedText(pages: [(try? String(contentsOf: url, encoding: .utf8)) ?? ""], usedOCR: false)
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
        heuristic(pages: [text], fileName: fileName, context: context)
    }

    static func heuristic(pages: [String], fileName: String, context: RecognitionContext) -> Recognition {
        var r = Recognition()
        let text = pages.joined(separator: "\n")
        let lowerPages = pages.map { $0.lowercased() }
        let lowerName = fileName.lowercased()
        let hay = (fileName + "\n" + text).lowercased()

        // 类型：按关键词计分，并记下最能说明问题的关键词出现在哪一页
        var best: (id: String, score: Int, keyword: String?, page: Int?)?
        for t in context.types {
            var score = 0
            var bestKey: (String, Int?)?
            for k in t.localNames + t.hints + [t.name] where !k.isEmpty {
                let lk = k.lowercased()
                guard hay.contains(lk) else { continue }
                score += k.count > 6 ? 3 : 2
                let page = lowerPages.firstIndex { $0.contains(lk) }
                if let cur = bestKey {
                    // 优先：出现在正文里的、较长的关键词
                    let curScore = (cur.1 != nil ? 1000 : 0) + cur.0.count
                    let newScore = (page != nil ? 1000 : 0) + k.count
                    if newScore > curScore { bestKey = (k, page) }
                } else {
                    bestKey = (k, page)
                }
            }
            if score > 0, score > (best?.score ?? 0) { best = (t.id, score, bestKey?.0, bestKey?.1) }
        }
        r.typeID = best?.id
        if let best, let key = best.keyword {
            if let page = best.page {
                r.typeFromContent = true
                let head = String(lowerPages[page].prefix(300))
                let place = head.contains(key.lowercased()) ? "标题" : "正文"
                r.evidence.append("第 \(page + 1) 页\(place)含“\(key)”")
            } else if lowerName.contains(key.lowercased()) {
                r.evidence.append("从文件名推断（含“\(key)”）")
            }
        } else {
            r.evidence.append("未能判断文件类型")
        }

        var bestCompany: (String, Int, String)?
        for c in context.companies {
            for n in c.names where n.count >= 3 {
                if hay.contains(n.lowercased()), n.count > (bestCompany?.1 ?? 0) { bestCompany = (c.id, n.count, n) }
            }
        }
        r.companyID = bestCompany?.0
        if let cid = r.companyID {
            r.jurisdiction = context.companies.first { $0.id == cid }?.jurisdiction
            if let n = bestCompany?.2 { r.evidence.append("公司名称“\(n)”") }
        } else if let guess = companyNameGuess(in: text) {
            r.companyNameGuess = guess
            r.evidence.append("文件上的公司名称“\(guess)”，档案中还没有")
        }

        if let no = registrationNumber(in: text) {
            r.registrationNumber = no
            r.evidence.append("编号 \(no)")
        }

        let dates = findDates(in: text)
        let issueWords = ["date of issue", "issued", "dated", "签发", "簽發", "发出日期", "發出日期", "発行", "証明する", "this day", "발급", "date:"]
        let expiryWords = ["expiry", "expires", "expiration", "valid until", "有效期至", "届满", "屆滿", "到期", "有効期限", "만료"]
        r.issueDate = dateNear(issueWords, in: text, dates: dates) ?? dates.filter { $0.day <= context.today }.map(\.day).max()
        r.expiryDate = dateNear(expiryWords, in: text, dates: dates)
        if r.expiryDate == r.issueDate { r.expiryDate = nil }
        return r
    }

    /// 文件上看起来像公司名称的第一行（含 Limited、Ltd、Inc、有限公司等）。
    static func companyNameGuess(in text: String) -> String? {
        let suffixes = ["limited", "ltd", "inc.", "incorporated", "corporation", "corp.", "pte", "llc", "有限公司", "株式会社", "주식회사"]
        for raw in text.split(whereSeparator: \.isNewline).prefix(80) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard line.count >= 4, line.count <= 80 else { continue }
            let l = line.lowercased()
            guard suffixes.contains(where: { l.contains($0) }) else { continue }
            // 跳过句子（如 “... is a limited company”）
            if l.hasPrefix("this ") || l.hasPrefix("i ") || l.contains(" is ") || l.contains(" was ") { continue }
            return line
        }
        return nil
    }

    /// 注册编号、证书编号等。
    static func registrationNumber(in text: String) -> String? {
        let pattern = #"(?i)(?:company\s+(?:no|number)|registration\s+(?:no|number)|certificate\s+(?:no|number)|incorporation\s+(?:no|number)|registered\s+no|编号|編號|登记号码|登記號碼|公司编号|公司編號)\.?\s*[:：.]?\s*([A-Z0-9][A-Z0-9-]{3,19})"#
        guard let re = try? NSRegularExpression(pattern: pattern) else { return nil }
        let ns = text as NSString
        guard let m = re.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)), m.numberOfRanges > 1 else { return nil }
        let v = ns.substring(with: m.range(at: 1))
        return v.contains(where: \.isNumber) ? v : nil
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
