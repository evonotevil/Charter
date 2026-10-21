// 压力测试数据（只在浏览器预览里用：地址加 ?sample&stress）。
// 真实长名称、多职务、缺失字段、中日英混排、数百份材料（含同类多份、新旧版本、过期、未取得、不适用）。

import type { Store } from "./store";
import * as D from "../domain/day";
import { type Appointment, type Company, type Document, type Holding, newPerson, ref, uuid } from "../domain/models";

const LONG: [string, string, string][] = [
  ["Harbor Crest Strategic Infrastructure & Renewable Energy Investment Holdings (Asia Pacific) Pte. Ltd.", "SG", "Private Limited (Pte. Ltd.)"],
  ["远澜跨境供应链管理与数字化贸易服务（深圳前海）有限公司香港分公司", "HK", "私人股份有限公司"],
  ["遠瀾グローバル・デジタル・トランスフォーメーション・ソリューションズ合同会社", "JP", "合同会社"],
  ["Seawind Maritime Logistics Holdings (USVI) LLC – Caribbean Operations", "VI", "LLC"],
  ["明岸資本管理股份有限公司", "TW", ""],
  ["Mingan Korea 유한회사 (Mingan Korea Co., Ltd.)", "KR", "유한회사"],
];

const FILE_NAMES = [
  (t: string, c: string, y: number) => `${y}年度${t}（${c}）已盖章扫描件 final v3.pdf`,
  (t: string, c: string, y: number) => `${c}_${t}_${y}-certified-true-copy.pdf`,
  (t: string, _c: string, y: number) => `scan_${y}0630_${t}.pdf`,
  (t: string, c: string, y: number) => `${t} ${c} ${y}（中英对照，含公证认证页）.pdf`,
];

export async function installStressData(s: Store) {
  const today = s.today;
  const groups = s.data.groups;
  const companies: Company[] = LONG.map(([name, j, form], i) => ({
    ...s.newCompanyDraft(name, j), entityForm: form, registrationNumber: i % 2 ? "" : `REG-${200000 + i * 731}`,
    registeredAddress: i % 3 === 0 ? "" : "Suite 2801-2805, 28/F, One Island East, 18 Westlands Road, Taikoo Place, Quarry Bay, Hong Kong",
    incorporationDate: i === 4 ? undefined : D.addMonths(today, -14 - i * 9),
  }));
  const alex = newPerson("Alexandra Catherine Montgomery-Whitfield");
  const sato = newPerson("佐藤 健一郎（Kenichiro Sato）");
  const parentOf = (i: number) => s.data.companies[i % s.data.companies.length];
  const holdings: Holding[] = companies.map((c, i) => ({ id: uuid(), holder: i === 5 ? ref("person", alex.id) : ref("company", parentOf(i).id), companyID: c.id,
    percent: i === 3 ? 66.67 : 100, shares: "", shareClass: "", isNominee: false, asOf: D.addMonths(today, -3), verified: false, ...(i === 2 ? { roleID: "jp.shain" } : {}) }));
  const appts: Appointment[] = [];
  for (const c of [...companies, ...s.data.companies.slice(0, 4)]) {
    appts.push({ id: uuid(), personID: alex.id, companyID: c.id, title: "董事", roleID: "common.director", asOf: D.addMonths(today, -2), verified: false });
    appts.push({ id: uuid(), personID: alex.id, companyID: c.id, title: "公司秘书", roleID: "common.secretary", asOf: D.addMonths(today, -2), verified: false });
  }
  appts.push({ id: uuid(), personID: sato.id, companyID: companies[2].id, title: "職務執行者", roleID: "jp.shokumu", verified: false });

  const docs: Document[] = [];
  const all = [...s.data.companies, ...companies];
  let k = 0;
  for (const c of all) {
    const types = s.templateItems(c.jurisdiction);
    for (const [ti, typeID] of types.entries()) {
      const t = s.docType(typeID);
      if (!t) continue;
      if ((ti + k) % 7 === 3) continue; // 缺件
      const versions = 1 + ((ti + k) % 4 === 0 ? 2 : 0);
      let prev: Document | undefined;
      for (let v = 0; v < versions; v++) {
        const y = 2021 + v + (ti % 3);
        const issued = `${y}-0${1 + (ti % 9)}-1${v}`;
        const d: Document = { id: uuid(), typeID, owner: ref("company", c.id), issueDate: issued,
          expiryDate: (ti + k) % 5 === 1 ? D.addDays(today, ((ti * 37 + k * 11) % 160) - 60) : undefined,
          form: "扫描件", filePath: `/stress/${c.id}/${uuid()}.pdf`, originalFileName: FILE_NAMES[(ti + v + k) % 4](t.name, c.name, y),
          needsUpdate: false, addedOn: D.addDays(today, -((ti * 13 + k) % 400)), notes: "" };
        if (prev) prev.supersededBy = d.id;
        docs.push(d); prev = d;
      }
      // 同类多份（都是现行）：例如两份董事名册分别对应不同股份类别
      if ((ti + k) % 6 === 1) docs.push({ id: uuid(), typeID, owner: ref("company", c.id), issueDate: "2025-06-30", form: "电子版",
        filePath: `/stress/${c.id}/${uuid()}.pdf`, originalFileName: `${t.name}（B 类股份）.pdf`, needsUpdate: false, addedOn: today, notes: "B 类股份" });
    }
    k++;
  }
  s.commit((d) => {
    d.people.push(alex as any, sato as any);
    d.companies.push(...(companies as any[]));
    d.holdings.push(...(holdings as any[]));
    d.appointments.push(...(appts as any[]));
    d.documents.push(...(docs as any[]));
    // 缺件标记：未取得、不适用
    for (const [i, c] of d.companies.entries()) {
      const ids = s.templateItems(c.jurisdiction);
      c.archive = c.archive ?? { added: [], removed: [], marks: {}, notes: {} };
      if (ids[3]) c.archive.marks[ids[3]] = i % 2 ? "notObtained" : "notApplicable";
    }
    if (groups[0]) groups[0] && d.groups[0].extraCompanyIDs.push(companies[0].id);
  }, { label: "载入压力测试数据" });
}
