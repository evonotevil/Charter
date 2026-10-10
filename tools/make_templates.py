"""生成 Charter/Resources/charter-templates.json。规则为草稿，needsReview=True，需找代理核对。"""
import json, os

J = [
 dict(code="HK", name="香港", timeZone="Asia/Hong_Kong", entityForms=["私人股份有限公司"]),
 dict(code="SG", name="新加坡", timeZone="Asia/Singapore", entityForms=["Private Limited (Pte. Ltd.)"]),
 dict(code="VG", name="英属维尔京群岛", timeZone="America/Tortola", entityForms=["BVI Business Company"]),
 dict(code="KY", name="开曼群岛", timeZone="America/Cayman", entityForms=["豁免公司 (Exempted Company)"]),
 dict(code="VI", name="美属维尔京群岛", timeZone="America/St_Thomas", entityForms=["LLC", "Corporation"]),
 dict(code="JP", name="日本", timeZone="Asia/Tokyo", entityForms=["株式会社", "合同会社"]),
 dict(code="KR", name="韩国", timeZone="Asia/Seoul", entityForms=["주식회사", "유한회사"]),
 dict(code="TW", name="台湾", timeZone="Asia/Taipei", entityForms=["股份有限公司", "有限公司"]),
]

def dt(id, name, category, local, juris, validity="permanent", months=None, hints=(), owner="company"):
    d = dict(id=id, name=name, category=category, localNames=list(local), jurisdictions=list(juris), owner=owner,
             validity=validity, hints=list(hints), builtIn=True)
    if months is not None: d["validityMonths"] = months
    return d

