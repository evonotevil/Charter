// 截止日计算、文件有效期、股权穿透与持股校验。逐行移植自 Swift 版 Engine/。

import * as D from "./day";
import type { Day } from "./day";
import {
  type Company, type ChangeRecord, type DateAdjust, type Document, type DocumentType, type Holding, type NodeRef,
  type ObligationRecord, type ObligationStatus, type RuleTemplate, type RuleTrust, type RuleVerification, type SharedSettings,
  effectiveRule, generatesObligations, isActiveOn, obligationKey, ref, refKey, ruleApplies, sameRef,
} from "./models";

// MARK: - 合规事项

export interface Obligation {
  key: string;
  rule: RuleTemplate;
  company: Company;
  originalDue: Day;
  due: Day;
  record?: ObligationRecord;
}
export const obligationStatus = (o: Obligation): ObligationStatus => o.record?.status ?? "pending";
export const obligationDone = (o: Obligation) => obligationStatus(o) === "done";
export const daysLeft = (o: Obligation, today: Day) => D.daysBetween(today, o.due);

export function adjustDay(d: Day, a: DateAdjust): Day {
  if (a === "none") return d;
  let x = d;
  const step = a === "previousBusinessDay" ? -1 : 1;
  while (D.isWeekend(x)) x = D.addDays(x, step);
  return x;
}

export function dueDates(rule: RuleTemplate, company: Company, documents: Document[], start: Day, end: Day): Day[] {
  const s = rule.schedule;
  const years: number[] = [];
  for (let y = D.year(start) - 1; y <= D.year(end) + 1; y++) years.push(y);
  let raw: Day[] = [];
  const inc = company.incorporationDate;
  switch (s.kind) {
    case "annualFixed":
      if (!s.date) return [];
      raw = years.map((y) => D.inYear(s.date!, y));
      break;
    case "afterAnniversary":
      if (!inc) return [];
      raw = years.filter((y) => y > D.year(inc)).map((y) => D.addDays(D.makeDay(y, D.month(inc), D.dayOf(inc)), s.days ?? 0));
      break;
    case "afterFiscalYearEnd":
      raw = years.flatMap((y) => {
        const fye = D.inYear(company.fiscalYearEnd, y);
        if (inc && fye < inc) return [];
        return [D.addDays(D.addMonths(fye, s.months ?? 0), s.days ?? 0)];
      });
      break;
    case "incorporationHalf": {
      if (!inc || !s.firstHalf || !s.secondHalf) return [];
      const md = D.month(inc) <= 6 ? s.firstHalf : s.secondHalf;
      raw = years.filter((y) => y > D.year(inc)).map((y) => D.inYear(md, y));
      break;
    }
    case "documentExpiry": {
      if (!s.documentTypeID) return [];
      const exp = documents
        .filter((d) => d.typeID === s.documentTypeID && sameRef(d.owner, ref("company", company.id)) && !d.supersededBy)
        .map((d) => d.expiryDate)
        .filter((x): x is Day => !!x)
        .sort();
      if (exp.length) raw = [exp[exp.length - 1]];
      break;
    }
    case "event":
      return [];
  }
  return raw.map((d) => adjustDay(d, rule.adjust)).filter((d) => d >= start && d <= end).sort();
}

