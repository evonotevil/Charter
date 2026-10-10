import Foundation
import AppKit

extension Notification.Name {
    /// 清空全部数据后发出，窗口据此重置选中状态。
    static let charterDataCleared = Notification.Name("CharterDataCleared")
}

// MARK: - 清空数据

extension AppStore {

    /// 清空时会移除的内容数量。
    struct ClearSummary {
        var companies: Int
        var groups: Int
        var people: Int
        var appointments: Int
        var holdings: Int
        var documents: Int
        var parties: Int
        var records: Int
        var changes: Int

        var lines: [String] {
            [("公司", companies, "家"), ("集团", groups, "个"), ("人员", people, "人"), ("任职记录", appointments, "条"),
             ("持股记录", holdings, "条"), ("文件（记录和已归档的文件本身）", documents, "份"), ("负责方", parties, "个"),
             ("合规事项和交办记录", records, "条"), ("变更记录", changes, "条")]
                .map { "\($0.0)：\($0.1) \($0.2)" }
        }
    }

    var clearSummary: ClearSummary {
        ClearSummary(companies: companies.count, groups: corporateGroups.count, people: people.count,
                     appointments: appointments.count, holdings: holdings.count, documents: documents.count,
                     parties: parties.count, records: records.count, changes: changes.count)
    }

    /// 清空公司、集团、人员、关系、文件（含数据文件夹里的归档文件）、负责方和事项记录。
    /// 设置和模板库（法域、档案条目、规则、用途）保留。
    func clearAllData() {
        guard !isImporting else { errorMessage = "文件正在归档，请完成后再清空数据。"; return }
        guard !loadFailed, !isLoading else {
            errorMessage = "数据还没有正常载入，暂不能清空。请检查数据文件夹后重新载入。"
            return
        }
        let fileURLs = documents.map { fileURL($0) }
        do {
            let e = FolderStore.encoder
            try persistCollections([
                ("companies", e.encode([Company]())),
                ("people", e.encode([Person]())),
                ("holdings", e.encode([Holding]())),
                ("appointments", e.encode([Appointment]())),
                ("parties", e.encode([Party]())),
                ("documents", e.encode([Document]())),
                ("obligations", e.encode([ObligationRecord]())),
                ("changes", e.encode([ChangeRecord]())),
                ("groups", e.encode([CorporateGroup]())),
            ])
        } catch {
            errorMessage = "清空失败，数据没有改动：\(error.localizedDescription)。请确认数据文件夹可写入后重试。"
            return
        }
        companies = []
        people = []
        holdings = []
        appointments = []
        parties = []
        documents = []
        records = []
        changes = []
        corporateGroups = []
        refreshDerived()

        // 记录写入成功后再删除归档文件，并清理留下的空文件夹。
        let fm = FileManager.default
        var failed = 0
        var folders = Set<URL>()
        for url in fileURLs {
            folders.insert(url.deletingLastPathComponent().standardizedFileURL)
            if fm.fileExists(atPath: url.path) {
                do { try fm.removeItem(at: url) } catch { failed += 1 }
            }
        }
        let filesRoot = store.filesDir.standardizedFileURL
        for folder in folders.sorted(by: { $0.path.count > $1.path.count }) {
            var dir = folder
            while dir.path.hasPrefix(filesRoot.path + "/"),
                  let items = try? fm.contentsOfDirectory(atPath: dir.path),
                  items.allSatisfy({ $0 == ".DS_Store" }) {
                try? fm.removeItem(at: dir)
                dir = dir.deletingLastPathComponent()
            }
        }
        NotificationCenter.default.post(name: .charterDataCleared, object: nil)
        if failed > 0 {
            errorMessage = "数据已清空，但有 \(failed) 个归档文件没能删除。可以在访达中打开数据文件夹的“文件”目录手动删除。"
        } else {
            showToast("已清空所有数据。设置和模板库已保留。")
        }
    }
}

// MARK: - 批量移除文件记录

extension AppStore {

    /// 从 Charter 移除多份文件的记录（数据文件夹里的文件本身保留），一次写入。
    func removeDocuments(_ ids: Set<String>) {
        guard !ids.isEmpty else { return }
        var next = documents.filter { !ids.contains($0.id) }
        for i in next.indices where next[i].supersededBy.map({ ids.contains($0) }) == true {
            next[i].supersededBy = nil
        }
        do {
            try persistCollections([("documents", FolderStore.encoder.encode(next))])
        } catch {
            errorMessage = "移除失败，档案没有改动：\(error.localizedDescription)"
            return
        }
        let removed = documents.count - next.count
        documents = next
        refreshDerived()
        showToast("已从 Charter 移除 \(removed) 份文件的记录，文件夹里的文件仍保留。")
    }
}

// MARK: - 删除负责方

extension AppStore {