D = [
 # 通用
 dt("common.passport", "护照", "护照", ["Passport", "护照", "護照", "旅券", "여권"], [], "expiryOnDocument", hints=["passport no", "date of expiry", "nationality"], owner="person"),
 dt("common.address", "地址证明", "地址证明", ["Proof of Address", "Utility Bill", "住址证明"], [], "monthsAfterIssue", 3, hints=["bank statement", "utility", "electricity"], owner="person"),
 dt("common.resolution", "董事会决议", "董事会决议", ["Board Resolution", "Written Resolutions of the Directors", "董事会决议", "取締役会議事録"], [], hints=["resolved that", "resolution"]),
 dt("common.audit", "审计报告", "审计报告", ["Audited Financial Statements", "Auditor's Report", "审计报告", "核數師報告"], [], hints=["independent auditor", "true and fair view"]),
 dt("common.receipt", "回执", "回执", ["Receipt", "Acknowledgement", "回执", "收据"], [], hints=["receipt", "acknowledg"]),
 dt("common.confirmation", "代理确认函", "规则确认", ["Confirmation", "确认函", "代理回复"], [], hints=["we confirm", "please note that the deadline"]),
 # 香港
 dt("hk.coi", "公司注册证明书", "注册证书", ["Certificate of Incorporation", "公司註冊證明書"], ["HK"], hints=["companies registry", "公司註冊處", "hong kong"]),
 dt("hk.br", "商业登记证", "商业登记", ["Business Registration Certificate", "商業登記證"], ["HK"], "expiryOnDocument", hints=["business registration office", "商業登記署", "date of expiry"]),
 dt("hk.cr-search", "公司查册结果", "存续证明", ["Company Search Report", "Company Particulars Search", "公司查冊"], ["HK"], "monthsAfterIssue", 3, hints=["cyber search centre", "company particulars"]),
 dt("hk.incumbency", "董事在职证明", "在职证明", ["Certificate of Incumbency", "在職證明書"], ["HK"], "monthsAfterIssue", 3, hints=["incumbency"]),
 dt("hk.nar1", "周年申报表", "年报回执", ["Annual Return", "NAR1", "周年申報表"], ["HK"], hints=["nar1", "annual return"]),
 dt("hk.articles", "组织章程细则", "章程", ["Articles of Association", "組織章程細則"], ["HK"], hints=["articles of association"]),
 dt("hk.directors", "董事名册", "董事名册", ["Register of Directors", "董事登記冊"], ["HK"], "untilChanged", hints=["register of directors"]),
 dt("hk.members", "成员登记册", "股东名册", ["Register of Members", "成員登記冊"], ["HK"], "untilChanged", hints=["register of members"]),
 dt("hk.scr", "重要控制人登记册", "受益所有人登记", ["Significant Controllers Register", "重要控制人登記冊"], ["HK"], "untilChanged", hints=["significant controller"]),
 # 新加坡
 dt("sg.coi", "注册证书", "注册证书", ["Certificate of Incorporation", "Certificate Confirming Incorporation"], ["SG"], hints=["accounting and corporate regulatory authority", "acra", "singapore"]),
 dt("sg.bizprofile", "Business Profile", "存续证明", ["Business Profile", "BizFile", "Company Profile"], ["SG"], "monthsAfterIssue", 3, hints=["bizfile", "business profile", "acra"]),
 dt("sg.incumbency", "董事在职证明", "在职证明", ["Certificate of Incumbency"], ["SG"], "monthsAfterIssue", 3, hints=["incumbency"]),
 dt("sg.constitution", "章程", "章程", ["Constitution", "Memorandum and Articles of Association"], ["SG"], hints=["constitution of"]),
 dt("sg.directors", "董事名册", "董事名册", ["Register of Directors"], ["SG"], "untilChanged", hints=["register of directors"]),
 dt("sg.members", "股东名册", "股东名册", ["Register of Members", "Electronic Register of Members"], ["SG"], "untilChanged", hints=["register of members"]),
 dt("sg.rorc", "可登记控制人登记册", "受益所有人登记", ["Register of Registrable Controllers", "RORC"], ["SG"], "untilChanged", hints=["registrable controller"]),
 # BVI
 dt("vg.coi", "注册证书", "注册证书", ["Certificate of Incorporation"], ["VG"], hints=["british virgin islands", "bvi business companies act", "registrar of corporate affairs"]),
 dt("vg.ma", "公司章程", "章程", ["Memorandum and Articles of Association", "Memorandum of Association"], ["VG"], hints=["memorandum and articles", "bvi business companies act"]),
 dt("vg.cogs", "存续证明", "存续证明", ["Certificate of Good Standing"], ["VG"], "monthsAfterIssue", 6, hints=["good standing", "british virgin islands", "registrar of corporate affairs"]),
 dt("vg.incumbency", "董事在职证明", "在职证明", ["Certificate of Incumbency"], ["VG"], "monthsAfterIssue", 6, hints=["incumbency", "british virgin islands"]),
 dt("vg.directors", "董事名册", "董事名册", ["Register of Directors"], ["VG"], "untilChanged", hints=["register of directors", "british virgin islands"]),
 dt("vg.members", "股东名册", "股东名册", ["Register of Members"], ["VG"], "untilChanged", hints=["register of members", "british virgin islands"]),
 dt("vg.bo", "实益拥有人登记", "受益所有人登记", ["Register of Beneficial Owners", "BOSS"], ["VG"], "untilChanged", hints=["beneficial owner"]),
 # 开曼
 dt("ky.coi", "注册证书", "注册证书", ["Certificate of Incorporation"], ["KY"], hints=["cayman islands", "exempted company", "registrar of companies"]),
 dt("ky.ma", "公司章程", "章程", ["Memorandum and Articles of Association"], ["KY"], hints=["memorandum and articles", "cayman islands"]),
 dt("ky.cogs", "存续证明", "存续证明", ["Certificate of Good Standing"], ["KY"], "monthsAfterIssue", 6, hints=["good standing", "cayman islands"]),
 dt("ky.incumbency", "董事在职证明", "在职证明", ["Certificate of Incumbency"], ["KY"], "monthsAfterIssue", 6, hints=["incumbency", "cayman islands"]),
 dt("ky.directors", "董事及高管名册", "董事名册", ["Register of Directors and Officers"], ["KY"], "untilChanged", hints=["register of directors and officers"]),
 dt("ky.members", "股东名册", "股东名册", ["Register of Members"], ["KY"], "untilChanged", hints=["register of members", "cayman islands"]),
 dt("ky.bo", "实益拥有人登记", "受益所有人登记", ["Beneficial Ownership Register", "Register of Beneficial Ownership"], ["KY"], "untilChanged", hints=["beneficial ownership"]),
 dt("ky.annual-return", "年报回执", "年报回执", ["Annual Return", "Annual Return Receipt"], ["KY"], hints=["annual return", "cayman islands"]),
 # 美属维尔京群岛
 dt("vi.formation", "成立证书", "注册证书", ["Certificate of Formation", "Articles of Organization", "Certificate of Incorporation"], ["VI"], hints=["virgin islands of the united states", "lieutenant governor", "division of corporations"]),
 dt("vi.operating", "运营协议", "章程", ["Operating Agreement", "Bylaws"], ["VI"], hints=["operating agreement"]),
 dt("vi.cogs", "存续证明", "存续证明", ["Certificate of Good Standing", "Certificate of Existence"], ["VI"], "monthsAfterIssue", 6, hints=["good standing", "virgin islands"]),
 dt("vi.annual", "年报与特许经营税收据", "年报回执", ["Annual Report", "Franchise Tax Receipt"], ["VI"], hints=["franchise tax", "annual report", "catalyst"]),
 # 日本
 dt("jp.rireki", "履历事项全部证明书", "存续证明", ["履歴事項全部証明書", "登記簿謄本", "Certificate of Registered Matters"], ["JP"], "monthsAfterIssue", 3, hints=["履歴事項全部証明書", "法務局", "会社法人等番号"]),
 dt("jp.teikan", "定款", "章程", ["定款", "Articles of Incorporation"], ["JP"], hints=["定款", "第1章 総則"]),
 dt("jp.inkan", "印鉴证明书", "印章证明", ["印鑑証明書"], ["JP"], "monthsAfterIssue", 3, hints=["印鑑証明書", "登記官"]),
 dt("jp.tax", "法人税申告书副本", "税务申报", ["法人税申告書", "申告書控え"], ["JP"], hints=["法人税", "確定申告"]),
 # 韩国
 dt("kr.registry", "法人登记簿誊本", "存续证明", ["법인등기부등본", "등기사항전부증명서", "Certificate of Corporate Registration"], ["KR"], "monthsAfterIssue", 3, hints=["등기사항전부증명서", "법인등기부", "등기번호"]),
 dt("kr.bizreg", "事业者登记证", "商业登记", ["사업자등록증", "Business Registration Certificate"], ["KR"], "untilChanged", hints=["사업자등록증", "국세청"]),
 dt("kr.articles", "章程", "章程", ["정관", "Articles of Incorporation"], ["KR"], hints=["정관", "제1장 총칙"]),
 dt("kr.shareholders", "股东名册", "股东名册", ["주주명부", "사원명부"], ["KR"], "untilChanged", hints=["주주명부"]),
 dt("kr.seal", "法人印鉴证明书", "印章证明", ["법인인감증명서"], ["KR"], "monthsAfterIssue", 3, hints=["인감증명서"]),
 # 台湾（基础条目，按需在“设置 → 档案条目”里增删）
 dt("tw.registration", "公司设立（变更）登记表", "注册证书", ["公司設立登記表", "公司變更登記表", "登記表"], ["TW"], "untilChanged", hints=["設立登記表", "變更登記表", "統一編號"]),
 dt("tw.approval", "公司登记核准函", "存续证明", ["核准函", "公司登記核准函"], ["TW"], hints=["核准", "經濟部"]),
 dt("tw.articles", "公司章程", "章程", ["公司章程", "章程"], ["TW"], hints=["章程", "第一章 總則"]),
 dt("tw.members", "股东名簿", "股东名册", ["股東名簿"], ["TW"], "untilChanged", hints=["股東名簿"]),
 dt("tw.directors", "董事名册", "董事名册", ["董事名冊", "董監事名單"], ["TW"], "untilChanged", hints=["董事", "監察人"]),
]

