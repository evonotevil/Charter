import Foundation

/// 一次变更要改的所有东西。预览时只读，确认后由 AppStore.apply 一次写入；取消则什么都不改。
struct ChangePlan {
    var companyID: String
    var kind: ChangeKind = .directorChange
    var effectiveOn: Day = .today()
    var summary: String = ""

    // 董事
    var endingAppointmentIDs: Set<String> = []
    var newAppointments: [Appointment] = []
    var newPeople: [Person] = []

    // 股东
    var endingHoldingIDs: Set<String> = []
    var newHoldings: [Holding] = []

    // 公司资料
    var newAddress: String?
    var newName: String?
    var newStatus: CompanyStatus?

    // 证明文件（确认时才归档）
    var evidenceURL: URL?
    var evidenceTypeID: String = "common.resolution"
}

/// 预览里的一条：将发生什么。
struct ChangeEffect: Hashable {
    enum Kind { case record, appointment, holding, company, document, obligation, evidence }
    var kind: Kind
    var text: String
}

extension AppStore {

    /// 某类变更会让哪些文件过时（按文件类别判断）。
    func affectedCategories(_ kind: ChangeKind) -> [String] {
        switch kind {
        case .directorChange: ["在职证明", "董事名册"]
        case .shareholderChange: ["股东名册", "受益所有人登记"]
        case .addressChange, .nameChange: ["存续证明", "在职证明", "商业登记"]
        default: []
        }
    }

    func affectedDocuments(_ kind: ChangeKind, companyID: String) -> [Document] {
        let cats = affectedCategories(kind)
        return ownedDocuments(of: NodeRef(kind: .company, id: companyID)).filter { d in
            docType(d.typeID).map { cats.contains($0.category) } ?? false
        }
    }

    /// 这次变更会触发的申报规则及截止日。
    func eventRules(_ kind: ChangeKind, company: Company, effective: Day) -> [(RuleTemplate, Day)] {
        library.rules.filter { $0.applies(to: company) }.map { $0.effective(for: company) }
            .filter { $0.schedule.kind == .event && $0.schedule.event == kind }
            .map { ($0, DeadlineEngine.adjust(effective.adding(days: $0.schedule.days ?? 0), $0.adjust)) }
    }

    func personName(_ id: String, plan: ChangePlan) -> String {
        person(id)?.name ?? plan.newPeople.first { $0.id == id }?.name ?? "未命名"
    }

    func holderName(_ ref: NodeRef, plan: ChangePlan) -> String {
        ref.kind == .person ? personName(ref.id, plan: plan) : name(of: ref)
    }

    /// 变更内容逐条写成文字，存进变更记录，也用于预览。
    func detailLines(_ p: ChangePlan) -> [String] {
        var lines: [String] = []
        for a in appointments where p.endingAppointmentIDs.contains(a.id) {
            lines.append("\(personName(a.personID, plan: p)) 离任\(a.title)")
        }
        for a in p.newAppointments {
            lines.append("\(personName(a.personID, plan: p)) 就任\(a.title)")
        }
        for h in holdings where p.endingHoldingIDs.contains(h.id) {
            lines.append("\(holderName(h.holder, plan: p)) 不再持有 \(Ownership.percentLabel(h.percent))")
        }
        for h in p.newHoldings {
            lines.append("\(holderName(h.holder, plan: p)) 持有 \(Ownership.percentLabel(h.percent))\(h.isNominee ? "（代持）" : "")")
        }
        let c = company(p.companyID)
        if let a = p.newAddress, a != c?.registeredAddress { lines.append("注册地址改为：\(a)") }
        if let n = p.newName, n != c?.name { lines.append("公司名称由 \(c?.name ?? "") 改为 \(n)") }
        if let s = p.newStatus, s != c?.status { lines.append("公司状态改为：\(s.label)") }
        return lines
    }

    func autoSummary(_ p: ChangePlan) -> String {
        let lines = detailLines(p)
        if lines.isEmpty { return p.kind.label }
        return lines.prefix(2).joined(separator: "；") + (lines.count > 2 ? "等 \(lines.count) 项" : "")
    }