    /// 指向某个负责方的引用数量。
    struct PartyReferences {
        var defaultCompanies: Int
        var ruleAssignments: Int
        var records: Int
        var isEmpty: Bool { defaultCompanies == 0 && ruleAssignments == 0 && records == 0 }

        var lines: [String] {
            var out: [String] = []
            if defaultCompanies > 0 { out.append("\(defaultCompanies) 家公司的默认负责方将改为未指定") }
            if ruleAssignments > 0 { out.append("\(ruleAssignments) 条按规则指定的负责方将改为跟随公司默认") }
            if records > 0 { out.append("\(records) 条事项记录将改为未指定负责方，交办历史保留") }
            return out
        }
    }

    func references(toParty id: String) -> PartyReferences {
        PartyReferences(
            defaultCompanies: companies.filter { $0.defaultPartyID == id }.count,
            ruleAssignments: companies.reduce(0) { $0 + $1.rulePartyIDs.values.filter { $0 == id }.count },
            records: records.filter { $0.partyID == id }.count)
    }

    /// 删除负责方，并把公司默认负责方、按规则指定和事项记录里的引用清空。一次写入。
    func delete(party p: Party) {
        var nextParties = parties
        nextParties.removeAll { $0.id == p.id }
        var nextCompanies = companies
        for i in nextCompanies.indices {
            if nextCompanies[i].defaultPartyID == p.id { nextCompanies[i].defaultPartyID = nil }
            nextCompanies[i].rulePartyIDs = nextCompanies[i].rulePartyIDs.filter { $0.value != p.id }
        }
        var nextRecords = records
        for i in nextRecords.indices where nextRecords[i].partyID == p.id { nextRecords[i].partyID = nil }
        do {
            let e = FolderStore.encoder
            try persistCollections([
                ("parties", e.encode(nextParties)),
                ("companies", e.encode(nextCompanies)),
                ("obligations", e.encode(nextRecords)),
            ])
        } catch {
            errorMessage = "删除负责方失败，数据没有改动：\(error.localizedDescription)"
            return
        }
        parties = nextParties
        companies = nextCompanies
        records = nextRecords
        refreshDerived()
        showToast("已删除负责方“\(p.name)”。")
    }
}

// MARK: - 导出、导入配置

/// 可在两套数据文件夹之间搬运的配置：设置（不含主 Mac 和数据文件夹位置）+ 模板库。
struct ConfigBundle: Codable {
    struct Settings: Codable {
        var reminderDays: [Int]
        var notificationHour: Int
        var calendarEnabled: Bool
        var calendarName: String
        var complianceEnabled: Bool?
    }

    static let currentVersion = 1

    var version: Int
    var exportedAt: Date
    var settings: Settings
    var library: TemplateLibrary

    static var encoder: JSONEncoder {
        let e = FolderStore.encoder
        e.dateEncodingStrategy = .iso8601
        return e
    }

    static var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }
}

enum ConfigImportError: LocalizedError {
    case unreadable(String)
    case newerVersion(Int)
    case empty

    var errorDescription: String? {
        switch self {
        case .unreadable(let detail):
            "这个文件不是 Charter 导出的配置，或者已经损坏。请选择用“导出配置…”生成的 JSON 文件。（\(detail)）"
        case .newerVersion(let v):
            "这份配置来自更新版本的 Charter（格式版本 \(v)）。请先把这台 Mac 上的 Charter 升级到最新版本再导入。"
        case .empty:
            "这份配置里没有法域和文件类型，导入后会让档案无法显示。请重新导出一份完整的配置。"
        }
    }
}

extension AppStore {

    enum ConfigImportMode: Hashable { case merge, replace }

    var configBundle: ConfigBundle {
        ConfigBundle(version: ConfigBundle.currentVersion, exportedAt: Date(),
                     settings: .init(reminderDays: settings.reminderDays, notificationHour: settings.notificationHour,
                                     calendarEnabled: settings.calendarEnabled, calendarName: settings.calendarName,
                                     complianceEnabled: settings.complianceEnabled),
                     library: library)
    }

    func exportConfig(to url: URL) {
        do {
            let data = try ConfigBundle.encoder.encode(configBundle)
            try data.write(to: url, options: .atomic)
            showToast("配置已导出：\(url.lastPathComponent)")
        } catch {
            errorMessage = "导出配置失败：\(error.localizedDescription)。请换一个可写入的位置再试。"
        }
    }

    static func readConfig(at url: URL) throws -> ConfigBundle {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let data: Data
        do { data = try Data(contentsOf: url) } catch { throw ConfigImportError.unreadable(error.localizedDescription) }
        let bundle: ConfigBundle
        do { bundle = try ConfigBundle.decoder.decode(ConfigBundle.self, from: data) }
        catch { throw ConfigImportError.unreadable(error.localizedDescription) }
        guard bundle.version <= ConfigBundle.currentVersion else { throw ConfigImportError.newerVersion(bundle.version) }
        guard !bundle.library.jurisdictions.isEmpty, !bundle.library.documentTypes.isEmpty else { throw ConfigImportError.empty }
        return bundle
    }