export function computeObligations(args: {
  companies: Company[]; rules: RuleTemplate[]; documents: Document[]; records: ObligationRecord[];
  changes: ChangeRecord[]; today: Day; horizonDays?: number;
}): Obligation[] {
  const { companies, rules, documents, records, changes, today } = args;
  const byKey = new Map<string, ObligationRecord>();
  for (const r of records) if (!byKey.has(r.key)) byKey.set(r.key, r);
  const end = D.addDays(today, args.horizonDays ?? 400);
  const out: Obligation[] = [];
  for (const company of companies) {
    if (!generatesObligations(company.status)) continue;
    for (const base of rules) {
      if (!ruleApplies(base, company)) continue;
      const rule = effectiveRule(base, company);
      if (rule.schedule.kind === "event") continue;
      for (const d of dueDates(rule, company, documents, company.trackingSince, end)) {
        const key = obligationKey(rule.id, company.id, d);
        const rec = byKey.get(key);
        out.push({ key, rule, company, originalDue: d, due: rec?.overrideDue ?? d, record: rec });
      }
    }
    for (const change of changes) {
      if (change.companyID !== company.id || change.effectiveOn < company.trackingSince) continue;
      for (const base of rules) {
        if (!ruleApplies(base, company)) continue;
        const rule = effectiveRule(base, company);
        if (rule.schedule.kind !== "event" || rule.schedule.event !== change.kind) continue;
        const d = adjustDay(D.addDays(change.effectiveOn, rule.schedule.days ?? 0), rule.adjust);
        const key = obligationKey(rule.id, company.id, d) + "|" + change.id;
        const rec = byKey.get(key);
        out.push({ key, rule, company, originalDue: d, due: rec?.overrideDue ?? d, record: rec });
      }
    }
  }
  return out.sort((a, b) => (a.due !== b.due ? (a.due < b.due ? -1 : 1) : a.company.name < b.company.name ? -1 : a.company.name > b.company.name ? 1 : 0));
}

/** 每个“规则 × 公司”只取最早一件未完成的。 */
export function openObligations(all: Obligation[]): Obligation[] {
  const seen = new Set<string>();
  const out: Obligation[] = [];
  for (const o of all) {
    if (obligationDone(o)) continue;
    const g = o.rule.schedule.kind === "event" ? o.key : `${o.rule.id}|${o.company.id}`;
    if (!seen.has(g)) { seen.add(g); out.push(o); }
  }
  return out;
}

export function reminderDays(o: Obligation, settings: SharedSettings): Day[] {
  return [...(o.rule.reminders ?? settings.reminderDays).map((n) => D.addDays(o.due, -n)), o.due];
}

export function ruleTrust(rule: RuleTemplate, company: Company, today: Day): RuleTrust {
  const judge = (v: RuleVerification | undefined, scope: string): RuleTrust | null => {
    if (!v || v.status !== "confirmed") return null;
    if (v.confirmedOn && D.addMonths(v.confirmedOn, 12) < today) return { kind: "needsReview", on: v.confirmedOn };
    return { kind: "confirmed", scope, on: v.confirmedOn };
  };
  return judge(company.ruleOverrides?.[rule.id]?.verification, "这家公司")
    ?? judge(rule.verification, "该法域通用")
    ?? { kind: "draft" };
}

export function explainObligation(o: Obligation, docTypeName: (id: string) => string): string[] {
  const s = o.rule.schedule;
  const c = o.company;
  const lines: string[] = [];
  switch (s.kind) {
    case "annualFixed":
      lines.push(`规则：每年 ${s.date ? D.mdLabel(s.date) : "?"} 前`);
      break;
    case "afterAnniversary": {
      const inc = c.incorporationDate ? `${D.month(c.incorporationDate)} 月 ${D.dayOf(c.incorporationDate)} 日` : "未填写";
      lines.push(`成立日 ${c.incorporationDate ? D.long(c.incorporationDate) : "未填写"}，每年周年日（${inc}）后 ${s.days ?? 0} 天内`);
      break;
    }
    case "afterFiscalYearEnd": {
      const y = D.year(o.originalDue);
      const calcOf = (f: Day) => D.addDays(D.addMonths(f, s.months ?? 0), s.days ?? 0);
      const fye = [y - 2, y - 1, y].map((yy) => D.inYear(c.fiscalYearEnd, yy))
        .find((f) => adjustDay(calcOf(f), o.rule.adjust) === o.originalDue) ?? D.inYear(c.fiscalYearEnd, y - 1);
      let calc = `财年结束 ${D.long(fye)}`;
      if (s.months && s.months > 0) calc += ` ＋ ${s.months} 个月`;
      if (s.days && s.days > 0) calc += ` ＋ ${s.days} 天`;
      const raw = calcOf(fye);
      lines.push(calc + ` ＝ ${D.long(raw)}`);
      if (raw !== o.originalDue) lines.push(`${D.long(raw)}是周末，调整到 ${D.long(o.originalDue)}`);
      lines.push(`这家公司的财年结束日：每年 ${D.mdLabel(c.fiscalYearEnd)}`);
      break;
    }
    case "incorporationHalf":
      if (c.incorporationDate) {
        const first = D.month(c.incorporationDate) <= 6;
        const md = first ? s.firstHalf : s.secondHalf;
        lines.push(`成立于 ${D.long(c.incorporationDate)}（${first ? "上半年" : "下半年"}），每年 ${md ? D.mdLabel(md) : "?"} 前`);
      } else lines.push("缺少成立日，无法判断上半年还是下半年");
      break;
    case "documentExpiry":
      lines.push(`按现有${s.documentTypeID ? docTypeName(s.documentTypeID) : "文件"}的到期日 ${D.long(o.originalDue)} 计算`);
      break;
    case "event":
      lines.push(`变更生效后 ${s.days ?? 0} 天内，即 ${D.long(o.originalDue)} 前`);
      break;
  }
  lines.push(o.rule.adjust === "none" ? "遇周末不调整" : o.rule.adjust === "previousBusinessDay" ? "遇周末提前到周五" : "遇周末顺延到周一");
  if (c.ruleOverrides?.[o.rule.id]?.schedule) lines.push("这家公司使用单独确认的算法");
  if (o.due !== o.originalDue) lines.push(`已手动改期到 ${D.long(o.due)}（原定 ${D.long(o.originalDue)}）`);
  return lines;
}

