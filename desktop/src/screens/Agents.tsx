// Charter 4 中介库：每家中介可有多位对接人；右侧列出它负责的公司和事项。

import { TicketStub } from "../ui/TicketStub";
import { companyTint } from "../ui/uistyle";
import { useListMotion } from "../ui/motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../state/hooks";
import * as D from "../domain/day";
import { type Contact, type Party, contactsOf, newContact, newParty } from "../domain/models";
import { Icon } from "../ui/Icon";
import { Button, EmptyStateView, PageHeader } from "../ui/kit";
import { leftText } from "./InfoCard";

export function AgentsView() {
  const { store, router } = useApp();
  const parties = [...store.data.parties].sort((a, b) => (a.kind === "agent" ? 0 : 1) - (b.kind === "agent" ? 0 : 1) || a.name.localeCompare(b.name));
  const sel = store.party(router.selectedAgentID) ?? parties[0];
  useEffect(() => {
    if (router.newPartyRequest) add();
  }, [router.newPartyRequest]);
  const add = () => {
    const p = { ...newParty("新中介"), contacts: [newContact()] };
    store.commit((d) => { d.parties.push(p as any); }, { label: "添加中介" });
    router.set("selectedAgentID", p.id);
  };
  const companiesOf = (p: Party) => store.data.companies.filter((c) => c.defaultPartyID === p.id);
  const openFor = (p: Party) => store.openObligations.filter((o) => store.responsibleParty(o)?.id === p.id);

  return (
    <div className="col grow" style={{ minHeight: 0, padding: "0 var(--page-edge)" }}>
      <PageHeader title="中介" stats={[
        { label: "中介", value: parties.length, unit: "家" },
        { label: "指定了默认中介的公司", value: store.data.companies.filter((c) => c.defaultPartyID).length, unit: "家" },
        { label: "经手的待办事项", value: store.openObligations.filter((o) => !!store.responsibleParty(o)).length, unit: "件", tone: "accent" },
      ]} subtitle={`${parties.length} 家 · ${store.data.companies.filter((c) => c.defaultPartyID).length} 家公司指定了默认中介`}>
        <Button kind="primary" icon="plus" onClick={add}>添加中介</Button>
      </PageHeader>
      {!sel ? <EmptyStateView symbol="person.2" title="还没有中介" message="把公司秘书、注册代理、税务师加进来，到期提醒会自动带上对接人。" actionTitle="添加中介" action={add} /> : (
        <div className="row grow" style={{ minHeight: 0, gap: 16, alignItems: "stretch", padding: "16px 0 24px" }}>
          <div className="surface scroll" style={{ width: 320, flex: "none", padding: 8 }}>
            {parties.map((p) => {
              const on = p.id === sel.id;
              return (
                <button key={p.id} className={`v4-item ${on ? "on" : ""}`} style={{ minHeight: 58 }} onClick={() => router.set("selectedAgentID", p.id)}>
                  <span className="v4-av">{[...p.name][0]}</span>
                  <span className="col grow" style={{ minWidth: 0 }}>
                    <span className="ellipsis" style={{ fontWeight: 600 }}>{p.name}</span>
                    <span className="ellipsis" style={{ fontSize: 12, opacity: 0.65 }}>{contactsOf(p).length} 位对接人 · {openFor(p).length} 项事项</span>
                  </span>
                </button>
              );
            })}
          </div>
          <AgentDetail key={sel.id} p={sel} />
        </div>
      )}
    </div>
  );
}