    /// 导入前给用户看的变化摘要。
    func configImportSummary(_ b: ConfigBundle, mode: ConfigImportMode) -> [String] {
        func describe<T>(_ name: String, _ incoming: [T], _ current: [T], key: (T) -> String) -> String {
            let have = Set(current.map(key))
            let overlap = incoming.filter { have.contains(key($0)) }.count
            switch mode {
            case .merge:
                return "\(name)：新增 \(incoming.count - overlap) 个，覆盖同名 \(overlap) 个"
            case .replace:
                return "\(name)：替换为 \(incoming.count) 个（现有 \(current.count) 个）"
            }
        }
        var lines = [
            describe("法域", b.library.jurisdictions, library.jurisdictions) { $0.code },
            describe("文件类型", b.library.documentTypes, library.documentTypes) { $0.id },
            describe("规则", b.library.rules, library.rules) { $0.id },
            describe("用途", b.library.packets, library.packets) { $0.id },
            "档案条目：\(b.library.archiveItems?.count ?? 0) 个法域的条目清单",
            "设置：到期前 \(b.settings.reminderDays.sorted(by: >).map(String.init).joined(separator: "、")) 天提醒，每天 \(b.settings.notificationHour):00",
        ]
        if mode == .replace {
            let kept = keptOnReplace(b)
            if kept.jurisdictions + kept.types > 0 {
                lines.append("仍被公司或文件使用的 \(kept.jurisdictions) 个法域、\(kept.types) 个文件类型会保留")
            }
        }
        return lines
    }

    /// 全部替换时，仍被现有公司或文件引用、但配置里没有的法域和文件类型。
    private func keptOnReplace(_ b: ConfigBundle) -> (jurisdictions: Int, types: Int, jurisdictionList: [Jurisdiction], typeList: [DocumentType]) {
        let usedCodes = Set(companies.map(\.jurisdiction))
        let usedTypes = Set(documents.map(\.typeID))
        let incomingCodes = Set(b.library.jurisdictions.map(\.code))
        let incomingTypes = Set(b.library.documentTypes.map(\.id))
        let js = library.jurisdictions.filter { usedCodes.contains($0.code) && !incomingCodes.contains($0.code) }
        let ts = library.documentTypes.filter { usedTypes.contains($0.id) && !incomingTypes.contains($0.id) }
        return (js.count, ts.count, js, ts)
    }

    func applyConfig(_ b: ConfigBundle, mode: ConfigImportMode) {
        guard !loadFailed, !isLoading else {
            errorMessage = "数据还没有正常载入，暂不能导入配置。请检查数据文件夹后重新载入。"
            return
        }
        errorMessage = nil
        var lib = library
        switch mode {
        case .replace:
            let kept = keptOnReplace(b)
            lib.jurisdictions = b.library.jurisdictions + kept.jurisdictionList
            lib.documentTypes = b.library.documentTypes + kept.typeList
            lib.rules = b.library.rules
            lib.packets = b.library.packets
            lib.archiveItems = b.library.archiveItems
        case .merge:
            lib.jurisdictions = Self.merged(lib.jurisdictions, b.library.jurisdictions) { $0.code }
            lib.documentTypes = Self.merged(lib.documentTypes, b.library.documentTypes) { $0.id }
            lib.rules = Self.merged(lib.rules, b.library.rules) { $0.id }
            lib.packets = Self.merged(lib.packets, b.library.packets) { $0.id }
            if let incoming = b.library.archiveItems {
                var items = lib.archiveItems ?? [:]
                items.merge(incoming) { _, new in new }
                lib.archiveItems = items
            }
        }
        lib.version = max(library.version, b.library.version)
        library = lib
        saveLibrary()

        settings.reminderDays = b.settings.reminderDays.isEmpty ? settings.reminderDays : b.settings.reminderDays
        settings.notificationHour = b.settings.notificationHour
        settings.calendarEnabled = b.settings.calendarEnabled
        settings.calendarName = b.settings.calendarName
        settings.complianceEnabled = b.settings.complianceEnabled
        saveSettings()
        if errorMessage == nil { showToast(mode == .merge ? "配置已合并导入。" : "配置已全部替换。") }
    }

    /// 按 key 合并：同 key 用新值覆盖（保留原位置），新的追加到末尾。
    private static func merged<T>(_ current: [T], _ incoming: [T], key: (T) -> String) -> [T] {
        var out = current
        var index: [String: Int] = [:]
        for (i, item) in out.enumerated() { index[key(item)] = i }
        for item in incoming {
            if let i = index[key(item)] { out[i] = item } else { index[key(item)] = out.count; out.append(item) }
        }
        return out
    }
}