export function scheduleSummary(s: RuleTemplate["schedule"], changeLabel: (k: string) => string): string {
  switch (s.kind) {
    case "annualFixed": return `每年 ${s.date ? D.mdLabel(s.date) : "?"}`;
    case "afterAnniversary": return `每个成立周年日后 ${s.days ?? 0} 天内`;
    case "afterFiscalYearEnd": {
      const m = s.months ?? 0, d = s.days ?? 0;
      return "财年结束后 " + (m > 0 ? `${m} 个月` : "") + (d > 0 ? `${d} 天` : "") + "内";
    }
    case "incorporationHalf":
      return `上半年成立的 ${s.firstHalf ? D.mdLabel(s.firstHalf) : "?"}，下半年成立的 ${s.secondHalf ? D.mdLabel(s.secondHalf) : "?"}`;
    case "documentExpiry": return "文件到期前办妥";
    case "event": return `${s.event ? changeLabel(s.event) : "变更"}后 ${s.days ?? 0} 天内`;
  }
}

// MARK: - 文件有效期

export type Freshness =
  | { kind: "valid" } | { kind: "expiring"; days: number } | { kind: "expired"; days: number }
  | { kind: "superseded" } | { kind: "needsUpdate" } | { kind: "unknown" };

export function freshnessLabel(f: Freshness): string {
  switch (f.kind) {
    case "valid": return "有效";
    case "expiring": return `${f.days} 天后到期`;
    case "expired": return `已过期 ${f.days} 天`;
    case "superseded": return "旧版，已有新版本";
    case "needsUpdate": return "需要更新";
    case "unknown": return "缺少日期";
  }
}
export const freshnessNeedsAttention = (f: Freshness) =>
  f.kind === "expiring" || f.kind === "expired" || f.kind === "needsUpdate" || f.kind === "unknown";
export const freshnessRank = (f: Freshness) =>
  ({ expired: 0, needsUpdate: 1, expiring: 2, unknown: 3, valid: 4, superseded: 5 })[f.kind];

export function freshnessOf(doc: Document, type: DocumentType | undefined, today: Day, warnDays = 30): Freshness {
  if (doc.supersededBy) return { kind: "superseded" };
  if (doc.needsUpdate) return { kind: "needsUpdate" };
  let expiry: Day | undefined;
  if (doc.expiryDate) expiry = doc.expiryDate;
  else {
    if (!type) return { kind: "unknown" };
    switch (type.validity) {
      case "permanent": case "untilChanged": return { kind: "valid" };
      case "expiryOnDocument": expiry = undefined; break;
      case "monthsAfterIssue": expiry = doc.issueDate ? D.addMonths(doc.issueDate, type.validityMonths ?? 6) : undefined; break;
    }
  }
  if (!expiry) return { kind: "unknown" };
  const left = D.daysBetween(today, expiry);
  if (left < 0) return { kind: "expired", days: -left };
  if (left <= warnDays) return { kind: "expiring", days: left };
  return { kind: "valid" };
}

