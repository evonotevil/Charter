// 一套虚构的示例数据（远澜、明岸等 17 家公司），用于试用。不含任何真实信息。

import * as D from "../domain/day";
import type { Day } from "../domain/day";
import { type Appointment, type Company, type Holding, type NodeRef, type Party, type Person, ref, uuid } from "../domain/models";
import { legacyGroups } from "../domain/groups";
import { platform } from "../platform/platform";
import type { Store } from "./store";

/** 最小可用的单页 PDF（只用 ASCII 文字）。 */
export function simplePDF(title: string, subtitle: string, lines: string[]): Uint8Array {
  const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, "").replace(/([()\\])/g, "\\$1");
  const text = [
    `BT /F1 20 Tf 72 740 Td (${ascii(title) || "Document"}) Tj ET`,
    `BT /F1 12 Tf 72 712 Td (${ascii(subtitle)}) Tj ET`,
    ...lines.filter(Boolean).map((l, i) => `BT /F1 11 Tf 72 ${670 - i * 18} Td (${ascii(l)}) Tj ET`),
  ].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export async function installSampleData(s: Store) {
  const d0 = s.data;
  if (d0.companies.length || d0.documents.length || d0.people.length) await s.snapshotBeforeChange("载入示例数据前");
  s.undoStack = []; s.redoStack = [];
  const today = s.today;
  const since = D.addDays(today, -20);
  const party = (name: string, kind: Party["kind"], contactName: string, email: string, followUpDays = 14): Party =>
    ({ id: uuid(), name, kind, contactName, email, phone: "", followUpDays, notes: "" });
  const lime = party("Lime Tree Corporate Services", "agent", "Emma Walters", "emma@limetree.example", 10);
  const mingde = party("明德秘书服务有限公司", "agent", "陈小姐", "cs@mingde.example", 7);
  const tortola = party("Tortola Agents Ltd", "agent", "James Penn", "james@tortola.example");
  const lion = party("Lion City Corporate Services", "agent", "Rachel Tan", "rachel@lioncity.example");
  const catalyst = party("St. Thomas Registered Agents", "agent", "", "filings@stthomas.example");
  const aoyama = party("青山税理士法人", "agent", "佐藤", "sato@aoyama.example");
  const hanbit = party("한빛세무회계", "agent", "김민지", "minji@hanbit.example");
  const finance = party("财务部", "agent", "李经理", "finance@yuanlan.example", 5);
  const legal = party("法务部", "agent", "周律师", "legal@yuanlan.example", 5);
  const kreston = party("Kreston Tax Advisory", "agent", "Melissa Ong", "melissa@kreston.example");
  const C2 = (name: string, role: string, email: string, phone = "") => ({ id: uuid(), name, role, email, phone });
  mingde.contacts = [C2("陈小姐", "公司秘书", "cs@mingde.example", "+852 2123 4567"), C2("Kelvin Ho", "税务", "kelvin@mingde.example")];
  lion.contacts = [C2("Rachel Tan", "年审", "rachel@lioncity.example", "+65 6123 4567"), C2("Jason Lim", "秘书事务", "jason@lioncity.example")];
  tortola.contacts = [C2("James Penn", "注册代理", "james@tortola.example")];
  aoyama.contacts = [C2("佐藤 美咲", "税理士", "sato@aoyama.example")];
  kreston.contacts = [C2("Melissa Ong", "税务经理", "melissa@kreston.example")];
  mingde.notes = "香港 · 公司秘书、周年申报"; lion.notes = "新加坡 · 公司秘书、年报"; tortola.notes = "BVI · 注册代理"; kreston.notes = "新加坡 · 企业所得税";
  const parties = [lime, mingde, tortola, lion, catalyst, aoyama, hanbit, kreston, finance, legal];

  const person = (name: string, aliases: string[], notes = ""): Person => ({ id: uuid(), name, aliases, email: "", notes });
  const zhang = person("张三", ["Zhang San"]);
  const wang = person("王五", ["Wang Wu"], "名义股东，代张三持有遠瀾テクノロジー 30%");
  const sato = person("佐藤健", ["Ken Sato"]);
  const tan = person("Tan Wei Ling", ["陈慧玲"]);
  const people = [zhang, wang, sato, tan];

  const co = (name: string, j: string, form: string, inc: Day, group: string, p: Party, reg: string, aliases: string[] = [], fye = "12-31"): Company => ({
    id: uuid(), name, formerNames: [], aliases, jurisdiction: j, entityForm: form, registrationNumber: reg, incorporationDate: inc,
    fiscalYearEnd: fye, status: "active", group, registeredAddress: "", defaultPartyID: p.id, rulePartyIDs: {}, disabledRuleIDs: [],
    trackingSince: since, notes: "",
  });
  const ky = co("Yuanlan Group Ltd.", "KY", "豁免公司 (Exempted Company)", "2020-01-15", "远澜集团", lime, "CT-361204", ["开曼控股"]);
  ky.registeredAddress = "Suite 4-210, Governors Square, Grand Cayman";
  const hk = co("远澜控股（香港）有限公司", "HK", "私人股份有限公司", "2019-11-12", "远澜集团", mingde, "2891043", ["香港控股", "Yuanlan Holdings (HK)"], "03-31");
  hk.rulePartyIDs["hk.profits-tax"] = finance.id;
  const hkt = co("远澜贸易（香港）有限公司", "HK", "私人股份有限公司", "2021-04-01", "远澜集团", mingde, "3017755", ["香港贸易"], "03-31");
  const sg = co("Yuanlan International Pte. Ltd.", "SG", "Private Limited (Pte. Ltd.)", "2020-09-01", "远澜集团", lion, "202024517K", ["新加坡国际"]);
  sg.rulePartyIDs["sg.form-c"] = finance.id;
  const sgv = co("Yuanlan Ventures Pte. Ltd.", "SG", "Private Limited (Pte. Ltd.)", "2024-05-02", "远澜集团", lion, "202418830D");
  const jp = co("遠瀾テクノロジー株式会社", "JP", "株式会社", "2021-08-01", "远澜集团", aoyama, "0104-01-158204", ["日本科技", "Yuanlan Technology"], "03-31");
  const kr = co("Yuanlan Korea LLC", "KR", "유한회사", "2023-02-01", "远澜集团", hanbit, "110114-0298811", ["韩国公司", "원란코리아"]);
  const bvi = co("Yuanlan Holdings (BVI) Ltd.", "VG", "BVI Business Company", "2019-06-10", "远澜集团", tortola, "1987342");
  const hc = co("Harbor Crest Investments Ltd", "VG", "BVI Business Company", "2018-09-20", "Harbor Crest", tortola, "1893015");
  const hcc = co("Harbor Crest Capital Ltd.", "KY", "豁免公司 (Exempted Company)", "2022-08-15", "Harbor Crest", lime, "CT-389921");
  const vi = co("Seawind Assets (USVI) LLC", "VI", "LLC", "2021-05-10", "独立公司", catalyst, "LLC-0021187");
  const cube = co("立方咨询有限公司", "HK", "私人股份有限公司", "2017-07-07", "独立公司", mingde, "2551270");
  vi.group = ""; cube.group = "";
  // 共用的顶层控股公司：在各品牌之上
  const top = co("Northstar Holdings Ltd.", "KY", "豁免公司 (Exempted Company)", "2018-03-12", "", lime, "CT-350118");
  const mab = co("Mingan Investments (BVI) Ltd.", "VG", "BVI Business Company", "2025-03-20", "明岸", tortola, "2045531");
  const mah = co("明岸（香港）有限公司", "HK", "私人股份有限公司", "2025-04-15", "明岸", mingde, "3311208", ["Mingan (HK)"], "03-31");
  const mas = co("Mingan Singapore Pte. Ltd.", "SG", "Private Limited (Pte. Ltd.)", "2025-05-02", "明岸", lion, "202518830D");
  mas.rulePartyIDs["sg.form-c"] = kreston.id;
  const maj = co("株式会社明岸ジャパン", "JP", "株式会社", "2025-06-18", "明岸", aoyama, "0104-01-198204", ["Mingan Japan"], "03-31");
  const companies = [top, ky, hk, hkt, sg, sgv, jp, kr, bvi, hc, hcc, vi, cube, mab, mah, mas, maj];

  const P = (x: Person) => ref("person", x.id), C = (x: Company) => ref("company", x.id);
  const h = (holder: NodeRef, c: Company, percent: number, shares: string, from: Day, extra: Partial<Holding> = {}): Holding =>
    ({ id: uuid(), holder, companyID: c.id, percent, shares, shareClass: "", isNominee: false, from, ...extra });
  const holdings: Holding[] = [
    h(P(zhang), top, 100, "1", "2018-03-12"),
    h(C(top), ky, 100, "1", "2020-01-15"),
    h(C(top), mab, 100, "50,000", "2025-03-20"),
    h(C(mab), mah, 100, "10,000", "2025-04-15"),
    h(C(mab), mas, 100, "100,000", "2025-05-02"),
    h(C(mab), maj, 100, "1,000", "2025-06-18"),
    h(P(zhang), hk, 100, "10,000", "2019-11-12", { to: "2020-06-30" }),
    h(C(ky), hk, 100, "10,000", "2020-06-30"),
    h(C(ky), sg, 100, "100,000", "2020-09-01"),
    h(C(ky), jp, 70, "700", "2021-08-01"),
    h(P(wang), jp, 30, "300", "2021-08-01", { isNominee: true, beneficialOwner: P(zhang) }),
    h(C(hk), hkt, 100, "10,000", "2021-04-01"),
    h(C(sg), kr, 100, "", "2023-02-01"),
    h(C(sg), sgv, 60, "60,000", "2024-05-02"),
    h(P(zhang), bvi, 100, "50,000", "2019-06-10"),
    h(C(bvi), sgv, 40, "40,000", "2024-05-02"),
    h(P(zhang), hc, 50, "25,000", "2018-09-20"),
    h(C(hc), hcc, 100, "1", "2022-08-15"),
    h(P(zhang), vi, 100, "", "2021-05-10"),
    h(P(zhang), cube, 100, "10,000", "2017-07-07"),
  ];
  const appt = (p: Person, c: Company, title: string, from?: Day): Appointment => ({ id: uuid(), personID: p.id, companyID: c.id, title, from });
  const appointments = [...companies.map((c) => appt(zhang, c, "董事", c.incorporationDate)), appt(sato, jp, "董事", "2021-08-01"), appt(sato, jp, "代表取締役", "2021-08-01"), appt(tan, sg, "本地董事", "2020-09-01"), appt(tan, mas, "本地董事", "2025-05-02"), appt(sato, maj, "代表取締役", "2025-06-18")];
  const changes = [
    { id: uuid(), companyID: hk.id, kind: "shareholderChange" as const, effectiveOn: "2020-06-30", recordedOn: "2020-07-02", summary: "张三将远澜控股（香港）100% 股份转让给 Yuanlan Group Ltd." },
    { id: uuid(), companyID: jp.id, kind: "shareholderChange" as const, effectiveOn: "2021-08-01", recordedOn: "2021-08-03", summary: "设立，Yuanlan Group 持股 70%，王五代张三持股 30%" },
  ];
  const groups = legacyGroups(companies, holdings, today, uuid);
  await s.persistCollections({ parties, people, companies, holdings, appointments, changes, records: [], documents: [], requests: [], groups });
  s.replace({ parties, people, companies, holdings, appointments, changes, records: [], documents: [], requests: [], groups });

  // 示例文件
  const p = platform();
  const tmp = p.join(await p.tempDir(), "charter-sample-" + uuid().slice(0, 8));
  await p.mkdirs(tmp);
  const reqs: { path: string; typeID: string; owner: NodeRef; issued?: Day; expiry?: Day }[] = [];
  const doc = async (typeID: string, owner: NodeRef, issued?: Day, expiry?: Day) => {
    const t = s.docType(typeID);
    if (!t) return;
    const file = p.join(tmp, uuid() + ".pdf");
    await p.writeBytes(file, simplePDF(t.localNames[0] ?? t.name, s.nameOf(owner),
      ["Sample document for trying Charter.", issued ? `Date of issue: ${issued}` : "", expiry ? `Date of expiry: ${expiry}` : ""]));
    reqs.push({ path: file, typeID, owner, issued, expiry });
  };
  const K = C(ky);
  await doc("ky.coi", K, "2020-01-15");
  await doc("ky.ma", K, "2020-01-15");
  await doc("ky.cogs", K, D.addDays(D.addMonths(today, -6), -12));
  await doc("ky.incumbency", K, D.addDays(D.addMonths(today, -6), 18));
  await doc("ky.directors", K, "2026-02-03");
  await doc("ky.members", K, "2026-02-03");
  await doc("ky.bo", K, "2026-02-03");
  await doc("hk.coi", C(hk), "2019-11-12");
  await doc("hk.br", C(hk), D.addMonths(D.addDays(today, 34), -12), D.addDays(today, 34));
  await doc("hk.articles", C(hk), "2019-11-12");
  // 远澜控股（香港）与 Yuanlan International 材料齐全，可随时出银行开户和 KYC 文件包；
  // Harbor Crest Investments 只够 KYC。这样总览里能看出“齐全”和“还缺”的差别。
  await doc("hk.cr-search", C(hk), D.addDays(today, -20));
  await doc("hk.incumbency", C(hk), D.addDays(today, -20));
  await doc("hk.directors", C(hk), "2025-06-30");
  await doc("hk.members", C(hk), "2025-06-30");
  await doc("hk.scr", C(hk), "2025-06-30");
  await doc("sg.constitution", C(sg), "2020-09-01");
  await doc("sg.incumbency", C(sg), D.addDays(today, -40));
  await doc("sg.directors", C(sg), "2025-03-12");
  await doc("sg.members", C(sg), "2025-03-12");
  await doc("sg.rorc", C(sg), "2025-03-12");
  await doc("vg.incumbency", C(hc), D.addMonths(today, -2));
  await doc("vg.members", C(hc), "2024-11-08");
  await doc("vg.bo", C(hc), "2024-11-08");
  await doc("hk.br", C(hkt), D.addMonths(D.addDays(today, 120), -36), D.addDays(today, 120));
  await doc("sg.coi", C(sg), "2020-09-01");
  await doc("sg.bizprofile", C(sg), D.addDays(today, -51));
  await doc("jp.rireki", C(jp), D.addDays(today, -98));
  await doc("jp.teikan", C(jp), "2021-08-01");
  await doc("kr.registry", C(kr), D.addDays(today, -122));
  await doc("vg.cogs", C(hc), D.addMonths(today, -2));
  await doc("vi.cogs", C(vi), D.addMonths(today, -4));
  await doc("common.passport", P(zhang), "2021-03-02", "2031-03-01");
  await doc("common.passport", P(wang), "2019-12-09", D.addDays(today, 25));
  try { await s.archiveBatch(reqs); } catch (e) { s.setError(`示例文件没有全部生成：${(e as Error).message}`); }
  try { await p.removeDir(tmp); } catch { /* 忽略 */ }
  s.onDataCleared?.();
  s.showToast("示例数据已载入：17 家公司、4 个人、10 家中介。");
}