function AgentDetail({ p }: { p: Party }) {
  const { store, router } = useApp();
  const companies = store.data.companies.filter((c) => c.defaultPartyID === p.id);
  const openFor = (x: Party) => store.openObligations.filter((o) => store.responsibleParty(o)?.id === x.id);
  const save = (fn: (x: Party) => void) => store.commit((d) => { const x = d.parties.find((y) => y.id === p.id); if (x) fn(x as Party); });
  const contacts = contactsOf(p);
  const setContacts = (cs: Contact[]) => save((x) => {
    x.contacts = cs;
    // 旧字段保持为主对接人，兼容旧版读取
    x.contactName = cs[0]?.name ?? ""; x.email = cs[0]?.email ?? ""; x.phone = cs[0]?.phone ?? "";
  });
  const dues = openFor(p).sort((a, b) => (a.due < b.due ? -1 : 1));
  const contactMotion = useListMotion(contacts.map((c) => c.id));
  return (
    <section className="surface col scroll grow appear" style={{ padding: "24px 28px", gap: 22, minWidth: 0 }}>
      <div className="row gap12">
        <InlineText value={p.name} onCommit={(v) => v.trim() && save((x) => { x.name = v.trim(); })} style={{ fontSize: 23, fontWeight: 700, letterSpacing: -0.4 }} label="中介名称" />
        <span className="spacer" />
        <Button kind="quiet" icon="trash" ariaLabel="删除中介" onClick={() => store.deleteParty(p)} />
      </div>
      <InlineText value={p.notes} placeholder="负责什么，例如：香港 · 公司秘书、周年申报" onCommit={(v) => save((x) => { x.notes = v; })} label="说明" className="muted" />
      <div className="col gap10">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="t-section">对接人</div>
          <Button size="small" kind="quiet" icon="plus" onClick={() => setContacts([...contacts, newContact()])}>添加对接人</Button>
        </div>
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
          {contacts.map((c, i) => (
            <div key={c.id} ref={contactMotion.rowRef(c.id)} className={`v4-contact ${contactMotion.isNew(c.id) ? "cp-new" : ""}`}>
              <div className="row gap6">
                <InlineText value={c.name} placeholder="姓名" label="姓名" style={{ fontWeight: 600 }} onCommit={(v) => setContacts(contacts.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
                {i === 0 ? <span className="v4-chip lime">主对接</span>
                  : <button className="link t-meta muted" style={{ whiteSpace: "nowrap" }} onClick={() => setContacts([c, ...contacts.filter((_, j) => j !== i)])}>设为主对接</button>}
                <span className="spacer" />
                <button className="v4-x" aria-label="删除对接人" onClick={() => setContacts(contacts.filter((_, j) => j !== i))}><Icon name="xmark" size={10} /></button>
              </div>
              <InlineText value={c.role} placeholder="负责什么" label="职责" className="muted t-meta" onCommit={(v) => setContacts(contacts.map((x, j) => (j === i ? { ...x, role: v } : x)))} />
              <InlineText value={c.email} placeholder="邮箱" label="邮箱" className="t-meta" onCommit={(v) => setContacts(contacts.map((x, j) => (j === i ? { ...x, email: v.trim() } : x)))} />
              <InlineText value={c.phone} placeholder="电话" label="电话" className="t-meta muted mono" onCommit={(v) => setContacts(contacts.map((x, j) => (j === i ? { ...x, phone: v.trim() } : x)))} />
            </div>
          ))}
        </div>
      </div>
      <div className="col gap8">
        <div className="t-section">默认负责的公司</div>
        {companies.length ? <div className="row gap6" style={{ flexWrap: "wrap" }}>{companies.map((c) => (
          <button key={c.id} className="v4-chip btnlike" onClick={() => router.openCompany(c.id)}>{c.jurisdiction} {c.name}</button>
        ))}</div> : <span className="muted">还没有公司把它设为默认中介。在公司页或新建公司时可以指定。</span>}
      </div>
      <div className="col gap4">
        <div className="t-section" style={{ marginBottom: 6 }}>负责的事项</div>
        {dues.length ? dues.map((o) => (
          <button key={o.key} className="v4-item tk" onClick={() => router.openDue(o.key)}>
            <TicketStub due={o.due} today={store.today} />
            <span className="v4-code" style={companyTint(store, o.company.id)}>{o.company.jurisdiction}</span>
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="ellipsis" style={{ fontWeight: 600 }}>{o.company.name}</span>
              <span className="ellipsis muted t-meta">{o.rule.name} · {D.long(o.due)}</span>
            </span>
            <span className={`v4-chip ${D.daysBetween(store.today, o.due) < 0 ? "bad" : D.daysBetween(store.today, o.due) <= 30 ? "warn" : ""}`}>{leftText(D.daysBetween(store.today, o.due))}</span>
          </button>
        )) : <span className="muted">暂无未完成事项。</span>}
      </div>
    </section>
  );
}

/** 就地编辑：看起来是文字，点一下就能改，回车或离开保存，Esc 放弃。 */
export function InlineText({ value, onCommit, placeholder, label, style, className, wrap }: {
  value: string; onCommit: (v: string) => void; placeholder?: string; label: string; style?: React.CSSProperties; className?: string;
  /** 长文本（公司名）：自动换行，最多按内容撑高；回车提交，不插入换行。 */
  wrap?: boolean;
}) {
  const [v, setV] = useState(value);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setV(value), [value]);
  useLayoutEffect(() => { const el = ta.current; if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } }, [v, wrap]);
  const keys = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); }
    if (e.key === "Escape") { e.stopPropagation(); setV(value); setTimeout(() => (e.target as HTMLElement).blur()); }
  };
  if (wrap) return (
    <textarea ref={ta} rows={1} className={`v4-inline wrap ${className ?? ""}`} aria-label={label} value={v} placeholder={placeholder} style={style} title={value}
      onChange={(e) => setV(e.target.value.replace(/\n/g, " "))} onBlur={() => { if (v !== value) onCommit(v); }} onKeyDown={keys} />
  );
  return (
    <input className={`v4-inline ${className ?? ""}`} aria-label={label} value={v} placeholder={placeholder} style={style} title={value.length > 24 ? value : undefined}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onCommit(v); }}
      onKeyDown={keys} />
  );
}