export function expiryOf(doc: Document, type?: DocumentType): Day | undefined {
  if (doc.expiryDate) return doc.expiryDate;
  if (!type) return undefined;
  if (type.validity === "monthsAfterIssue") return doc.issueDate ? D.addMonths(doc.issueDate, type.validityMonths ?? 6) : undefined;
  return undefined;
}

export function expiryLabel(doc: Document, type?: DocumentType): string {
  const e = expiryOf(doc, type);
  if (e) return e;
  if (type?.validity === "permanent" || type?.validity === "untilChanged") return "长期";
  return "待核对";
}

// MARK: - 股权

export const activeHoldings = (hs: Holding[], day: Day) => hs.filter((h) => isActiveOn(h, day));

export function percentLabel(p: number): string {
  if (Math.abs(p - Math.round(p)) < 0.005) return `${Math.round(p)}%`;
  return `${p.toFixed(2)}%`;
}

export interface ChainStep { holding: Holding; asBeneficial: boolean }
export interface Chain { from: NodeRef; steps: ChainStep[]; percent: number; id: string }
export const chainHasNominee = (c: Chain) => c.steps.some((s) => s.holding.isNominee);

export function chainPaths(from: NodeRef, to: string, all: Holding[], day: Day, maxDepth = 12): Chain[] {
  const hs = activeHoldings(all, day);
  const out: Chain[] = [];
  const dfs = (node: NodeRef, steps: ChainStep[], pct: number, visited: Set<string>) => {
    if (steps.length >= maxDepth) return;
    for (const h of hs) {
      const direct = sameRef(h.holder, node);
      const beneficial = h.isNominee && sameRef(h.beneficialOwner, node) && !sameRef(h.holder, node);
      if (!direct && !beneficial) continue;
      const next = refKey(ref("company", h.companyID));
      if (visited.has(next)) continue;
      const s = [...steps, { holding: h, asBeneficial: beneficial }];
      const p = (pct * h.percent) / 100;
      if (h.companyID === to) {
        out.push({ from, steps: s, percent: p, id: s.map((x) => x.holding.id).join(">") + "|" + from.id });
      } else {
        const v = new Set(visited); v.add(next);
        dfs(ref("company", h.companyID), s, p, v);
      }
    }
  };
  dfs(from, [], 100, new Set([refKey(from)]));
  return out.sort((a, b) => b.percent - a.percent);
}

export interface BreakdownOwner { owner: NodeRef; percent: number; viaNominee: boolean; isTopCompany: boolean }
export interface OwnershipBreakdown {
  owners: BreakdownOwner[];
  unknown: number;
  gaps: { companyID: string; missing: number }[];
  unresolvedNominees: Holding[];
  cyclicCompanyIDs: string[];
}

