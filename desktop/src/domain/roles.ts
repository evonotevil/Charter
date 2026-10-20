// 4.4 法域角色表：本地名称 + 归入三大类。结构图、检索、规则按大类理解，界面显示本地名称。

export type RoleCategory = "owner" | "manager" | "representative";
export const roleCategoryLabel: Record<RoleCategory, string> = { owner: "所有者", manager: "管理者", representative: "秘书与代表" };

export interface Role { id: string; name: string; local?: string; category: RoleCategory; jurisdictions?: string[]; entityForms?: RegExp }

/** jurisdictions 为空 = 所有法域通用；entityForms 限定实体类型（如合同会社、LLC）。 */
export const roles: Role[] = [
  { id: "common.shareholder", name: "股东", category: "owner" },
  { id: "common.director", name: "董事", category: "manager" },
  { id: "common.alternate", name: "候补董事", category: "manager" },
  { id: "common.secretary", name: "公司秘书", category: "representative" },
  { id: "common.authorised", name: "授权代表", category: "representative" },
  { id: "sg.local", name: "本地董事", category: "manager", jurisdictions: ["SG"] },
  { id: "hk.rep", name: "指定代表", local: "Designated Representative", category: "representative", jurisdictions: ["HK"] },
  { id: "jp.daihyo", name: "代表取締役", category: "manager", jurisdictions: ["JP"], entityForms: /株式会社/ },
  { id: "jp.torishimari", name: "取締役", category: "manager", jurisdictions: ["JP"], entityForms: /株式会社/ },
  { id: "jp.kansa", name: "監査役", category: "manager", jurisdictions: ["JP"], entityForms: /株式会社/ },
  { id: "jp.shain", name: "社員", category: "owner", jurisdictions: ["JP"], entityForms: /合同会社/ },
  { id: "jp.gyomu", name: "業務執行社員", category: "manager", jurisdictions: ["JP"], entityForms: /合同会社/ },
  { id: "jp.daihyoshain", name: "代表社員", category: "representative", jurisdictions: ["JP"], entityForms: /合同会社/ },
  { id: "jp.shokumu", name: "職務執行者", category: "representative", jurisdictions: ["JP"], entityForms: /合同会社/ },
  { id: "llc.member", name: "Member", local: "成员", category: "owner", jurisdictions: ["VI", "US", "KR"], entityForms: /LLC|유한/ },
  { id: "llc.manager", name: "Manager", local: "经理", category: "manager", jurisdictions: ["VI", "US"], entityForms: /LLC/ },
  { id: "tw.chairman", name: "董事長", category: "representative", jurisdictions: ["TW"] },
  { id: "tw.supervisor", name: "監察人", category: "manager", jurisdictions: ["TW"] },
  { id: "tw.manager", name: "經理人", category: "manager", jurisdictions: ["TW"] },
  { id: "kr.ceo", name: "대표이사", local: "代表理事", category: "representative", jurisdictions: ["KR"] },
  { id: "kr.director", name: "이사", local: "理事", category: "manager", jurisdictions: ["KR"] },
  { id: "kr.auditor", name: "감사", local: "监事", category: "manager", jurisdictions: ["KR"] },
  { id: "us.officer", name: "Officer", local: "高管", category: "manager", jurisdictions: ["US", "VI"] },
];

export const roleByID = (id?: string) => roles.find((r) => r.id === id);

/** 某家公司可选的角色：通用 + 本法域（且实体类型匹配）。 */
export function rolesFor(jurisdiction: string, entityForm = "", category?: RoleCategory): Role[] {
  return roles.filter((r) => (!category || r.category === category)
    && (!r.jurisdictions || r.jurisdictions.includes(jurisdiction))
    && (!r.entityForms || r.entityForms.test(entityForm)));
}

/** 显示名：本地名称在前，必要时带中文说明。 */
export const roleLabel = (r: Role) => (r.local ? `${r.name}（${r.local}）` : r.name);

/** 从自由文本职务猜角色（迁移和兼容旧数据用）。 */
export function guessRole(title: string, jurisdiction: string, entityForm = ""): Role | undefined {
  const t = title.trim().toLowerCase();
  const pool = rolesFor(jurisdiction, entityForm);
  return pool.find((r) => r.name.toLowerCase() === t || r.local?.toLowerCase() === t)
    ?? (/秘书|secretary/.test(t) ? roleByID("common.secretary") : /董事|director/.test(t) ? roleByID("common.director") : undefined);
}
