import Foundation
import Observation
import AppKit

@MainActor
@Observable
final class AppStore {

    // MARK: 数据
    var companies: [Company] = [] { didSet { archiveCache.removeAll() } }
    var people: [Person] = []
    var holdings: [Holding] = []
    var appointments: [Appointment] = []
    var parties: [Party] = []
    var documents: [Document] = [] { didSet { archiveCache.removeAll() } }
    var records: [ObligationRecord] = []
    var changes: [ChangeRecord] = []
    var corporateGroups: [CorporateGroup] = []
    var settings = SharedSettings()
    var library = TemplateLibrary(version: 1, jurisdictions: [], documentTypes: [], rules: [], packets: []) { didSet { archiveCache.removeAll() } }

    // MARK: 派生
    private(set) var allObligations: [Obligation] = []
    private(set) var openObligations: [Obligation] = []
    var today: Day = .today() { didSet { archiveCache.removeAll() } }

    // MARK: 状态
    var errorMessage: String?
    var toast: Toast?
    /// 等待确认归档的文件（不写入档案）。
    var staged: [String: StagedFile] = [:]
    private(set) var store: FolderStore
    /// archive(of:) 的缓存；companies / documents / library / today 变化时清空。
    @ObservationIgnored var archiveCache: [String: [ArchiveItem]] = [:]
    @ObservationIgnored private var lastLoaded: [String: Date] = [:]
    /// 读取失败时禁止保存，免得用空数据覆盖文件夹里的真实数据。
    private(set) var loadFailed = false
    private(set) var isLoading = false
    var isImporting = false
    @ObservationIgnored private var sideEffectTask: Task<Void, Never>?
    @ObservationIgnored private var loadingTask: Task<Void, Never>?
    @ObservationIgnored private var loadGeneration = UUID()
    @ObservationIgnored private let preferences: UserDefaults
    @ObservationIgnored private let enablesSideEffects: Bool

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        var text: String
        var undo: (() -> Void)?
        static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
    }

    // MARK: 设备

    static let deviceIDKey = "deviceID"
    static let dataRootKey = "dataRoot"

    var deviceID: String {
        if let id = preferences.string(forKey: AppStore.deviceIDKey) { return id }
        let id = UUID().uuidString
        preferences.set(id, forKey: AppStore.deviceIDKey)
        return id
    }
    var deviceName: String { Host.current().localizedName ?? "这台 Mac" }
    var isPrimaryDevice: Bool { settings.primaryDeviceID == nil || settings.primaryDeviceID == deviceID }

    init(root: URL? = nil, preferences: UserDefaults = .standard, enablesSideEffects: Bool = true) {
        self.preferences = preferences
        self.enablesSideEffects = enablesSideEffects
        let path = preferences.string(forKey: AppStore.dataRootKey)
        store = FolderStore(root: root ?? path.map { URL(fileURLWithPath: $0, isDirectory: true) } ?? FolderStore.defaultRoot)
        load()
    }

    // MARK: 读写

    func changeDataRoot(to url: URL) {
        guard !isImporting else { errorMessage = "文件正在归档，请完成后再切换数据文件夹。"; return }
        preferences.set(url.path, forKey: AppStore.dataRootKey)
        store = FolderStore(root: url)
        load()
    }

    func load() {
        loadingTask?.cancel()
        sideEffectTask?.cancel()
        let generation = UUID()
        loadGeneration = generation
        let folder = store
        let collections = Self.collections
        isLoading = true
        loadFailed = true
        loadingTask = Task { [weak self] in
            do {
                let snapshot = try await StorageWorker.perform {
                    try StoreSnapshot.read(from: folder, collections: collections)
                }
                guard let self, !Task.isCancelled, self.loadGeneration == generation else { return }
                self.library = snapshot.library
                self.companies = snapshot.companies
                self.people = snapshot.people
                self.holdings = snapshot.holdings
                self.appointments = snapshot.appointments
                self.parties = snapshot.parties
                self.documents = snapshot.documents
                self.records = snapshot.records
                self.changes = snapshot.changes
                self.settings = snapshot.settings
                self.corporateGroups = snapshot.groups ?? Self.legacyGroups(companies: snapshot.companies, holdings: snapshot.holdings, today: self.today)
                self.lastLoaded = snapshot.modified
                self.loadFailed = false
                self.isLoading = false
                self.errorMessage = nil
                if self.settings.primaryDeviceID == nil {
                    self.settings.primaryDeviceID = self.deviceID
                    self.settings.primaryDeviceName = self.deviceName
                    self.persist(self.settings, "settings")
                }
                if snapshot.groups == nil, !self.corporateGroups.isEmpty { self.saveGroups() }
                self.refreshDerived()
            } catch {
                guard let self, !Task.isCancelled, self.loadGeneration == generation else { return }
                self.isLoading = false
                self.errorMessage = "读取数据失败，现有档案已保留并暂停保存。请检查数据文件夹是否可访问，修复后重新载入：\(error.localizedDescription)"
            }
        }
    }

    func waitForLoad() async { await loadingTask?.value }

    static let collections = ["companies", "people", "holdings", "appointments", "parties", "documents", "obligations", "changes", "settings", "groups"]

    /// 回到前台时检查另一台 Mac 是否改过数据。
    func reloadIfChangedElsewhere() {
        guard !isLoading, !isImporting else { return }
        today = .today()
        let changed = Self.collections.contains { store.modificationDate($0) != lastLoaded[$0] }
        if changed { load() } else { refreshDerived() }
    }

    func persist<T: Encodable>(_ value: T, _ name: String) {
        guard !loadFailed else {
            errorMessage = "数据读取曾失败，已暂停保存以免覆盖原文件。请检查数据文件夹后重新载入。"
            return
        }
        do {
            try store.save(value, as: name)
            lastLoaded[name] = store.modificationDate(name)
        } catch {
            errorMessage = "保存失败：\(error.localizedDescription)"
        }
    }

    func recordModifications(_ dates: [String: Date]) { lastLoaded = dates }
    func updateModifications(_ dates: [String: Date]) { lastLoaded.merge(dates) { _, new in new } }
    func protectAfterWriteFailure() { loadFailed = true }

    func persistCollections(_ writes: [(String, Data)]) throws {
        guard !loadFailed, !isLoading else { throw ArchiveError.unavailable }
        do { try store.saveCollections(writes) }
        catch {
            if let failure = error as? CollectionSaveError, !failure.rollbackFailures.isEmpty { loadFailed = true }
            throw error
        }
        for (name, _) in writes { lastLoaded[name] = store.modificationDate(name) }
    }

    func saveCompanies() { persist(companies, "companies"); refreshDerived() }
    func savePeople() { persist(people, "people") }
    func saveHoldings() { persist(holdings, "holdings") }
    func saveAppointments() { persist(appointments, "appointments") }
    func saveParties() { persist(parties, "parties") }
    func saveDocuments() { persist(documents, "documents"); refreshDerived() }
    func saveRecords() { persist(records, "obligations"); refreshDerived() }
    func saveChanges() { persist(changes, "changes"); refreshDerived() }
    func saveSettings() { persist(settings, "settings"); refreshDerived() }
    func saveGroups() { persist(corporateGroups, "groups") }
    func saveLibrary() {
        guard !loadFailed else { return }
        do { try store.saveTemplates(library) } catch { errorMessage = "保存模板失败：\(error.localizedDescription)" }
        refreshDerived()
    }

    func refreshDerived() {
        allObligations = DeadlineEngine.obligations(companies: companies, rules: library.rules, documents: documents,
                                                   records: records, changes: changes, today: today)
        openObligations = DeadlineEngine.open(allObligations)
        sideEffectTask?.cancel()
        sideEffectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            await self?.sideEffects()
        }
    }

    private func sideEffects() async {
        guard enablesSideEffects, isPrimaryDevice else { return }
        await Notifier.shared.reschedule(store: self)
        if settings.calendarEnabled && complianceOn { await CalendarSync.shared.sync(store: self) }
    }

    // MARK: 查询

    func company(_ id: String?) -> Company? { companies.first { $0.id == id } }
    func person(_ id: String?) -> Person? { people.first { $0.id == id } }
    func party(_ id: String?) -> Party? { parties.first { $0.id == id } }
    func docType(_ id: String?) -> DocumentType? { library.documentTypes.first { $0.id == id } }
    func jurisdiction(_ code: String) -> Jurisdiction? { library.jurisdictions.first { $0.code == code } }
    func jurisdictionName(_ code: String) -> String { jurisdiction(code)?.name ?? code }

    func name(of ref: NodeRef) -> String {
        switch ref.kind {
        case .company: company(ref.id)?.name ?? "未知公司"
        case .person: person(ref.id)?.name ?? "未知"
        }
    }

    func responsibleParty(for o: Obligation) -> Party? {
        party(o.record?.partyID ?? o.company.rulePartyIDs[o.rule.id] ?? o.company.defaultPartyID)
    }

    func freshness(_ d: Document) -> Freshness { Freshness.of(d, type: docType(d.typeID), today: today) }

    func ownedDocuments(of owner: NodeRef, includeSuperseded: Bool = false) -> [Document] {
        documents.filter { $0.owner == owner && (includeSuperseded || $0.supersededBy == nil) }
            .sorted { (freshness($0).sortRank, $0.addedOn) < (freshness($1).sortRank, $1.addedOn) }
    }

    /// 需要处理的文件：过期、快过期、标记需更新的。
    var documentsNeedingAttention: [Document] {
        documents.filter { $0.supersededBy == nil && freshness($0).needsAttention }
            .sorted { freshness($0).sortRank < freshness($1).sortRank }
    }

    func obligations(for companyID: String) -> [Obligation] { allObligations.filter { $0.company.id == companyID } }

    func directors(of companyID: String) -> [Person] {
        appointments.filter { $0.companyID == companyID && $0.isActive(on: today) && $0.title.contains("董事") }
            .compactMap { person($0.personID) }
    }


    // MARK: 规则可信度

    func trust(_ o: Obligation) -> RuleTrust { DeadlineEngine.trust(rule: o.rule, company: o.company, today: today) }

    func trust(ruleID: String, company: Company) -> RuleTrust {
        guard let r = library.rules.first(where: { $0.id == ruleID }) else { return .draft }
        return DeadlineEngine.trust(rule: r, company: company, today: today)
    }

    func verification(ruleID: String, company: Company?) -> RuleVerification? {
        if let c = company, let v = c.ruleOverrides?[ruleID]?.verification, v.status == .confirmed { return v }
        return library.rules.first { $0.id == ruleID }?.verification
    }

    func explain(_ o: Obligation) -> [String] {
        DeadlineEngine.explain(o, documents: documents) { [weak self] id in self?.docType(id)?.name ?? "文件" }
    }

    /// 记录规则核对结果。companyID 为空 = 该法域通用；否则只对这家公司生效（可带不同算法）。
    func confirmRule(ruleID: String, companyID: String?, verification: RuleVerification, schedule: Schedule?) {
        let word = verification.status == .confirmed ? "确认" : "改回待核对"
        if let cid = companyID, let i = companies.firstIndex(where: { $0.id == cid }) {
            var overrides = companies[i].ruleOverrides ?? [:]
            overrides[ruleID] = CompanyRuleOverride(schedule: schedule, verification: verification)
            companies[i].ruleOverrides = overrides
            saveCompanies()
            if let ri = library.rules.firstIndex(where: { $0.id == ruleID }) {
                appendRevision(ri, "\(companies[i].name) 单独\(word)\(schedule.map { "，算法改为“\($0.summary)”" } ?? "")（\(verification.confirmedBy)）")
                saveLibrary()
            }
        } else if let ri = library.rules.firstIndex(where: { $0.id == ruleID }) {
            library.rules[ri].verification = verification
            library.rules[ri].needsReview = verification.status != .confirmed
            appendRevision(ri, "通用规则\(word)（\(verification.confirmedBy)，\(verification.sourceKind)）")
            saveLibrary()
        }
        showToast(verification.status == .confirmed ? "已记录核对信息。" : "已改回待核对。")
    }

    /// 在设置里改规则：算法变了就记一笔，并把确认状态退回待核对。
    func updateRule(_ new: RuleTemplate) {
        guard let i = library.rules.firstIndex(where: { $0.id == new.id }) else { return }
        let old = library.rules[i]
        library.rules[i] = new
        if old.schedule != new.schedule || old.adjust != new.adjust {
            appendRevision(i, "算法由“\(old.schedule.summary)”改为“\(new.schedule.summary)”")
            if library.rules[i].verification?.status == .confirmed {
                library.rules[i].verification?.status = .draft
                library.rules[i].needsReview = true
            }
        }
        saveLibrary()
    }

    private func appendRevision(_ i: Int, _ summary: String) {
        var revs = library.rules[i].revisions ?? []
        // 同一天连续改同一条规则，只保留最后一笔
        if let last = revs.last, last.on == today, last.summary.hasPrefix("算法由"), summary.hasPrefix("算法由") {
            revs[revs.count - 1] = RuleRevision(on: today, summary: summary)
        } else {
            revs.append(RuleRevision(on: today, summary: summary))
        }
        library.rules[i].revisions = revs
    }

    // MARK: 事项操作

    private func upsertRecord(for o: Obligation, _ change: (inout ObligationRecord) -> Void) {
        var r = records.first(where: { $0.key == o.key }) ?? o.record ?? ObligationRecord(key: o.key, ruleID: o.rule.id, companyID: o.company.id, dueDate: o.originalDue)
        change(&r)
        if let i = records.firstIndex(where: { $0.key == r.key }) { records[i] = r } else { records.append(r) }
        saveRecords()
    }

    private func log(_ r: inout ObligationRecord, _ action: HandoffEntry.Action, party: String? = nil, channel: String? = nil) {
        r.log = (r.log ?? []) + [HandoffEntry(action: action, at: Date(), partyID: party ?? r.partyID, channel: channel)]
    }

    func complete(_ o: Obligation, receipt: Document? = nil) {
        let before = o.record
        upsertRecord(for: o) { r in
            r.status = .done
            r.completedOn = today
            if let receipt { r.receiptDocumentID = receipt.id }
            log(&r, .completed)
        }
        let next = openObligations.first { $0.rule.id == o.rule.id && $0.company.id == o.company.id }
        let tail = next.map { "下一次截止日 \($0.due.display(relativeTo: today)) 已排好。" } ?? ""
        showToast((receipt == nil ? "已完成。" : "已完成，回执已存档。") + tail) { [weak self] in self?.restore(o, to: before) }
    }

    func attachReceipt(_ doc: Document, to o: Obligation) {
        upsertRecord(for: o) { $0.receiptDocumentID = doc.id }
        showToast("回执已存档。")
    }

    /// 起草了邮件或复制了消息，但还没发出：状态变为“待发送”。
    func draft(_ os: [Obligation], to party: Party, channel: String) {
        let befores = os.map { ($0, $0.record) }
        for o in os {
            upsertRecord(for: o) { r in
                r.status = .drafted
                r.partyID = party.id
                r.draftedOn = today
                log(&r, channel == "邮件" ? .drafted : .copied, party: party.id, channel: channel)
            }
        }
        let what = channel == "邮件" ? "邮件草稿已在“邮件”里打开" : "消息已复制"
        let n = os.count > 1 ? " \(os.count) 件" : ""
        showToast("\(what)。发出后点“确认已发送”\(n)。") { [weak self] in
            for (o, r) in befores { self?.restore(o, to: r) }
        }
    }

    /// 确认已经发给负责方：状态变为“已交办”，开始计算等回件天数。
    func confirmSent(_ os: [Obligation], to party: Party? = nil, channel: String? = nil) {
        let befores = os.map { ($0, $0.record) }
        for o in os {
            upsertRecord(for: o) { r in
                if let party { r.partyID = party.id }
                r.status = .handedOff
                r.handedOffOn = today
                log(&r, .sent, channel: channel)
            }
        }
        let who = (party ?? self.party(os.first?.record?.partyID)).map { "交给\(latinPad($0.name))" } ?? "交办"
        showToast(os.count > 1 ? "已确认\(who) \(os.count) 件，开始等回件。" : "已确认\(who)，开始等回件。") { [weak self] in
            for (o, r) in befores { self?.restore(o, to: r) }
        }
    }

    /// 催办：记录一次，并重新开始计算等回件天数。
    func nudge(_ o: Obligation, channel: String) {
        upsertRecord(for: o) { r in
            log(&r, .nudged, channel: channel)
        }
        showToast(channel == "邮件" ? "催办邮件已在“邮件”中打开。" : "催办消息已复制。")
    }

    func revertToPending(_ o: Obligation) {
        let before = o.record
        upsertRecord(for: o) { r in
            r.status = .pending
            r.completedOn = nil
            r.handedOffOn = nil
            r.draftedOn = nil
            log(&r, .reverted)
        }
        showToast("已退回待交办。") { [weak self] in self?.restore(o, to: before) }
    }

    /// 最近一次交出或催办的日期，等回件天数从这里算。
    func lastContact(_ o: Obligation) -> Day? {
        let nudged = o.record?.log?.last(where: { $0.action == .nudged }).map { Day(date: $0.at) }
        return [o.record?.handedOffOn, nudged].compactMap { $0 }.max()
    }

    func receipt(_ o: Obligation) -> Document? {
        guard let id = o.record?.receiptDocumentID else { return nil }
        return documents.first { $0.id == id }
    }

    /// 今天需要我动手的事项：待交办、待发送，或交办太久没回音。
    func needsMe(_ o: Obligation) -> Bool {
        switch o.status.normalized {
        case .pending, .drafted: true
        case .handedOff: waitingTooLong(o)
        default: false
        }
    }

    func reschedule(_ o: Obligation, to day: Day?) {
        upsertRecord(for: o) { $0.overrideDue = day }
    }

    func setNote(_ o: Obligation, _ note: String) {
        upsertRecord(for: o) { $0.note = note }
    }

    private func restore(_ o: Obligation, to record: ObligationRecord?) {
        records.removeAll { $0.key == o.key }
        if let record { records.append(record) }
        saveRecords()
    }

    /// 交办后多少天没回音。
    func waitingTooLong(_ o: Obligation) -> Bool {
        guard o.status.isHandedOff, let since = lastContact(o) else { return false }
        let limit = party(o.record?.partyID)?.followUpDays ?? 14
        return since.days(until: today) >= limit
    }

    // MARK: 公司、人、关系

    func upsert(_ c: Company) {
        if let i = companies.firstIndex(where: { $0.id == c.id }) { companies[i] = c } else { companies.append(c) }
        saveCompanies()
    }

    func delete(company c: Company) {
        companies.removeAll { $0.id == c.id }
        holdings.removeAll { $0.companyID == c.id || $0.holder == NodeRef(kind: .company, id: c.id) }
        appointments.removeAll { $0.companyID == c.id }
        saveCompanies(); saveHoldings(); saveAppointments()
    }

    func upsert(_ p: Person) {
        if let i = people.firstIndex(where: { $0.id == p.id }) { people[i] = p } else { people.append(p) }
        savePeople()
    }

    func upsert(_ a: Appointment) {
        if let i = appointments.firstIndex(where: { $0.id == a.id }) { appointments[i] = a } else { appointments.append(a) }
        saveAppointments()
    }

    func upsert(_ p: Party) {
        if let i = parties.firstIndex(where: { $0.id == p.id }) { parties[i] = p } else { parties.append(p) }
        saveParties()
    }

    /// 记录一次变更：写入变更记录，并把受影响的文件标为需要更新。
    func record(change: ChangeRecord) {
        changes.append(change)
        if let cid = change.companyID {
            let affected = affectedCategories(change.kind)
            for i in documents.indices where documents[i].owner == NodeRef(kind: .company, id: cid) && documents[i].supersededBy == nil {
                if let t = docType(documents[i].typeID), affected.contains(t.category) { documents[i].needsUpdate = true }
            }
            saveDocuments()
        }
        saveChanges()
    }

    // MARK: 文件

    /// 归档一个文件；同类旧文件自动标为“已被取代”。
    @discardableResult
    func archive(file url: URL, typeID: String, owner: NodeRef, issued: Day?, expiry: Day?, form: String = "扫描件") throws -> Document {
        guard !loadFailed, !isLoading else { throw ArchiveError.unavailable }
        let typeName = docType(typeID)?.name ?? "文件"
        let rel = try store.archive(file: url, ownerName: name(of: owner), owner: owner, typeName: typeName, issued: issued)
        let doc = Document(typeID: typeID, owner: owner, issueDate: issued, expiryDate: expiry, form: form,
                           filePath: rel, originalFileName: url.lastPathComponent, addedOn: today)
        let next = DocumentVersions.inserting(doc, into: documents)
        do { try persistCollections([("documents", FolderStore.encoder.encode(next))]) }
        catch { try? FileManager.default.removeItem(at: store.absoluteURL(for: rel)); throw error }
        documents = next
        refreshDerived()
        return next.first { $0.id == doc.id }!
    }

    func fileURL(_ d: Document) -> URL { store.absoluteURL(for: d.filePath) }

    func reveal(_ d: Document) { NSWorkspace.shared.activateFileViewerSelecting([fileURL(d)]) }
    func open(_ d: Document) { NSWorkspace.shared.open(fileURL(d)) }

    func delete(document d: Document) {
        documents.removeAll { $0.id == d.id }
        for i in documents.indices where documents[i].supersededBy == d.id { documents[i].supersededBy = nil }
        saveDocuments()
    }

    // MARK: 提示条

    func showToast(_ text: String, undo: (() -> Void)? = nil) {
        let t = Toast(text: text, undo: undo)
        toast = t
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(6))
            if self.toast == t { self.toast = nil }
        }
    }
}