    /// 预览：确认后会发生的所有事。
    func effects(_ p: ChangePlan) -> [ChangeEffect] {
        guard let c = company(p.companyID) else { return [] }
        var out: [ChangeEffect] = [ChangeEffect(kind: .record, text: "在变更记录里新增：\(p.effectiveOn.long) \(p.summary.isEmpty ? autoSummary(p) : p.summary)")]
        for a in appointments where p.endingAppointmentIDs.contains(a.id) {
            out.append(ChangeEffect(kind: .appointment, text: "\(personName(a.personID, plan: p)) 的\(a.title)任期结束于 \(p.effectiveOn.long)"))
        }
        for a in p.newAppointments {
            out.append(ChangeEffect(kind: .appointment, text: "\(personName(a.personID, plan: p)) 自 \(p.effectiveOn.long) 起任\(a.title)"))
        }
        for h in holdings where p.endingHoldingIDs.contains(h.id) {
            out.append(ChangeEffect(kind: .holding, text: "\(holderName(h.holder, plan: p)) 的 \(Ownership.percentLabel(h.percent)) 持股结束于 \(p.effectiveOn.long)"))
        }
        for h in p.newHoldings {
            out.append(ChangeEffect(kind: .holding, text: "\(holderName(h.holder, plan: p)) 自 \(p.effectiveOn.long) 起持有 \(Ownership.percentLabel(h.percent))"))
        }
        if let a = p.newAddress, a != c.registeredAddress { out.append(ChangeEffect(kind: .company, text: "注册地址更新为“\(a)”")) }
        if let n = p.newName, n != c.name { out.append(ChangeEffect(kind: .company, text: "公司名称更新为 \(n)，\(c.name) 记为曾用名")) }
        if let s = p.newStatus, s != c.status { out.append(ChangeEffect(kind: .company, text: "公司状态改为“\(s.label)”")) }
        for d in affectedDocuments(p.kind, companyID: c.id) {
            out.append(ChangeEffect(kind: .document, text: "\(docType(d.typeID)?.name ?? "文件")（\(d.issueDate.map { "\($0.long)签发" } ?? "日期未知")）标为“需要更新”"))
        }
        for (r, due) in complianceOn ? eventRules(p.kind, company: c, effective: p.effectiveOn) : [] {
            let trustNote = DeadlineEngine.trust(rule: r, company: c, today: today).isConfirmed ? "" : "（规则待核对）"
            out.append(ChangeEffect(kind: .obligation, text: "新增事项：\(r.name)，\(due.long)前办妥\(trustNote)"))
        }
        if let u = p.evidenceURL {
            out.append(ChangeEffect(kind: .evidence, text: "\(u.lastPathComponent) 归档为\(docType(p.evidenceTypeID)?.name ?? "文件")"))
        }
        return out
    }

    /// 一次写入整个变更。失败时恢复原状，不留下半成品。
    func apply(_ p: ChangePlan) async throws {
        guard !loadFailed, !isLoading, !isImporting else { throw ArchiveError.unavailable }
        guard var c = company(p.companyID) else { throw ArchiveError.invalidTarget }
        try validate(p)
        isImporting = true
        defer { isImporting = false }
        let folder = store
        var copiedEvidence: URL?
        let snapshot = (companies, people, holdings, appointments, documents, changes)

        do {
            var evidenceID: String?
            if let u = p.evidenceURL {
                let access = u.startAccessingSecurityScopedResource()
                defer { if access { u.stopAccessingSecurityScopedResource() } }
                let owner = NodeRef(kind: .company, id: c.id)
                let companyName = c.name
                let typeName = docType(p.evidenceTypeID)?.name ?? "证明文件"
                let path = try await StorageWorker.perform {
                    try folder.archive(file: u, ownerName: companyName, owner: owner, typeName: typeName, issued: p.effectiveOn)
                }
                copiedEvidence = folder.absoluteURL(for: path)
                let evidence = Document(typeID: p.evidenceTypeID, owner: owner, issueDate: p.effectiveOn, expiryDate: nil,
                                        form: "扫描件", filePath: path, originalFileName: u.lastPathComponent, addedOn: today)
                documents = DocumentVersions.inserting(evidence, into: documents)
                evidenceID = evidence.id
            }

            let referenced = Set(p.newAppointments.map(\.personID) + p.newHoldings.map(\.holder.id)
                                 + p.newHoldings.compactMap { $0.beneficialOwner?.id })
            people.append(contentsOf: p.newPeople.filter { np in referenced.contains(np.id) && !people.contains { $0.id == np.id } })
            for i in appointments.indices where p.endingAppointmentIDs.contains(appointments[i].id) {
                appointments[i].to = p.effectiveOn
            }
            appointments.append(contentsOf: p.newAppointments.map { var a = $0; a.from = p.effectiveOn; return a })
            for i in holdings.indices where p.endingHoldingIDs.contains(holdings[i].id) {
                holdings[i].to = p.effectiveOn
            }
            holdings.append(contentsOf: p.newHoldings.map { var h = $0; h.from = p.effectiveOn; return h })

            if let a = p.newAddress { c.registeredAddress = a }
            if let n = p.newName, n != c.name {
                if !c.formerNames.contains(c.name) { c.formerNames.append(c.name) }
                c.name = n
            }
            if let s = p.newStatus { c.status = s }
            if let i = companies.firstIndex(where: { $0.id == c.id }) { companies[i] = c }

            let affected = Set(affectedDocuments(p.kind, companyID: c.id).map(\.id))
            for i in documents.indices where affected.contains(documents[i].id) { documents[i].needsUpdate = true }

            var record = ChangeRecord(companyID: c.id, kind: p.kind, effectiveOn: p.effectiveOn, recordedOn: today,
                                      summary: p.summary.isEmpty ? autoSummary(p) : p.summary)
            record.details = detailLines(p)
            record.evidenceDocumentID = evidenceID
            changes.append(record)

            try await writeChangeCollections()
            refreshDerived()
            let applied = (companies, people, holdings, appointments, documents, changes)

            let n = complianceOn ? eventRules(p.kind, company: c, effective: p.effectiveOn).count : 0
            showToast("已记录变更" + (n > 0 ? "，新增 \(n) 件申报事项。" : "。")) { [weak self] in
                guard let self, !self.isLoading, !self.isImporting else { return }
                guard self.companies == applied.0, self.people == applied.1,
                      self.holdings == applied.2, self.appointments == applied.3,
                      self.documents == applied.4, self.changes == applied.5 else {
                    self.errorMessage = "此后已有其他档案修改，无法直接撤销。请通过新的变更记录更正，避免覆盖后续修改。"
                    return
                }
                Task {
                    self.isImporting = true
                    defer { self.isImporting = false }
                    do { try await self.restoreSnapshot(snapshot) }
                    catch { self.errorMessage = "撤销未完成，请检查数据文件夹：\(error.localizedDescription)" }
                }
            }
        } catch {
            (companies, people, holdings, appointments, documents, changes) = snapshot
            if let failure = error as? CollectionSaveError, !failure.rollbackFailures.isEmpty {
                protectAfterWriteFailure()
            } else if let copiedEvidence {
                try? FileManager.default.removeItem(at: copiedEvidence)
            }
            refreshDerived()
            throw error
        }
    }

