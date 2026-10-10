import Foundation

struct ArchiveRequest {
    var url: URL
    var typeID: String
    var owner: NodeRef
    var issued: Day?
    var expiry: Day?
    var form: String = "扫描件"
    var note: String = ""
}

extension AppStore {
    /// Copy on the storage queue; publish and persist once for the complete batch.
    /// A failed copy or metadata write keeps the previous archive and removes only
    /// files created by this operation. The confirmation UI remains available.
    func archiveBatch(_ requests: [ArchiveRequest], newCompanies: [Company] = []) async throws -> [Document] {
        guard !loadFailed, !isLoading, !isImporting else { throw ArchiveError.unavailable }
        guard !requests.isEmpty else { return [] }
        isImporting = true
        defer { isImporting = false }
        let folder = store
        let day = today
        let proposedCompanies = companies + newCompanies.filter { candidate in !companies.contains { $0.id == candidate.id } }
        let companyNames = Dictionary(uniqueKeysWithValues: proposedCompanies.map { ($0.id, $0.name) })
        let personNames = Dictionary(uniqueKeysWithValues: people.map { ($0.id, $0.name) })
        let types = Dictionary(uniqueKeysWithValues: library.documentTypes.map { ($0.id, $0) })
        for request in requests {
            guard let type = types[request.typeID], type.owner == request.owner.kind,
                  (request.owner.kind == .company ? companyNames[request.owner.id] : personNames[request.owner.id]) != nil else {
                throw ArchiveError.invalidTarget
            }
        }
        let copies = try await StorageWorker.perform {
            var copies: [Document] = []
            do {
                for request in requests {
                    let access = request.url.startAccessingSecurityScopedResource()
                    defer { if access { request.url.stopAccessingSecurityScopedResource() } }
                    let name = request.owner.kind == .company ? companyNames[request.owner.id]! : personNames[request.owner.id]!
                    let path = try folder.archive(file: request.url, ownerName: name, owner: request.owner,
                                                  typeName: types[request.typeID]!.name, issued: request.issued)
                    var document = Document(typeID: request.typeID, owner: request.owner, issueDate: request.issued,
                                            expiryDate: request.expiry, form: request.form, filePath: path,
                                            originalFileName: request.url.lastPathComponent, addedOn: day)
                    document.notes = request.note
                    copies.append(document)
                }
                return copies
            } catch {
                for document in copies { try? FileManager.default.removeItem(at: folder.absoluteURL(for: document.filePath)) }
                throw error
            }
        }
        do {
            let next = copies.reduce(documents) { DocumentVersions.inserting($1, into: $0) }
            let names = Self.collections
            let modified = try await StorageWorker.perform {
                var writes = [("documents", try FolderStore.encoder.encode(next))]
                if !newCompanies.isEmpty { writes.append(("companies", try FolderStore.encoder.encode(proposedCompanies))) }
                try folder.saveCollections(writes)
                return Dictionary(uniqueKeysWithValues: names.compactMap { name in folder.modificationDate(name).map { (name, $0) } })
            }
            // UI is locked during the commit; a folder switch is rejected too.
            documents = next
            companies = proposedCompanies
            recordModifications(modified)
            refreshDerived()
            return copies.compactMap { copy in next.first { $0.id == copy.id } }
        } catch {
            if let failure = error as? CollectionSaveError, !failure.rollbackFailures.isEmpty {
                // Metadata may still reference these copies; retain them for recovery.
                protectAfterWriteFailure()
            } else {
                try? await StorageWorker.perform {
                    for document in copies { try FileManager.default.removeItem(at: folder.absoluteURL(for: document.filePath)) }
                }
            }
            throw error
        }
    }
}

enum ArchiveError: LocalizedError {
    case unavailable, invalidTarget
    var errorDescription: String? {
        switch self {
        case .unavailable: "数据正在读取、归档或处于保护状态，请完成或修复后再试。"
        case .invalidTarget: "材料类别与归属不匹配，请重新选择公司或人员及材料类别。"
        }
    }
}
