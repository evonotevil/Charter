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
import { TweenNumber } from "../ui/motion";
import { CompanyChips } from "./PropChips";
import { softBg, useUIStyle, softLike } from "../ui/uistyle";


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
  const soft = softLike(useUIStyle());
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
  // 一人多职：一行人名，职务合并（长内容规则）
  const people = [...new Set(officers.map((x) => x.personID))].map((pid) => ({ pid, name: store.person(pid)?.name ?? "", titles: officers.filter((x) => x.personID === pid).map((x) => x.title) }));
  const next = store.openObligations.filter((o) => o.company.id === c.id).sort((a, b) => (a.due < b.due ? -1 : 1))[0];
  const party = store.party(c.defaultPartyID);
  const contact = party ? contactsOf(party)[0] : undefined;
  if (soft) {
    const color = g ? store.brandColor(g) : null;
    const left = next ? D.daysBetween(store.today, next.due) : null;
    const top = holders[0];
    const copy = () => { void platform().copyText(store.companySummary(c)); store.showToast("公司资料摘要已复制。"); };
    return (
      <aside className="bento appear" aria-label="信息卡">
        <div className="bento-tile swap-quick tinted" key={c.id + "h"} style={{ background: color ? softBg(color) : "var(--surface)" }}>
          <div className="row gap12" style={{ alignItems: "flex-start" }}>
            <span className="bento-code">{c.jurisdiction}</span>
            <div className="col grow" style={{ minWidth: 0, gap: 8 }}>
              <div className="selectable name-2" title={c.name} style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.3, WebkitLineClamp: 3 }}>{c.name}</div>
              <div className="row gap6" style={{ flexWrap: "wrap" }}><CompanyChips c={c} chipClass="bento-chip" /></div>
            </div>
            <button className="v4-x" aria-label="关闭信息卡" onClick={() => router.set("selectedCompanyID", null)}><Icon name="xmark" size={12} /></button>
          </div>
        </div>
        <div className="col scroll grow swap-quick" key={c.id} style={{ gap: 10, minHeight: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {next && left !== null ? (
              <button className="bento-tile" style={{ textAlign: "left", background: left < 0 ? "var(--danger-soft)" : left <= 30 ? "var(--amber-soft)" : "var(--surface)" }} onClick={() => router.openDue(next.key)}>
                <div className="v4-label" style={{ color: left < 0 ? "var(--danger)" : left <= 30 ? "var(--amber-text)" : undefined }}>{left < 0 ? "已逾期" : "下一件到期"}</div>
                <div className="row" style={{ alignItems: "flex-end", gap: 4, marginTop: 6 }}><span className="big-num"><TweenNumber value={Math.abs(left)} /></span><span className="big-unit">天</span></div>
                <div className="ellipsis" style={{ fontSize: 12.5, fontWeight: 600, marginTop: 6 }}>{next.rule.name}</div>
              </button>
            ) : <div className="bento-tile"><div className="v4-label">下一件到期</div><div className="muted" style={{ marginTop: 10 }}>没有待办</div></div>}
            <div className="bento-tile">
              <div className="v4-label">{top ? "最大股东持股" : "股东"}</div>
              {top ? <>
                <div className="row" style={{ alignItems: "flex-end", gap: 2, marginTop: 6 }}><span className="big-num">{Number(top.percent.toFixed(2))}</span><span className="big-unit">%</span></div>
                <button className="v4-link ellipsis t-meta" style={{ marginTop: 6, maxWidth: "100%", textAlign: "left" }} onClick={() => top.holder.kind === "company" ? router.set("selectedCompanyID", top.holder.id) : router.openPerson(top.holder.id)}>{store.nameOf(top.holder)}</button>
              </> : <div className="muted" style={{ marginTop: 10 }}>未登记</div>}
            </div>
          </div>
          {holders.length > 1 && <div className="bento-tile col gap6">
            <div className="v4-label">其他股东</div>
            {holders.slice(1).map((h) => <div key={h.id} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <button className="v4-link ellipsis" style={{ textAlign: "left" }} onClick={() => h.holder.kind === "company" ? router.set("selectedCompanyID", h.holder.id) : router.openPerson(h.holder.id)}>{store.nameOf(h.holder)}</button>
              <span className="num" style={{ fontWeight: 600 }}>{percentLabel(h.percent)}</span></div>)}
          </div>}
          <div className="bento-tile col gap8">
            <div className="v4-label">董事和高管</div>
            {people.length ? people.map(({ pid, name, titles }) => (
              <div key={pid} className="row gap8" style={{ alignItems: "flex-start" }}>
                <span className="bento-avatar">{[...name][0]}</span>
                <button className="v4-link grow name-2" style={{ textAlign: "left", fontWeight: 600, minWidth: 0 }} title={name} onClick={() => router.openPerson(pid)}>{name}</button>
                <span className="muted t-meta" style={{ textAlign: "right", maxWidth: 120 }}>{titles.join("、")}</span></div>
            )) : <span className="muted">未登记</span>}
          </div>
          <div className="bento-tile">
            <div className="row" style={{ justifyContent: "space-between" }}><span className="v4-label">平行公司</span><span className="v4-label">默认中介</span></div>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginTop: 8, gap: 12 }}>
              <div className="row gap6" style={{ flexWrap: "wrap", minWidth: 0 }}>{sibs.length ? sibs.map((x) => <button key={x.id} className="v4-chip btnlike" onClick={() => router.set("selectedCompanyID", x.id)}>{x.jurisdiction} {x.name}</button>) : <span className="muted">无</span>}</div>
              {party ? <button className="v4-link" style={{ textAlign: "right", flex: "none" }} onClick={() => router.openAgent(party.id)}><div style={{ fontWeight: 600 }}>{party.name}</div><div className="t-meta muted">{contact?.name}</div></button> : <span className="muted" style={{ flex: "none" }}>未指定</span>}
            </div>
          </div>
        </div>
        <div className="row gap8">
          <Button kind="primary" style={{ flex: 1 }} onClick={() => router.openCompany(c.id)}>打开公司</Button>
          <Button onClick={copy}>复制摘要</Button>
        </div>
      </aside>
    );
  }
  return (
    <aside className="v4-card appear" aria-label="信息卡">
      <div className="row gap12 swap-quick" key={c.id + "h"} style={{ alignItems: "flex-start", padding: "22px 22px 16px" }}>
        <span className="v4-code big">{c.jurisdiction}</span>
        <div className="col grow" style={{ minWidth: 0, gap: 8 }}>
          <div className="selectable name-2" title={c.name} style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.3, WebkitLineClamp: 3 }}>{c.name}</div>
          <div className="row gap6" style={{ flexWrap: "wrap" }}><CompanyChips c={c} /></div>
        </div>
        <button className="v4-x" aria-label="关闭信息卡" onClick={() => router.set("selectedCompanyID", null)}><Icon name="xmark" size={12} /></button>
      </div>
      <div className="hairline" />
      <div className="col scroll grow swap-quick" key={c.id} style={{ padding: "16px 22px", gap: 18 }}>
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
          {people.length ? people.map(({ pid, name, titles }) => (
            <div key={pid} className="row gap8" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <button className="v4-link name-2" style={{ textAlign: "left", minWidth: 0 }} title={name} onClick={() => router.openPerson(pid)}>{name}</button>
              <span className="muted t-meta" style={{ textAlign: "right", flex: "none", maxWidth: 140 }}>{titles.join("、")}</span>
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