    private func restoreSnapshot(_ s: ([Company], [Person], [Holding], [Appointment], [Document], [ChangeRecord])) async throws {
        let current = (companies, people, holdings, appointments, documents, changes)
        (companies, people, holdings, appointments, documents, changes) = s
        do { try await writeChangeCollections() }
        catch {
            (companies, people, holdings, appointments, documents, changes) = current
            if let failure = error as? CollectionSaveError, !failure.rollbackFailures.isEmpty { protectAfterWriteFailure() }
            throw error
        }
        refreshDerived()
    }

    private func writeChangeCollections() async throws {
        let folder = store
        let snapshot = (companies, people, holdings, appointments, documents, changes)
        let dates = try await StorageWorker.perform {
            let writes = [
                ("companies", try FolderStore.encoder.encode(snapshot.0)),
                ("people", try FolderStore.encoder.encode(snapshot.1)),
                ("holdings", try FolderStore.encoder.encode(snapshot.2)),
                ("appointments", try FolderStore.encoder.encode(snapshot.3)),
                ("documents", try FolderStore.encoder.encode(snapshot.4)),
                ("changes", try FolderStore.encoder.encode(snapshot.5))
            ]
            try folder.saveCollections(writes)
            return Dictionary(uniqueKeysWithValues: writes.compactMap { name, _ in folder.modificationDate(name).map { (name, $0) } })
        }
        // Preserve modification dates for collections outside this transaction.
        updateModifications(dates)
    }

    private func validate(_ p: ChangePlan) throws {
        let peopleIDs = Set(people.map(\.id) + p.newPeople.map(\.id))
        let companyIDs = Set(companies.map(\.id))
        guard p.newAppointments.allSatisfy({ $0.companyID == p.companyID && peopleIDs.contains($0.personID) }),
              p.newHoldings.allSatisfy({ $0.companyID == p.companyID }),
              p.endingAppointmentIDs.isSubset(of: Set(appointments.filter {
                  $0.companyID == p.companyID && $0.isActive(on: p.effectiveOn)
              }.map(\.id))),
              p.endingHoldingIDs.isSubset(of: Set(holdings.filter {
                  $0.companyID == p.companyID && $0.isActive(on: p.effectiveOn)
              }.map(\.id))) else { throw ChangeValidationError.invalidRelationships }
        if !p.newHoldings.isEmpty || !p.endingHoldingIDs.isEmpty {
            var candidate = holdings
            for i in candidate.indices where p.endingHoldingIDs.contains(candidate[i].id) {
                candidate[i].to = p.effectiveOn
            }
            candidate.append(contentsOf: p.newHoldings.map { var h = $0; h.from = p.effectiveOn; return h })
            try HoldingValidation.validate(candidate, companyIDs: companyIDs, personIDs: peopleIDs,
                                           changedCompanyIDs: [p.companyID])
        }
        if p.evidenceURL != nil, docType(p.evidenceTypeID)?.owner != .company { throw ArchiveError.invalidTarget }
    }

    /// 有董事或股东类变更记录，但任职或持股里找不到对应的变化——多半是只记了变更、没更新名册。
    func unsyncedChanges(companyID: String) -> [ChangeRecord] {
        changes.filter { ch in
            guard ch.companyID == companyID else { return false }
            switch ch.kind {
            case .directorChange:
                return !appointments.contains { $0.companyID == companyID && ($0.from == ch.effectiveOn || $0.to == ch.effectiveOn) }
            case .shareholderChange:
                return !holdings.contains { $0.companyID == companyID && ($0.from == ch.effectiveOn || $0.to == ch.effectiveOn) }
            default:
                return false
            }
        }
    }
}

private enum ChangeValidationError: LocalizedError {
    case invalidRelationships
    var errorDescription: String? {
        switch self {
        case .invalidRelationships: "任职或持股的对象、比例或任期不匹配，请返回第一步检查。"
        }
    }
}
