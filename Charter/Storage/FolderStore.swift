import Foundation

/// 所有数据都是数据文件夹里的普通文件：
///
///     Charter/
///       数据/companies.json, people.json, holdings.json, appointments.json,
///            parties.json, documents.json, obligations.json, changes.json, settings.json
///       模板/templates.json            ← 文件类型库、规则、文件包，可直接编辑
///       文件/<公司注册名>/<公司名_类型_签发日>.pdf
///       文件/人员/<姓名>/...
///       文件包/
///
/// 放在 iCloud Drive 里就能在两台 Mac 之间同步，不需要开发者账号。
struct FolderStore {
    let root: URL

    var dataDir: URL { root.appendingPathComponent("数据", isDirectory: true) }
    var templateDir: URL { root.appendingPathComponent("模板", isDirectory: true) }
    var filesDir: URL { root.appendingPathComponent("文件", isDirectory: true) }
    var packetsDir: URL { root.appendingPathComponent("文件包", isDirectory: true) }
    var templatesFile: URL { templateDir.appendingPathComponent("templates.json") }

    static var defaultRoot: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let icloud = home.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
        if FileManager.default.fileExists(atPath: icloud.path) {
            return icloud.appendingPathComponent("Charter", isDirectory: true)
        }
        return home.appendingPathComponent("Documents/Charter", isDirectory: true)
    }

    var isInICloud: Bool { root.path.contains("Mobile Documents") }

    func prepare() throws {
        for d in [root, dataDir, templateDir, filesDir, packetsDir] {
            try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        }
    }

    // MARK: JSON

    static var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return e
    }
    static var decoder: JSONDecoder { JSONDecoder() }

    func url(_ name: String) -> URL { dataDir.appendingPathComponent(name + ".json") }

    func load<T: Decodable>(_ name: String, _ type: T.Type) throws -> T? {
        let u = url(name)
        guard FileManager.default.fileExists(atPath: u.path) else { return nil }
        let data = try coordinatedRead(u)
        return try FolderStore.decoder.decode(T.self, from: data)
    }

    func save<T: Encodable>(_ value: T, as name: String) throws {
        let data = try FolderStore.encoder.encode(value)
        try coordinatedWrite(data, to: url(name))
    }

    /// Compensating transaction for a small set of related collections. Read all
    /// originals before writing; report a failed rollback rather than hiding it.
    func saveCollections(_ writes: [(String, Data)]) throws {
        let originals = try writes.map { name, _ -> (String, Data?) in
            let source = url(name)
            return (name, FileManager.default.fileExists(atPath: source.path) ? try coordinatedRead(source) : nil)
        }
        var attempted = 0
        do {
            for (name, data) in writes {
                attempted += 1
                try coordinatedWrite(data, to: url(name))
            }
        } catch {
            var failures: [String] = []
            for (name, data) in originals.prefix(attempted).reversed() {
                do {
                    if let data { try coordinatedWrite(data, to: url(name)) }
                    else if FileManager.default.fileExists(atPath: url(name).path) { try FileManager.default.removeItem(at: url(name)) }
                } catch { failures.append("\(name)：\(error.localizedDescription)") }
            }
            throw CollectionSaveError(cause: error, rollbackFailures: failures)
        }
    }

    func modificationDate(_ name: String) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: url(name).path))?[.modificationDate] as? Date
    }

    // MARK: Templates

    func loadTemplates() throws -> TemplateLibrary {
        if FileManager.default.fileExists(atPath: templatesFile.path) {
            let data = try coordinatedRead(templatesFile)
            var lib = try FolderStore.decoder.decode(TemplateLibrary.self, from: data)
            if let bundled = try? FolderStore.bundledTemplates(), bundled.version > lib.version {
                lib = FolderStore.migrate(lib, to: bundled)
                try saveTemplates(lib)
            }
            return lib
        }
        let lib = try FolderStore.bundledTemplates()
        try saveTemplates(lib)
        return lib
    }

    func saveTemplates(_ lib: TemplateLibrary) throws {
        try coordinatedWrite(try FolderStore.encoder.encode(lib), to: templatesFile)
    }

    /// 模板升级：补上新内置项；用户没改过名字的内置文件类型，换成新名字。不动用户改过的内容。
    static func migrate(_ old: TemplateLibrary, to new: TemplateLibrary) -> TemplateLibrary {
        var lib = old
        let renamed: [String: String] = ["在职证明": "董事在职证明"]
        for t in new.documentTypes {
            if let i = lib.documentTypes.firstIndex(where: { $0.id == t.id }) {
                if lib.documentTypes[i].builtIn, let to = renamed[lib.documentTypes[i].name], to == t.name {
                    lib.documentTypes[i].name = t.name
                    lib.documentTypes[i].localNames = t.localNames
                }
            } else {
                lib.documentTypes.append(t)
            }
        }
        for j in new.jurisdictions where !lib.jurisdictions.contains(where: { $0.code == j.code }) { lib.jurisdictions.append(j) }
        for r in new.rules where !lib.rules.contains(where: { $0.id == r.id }) { lib.rules.append(r) }
        for p in new.packets where !lib.packets.contains(where: { $0.id == p.id }) { lib.packets.append(p) }
        lib.version = new.version
        return lib
    }

    static func bundledTemplates() throws -> TemplateLibrary {
        guard let u = Bundle.main.url(forResource: "charter-templates", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try decoder.decode(TemplateLibrary.self, from: Data(contentsOf: u))
    }

    // MARK: Files

    func absoluteURL(for relativePath: String) -> URL { root.appendingPathComponent(relativePath) }

    func folder(for owner: NodeRef, name: String) -> URL {
        switch owner.kind {
        case .company: return filesDir.appendingPathComponent(FolderStore.safe(name), isDirectory: true)
        case .person: return filesDir.appendingPathComponent("人员", isDirectory: true).appendingPathComponent(FolderStore.safe(name), isDirectory: true)
        }
    }

    /// 把一个外部文件复制进数据文件夹，按“公司名_类型_签发日”命名，返回相对路径。
    func archive(file source: URL, ownerName: String, owner: NodeRef, typeName: String, issued: Day?) throws -> String {
        let dir = folder(for: owner, name: ownerName)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let ext = source.pathExtension.isEmpty ? "pdf" : source.pathExtension.lowercased()
        let base = FolderStore.safe([ownerName, typeName, issued?.description ?? "未注明日期"].joined(separator: "_"))
        var target = dir.appendingPathComponent(base).appendingPathExtension(ext)
        var n = 2
        while FileManager.default.fileExists(atPath: target.path) {
            target = dir.appendingPathComponent("\(base) (\(n))").appendingPathExtension(ext)
            n += 1
        }
        try FileManager.default.copyItem(at: source, to: target)
        return relativePath(of: target)
    }

    func relativePath(of url: URL) -> String {
        let r = root.standardizedFileURL.path
        let p = url.standardizedFileURL.path
        return p.hasPrefix(r + "/") ? String(p.dropFirst(r.count + 1)) : p
    }

    static func safe(_ s: String) -> String {
        let bad = CharacterSet(charactersIn: "/\\:?%*|\"<>")
        return s.components(separatedBy: bad).joined(separator: "-").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Coordination（让 iCloud 同步时不读到写了一半的文件）

    private func coordinatedRead(_ u: URL) throws -> Data {
        var result: Result<Data, Error> = .failure(CocoaError(.fileReadUnknown))
        var err: NSError?
        NSFileCoordinator().coordinate(readingItemAt: u, options: [], error: &err) { url in
            result = Result { try Data(contentsOf: url) }
        }
        if let err { throw err }
        return try result.get()
    }

    private func coordinatedWrite(_ data: Data, to u: URL) throws {
        var result: Result<Void, Error> = .success(())
        var err: NSError?
        NSFileCoordinator().coordinate(writingItemAt: u, options: .forReplacing, error: &err) { url in
            result = Result { try data.write(to: url, options: .atomic) }
        }
        if let err { throw err }
        try result.get()
    }
}

struct CollectionSaveError: LocalizedError {
    var cause: Error
    var rollbackFailures: [String]
    var errorDescription: String? {
        cause.localizedDescription + (rollbackFailures.isEmpty ? "（原档案已恢复）" : "；部分档案无法恢复，请停止编辑并检查数据文件夹：" + rollbackFailures.joined(separator: "；"))
    }
}
