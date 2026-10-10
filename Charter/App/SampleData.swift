import Foundation

/// 一套虚构的示例数据（远澜集团等 12 家公司），用于试用和开发。不含任何真实信息。
enum SampleData {

    @MainActor
    static func install(into s: AppStore) {
        let today = s.today
        let since = today.adding(days: -20)

        // 负责方
        let lime = Party(name: "Lime Tree Corporate Services", kind: .agent, contactName: "Emma Walters", email: "emma@limetree.example", followUpDays: 10)
        let mingde = Party(name: "明德秘书服务有限公司", kind: .agent, contactName: "陈小姐", email: "cs@mingde.example", followUpDays: 7)
        let tortola = Party(name: "Tortola Agents Ltd", kind: .agent, contactName: "James Penn", email: "james@tortola.example")
        let lion = Party(name: "Lion City Corporate Services", kind: .agent, contactName: "Rachel Tan", email: "rachel@lioncity.example")
        let catalyst = Party(name: "St. Thomas Registered Agents", kind: .agent, email: "filings@stthomas.example")
        let aoyama = Party(name: "青山税理士法人", kind: .agent, contactName: "佐藤", email: "sato@aoyama.example")
        let hanbit = Party(name: "한빛세무회계", kind: .agent, contactName: "김민지", email: "minji@hanbit.example")
        let finance = Party(name: "财务部", kind: .department, contactName: "李经理", email: "finance@yuanlan.example", followUpDays: 5)
        let legal = Party(name: "法务部", kind: .department, contactName: "周律师", email: "legal@yuanlan.example", followUpDays: 5)
        s.parties = [lime, mingde, tortola, lion, catalyst, aoyama, hanbit, finance, legal]

        // 人
        let zhang = Person(name: "张三", aliases: ["Zhang San"])
        let wang = Person(name: "王五", aliases: ["Wang Wu"], notes: "名义股东，代张三持有遠瀾テクノロジー 30%")
        let sato = Person(name: "佐藤健", aliases: ["Ken Sato"])
        s.people = [zhang, wang, sato]

        func co(_ name: String, _ j: String, _ form: String, _ inc: Day, fye: MonthDay = MonthDay(12, 31), group: String, party: Party, reg: String, aliases: [String] = []) -> Company {
            Company(name: name, aliases: aliases, jurisdiction: j, entityForm: form, registrationNumber: reg, incorporationDate: inc,
                    fiscalYearEnd: fye, group: group, defaultPartyID: party.id, trackingSince: since)
        }

        var ky = co("Yuanlan Group Ltd.", "KY", "豁免公司 (Exempted Company)", Day(2020, 1, 15), group: "远澜集团", party: lime, reg: "CT-361204", aliases: ["开曼控股"])
        ky.registeredAddress = "Suite 4-210, Governors Square, Grand Cayman"
        var hk = co("远澜控股（香港）有限公司", "HK", "私人股份有限公司", Day(2019, 11, 12), fye: MonthDay(3, 31), group: "远澜集团", party: mingde, reg: "2891043", aliases: ["香港控股", "Yuanlan Holdings (HK)"])
        hk.rulePartyIDs["hk.profits-tax"] = finance.id
        let hkt = co("远澜贸易（香港）有限公司", "HK", "私人股份有限公司", Day(2021, 4, 1), fye: MonthDay(3, 31), group: "远澜集团", party: mingde, reg: "3017755", aliases: ["香港贸易"])
        var sg = co("Yuanlan International Pte. Ltd.", "SG", "Private Limited (Pte. Ltd.)", Day(2020, 9, 1), group: "远澜集团", party: lion, reg: "202024517K", aliases: ["新加坡国际"])
        sg.rulePartyIDs["sg.form-c"] = finance.id
        let sgv = co("Yuanlan Ventures Pte. Ltd.", "SG", "Private Limited (Pte. Ltd.)", Day(2024, 5, 2), group: "远澜集团", party: lion, reg: "202418830D")
        let jp = co("遠瀾テクノロジー株式会社", "JP", "株式会社", Day(2021, 8, 1), fye: MonthDay(3, 31), group: "远澜集团", party: aoyama, reg: "0104-01-158204", aliases: ["日本科技", "Yuanlan Technology"])
        let kr = co("Yuanlan Korea LLC", "KR", "유한회사", Day(2023, 2, 1), group: "远澜集团", party: hanbit, reg: "110114-0298811", aliases: ["韩国公司", "원란코리아"])
        let bvi = co("Yuanlan Holdings (BVI) Ltd.", "VG", "BVI Business Company", Day(2019, 6, 10), group: "远澜集团", party: tortola, reg: "1987342")
        let hc = co("Harbor Crest Investments Ltd", "VG", "BVI Business Company", Day(2018, 9, 20), group: "Harbor Crest", party: tortola, reg: "1893015")
        let hcc = co("Harbor Crest Capital Ltd.", "KY", "豁免公司 (Exempted Company)", Day(2022, 8, 15), group: "Harbor Crest", party: lime, reg: "CT-389921")
        let vi = co("Seawind Assets (USVI) LLC", "VI", "LLC", Day(2021, 5, 10), group: "独立公司", party: catalyst, reg: "LLC-0021187")
        let cube = co("立方咨询有限公司", "HK", "私人股份有限公司", Day(2017, 7, 7), fye: MonthDay(12, 31), group: "独立公司", party: mingde, reg: "2551270")
        s.companies = [ky, hk, hkt, sg, sgv, jp, kr, bvi, hc, hcc, vi, cube]

        // 持股
        func p(_ person: Person) -> NodeRef { NodeRef(kind: .person, id: person.id) }
        func c(_ company: Company) -> NodeRef { NodeRef(kind: .company, id: company.id) }
        s.holdings = [
            Holding(holder: p(zhang), companyID: ky.id, percent: 100, shares: "1", from: Day(2020, 1, 15)),
            Holding(holder: p(zhang), companyID: hk.id, percent: 100, shares: "10,000", from: Day(2019, 11, 12), to: Day(2020, 6, 30)),
            Holding(holder: c(ky), companyID: hk.id, percent: 100, shares: "10,000", from: Day(2020, 6, 30)),
            Holding(holder: c(ky), companyID: sg.id, percent: 100, shares: "100,000", from: Day(2020, 9, 1)),
            Holding(holder: c(ky), companyID: jp.id, percent: 70, shares: "700", from: Day(2021, 8, 1)),
            Holding(holder: p(wang), companyID: jp.id, percent: 30, shares: "300", isNominee: true, beneficialOwner: p(zhang), from: Day(2021, 8, 1)),
            Holding(holder: c(hk), companyID: hkt.id, percent: 100, shares: "10,000", from: Day(2021, 4, 1)),
            Holding(holder: c(sg), companyID: kr.id, percent: 100, from: Day(2023, 2, 1)),
            Holding(holder: c(sg), companyID: sgv.id, percent: 60, shares: "60,000", from: Day(2024, 5, 2)),
            Holding(holder: p(zhang), companyID: bvi.id, percent: 100, shares: "50,000", from: Day(2019, 6, 10)),
            Holding(holder: c(bvi), companyID: sgv.id, percent: 40, shares: "40,000", from: Day(2024, 5, 2)),
            Holding(holder: p(zhang), companyID: hc.id, percent: 50, shares: "25,000", from: Day(2018, 9, 20)),
            Holding(holder: c(hc), companyID: hcc.id, percent: 100, shares: "1", from: Day(2022, 8, 15)),
            Holding(holder: p(zhang), companyID: vi.id, percent: 100, from: Day(2021, 5, 10)),
            Holding(holder: p(zhang), companyID: cube.id, percent: 100, shares: "10,000", from: Day(2017, 7, 7)),
        ]

        // 任职
        s.appointments = s.companies.map { Appointment(personID: zhang.id, companyID: $0.id, title: "董事", from: $0.incorporationDate) }
            + [Appointment(personID: sato.id, companyID: jp.id, title: "董事", from: Day(2021, 8, 1)),
               Appointment(personID: sato.id, companyID: jp.id, title: "代表取締役", from: Day(2021, 8, 1))]

        // 变更记录
        s.changes = [
            ChangeRecord(companyID: hk.id, kind: .shareholderChange, effectiveOn: Day(2020, 6, 30), recordedOn: Day(2020, 7, 2), summary: "张三将远澜控股（香港）100% 股份转让给 Yuanlan Group Ltd."),
            ChangeRecord(companyID: jp.id, kind: .shareholderChange, effectiveOn: Day(2021, 8, 1), recordedOn: Day(2021, 8, 3), summary: "设立，Yuanlan Group 持股 70%，王五代张三持股 30%"),
        ]

        s.records = []
        s.documents = []
        s.saveParties(); s.savePeople(); s.saveHoldings(); s.saveAppointments(); s.saveChanges(); s.saveCompanies()
        s.corporateGroups = AppStore.legacyGroups(companies: s.companies, holdings: s.holdings, today: today)
        s.saveGroups()

        // 示例文件（生成简单的 PDF）
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("charter-sample", isDirectory: true)
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        func doc(_ typeID: String, _ owner: NodeRef, issued: Day?, expiry: Day? = nil) {
            let t = s.docType(typeID)
            let file = tmp.appendingPathComponent(UUID().uuidString + ".pdf")
            try? PDFWriter.write(to: file, title: t?.localNames.first ?? t?.name ?? "Document",
                                 subtitle: s.name(of: owner),
                                 lines: ["示例文件，仅用于试用 Charter。", issued.map { "Date of issue: \($0)" } ?? "", expiry.map { "Date of expiry: \($0)" } ?? ""])
            _ = try? s.archive(file: file, typeID: typeID, owner: owner, issued: issued, expiry: expiry)
        }
        let K = c(ky)
        doc("ky.coi", K, issued: Day(2020, 1, 15))
        doc("ky.ma", K, issued: Day(2020, 1, 15))
        doc("ky.cogs", K, issued: today.adding(months: -6).adding(days: -12))
        doc("ky.incumbency", K, issued: today.adding(months: -6).adding(days: 18))
        doc("ky.directors", K, issued: Day(2026, 2, 3))
        doc("ky.members", K, issued: Day(2026, 2, 3))
        doc("ky.bo", K, issued: Day(2026, 2, 3))
        doc("hk.coi", c(hk), issued: Day(2019, 11, 12))
        doc("hk.br", c(hk), issued: today.adding(days: 34).adding(months: -12), expiry: today.adding(days: 34))
        doc("hk.articles", c(hk), issued: Day(2019, 11, 12))
        doc("hk.br", c(hkt), issued: today.adding(days: 120).adding(months: -36), expiry: today.adding(days: 120))
        doc("sg.coi", c(sg), issued: Day(2020, 9, 1))
        doc("sg.bizprofile", c(sg), issued: today.adding(days: -51))
        doc("jp.rireki", c(jp), issued: today.adding(days: -98))
        doc("jp.teikan", c(jp), issued: Day(2021, 8, 1))
        doc("kr.registry", c(kr), issued: today.adding(days: -122))
        doc("vg.cogs", c(hc), issued: today.adding(months: -2))
        doc("vi.cogs", c(vi), issued: today.adding(months: -4))
        doc("common.passport", p(zhang), issued: Day(2021, 3, 2), expiry: Day(2031, 3, 1))
        doc("common.passport", p(wang), issued: Day(2019, 12, 9), expiry: today.adding(days: 25))
        try? FileManager.default.removeItem(at: tmp)

        s.showToast("示例数据已载入：12 家公司、3 个人、9 个负责方。")
    }
}
