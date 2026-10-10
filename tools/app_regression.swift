import Foundation

/// Compile with -D CHARTER_REGRESSION and the app sources. Every write uses a
/// temporary data root and an isolated defaults suite, never the user's archive.
@main
struct AppRegression {
    @MainActor
    static func main() async throws {
        let fm = FileManager.default
        let project = URL(fileURLWithPath: fm.currentDirectoryPath)
        let root = fm.temporaryDirectory.appendingPathComponent("charter-app-regression-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: root) }
        let suite = "charter.regression.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let folder = FolderStore(root: root)
        try folder.prepare()
        let resource = project.appendingPathComponent("Charter/Resources/charter-templates.json")
        let library = try FolderStore.decoder.decode(TemplateLibrary.self, from: Data(contentsOf: resource))
        try folder.saveTemplates(library)
        let s = AppStore(root: root, preferences: defaults, enablesSideEffects: false)
        await s.waitForLoad()
        precondition(!s.loadFailed && !s.isLoading)
        s.today = Day(2026, 10, 10)
        let c = Company(name: "Regression Ltd.", jurisdiction: "KY", trackingSince: s.today)
        s.companies = [c]; s.saveCompanies()
        let owner = NodeRef(kind: .company, id: c.id)
        let type = library.documentTypes.first { $0.owner == .company }!
        let source = root.appendingPathComponent("source.pdf")
        try Data("regression fixture".utf8).write(to: source)
        func request(_ url: URL, _ issued: Day?) -> ArchiveRequest {
            ArchiveRequest(url: url, typeID: type.id, owner: owner, issued: issued, expiry: nil)
        }
        func check(_ condition: @autoclosure () throws -> Bool) throws {
            let result = try condition(); precondition(result)
        }
        func fileCount() throws -> Int {
            let paths = fm.enumerator(at: folder.filesDir, includingPropertiesForKeys: [.isRegularFileKey])!
            return try paths.compactMap { $0 as? URL }.filter { try $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true }.count
        }

        // Cancel is side-effect free; explicitly confirming commits once.
        let stageDir = root.appendingPathComponent("stage")
        try fm.createDirectory(at: stageDir, withIntermediateDirectories: true)
        let stagedURL = stageDir.appendingPathComponent("cancel.pdf")
        try fm.copyItem(at: source, to: stagedURL)
        s.staged["cancel"] = StagedFile(id: "cancel", url: stagedURL, originalName: "cancel.pdf", recognition: Recognition())
        s.discardStaged("cancel")
        precondition(s.documents.isEmpty && !fm.fileExists(atPath: stagedURL.path))
        try check(try fileCount() == 0)

        let confirmDir = root.appendingPathComponent("confirm-stage")
        try fm.createDirectory(at: confirmDir, withIntermediateDirectories: true)
        let confirmURL = confirmDir.appendingPathComponent("confirm.pdf")
        try fm.copyItem(at: source, to: confirmURL)
        var callbackFired = false
        s.staged["confirm"] = StagedFile(id: "confirm", url: confirmURL, originalName: "confirm.pdf",
                                         recognition: Recognition(), onArchived: { _ in callbackFired = true })
        _ = try await s.commitStaged("confirm", typeID: type.id, owner: owner, issued: Day(2024, 1, 1), expiry: nil, form: "扫描件")
        precondition(callbackFired && s.staged.isEmpty && s.documents.count == 1)
        do {
            _ = try await s.commitStaged("confirm", typeID: type.id, owner: owner, issued: nil, expiry: nil, form: "扫描件")
            preconditionFailure("Confirmation must not commit twice")
        } catch {}

        let new = try await s.archiveBatch([request(source, Day(2026, 9, 1))]).first!
        let older = try await s.archiveBatch([request(source, Day(2025, 9, 1))]).first!
        precondition(older.supersededBy == new.id)
        precondition(s.documents.filter { $0.supersededBy == nil }.map(\.id) == [new.id])
        let latest = try await s.archiveBatch([request(source, Day(2026, 10, 1))]).first!
        precondition(s.documents.first { $0.id == new.id }?.supersededBy == latest.id)
        precondition(s.documents.filter { $0.supersededBy == nil }.count == 1)

        let before = s.documents
        let beforeFiles = try fileCount()
        do {
            _ = try await s.archiveBatch([request(source, nil), request(root.appendingPathComponent("missing.pdf"), nil)])
            preconditionFailure("Missing source must fail the entire batch")
        } catch {}
        precondition(s.documents == before && !s.isImporting)
        try check(try fileCount() == beforeFiles)

        // A metadata read/write failure must leave the archive and copies intact.
        let savedDocuments = try Data(contentsOf: folder.url("documents"))
        try fm.removeItem(at: folder.url("documents"))
        try fm.createDirectory(at: folder.url("documents"), withIntermediateDirectories: true)
        do { _ = try await s.archiveBatch([request(source, nil)]); preconditionFailure("Invalid metadata target must fail") }
        catch {}
        precondition(s.documents == before)
        try check(try fileCount() == beforeFiles)
        try fm.removeItem(at: folder.url("documents"))
        try savedDocuments.write(to: folder.url("documents"))

        // Fail the second write after the first succeeds; restore the first file.
        let originalCompanies = try Data(contentsOf: folder.url("companies"))
        do {
            try folder.saveCollections([("companies", Data("[]".utf8)), ("nonexistent/subcollection", Data("[]".utf8))])
            preconditionFailure("Second collection must fail")
        } catch let error as CollectionSaveError { precondition(error.rollbackFailures.isEmpty) }
        try check(try Data(contentsOf: folder.url("companies")) == originalCompanies)

        // Two director changes on the same day leave only the latest active.
        let a = Person(name: "A"), b = Person(name: "B"), d = Person(name: "C")
        s.people = [a, b, d]; s.savePeople()
        let oldAppointment = Appointment(personID: a.id, companyID: c.id, title: "董事", from: Day(2020, 1, 1))
        s.appointments = [oldAppointment]; s.saveAppointments()
        var change = ChangePlan(companyID: c.id, effectiveOn: s.today)
        change.endingAppointmentIDs = [oldAppointment.id]
        let second = Appointment(personID: b.id, companyID: c.id, title: "董事")
        change.newAppointments = [second]
        try await s.apply(change)
        precondition(s.directors(of: c.id).map(\.id) == [b.id])
        change.endingAppointmentIDs = [second.id]
        change.newAppointments = [Appointment(personID: d.id, companyID: c.id, title: "董事")]
        try await s.apply(change)
        precondition(s.directors(of: c.id).map(\.id) == [d.id])

        let currentDocIndex = s.documents.firstIndex { $0.supersededBy == nil }!
        let typeIndex = s.library.documentTypes.firstIndex { $0.id == type.id }!
        s.library.documentTypes[typeIndex].validity = .monthsAfterIssue
        s.library.documentTypes[typeIndex].validityMonths = 6
        s.documents[currentDocIndex].issueDate = nil
        let packet = PacketTemplate(id: "test", name: "KYC", categories: [type.category], includeDirectorsPassports: false, maxAgeMonths: 3)
        let item = Packager.items(for: packet, company: s.companies[0], store: s).first!
        precondition(!item.included && item.problem?.contains("未注明签发日期") == true)
        precondition(Freshness.expiryLabel(of: s.documents[currentDocIndex], type: s.library.documentTypes[typeIndex]) == "待核对")
        var invalid = ChangePlan(companyID: c.id, effectiveOn: s.today)
        invalid.newHoldings = [Holding(holder: NodeRef(kind: .person, id: a.id), companyID: c.id, percent: 150)]
        let priorChanges = s.changes
        do { try await s.apply(invalid); preconditionFailure("Out-of-range percentage must fail") } catch {}
        precondition(s.changes == priorChanges && !s.isImporting)

        let nominee = NodeRef(kind: .person, id: "nominee")
        let unresolved = [Holding(holder: nominee, companyID: c.id, percent: 30, isNominee: true)]
        precondition(Ownership.ultimateOwners(of: c.id, holdings: unresolved, on: s.today).isEmpty)
        let breakdown = Chains.breakdown(of: c.id, holdings: unresolved, on: s.today)
        precondition(breakdown.owners.isEmpty && abs(breakdown.unknown - 100) < 0.001 && breakdown.unresolvedNominees.count == 1)
        let changeCount = s.changes.count
        s.companies[0].notes = "later edit"
        s.toast?.undo?()
        precondition(s.changes.count == changeCount && s.companies[0].notes == "later edit")
        precondition(s.errorMessage?.contains("此后已有") == true)
        s.saveCompanies()

        // Bulk commit persists once and keeps only one current version.
        let start = ContinuousClock.now
        _ = try await s.archiveBatch((0..<200).map { _ in request(source, s.today) })
        precondition(s.documents.count == before.count + 200)
        precondition(s.documents.filter { $0.supersededBy == nil }.count == 1)
        print("200-file batch:", start.duration(to: .now))
        s.load(); await s.waitForLoad()
        precondition(!s.loadFailed && s.documents.count == before.count + 200)
        precondition(s.directors(of: c.id).map(\.id) == [d.id])

        let exported = try await ArchiveExporter.export(company: s.companies[0], store: s, includeOld: true) { done, total in
            precondition(done <= total)
        }
        let unzip = Process(), output = Pipe()
        unzip.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        unzip.arguments = ["-Z1", exported.path]
        unzip.standardOutput = output
        try unzip.run()
        let listing = output.fileHandleForReading.readDataToEndOfFile()
        unzip.waitUntilExit()
        let paths = String(decoding: listing, as: UTF8.self).split(separator: "\n")
        precondition(unzip.terminationStatus == 0 && paths.count == s.documents.count + 3)
        precondition(Set(paths).count == paths.count, "Same-date old versions must have unique ZIP paths")

        // Metadata edits must retain the form's source record on invalid combinations.
        let originalDocuments = s.documents
        var edited = s.documents.first { $0.supersededBy == nil }!
        edited.owner = NodeRef(kind: .person, id: a.id)
        do { try s.updateDocument(edited); preconditionFailure("Company type cannot belong to person") }
        catch DocumentUpdateError.ownerTypeMismatch {}
        precondition(s.documents == originalDocuments)
        edited.owner = owner
        let originalTypes = s.library.documentTypes
        var restrictedType = s.library.documentTypes[typeIndex]
        restrictedType.id = "regression.jp-only"
        restrictedType.jurisdictions = ["JP"]
        s.library.documentTypes.append(restrictedType)
        edited.typeID = restrictedType.id
        do { try s.updateDocument(edited); preconditionFailure("Wrong jurisdiction must fail") }
        catch DocumentUpdateError.jurisdictionMismatch {}
        precondition(s.documents == originalDocuments)
        s.library.documentTypes = originalTypes

        edited = originalDocuments.first { $0.supersededBy == nil }!
        var duplicate = edited
        duplicate.id = "regression-duplicate"
        s.documents.append(duplicate)
        do { try s.updateDocument(edited); preconditionFailure("Duplicate current version must fail") }
        catch DocumentUpdateError.duplicateCurrent {}
        precondition(s.documents == originalDocuments + [duplicate])
        s.documents = originalDocuments
        let onDiskDocuments = try Data(contentsOf: folder.url("documents"))
        try fm.removeItem(at: folder.url("documents"))
        try fm.createDirectory(at: folder.url("documents"), withIntermediateDirectories: true)
        edited.notes = "must not publish on failure"
        do { try s.updateDocument(edited); preconditionFailure("Metadata write failure must preserve memory") }
        catch {}
        precondition(s.documents == originalDocuments)
        try fm.removeItem(at: folder.url("documents"))
        try onDiskDocuments.write(to: folder.url("documents"))
        edited.notes = "validated metadata"
        try s.updateDocument(edited)
        let savedEdits = try folder.load("documents", [Document].self)!
        precondition(savedEdits.contains { $0.id == edited.id && $0.notes == edited.notes })

        // Gap reasons survive package preparation; not-applicable does not silently waive a packet requirement.
        let currentID = edited.id
        s.documents = []
        for mark in [ItemMark.external, .restricted, .notApplicable, .unverified] {
            s.companies[0].archive = CompanyArchive(added: [type.id], marks: [type.id: mark], notes: [type.id: "代理保管，需先确认"])
            let missing = Packager.items(for: packet, company: s.companies[0], store: s).first!
            precondition(!missing.included && missing.problem?.contains(mark.label) == true)
            precondition(missing.problem?.contains("代理保管") == true)
        }
        s.companies[0].archive = nil
        s.documents = originalDocuments.map { $0.id == currentID ? edited : $0 }

        // Cyclic ownership is not mistaken for a known ultimate company owner.
        let cycleHoldings = [Holding(holder: NodeRef(kind: .company, id: "cycle-b"), companyID: "cycle-a", percent: 100),
                             Holding(holder: NodeRef(kind: .company, id: "cycle-a"), companyID: "cycle-b", percent: 100)]
        let cyclic = Chains.breakdown(of: "cycle-a", holdings: cycleHoldings, on: s.today)
        precondition(cyclic.owners.isEmpty && abs(cyclic.unknown - 100) < 0.001 && !cyclic.cyclicCompanyIDs.isEmpty)
        precondition(Ownership.ultimateOwners(of: "cycle-a", holdings: cycleHoldings, on: s.today).isEmpty)

        // Direct structure edits use the same percentage validation as the change wizard.
        let oldHoldings = s.holdings
        s.holdings = [Holding(holder: NodeRef(kind: .person, id: a.id), companyID: c.id, percent: 60)]
        let holdingSnapshot = s.holdings
        precondition(!s.addHolding(holder: NodeRef(kind: .person, id: b.id), companyID: c.id,
                                  percent: 50, nominee: false, beneficialOwner: nil, from: s.today))
        precondition(s.holdings == holdingSnapshot && s.errorMessage?.contains("超过 100%") == true)
        s.holdings = oldHoldings

        // A corrupt collection keeps the last complete state and blocks writes.
        let savedCompanies = s.companies
        try Data("broken-json".utf8).write(to: folder.url("companies"))
        s.load(); await s.waitForLoad()
        precondition(s.loadFailed && s.companies == savedCompanies && !s.isLoading)
        s.saveCompanies()
        try check(try Data(contentsOf: folder.url("companies")) == Data("broken-json".utf8))

        // Optionally prepare a separate visual-review fixture; no real data read.
        if CommandLine.arguments.count > 1 {
            let fixture = FolderStore(root: URL(fileURLWithPath: CommandLine.arguments[1]))
            try fixture.prepare(); try fixture.saveTemplates(library)
            let demo = AppStore(root: fixture.root, preferences: defaults, enablesSideEffects: false)
            await demo.waitForLoad()
            SampleData.install(into: demo)
            precondition(!demo.loadFailed && demo.companies.count == 12)
            print("Review fixture:", fixture.root.path)
        }
        print("App regressions passed: explicit confirmation, cancel, versions, copy/write failures, rollback, same-day directors, safe undo, bulk, export history, reload protection, KYC dates, unresolved nominees, document metadata validation, package gap reasons, cyclic ownership, direct holding validation.")
    }
}
