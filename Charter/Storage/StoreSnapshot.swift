import Foundation

/// Fully decode before publishing: a corrupt collection cannot partially replace
/// the live store or allow an empty array to overwrite the user's data.
struct StoreSnapshot {
    var library: TemplateLibrary
    var companies: [Company]
    var people: [Person]
    var holdings: [Holding]
    var appointments: [Appointment]
    var parties: [Party]
    var documents: [Document]
    var records: [ObligationRecord]
    var changes: [ChangeRecord]
    var groups: [CorporateGroup]?
    var settings: SharedSettings
    var modified: [String: Date]

    static func read(from folder: FolderStore, collections: [String]) throws -> StoreSnapshot {
        try folder.prepare()
        let snapshot = try StoreSnapshot(
            library: folder.loadTemplates(),
            companies: folder.load("companies", [Company].self) ?? [],
            people: folder.load("people", [Person].self) ?? [],
            holdings: folder.load("holdings", [Holding].self) ?? [],
            appointments: folder.load("appointments", [Appointment].self) ?? [],
            parties: folder.load("parties", [Party].self) ?? [],
            documents: folder.load("documents", [Document].self) ?? [],
            records: folder.load("obligations", [ObligationRecord].self) ?? [],
            changes: folder.load("changes", [ChangeRecord].self) ?? [],
            groups: folder.load("groups", [CorporateGroup].self),
            settings: folder.load("settings", SharedSettings.self) ?? SharedSettings(),
            modified: Dictionary(uniqueKeysWithValues: collections.compactMap { name in
                folder.modificationDate(name).map { (name, $0) }
            }))
        return snapshot
    }
}
