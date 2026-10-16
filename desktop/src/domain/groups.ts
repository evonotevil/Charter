// 集团成员推导：从顶层沿持股往下，排除你排除的公司，再加上手动归入的公司。

import type { Day } from "./day";
import { type Company, type CorporateGroup, type GroupRow, type Holding, type NodeRef, isActiveOn, ref, refKey, sameRef } from "./models";

export const excludedSet = (g: CorporateGroup) => new Set(g.excludedCompanyIDs ?? []);

function children(node: NodeRef, holdings: Holding[]) {
  return holdings.filter((h) => sameRef(h.holder, node) || (h.isNominee && sameRef(h.beneficialOwner, node)));
}

export function groupRows(g: CorporateGroup, all: Holding[], companies: Company[], day: Day): GroupRow[] {
  const holdings = all.filter((h) => isActiveOn(h, day));
  const existing = new Set(companies.map((c) => c.id));
  const excluded = excludedSet(g);
  const best = new Map<string, { depth: number; parent?: NodeRef; percent?: number; nominee: boolean }>();
  const queue: [NodeRef, number][] = [];
  for (const t of g.tops) {
    if (t.kind === "company" && existing.has(t.id) && !excluded.has(t.id)) best.set(t.id, { depth: 0, nominee: false });
    queue.push([t, 0]);
  }
  for (let i = 0; i < queue.length; i++) {
    const [node, d] = queue[i];
    for (const h of children(node, holdings)) {
      if (!existing.has(h.companyID) || excluded.has(h.companyID)) continue;
      const depth = d + 1;
      const nominee = h.isNominee && !sameRef(h.holder, node);
      const b = best.get(h.companyID);
      if (b) {
        if (depth < b.depth || (depth === b.depth && h.percent > (b.percent ?? 0))) best.set(h.companyID, { depth, parent: node, percent: h.percent, nominee });
        continue;
      }
      best.set(h.companyID, { depth, parent: node, percent: h.percent, nominee });
      queue.push([ref("company", h.companyID), depth]);
    }
  }
  const nameOf = (id: string) => companies.find((c) => c.id === id)?.name ?? "";
  const out: GroupRow[] = [];
  const placed = new Set<string>();
  const kidsOf = (parent: NodeRef, depthOne = false) =>
    [...best.entries()].filter(([, v]) => v.parent && sameRef(v.parent, parent) && (!depthOne || v.depth === 1))
      .map(([k]) => k).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const emit = (id: string) => {
    const b = best.get(id);
    if (!b || placed.has(id)) return;
    placed.add(id);
    out.push({ companyID: id, depth: b.depth, parent: b.parent, percent: b.percent, viaNominee: b.nominee, unconnected: false });
    for (const k of kidsOf(ref("company", id))) emit(k);
  };
  for (const t of g.tops) {
    if (t.kind === "company") emit(t.id);
    else for (const k of kidsOf(t, true)) emit(k);
  }
  for (const id of g.extraCompanyIDs) {
    if (existing.has(id) && !placed.has(id) && !excluded.has(id)) {
      placed.add(id);
      out.push({ companyID: id, depth: 0, viaNominee: false, unconnected: true });
    }
  }
  return out;
}

export type GroupMembership =
  | { kind: "top" }
  | { kind: "derived"; path: NodeRef[]; percents: number[] }
  | { kind: "manual" }
  | { kind: "excluded" }
  | { kind: "none" };

export const isMember = (m: GroupMembership) => m.kind === "top" || m.kind === "derived" || m.kind === "manual";
export const sourceLabel = (m: GroupMembership) =>
  ({ top: "顶层", derived: "股权推导", manual: "手动加入", excluded: "已排除", none: "不在集团" })[m.kind];

export function membershipOf(companyID: string, g: CorporateGroup, rows: GroupRow[]): GroupMembership {
  if (excludedSet(g).has(companyID)) return { kind: "excluded" };
  const row = rows.find((r) => r.companyID === companyID);
  if (!row) return { kind: "none" };
  if (row.unconnected) return { kind: "manual" };
  if (!row.parent && g.tops.some((t) => sameRef(t, ref("company", companyID)))) return { kind: "top" };
  const path: NodeRef[] = [ref("company", companyID)];
  const percents: number[] = [];
  let cur: GroupRow = row;
  for (let guard = 0; cur.parent && guard < 64; guard++) {
    percents.unshift(cur.percent ?? 0);
    path.unshift(cur.parent);
    const parent: NodeRef = cur.parent;
    if (parent.kind !== "company") break;
    const next = rows.find((r) => r.companyID === parent.id);
    if (!next) break;
    cur = next;
  }
  return { kind: "derived", path, percents };
}

/** 1.x 的“所属集团”文字迁移为集团。 */
export function legacyGroups(companies: Company[], holdings: Holding[], today: Day, newID: () => string): CorporateGroup[] {
  const names = [...new Set(companies.map((c) => c.group).filter((s) => s))].sort();
  return names.map((name) => {
    const members = new Set(companies.filter((c) => c.group === name).map((c) => c.id));
    const active = holdings.filter((h) => isActiveOn(h, today));
    const roots = [...members].filter((id) => !active.some((h) => h.companyID === id && h.holder.kind === "company" && members.has(h.holder.id)));
    const nameOf = (id: string) => companies.find((c) => c.id === id)?.name ?? "";
    const g: CorporateGroup = {
      id: newID(), name, tops: roots.sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((id) => ref("company", id)),
      extraCompanyIDs: [], notes: "",
    };
    const reach = new Set(groupRows(g, holdings, companies, today).map((r) => r.companyID));
    g.extraCompanyIDs = [...members].filter((id) => !reach.has(id)).sort();
    return g;
  });
}

export { refKey };
