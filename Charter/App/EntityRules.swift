import Foundation

// MARK: - 人员识别：别名与可能重复

extension AppStore {
    /// 比较用的名字：去掉空格、标点和大小写；拉丁字母按词排序，使“Zhang San”与“San Zhang”一致。
    static func nameKey(_ s: String) -> String {
        let lowered = s.lowercased()
        let words = lowered.split { !$0.isLetter && !$0.isNumber }.map(String.init)
        if words.allSatisfy({ $0.allSatisfy { $0.isASCII } }) && words.count > 1 {
            return words.sorted().joined()
        }
        return words.joined()
    }

    /// 人员的显示名：有别名时附在后面，方便在下拉框里认出同一个人。
    func personLabel(_ p: Person) -> String {
        p.aliases.isEmpty ? p.name : "\(p.name)（又名 \(p.aliases.prefix(2).joined(separator: "、"))）"
    }

    func personLabel(_ id: String) -> String { person(id).map(personLabel) ?? "未知" }

    /// 名字或别名与输入一致的已有人员。
    func possibleDuplicates(of name: String, excluding id: String? = nil) -> [Person] {
        let key = Self.nameKey(name)
        guard key.count >= 2 else { return [] }
        return people.filter { p in
            p.id != id && ([p.name] + p.aliases).contains { Self.nameKey($0) == key }
        }
    }
}

// MARK: - 治理角色

extension AppStore {
    /// 按实体类型给出常用的任职角色；第一个为默认值。
    static func roleSuggestions(entityForm: String) -> [String] {
        let f = entityForm.lowercased()
        if f.contains("llc") || f.contains("limited liability company") || f.contains("有限责任公司（美") {
            return ["经理", "管理成员", "成员", "授权签字人"]
        }
        if f.contains("partnership") || f.contains("合伙") || f.contains(" lp") || f.hasSuffix("lp") {
            return ["普通合伙人", "有限合伙人", "授权签字人"]
        }
        if f.contains("株式会社") || f.contains("kabushiki") || f.contains("k.k") {
            return ["代表取締役", "取締役", "監査役"]
        }
        if f.contains("合同会社") || f.contains("godo") {
            return ["代表社員", "業務執行社員", "社員"]
        }
        if f.contains("foundation") || f.contains("基金会") {
            return ["理事", "监事", "受益人代表"]
        }
        if f.contains("trust") || f.contains("信托") {
            return ["受托人", "保护人"]
        }
        if f.contains("有限公司") && !f.contains("股份") && (f.contains("中国") || f.contains("内地")) {
            return ["执行董事", "董事", "经理", "监事", "法定代表人"]
        }
        return ["董事", "公司秘书", "授权签字人"]
    }

    func roleSuggestions(for companyID: String) -> [String] {
        Self.roleSuggestions(entityForm: company(companyID)?.entityForm ?? "")
    }

    /// 页面上“添加董事”一类入口的称呼。
    func officerNoun(for companyID: String) -> String {
        switch roleSuggestions(for: companyID).first {
        case "经理": "经理或成员"
        case "普通合伙人": "合伙人"
        case "代表取締役": "取締役"
        default: "董事"
        }
    }
}

// MARK: - 实体类型与设立阶段

extension AppStore {
    /// 条目是否适用于这家公司的实体类型。只看本法域的类型：条目没有限定本法域的任何类型、
    /// 或公司还没填实体类型时，都视为适用。
    func itemApplies(_ t: DocumentType, to c: Company) -> Bool {
        guard let forms = t.entityForms, !forms.isEmpty, !c.entityForm.isEmpty else { return true }
        let local = Set(jurisdiction(c.jurisdiction)?.entityForms ?? []).union([c.entityForm])
        let relevant = forms.filter { local.contains($0) }
        return relevant.isEmpty || relevant.contains(c.entityForm)
    }
}

extension Company {
    /// 设立中：成立文件、名册、任职和股东都还没有产生，不计入缺件和完成度。
    var isForming: Bool { status == .forming }
}