def rule(id, name, local, juris, schedule, responsible, penalty, notes="", required=(), forms=(), enabled=True, adjust="none"):
    return dict(id=id, name=name, localName=local, jurisdictions=list(juris), entityForms=list(forms), schedule=schedule,
                adjust=adjust, requiredDocTypeIDs=list(required), responsibleHint=responsible, penalty=penalty,
                notes=notes, needsReview=True, enabled=enabled, builtIn=True)

def fixed(md): return dict(kind="annualFixed", date=md)
def anniv(days): return dict(kind="afterAnniversary", days=days)
def fye(months=0, days=0):
    d = dict(kind="afterFiscalYearEnd", months=months)
    if days: d["days"] = days
    return d
def half(a, b): return dict(kind="incorporationHalf", firstHalf=a, secondHalf=b)
def docexp(t): return dict(kind="documentExpiry", documentTypeID=t)
def event(kind, days): return dict(kind="event", event=kind, days=days)

R = [
 # 香港
 rule("hk.annual-return", "周年申报表", "Annual Return (NAR1)", ["HK"], anniv(42), "公司秘书",
      "逾期按时长分档收费，最高可被检控", "每个成立周年日后 42 天内交公司注册处。"),
 rule("hk.br-renewal", "商业登记证续期", "Business Registration Renewal", ["HK"], docexp("hk.br"), "公司秘书或会计",
      "逾期罚款，并可被检控", "按现有商业登记证的到期日提醒；登记证有 1 年和 3 年两种。"),
 rule("hk.profits-tax", "利得税报税表", "Profits Tax Return (BIR51)", ["HK"], fixed("05-02"), "税务代表或会计师",
      "罚款，并可能被估税", "税务局通常 4 月初发出，期限一个月；有会计师延期安排的，改成延期后的日期。附经审计账目。"),
 rule("hk.agm", "周年大会或书面决议", "Annual General Meeting", ["HK"], fye(9), "公司秘书",
      "董事可被罚款", "私人公司在会计参照期结束后 9 个月内举行，可用全体成员书面决议代替；单一成员公司可豁免。"),
 rule("hk.officer-change", "董事、秘书变更通知", "ND2A / ND2B", ["HK"], event("directorChange", 15), "公司秘书", "逾期罚款", "变更后 15 天内通知公司注册处。"),
 rule("hk.address-change", "注册地址变更通知", "NR1", ["HK"], event("addressChange", 15), "公司秘书", "逾期罚款", "变更后 15 天内通知公司注册处。"),
 rule("hk.scr-update", "更新重要控制人登记册", "SCR update", ["HK"], event("shareholderChange", 7), "公司秘书", "属刑事罪行，可被罚款", "控制人变更后更新登记册；7 天期限有待核对。"),
 # 新加坡
 rule("sg.agm", "周年大会", "Annual General Meeting", ["SG"], fye(6), "公司秘书", "罚款，董事可被追责", "财年结束后 6 个月内；私人公司可经成员同意豁免。"),
 rule("sg.annual-return", "周年申报", "Annual Return (ACRA)", ["SG"], fye(7), "公司秘书", "逾期 3 个月内 300 新元，超过 3 个月 600 新元", "财年结束后 7 个月内向 ACRA 申报。"),
 rule("sg.eci", "估计应税收入", "Estimated Chargeable Income", ["SG"], fye(3), "税务代理", "可被估税", "财年结束后 3 个月内；收入 500 万新元以下且应税收入为零可免报。"),
 rule("sg.form-c", "企业所得税申报", "Form C / C-S / C-S Lite", ["SG"], fixed("11-30"), "税务代理", "罚款，欠税加收滞纳金", "每年 11 月 30 日前电子申报上一财年。"),
 rule("sg.rorc-update", "更新可登记控制人登记册", "RORC update", ["SG"], event("shareholderChange", 7), "公司秘书", "罚款", "变更后 7 天内更新，并在之后 2 个工作日内报送中央登记册。"),
 rule("sg.officer-change", "董事、高管变更申报", "Change of Officers", ["SG"], event("directorChange", 14), "公司秘书", "逾期罚款", "变更后 14 天内向 ACRA 申报。"),
 # BVI
 rule("vg.annual-fee", "政府年费", "Annual Registration Fee", ["VG"], half("05-31", "11-30"), "注册代理",
      "逾期加收 10%，再逾期加收 50%，之后可能被除名", "1–6 月成立的公司 5 月 31 日前缴，7–12 月成立的 11 月 30 日前缴。"),
 rule("vg.annual-return", "年度财务申报", "Annual Return (financial)", ["VG"], fye(9), "注册代理",
      "首月 300 美元，之后每月 200 美元，最高 5,000 美元", "财年结束后 9 个月内把资产负债表和损益表交给注册代理；向 BVI 税务局报税的公司可豁免。"),
 rule("vg.es-return", "经济实质申报", "Economic Substance Return", ["VG"], fye(6), "注册代理", "罚款", "财年结束后 6 个月内经注册代理申报。"),
 rule("vg.register-update", "董事名册变更报送", "Register of Directors update", ["VG"], event("directorChange", 30), "注册代理", "罚款，且无法取得存续证明", "董事变更后 30 天内报送。"),
 rule("vg.bo-update", "股东及实益拥有人变更报送", "Members / BO register update", ["VG"], event("shareholderChange", 30), "注册代理", "罚款，且无法取得存续证明", "股东或实益拥有人变更后 30 天内报送。"),
 # 开曼
 rule("ky.annual-return", "周年申报与年费", "Annual Return and Annual Fee", ["KY"], fixed("01-31"), "注册办事处", "罚款，严重时被除名", "每年 1 月 31 日前向公司注册处申报并缴费。"),
 rule("ky.es-notification", "经济实质通知", "Economic Substance Notification", ["KY"], fixed("01-31"), "注册办事处", "罚款", "通常与周年申报一起提交。"),
 rule("ky.es-return", "经济实质报告", "Economic Substance Return", ["KY"], fye(12), "注册办事处或顾问", "罚款，可被视为不符合经济实质", "只有从事“相关活动”的公司需要，默认关闭。", enabled=False),
 rule("ky.bo-update", "实益拥有人信息更新", "Beneficial Ownership update", ["KY"], event("shareholderChange", 30), "注册办事处", "罚款", "实益拥有人变更后告知注册办事处更新；期限有待核对。"),
 # 美属维尔京群岛
 rule("vi.annual-report", "年度报告与特许经营税", "Annual Report and Franchise Tax", ["VI"], fixed("06-30"), "注册代理",
      "7 月 1 日起加收罚款和利息，状态降为不良，无法取得存续证明", "每年 6 月 30 日前经 Catalyst 系统提交。"),
 # 日本
 rule("jp.corp-tax", "法人税申告", "法人税・地方法人税申告", ["JP"], fye(2), "税理士", "无申告加算税和延滞税", "财年结束后 2 个月内；设有会计监查人等情况可申请延长 1 个月。", adjust="nextBusinessDay"),
 rule("jp.consumption-tax", "消费税申告", "消費税申告", ["JP"], fye(2), "税理士", "无申告加算税和延滞税", "只有课税事业者需要。", adjust="nextBusinessDay"),
 rule("jp.agm", "定时股东大会", "定時株主総会", ["JP"], fye(3), "董事或司法书士", "", "通常在财年结束后 3 个月内召开。", forms=["株式会社"]),
 rule("jp.officer-registration", "董事变更登记", "役員変更登記", ["JP"], event("directorChange", 14), "司法书士", "最高 100 万日元过料", "变更生效后 2 周内登记；任期届满重任也需要登记。"),
 rule("jp.address-registration", "总公司迁址登记", "本店移転登記", ["JP"], event("addressChange", 14), "司法书士", "过料", "迁址后 2 周内登记。"),
 # 韩国
 rule("kr.corp-tax", "法人税申报", "법인세 신고", ["KR"], fye(3), "税务师", "未申报加算税 20% 起，另有滞纳金", "财年结束后 3 个月内申报并缴纳；12 月结账的为 3 月 31 日。", adjust="nextBusinessDay"),
 rule("kr.local-tax", "法人地方所得税申报", "법인지방소득세 신고", ["KR"], fye(4), "税务师", "加算税", "法人税申报期满后 1 个月内，经 Wetax 申报。", adjust="nextBusinessDay"),
 rule("kr.agm", "定期股东大会", "정기주주총회", ["KR"], fye(3), "代表董事", "最高 500 万韩元罚款", "财年结束后 3 个月内召开，批准财务报表。", forms=["주식회사"]),
 rule("kr.change-registration", "变更登记", "변경등기", ["KR"], event("directorChange", 14), "法务士", "罚款", "股东大会决议等变更后 2 周内登记。"),
]

P = [
 dict(id="bank", name="银行开户", categories=["注册证书", "章程", "存续证明", "在职证明", "董事名册", "股东名册", "受益所有人登记"], includeDirectorsPassports=True, maxAgeMonths=3),
 dict(id="audit", name="年度审计", categories=["注册证书", "董事名册", "股东名册", "董事会决议", "年报回执", "审计报告"], includeDirectorsPassports=False),
 dict(id="kyc", name="KYC 更新", categories=["存续证明", "在职证明", "受益所有人登记", "股东名册"], includeDirectorsPassports=True, maxAgeMonths=3),
]

lib = dict(version=3, jurisdictions=J, documentTypes=D, rules=R, packets=P)
out = os.path.join(os.path.dirname(__file__), "..", "Charter", "Resources", "charter-templates.json")
json.dump(lib, open(out, "w"), ensure_ascii=False, indent=2)
ids = [d["id"] for d in D]; assert len(ids) == len(set(ids))
for r in R:
    for t in r["requiredDocTypeIDs"]: assert t in ids
    if r["schedule"]["kind"] == "documentExpiry": assert r["schedule"]["documentTypeID"] in ids
print(len(D), "document types,", len(R), "rules")
