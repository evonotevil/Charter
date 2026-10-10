import Foundation

extension AppStore {

    // MARK: 现任

    /// 某日在任的董事和高管（统一定义：就任日 ≤ 该日，且未离任或离任日晚于该日）。
    func officers(of companyID: String, on day: Day? = nil) -> [Appointment] {
        appointments.filter { $0.companyID == companyID && $0.isActive(on: day ?? today) }
            .sorted { ($0.title, name(of: NodeRef(kind: .person, id: $0.personID))) < ($1.title, name(of: NodeRef(kind: .person, id: $1.personID))) }
    }

    func directShareholders(of companyID: String, on day: Day? = nil) -> [Holding] {
        holdings.filter { $0.companyID == companyID && $0.isActive(on: day ?? today) }.sorted { $0.percent > $1.percent }
    }

    func breakdown(of companyID: String, on day: Day? = nil) -> OwnershipBreakdown {
        Chains.breakdown(of: companyID, holdings: holdings, on: day ?? today)
    }

    /// 集团顶层到这家公司的链条（每个集团、每个顶层各取路径）。
    func chainsFromTops(to companyID: String, on day: Day? = nil) -> [(group: CorporateGroup, chain: Chain)] {
        var out: [(CorporateGroup, Chain)] = []
        for g in groups(containing: companyID) {
            for t in g.tops where t != NodeRef(kind: .company, id: companyID) {
                for c in Chains.paths(from: t, to: companyID, holdings: holdings, on: day ?? today) { out.append((g, c)) }
            }
        }
        return out.map { (group: $0.0, chain: $0.1) }
    }

    // MARK: 文字

    /// 一条持股描述：“王五（代张三）持有 30%”。
    func holdingText(_ h: Holding) -> String {
        var t = name(of: h.holder)
        if h.isNominee { t += "（代\(h.beneficialOwner.map { name(of: $0) } ?? "他人")持有）" }
        return "\(t) \(Ownership.percentLabel(h.percent))"
    }

    /// 链条文字：“张三 → Yuanlan Group Ltd.（100%）→ 遠瀾テクノロジー（70%）＝ 70%”。
    func chainText(_ c: Chain) -> String {
        var parts = [name(of: c.from)]
        for s in c.steps {
            let target = name(of: NodeRef(kind: .company, id: s.holding.companyID))
            if s.asBeneficial {
                parts.append("\(target)（经\(name(of: s.holding.holder))代持 \(Ownership.percentLabel(s.holding.percent))）")
            } else {
                parts.append("\(target)（\(Ownership.percentLabel(s.holding.percent))）")
            }
        }
        return parts.joined(separator: " → ") + (c.steps.count > 1 ? " ＝ \(Ownership.percentLabel(c.percent))" : "")
    }

    func breakdownLines(_ b: OwnershipBreakdown) -> [String] {
        var lines = b.owners.map { o -> String in
            var t = "\(name(of: o.owner)) \(Ownership.percentLabel(o.percent))"
            if o.viaNominee { t += "（含代持）" }
            if o.isTopCompany { t += "（其上层股东未录入）" }
            return t
        }
        if b.unknown > 0.005 {
            let where_ = b.gaps.map { "\(name(of: NodeRef(kind: .company, id: $0.companyID))) 有 \(Ownership.percentLabel($0.missing)) 股东未录入" }
                + b.unresolvedNominees.map { "\(name(of: $0.holder)) 代持的实际受益人尚未确认" }
                + b.cyclicCompanyIDs.map { "\(name(of: NodeRef(kind: .company, id: $0))) 存在循环持股，需单独核算" }
            lines.append("未识别 \(Ownership.percentLabel(b.unknown))：\(where_.joined(separator: "；"))")
        }
        return lines
    }