export function breakdown(companyID: string, all: Holding[], day: Day): OwnershipBreakdown {
  const act = activeHoldings(all, day);
  const totals = new Map<string, { owner: NodeRef; pct: number; via: boolean; top: boolean }>();
  let unknown = 0;
  const gaps = new Map<string, number>();
  const unresolved: Holding[] = [];
  const cyclic = new Set<string>();
  const walk = (company: string, factor: number, nominee: boolean, visited: Set<string>) => {
    const ups = act.filter((h) => h.companyID === company);
    const sum = ups.reduce((a, h) => a + h.percent, 0);
    if (sum < 99.995) {
      unknown += (factor * (100 - sum)) / 100;
      gaps.set(company, Math.max(gaps.get(company) ?? 0, 100 - sum));
    }
    for (const h of ups) {
      const share = (factor * h.percent) / 100;
      if (h.isNominee && !h.beneficialOwner) {
        unknown += share;
        if (!unresolved.some((x) => x.id === h.id)) unresolved.push(h);
        continue;
      }
      let holder = h.holder;
      let via = nominee;
      if (h.isNominee && h.beneficialOwner) { holder = h.beneficialOwner; via = true; }
      const k = refKey(holder);
      if (holder.kind === "person") {
        const prev = totals.get(k) ?? { owner: holder, pct: 0, via: false, top: false };
        totals.set(k, { owner: holder, pct: prev.pct + share, via: prev.via || via, top: false });
      } else {
        const hasParents = act.some((x) => x.companyID === holder.id);
        if (visited.has(holder.id)) { unknown += share; cyclic.add(holder.id); }
        else if (hasParents) { const v = new Set(visited); v.add(holder.id); walk(holder.id, share, via, v); }
        else {
          const prev = totals.get(k) ?? { owner: holder, pct: 0, via: false, top: true };
          totals.set(k, { owner: holder, pct: prev.pct + share, via: prev.via || via, top: true });
        }
      }
    }
  };
  walk(companyID, 100, false, new Set([companyID]));
  return {
    owners: [...totals.values()].map((t) => ({ owner: t.owner, percent: t.pct, viaNominee: t.via, isTopCompany: t.top }))
      .sort((a, b) => b.percent - a.percent),
    unknown,
    gaps: [...gaps.entries()].map(([companyID, missing]) => ({ companyID, missing })).sort((a, b) => b.missing - a.missing),
    unresolvedNominees: unresolved,
    cyclicCompanyIDs: [...cyclic].sort(),
  };
}

export function ultimateOwners(companyID: string, hs: Holding[], day: Day) {
  return breakdown(companyID, hs, day).owners;
}

export function portfolio(owner: NodeRef, companies: Company[], hs: Holding[], day: Day) {
  return companies.flatMap((c) => {
    const hit = ultimateOwners(c.id, hs, day).find((o) => sameRef(o.owner, owner));
    return hit && hit.percent > 0.0001 ? [{ company: c, percent: hit.percent, viaNominee: hit.viaNominee }] : [];
  }).sort((a, b) => b.percent - a.percent);
}

// MARK: - 持股校验

export class HoldingValidationError extends Error {}

export function validateHoldings(hs: Holding[], companyIDs: Set<string>, personIDs: Set<string>, changed: Set<string>) {
  const exists = (r: NodeRef) => (r.kind === "company" ? companyIDs.has(r.id) : personIDs.has(r.id));
  for (const companyID of changed) {
    if (!companyIDs.has(companyID)) throw new HoldingValidationError("被持股公司已经不存在，请重新选择。");
    const relevant = hs.filter((h) => h.companyID === companyID);
    for (const h of relevant) {
      if (!Number.isFinite(h.percent) || h.percent <= 0 || h.percent > 100) throw new HoldingValidationError("持股比例必须大于 0% 且不超过 100%。");
      if (h.from && h.to && h.to < h.from) throw new HoldingValidationError("持股结束日期不能早于生效日期。");
      if (!exists(h.holder)) throw new HoldingValidationError("股东已经不存在，请重新选择。");
      if (h.beneficialOwner && !exists(h.beneficialOwner)) throw new HoldingValidationError("实际受益人已经不存在，请重新选择。");
    }
    const before = relevant.filter((h) => !h.from).reduce((a, h) => a + h.percent, 0);
    if (before > 100.005) throw new HoldingValidationError("最早一条记录之前的持股合计超过 100%，请检查没有生效日期的持股。");
    const bounds = [...new Set(relevant.flatMap((h) => [h.from, h.to].filter((x): x is Day => !!x)))].sort();
    for (const day of bounds) {
      const total = relevant.filter((h) => isActiveOn(h, day)).reduce((a, h) => a + h.percent, 0);
      if (total > 100.005) throw new HoldingValidationError(`${D.long(day)} 的持股合计超过 100%，请检查重叠的持股记录。`);
    }
  }
}

