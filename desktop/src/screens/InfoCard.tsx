// Charter 4 结构图右侧的信息卡：股东、平行公司、董事、下一项到期、默认中介。

import { useApp } from "../state/hooks";
import type { Store } from "../state/store";
import type { Router } from "../state/router";
import * as D from "../domain/day";
import { type Company, type NodeRef, contactsOf, ref } from "../domain/models";
import { percentLabel } from "../domain/engine";
import { platform } from "../platform/platform";
import { installSampleData } from "../state/sample";
import { Icon } from "../ui/Icon";
import { Button, PageHeader } from "../ui/kit";


/** 公司 → 最大的公司股东（当前有效）。 */
export function companyParents(store: Store): Map<string, { parent: string; percent: number }> {
  const out = new Map<string, { parent: string; percent: number }>();
  const ids = new Set(store.data.companies.map((c) => c.id));
  for (const c of store.data.companies) {
    const hs = store.directShareholders(c.id).filter((h) => h.holder.kind === "company" && ids.has(h.holder.id) && h.holder.id !== c.id);
    if (hs[0]) out.set(c.id, { parent: hs[0].holder.id, percent: hs[0].percent });
  }
  // 防环：沿父链走，遇到回环就断开
  for (const id of out.keys()) {
    const seen = new Set<string>([id]);
    let cur = out.get(id)?.parent;
    while (cur) {
      if (seen.has(cur)) { out.delete(id); break; }
      seen.add(cur); cur = out.get(cur)?.parent;
    }
  }
  return out;
}

export const liveCompanies = (store: Store) => store.data.companies.filter((c) => c.status !== "dissolved" && c.status !== "redomiciled");


export function InfoCard({ store, router, id }: { store: Store; router: Router; id: string }) {
  const c = store.company(id)!;
  const parents = companyParents(store);
  const g = store.brandOf(c.id);
  const p = parents.get(c.id);
  const parent = p ? store.company(p.parent) : undefined;
  const above: string[] = [];
  let cur = p ? parents.get(p.parent)?.parent : undefined;
  for (let i = 0; cur && i < 12; i++) { above.push(store.company(cur)?.name ?? ""); cur = parents.get(cur)?.parent; }
  const holders = store.directShareholders(c.id);
  const sibs = p ? liveCompanies(store).filter((x) => x.id !== c.id && parents.get(x.id)?.parent === p.parent) : [];
  const officers = store.officers(c.id);
  const next = store.openObligations.filter((o) => o.company.id === c.id).sort((a, b) => (a.due < b.due ? -1 : 1))[0];
  const party = store.party(c.defaultPartyID);
  const contact = party ? contactsOf(party)[0] : undefined;
  return (
    <aside className="v4-card appear" aria-label="信息卡">
      <div className="row gap12" style={{ alignItems: "flex-start", padding: "22px 22px 16px" }}>
        <span className="v4-code big">{c.jurisdiction}</span>
        <div className="col grow" style={{ minWidth: 0, gap: 8 }}>
          <div className="selectable" style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.3 }}>{c.name}</div>
          <div className="row gap6" style={{ flexWrap: "wrap" }}>
            <span className="v4-chip">{store.jurisdictionName(c.jurisdiction)}</span>
            {g ? <button className="v4-chip btnlike" title="编辑这个集团" onClick={() => router.openSettings("groups", g.id)}><span className="v4-dot" style={{ background: store.brandColor(g) }} />{g.name}</button>
              : <span className="v4-chip"><span className="v4-dot" style={{ background: "var(--muted)" }} />各集团共用</span>}
          </div>
        </div>
        <button className="v4-x" aria-label="关闭信息卡" onClick={() => router.set("selectedCompanyID", null)}><Icon name="xmark" size={12} /></button>
      </div>
      <div className="hairline" />
      <div className="col scroll grow" style={{ padding: "16px 22px", gap: 18 }}>
        <section className="col gap6">
          <div className="v4-label">股东</div>
          {holders.length ? holders.map((h) => (
            <div key={h.id} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <button className="v4-link ellipsis" style={{ textAlign: "left" }} onClick={() => h.holder.kind === "company" ? router.set("selectedCompanyID", h.holder.id) : router.openPerson(h.holder.id)}>{store.nameOf(h.holder)}</button>
              <span className="num" style={{ fontWeight: 600 }}>{percentLabel(h.percent)}</span>
            </div>
          )) : <span className="muted">未登记股东</span>}
          {(above.length > 0 || (parent && !p)) && <span className="t-meta muted">再往上：{above.join(" → ")}</span>}
        </section>
        <section className="col gap6">
          <div className="v4-label">平行公司</div>
          {sibs.length ? <div className="row gap6" style={{ flexWrap: "wrap" }}>{sibs.map((s) => (
            <button key={s.id} className="v4-chip btnlike" onClick={() => router.set("selectedCompanyID", s.id)}>{s.jurisdiction} {s.name}</button>
          ))}</div> : <span className="muted">无</span>}
        </section>
        <section className="col gap6">
          <div className="v4-label">董事和高管</div>
          {officers.length ? officers.map((a) => (
            <div key={a.id} className="row" style={{ justifyContent: "space-between" }}>
              <button className="v4-link" onClick={() => router.openPerson(a.personID)}>{store.person(a.personID)?.name}</button>
              <span className="muted t-meta">{a.title}</span>
            </div>
          )) : <span className="muted">未登记</span>}
        </section>
        {next && (
          <button className="v4-due" style={{ background: D.daysBetween(store.today, next.due) <= 30 ? "var(--amber-soft)" : "var(--band)" }} onClick={() => router.openDue(next.key)}>
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{next.rule.name}</span>
              <span className="v4-chip" style={{ background: "var(--surface)" }}>{leftText(D.daysBetween(store.today, next.due))}</span>
            </div>
            <div className="t-meta muted" style={{ marginTop: 4 }}>{D.long(next.due)}{store.responsibleParty(next) ? " · " + store.responsibleParty(next)!.name : ""}</div>
          </button>
        )}
        <section className="col gap6">
          <div className="v4-label">默认中介</div>
          {party ? (
            <button className="row v4-link" style={{ justifyContent: "space-between", textAlign: "left" }} onClick={() => router.openAgent(party.id)}>
              <span style={{ fontWeight: 600 }}>{party.name}</span><span className="muted t-meta">{contact?.name}</span>
            </button>
          ) : <span className="muted">未指定</span>}
        </section>
        {c.registrationNumber && <section className="col gap6"><div className="v4-label">注册编号</div><span className="mono selectable">{c.registrationNumber}</span></section>}
      </div>
      <div className="row gap8" style={{ padding: "14px 22px 20px" }}>
        <Button kind="primary" style={{ flex: 1 }} onClick={() => router.openCompany(c.id)}>打开公司</Button>
        <Button onClick={() => { void platform().copyText(store.companySummary(c)); store.showToast("公司资料摘要已复制。"); }}>复制摘要</Button>
      </div>
    </aside>
  );
}

export const leftText = (n: number) => (n < 0 ? `已逾期 ${-n} 天` : n === 0 ? "今天" : `${n} 天后`);