    /// 公司资料摘要：可以直接贴给同事或代理。
    func companySummary(_ c: Company, on day: Day? = nil) -> String {
        let d = day ?? today
        var lines: [String] = []
        lines.append("公司名称：\(c.name)" + (c.formerNames.isEmpty ? "" : "（曾用名：\(c.formerNames.joined(separator: "、"))）"))
        lines.append("注册地：\(jurisdictionName(c.jurisdiction))" + (c.entityForm.isEmpty ? "" : "，\(c.entityForm)"))
        lines.append("注册编号：\(c.registrationNumber.isEmpty ? "未填写" : c.registrationNumber)")
        lines.append("成立日期：\(c.incorporationDate?.description ?? "未填写")")
        lines.append("注册地址：\(c.registeredAddress.isEmpty ? "未填写" : c.registeredAddress)")
        if c.status != .active { lines.append("状态：\(c.status.label)") }
        let officers = officers(of: c.id, on: d)
        lines.append("董事及高管：" + (officers.isEmpty ? "未录入" : officers.map { "\(name(of: NodeRef(kind: .person, id: $0.personID)))（\($0.title)）" }.joined(separator: "、")))
        let sh = directShareholders(of: c.id, on: d)
        lines.append("直接股东：" + (sh.isEmpty ? "未录入" : sh.map(holdingText).joined(separator: "；")))
        let b = breakdown(of: c.id, on: d)
        if !b.owners.isEmpty || b.unknown > 0.005 {
            lines.append("最终受益（穿透）：" + breakdownLines(b).joined(separator: "；"))
        }
        let gs = groups(containing: c.id)
        if !gs.isEmpty { lines.append("所属集团：\(gs.map(\.name).joined(separator: "、"))") }
        for item in chainsFromTops(to: c.id, on: d).prefix(4) {
            lines.append("持股链条（\(item.group.name)）：\(chainText(item.chain))")
        }
        lines.append("（以上信息截至 \(d.long)，摘自 Charter 档案）")
        return lines.joined(separator: "\n")
    }

    /// 人员摘要：按“现任职务、直接持股、穿透后持有、由他人代持、曾任职务”分节，空的节不写。
    func personSummary(_ p: Person) -> String {
        let ref = NodeRef(kind: .person, id: p.id)
        func companyName(_ id: String) -> String { name(of: NodeRef(kind: .company, id: id)) }
        func range(_ from: Day?, _ to: Day?) -> String? {
            switch (from, to) {
            case (let f?, let t?): return "\(f.description) 至 \(t.description)"
            case (let f?, nil): return "\(f.description) 起"
            case (nil, let t?): return "至 \(t.description)"
            default: return nil
            }
        }
        var sections: [(String, [String])] = []

        // 现任职务：同一公司的多个职务合并成一行
        let roles = appointments.filter { $0.personID == p.id && $0.isActive(on: today) }
        let byCompany = Dictionary(grouping: roles, by: \.companyID)
        let current = byCompany.keys.sorted { companyName($0) < companyName($1) }.map { cid -> String in
            let rs = byCompany[cid] ?? []
            var titles: [String] = []
            for r in rs where !titles.contains(r.title) { titles.append(r.title) }
            let since = rs.compactMap(\.from).min().map { "（\($0.description) 起）" } ?? ""
            return "\(companyName(cid)) — \(titles.joined(separator: "、"))\(since)"
        }
        sections.append(("现任职务", current))

        // 直接持股
        let direct = holdings.filter { $0.holder == ref && $0.isActive(on: today) }.sorted { $0.percent > $1.percent }
        sections.append(("直接持股", direct.map { h -> String in
            let base = "\(companyName(h.companyID)) \(Ownership.percentLabel(h.percent))"
            return base + (h.isNominee ? "（名义股东，代\(h.beneficialOwner.map { name(of: $0) } ?? "他人")持有）" : "")
        }))

        // 穿透后持有：代持部分写明由谁代持多少
        let held = holdings.filter { $0.isNominee && $0.beneficialOwner == ref && $0.isActive(on: today) }
        let pf = Ownership.portfolio(of: ref, companies: companies, holdings: holdings, on: today)
        sections.append(("穿透后持有", pf.map { item -> String in
            var t = "\(item.company.name) \(Ownership.percentLabel(item.percent))"
            if item.viaNominee {
                let here = held.filter { $0.companyID == item.company.id }
                if here.isEmpty {
                    t += "（含代持）"
                } else {
                    t += "（含" + here.map { "\(name(of: $0.holder))代持 \(Ownership.percentLabel($0.percent))" }.joined(separator: "、") + "）"
                }
            }
            return t
        }))

        // 由他人代持
        sections.append(("由他人代持", held.map { h -> String in
            return "\(companyName(h.companyID)) \(Ownership.percentLabel(h.percent))（由\(name(of: h.holder))代持）"
        }))

        // 曾任职务
        let past = appointments.filter { $0.personID == p.id && !$0.isActive(on: today) }
            .sorted { ($0.to ?? $0.from ?? today) > ($1.to ?? $1.from ?? today) }
        sections.append(("曾任职务", past.map { a -> String in
            let period = range(a.from, a.to).map { "（\($0)）" } ?? ""
            return "\(companyName(a.companyID)) — \(a.title)\(period)"
        }))

        var lines = [p.name]
        for (title, items) in sections where !items.isEmpty {
            lines.append("")
            lines.append("【\(title)】")
            lines.append(contentsOf: items.map { "· \($0)" })
        }
        return lines.joined(separator: "\n")
    }
}
