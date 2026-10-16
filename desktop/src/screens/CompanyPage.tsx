// Charter 4 公司页：一页两栏。左：基本信息、股东、董事和高管、变更历史；右：到期事项、档案清单、默认中介。
// 字段直接改，改动自动记入变更历史；涉及申报义务的变更会自动出现在到期里。拖入文件直接归档。

import { useState, type ReactNode } from "react";
import * as D from "../domain/day";
import { type ArchiveItem, type Company, type NodeRef, archiveItemName, archiveStateLabel, companyStatusLabel, companyStatuses, contactsOf, hasFile, isNotApplicable, ref } from "../domain/models";
import { percentLabel } from "../domain/engine";
import { useApp } from "../state/hooks";
import { quickArchive } from "../state/actions";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { ActionMenu, Button, DateField, SelectField, divider, item } from "../ui/kit";
import { DropTarget } from "../ui/drop";
import { InlineText } from "./Agents";
import { leftText } from "./InfoCard";
import { useStageFile } from "./common";

export function CompanyPage({ company: c }: { company: Company }) {
  const { store, router } = useApp();
  const [startStage, stageNode] = useStageFile();
  const g = store.brandOf(c.id);
  const onDrop = async (paths: string[]) => {
    const left = await quickArchive(store, paths, c.id);
    if (left.length === 1) void startStage({ owner: ref("company", c.id), path: left[0] });
    else if (left.length > 1) router.startImport(left, { kind: "company", id: c.id });
  };
  return (
    <DropTarget message={`松开即可归档到 ${c.name}`} onDrop={(p) => void onDrop(p)} style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div className="surface col grow cp-card">
        <header className="row gap16" style={{ padding: "22px 24px 18px", alignItems: "flex-start" }}>
          <span className="v4-code big">{c.jurisdiction}</span>
          <div className="col grow" style={{ minWidth: 0, gap: 8 }}>
            <InlineText value={c.name} label="公司名称" onCommit={(v) => v.trim() && store.editCompanyField(c, "name", v.trim(), "公司名称")} style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4 }} />
            <div className="row gap6 wrap">
              <span className="v4-chip">{store.jurisdictionName(c.jurisdiction)}</span>
              {g ? <button className="v4-chip btnlike" onClick={() => router.openSettings("groups", g.id)} title="编辑这个集团"><span className="v4-dot" style={{ background: store.brandColor(g) }} />{g.name}</button>
                : <span className="v4-chip muted">不属于集团</span>}
              {c.status !== "active" && <span className="v4-chip warn">{companyStatusLabel[c.status]}</span>}
            </div>
          </div>
          <Button onClick={() => { void platform().copyText(store.companySummary(c)); store.showToast("公司资料摘要已复制。"); }}>复制摘要</Button>
          <ActionMenu icon="ellipsis" ariaLabel="更多" align="end" showsChevron={false} entries={[
            item("准备文件包…", "shippingbox", () => router.open({ kind: "packet", companyID: c.id })),
            item("导出全部档案…", "archivebox", () => router.open({ kind: "exportAll", companyID: c.id })),
            item("上传材料…", "square.and.arrow.down", () => void startStage({ owner: ref("company", c.id) })),
            item("在结构图中选中", "point.3.connected.trianglepath.dotted", () => router.update((r) => { r.section = "structure"; r.selectedCompanyID = c.id; })),
            item("更多资料（曾用名、别名、备注）…", "pencil", () => router.open({ kind: "editCompany", companyID: c.id })),
            divider,
            item("删除公司", "trash", () => { store.deleteCompany(c); router.set("selectedCompanyID", null); }, { destructive: true }),
          ]} />
        </header>
        <div className="hairline" />
        <div className="scroll grow">
          <div className="cp-grid">
            <div className="col gap16" style={{ minWidth: 0 }}>
              <Basics c={c} />
              <Shareholders c={c} />
              <Officers c={c} />
              <History c={c} />
            </div>
            <div className="col gap16" style={{ minWidth: 0 }}>
              <Dues c={c} />
              <Archive c={c} onUpload={(typeID) => void startStage({ owner: ref("company", c.id), typeID })} />
              <Agent c={c} />
            </div>
          </div>
        </div>
      </div>
      {stageNode}
    </DropTarget>
  );
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="cp-sec">
      <div className="row" style={{ justifyContent: "space-between", gap: 12, minHeight: 28 }}><h3 className="sec" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>{aside}</div>
      <div className="col" style={{ marginTop: 6 }}>{children}</div>
    </section>
  );
}

function KV({ k, children }: { k: string; children: ReactNode }) {
  return <div className="cp-kv"><span className="muted">{k}</span><span className="row" style={{ justifyContent: "flex-end", minWidth: 0, flex: 1 }}>{children}</span></div>;
}

function Basics({ c }: { c: Company }) {
  const { store } = useApp();
  const forms = store.jurisdiction(c.jurisdiction)?.entityForms ?? [];
  return (
    <Card title="基本信息" aside={<span className="t-meta muted">点击直接改，改动记入历史</span>}>
      <KV k="注册编号"><InlineText value={c.registrationNumber} label="注册编号" placeholder="未填写" className="mono" style={{ textAlign: "right" }} onCommit={(v) => store.editCompanyField(c, "registrationNumber", v.trim(), "注册编号")} /></KV>
      <KV k="成立日期"><DateField value={c.incorporationDate} onChange={(d) => store.editCompanyField(c, "incorporationDate", d, "成立日期")} placeholder="未填写" minWidth={150} /></KV>
      <KV k="注册地址"><InlineText value={c.registeredAddress} label="注册地址" placeholder="未填写" style={{ textAlign: "right" }} onCommit={(v) => store.editCompanyField(c, "registeredAddress", v.trim(), "注册地址")} /></KV>
      {forms.length > 0 && <KV k="实体类型"><SelectField options={forms.map((f) => [f, f] as [string, string])} value={c.entityForm} placeholder="未选择" onChange={(v) => store.editCompanyField(c, "entityForm", v, "实体类型")} minWidth={180} /></KV>}
      <KV k="财年结束"><InlineText value={c.fiscalYearEnd} label="财年结束（月-日）" className="mono" style={{ textAlign: "right", width: 90 }} onCommit={(v) => /^\d{2}-\d{2}$/.test(v.trim()) && store.editCompanyField(c, "fiscalYearEnd", v.trim(), "财年结束日")} /></KV>
      <KV k="状态"><SelectField options={companyStatuses.map((s) => [s, companyStatusLabel[s]] as [typeof s, string])} value={c.status} onChange={(v) => store.editCompanyField(c, "status", v, "公司状态")} minWidth={120} /></KV>
    </Card>
  );
}

function Shareholders({ c }: { c: Company }) {
  const { store, router } = useApp();
  const hs = store.directShareholders(c.id);
  const total = hs.reduce((a, h) => a + h.percent, 0);
  const [adding, setAdding] = useState(false);
  return (
    <Card title="股东" aside={<span className="t-meta muted">合计 <b className="num" style={{ color: total > 0 && Math.abs(total - 100) > 0.01 ? "var(--amber-text)" : "var(--ink)" }}>{percentLabel(total)}</b></span>}>
      {hs.map((h) => (
        <div key={h.id} className="cp-line">
          <span className="v4-code" style={h.holder.kind === "person" ? { borderRadius: "50%" } : undefined}>{h.holder.kind === "company" ? store.company(h.holder.id)?.jurisdiction : [...store.nameOf(h.holder)][0]}</span>
          <button className="v4-link ellipsis grow" style={{ textAlign: "left" }} onClick={() => h.holder.kind === "company" ? router.openCompany(h.holder.id) : router.openPerson(h.holder.id)}>{store.nameOf(h.holder)}{h.isNominee ? <span className="muted" style={{ fontWeight: 400 }}>（名义）</span> : null}</button>
          <InlineText value={String(h.percent)} label="持股比例" className="num" style={{ width: 64, textAlign: "right", fontWeight: 600 }} onCommit={(v) => store.setHoldingPercent(h, parseFloat(v))} />
          <span className="muted">%</span>
          <button className="v4-x cp-hide" aria-label={`移除股东 ${store.nameOf(h.holder)}`} title="移除（记为不再持股）" onClick={() => store.endHolding(h)}><Icon name="xmark" size={10} /></button>
        </div>
      ))}
      {!hs.length && <span className="muted t-meta" style={{ padding: "6px 0" }}>还没有股东。</span>}
      {adding ? <HolderPicker c={c} onDone={() => setAdding(false)} /> : <button className="cp-add" onClick={() => setAdding(true)}>+ 添加股东</button>}
    </Card>
  );
}

function HolderPicker({ c, onDone }: { c: Company; onDone: () => void }) {
  const { store } = useApp();
  const [q, setQ] = useState("");
  const [pct, setPct] = useState(String(Math.max(0, 100 - store.directShareholders(c.id).reduce((a, h) => a + h.percent, 0)) || 100));
  const ql = q.trim().toLowerCase();
  const p = parseFloat(pct);
  const opts: { r: NodeRef; name: string; code: string }[] = ql ? [
    ...store.data.companies.filter((x) => x.id !== c.id && x.name.toLowerCase().includes(ql)).slice(0, 5).map((x) => ({ r: ref("company", x.id), name: x.name, code: x.jurisdiction })),
    ...store.data.people.filter((x) => (x.name + " " + x.aliases.join(" ")).toLowerCase().includes(ql)).slice(0, 3).map((x) => ({ r: ref("person", x.id), name: x.name, code: [...x.name][0] })),
  ] : [];
  const add = (h: Parameters<typeof store.addShareholderInline>[1]) => { if (p > 0 && p <= 100) { store.addShareholderInline(c.id, h, p); onDone(); } };
  return (
    <div className="col gap6" style={{ marginTop: 6 }}>
      <div className="row gap8">
        <input className="v4-input grow" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入公司或人名…" aria-label="股东" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onDone(); } }} />
        <input className="v4-input num" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))} aria-label="持股比例" style={{ width: 72, textAlign: "right" }} /><span className="muted">%</span>
      </div>
      {ql && <div className="v4-menu">
        {opts.map((o) => <button key={o.r.kind + o.r.id} className="v4-opt" onClick={() => add({ kind: "existing", ref: o.r })}><span className="v4-code" style={o.r.kind === "person" ? { borderRadius: "50%" } : undefined}>{o.code}</span><span className="grow ellipsis">{o.name}</span></button>)}
        <button className="v4-opt" onClick={() => add({ kind: "newPerson", name: q })}><span className="v4-code dark" style={{ borderRadius: "50%" }}>+</span><span className="grow ellipsis" style={{ fontWeight: 600 }}>新建个人“{q.trim()}”</span></button>
        <button className="v4-opt" onClick={() => add({ kind: "newCompany", name: q, jurisdiction: "VG" })}><span className="v4-code dark">+</span><span className="grow ellipsis" style={{ fontWeight: 600 }}>新建公司“{q.trim()}”</span></button>
      </div>}
    </div>
  );
}

function Officers({ c }: { c: Company }) {
  const { store, router } = useApp();
  const os = store.officers(c.id);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("董事");
  const [adding, setAdding] = useState(false);
  const add = () => { if (name.trim()) { store.addOfficer(c.id, name, title.trim() || "董事"); setName(""); setAdding(false); } };
  return (
    <Card title="董事和高管">
      {os.map((a) => {
        const p = store.person(a.personID);
        return (
          <div key={a.id} className="cp-line">
            <span className="v4-code" style={{ borderRadius: "50%" }}>{[...(p?.name ?? "?")][0]}</span>
            <button className="v4-link ellipsis grow" style={{ textAlign: "left" }} onClick={() => router.openPerson(a.personID)}>{p?.name}</button>
            <span className="t-meta muted">{a.title}{a.from ? ` · ${D.long(a.from)}起` : ""}</span>
            <button className="v4-x cp-hide" aria-label={`移除 ${p?.name}`} title="卸任（记入历史）" onClick={() => store.endAppointment(a)}><Icon name="xmark" size={10} /></button>
          </div>
        );
      })}
      {!os.length && <span className="muted t-meta" style={{ padding: "6px 0" }}>还没有董事或高管。</span>}
      {adding ? (
        <div className="row gap8" style={{ marginTop: 6 }}>
          <input className="v4-input grow" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名，已有的人会自动关联" aria-label="姓名" list="cp-people"
            onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") { e.stopPropagation(); setAdding(false); } }} />
          <datalist id="cp-people">{store.data.people.map((p) => <option key={p.id} value={p.name} />)}</datalist>
          <input className="v4-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="职务" style={{ width: 110 }} onKeyDown={(e) => e.key === "Enter" && add()} />
          <Button size="small" kind="primary" onClick={add}>添加</Button>
        </div>
      ) : <button className="cp-add" onClick={() => setAdding(true)}>+ 添加董事或高管</button>}
    </Card>
  );
}

function History({ c }: { c: Company }) {
  const { store } = useApp();
  const list = store.data.changes.filter((x) => x.companyID === c.id).sort((a, b) => (a.effectiveOn < b.effectiveOn ? 1 : a.effectiveOn > b.effectiveOn ? -1 : 0));
  return (
    <Card title="变更历史" aside={<span className="t-meta muted">生效日期可改</span>}>
      {list.slice(0, 30).map((x) => (
        <div key={x.id} className="cp-line" style={{ alignItems: "flex-start", paddingTop: 8, paddingBottom: 8 }}>
          <span className="grow" style={{ fontSize: 13.5, lineHeight: 1.5, minWidth: 0 }}>{x.summary}</span>
          <DateField value={x.effectiveOn} onChange={(d) => d && store.setChangeDate(x.id, d)} allowsClear={false} minWidth={140} />
        </div>
      ))}
      {!list.length && <span className="muted t-meta" style={{ padding: "6px 0" }}>还没有变更。改了上面的信息会自动记在这里。</span>}
    </Card>
  );
}

function Dues({ c }: { c: Company }) {
  const { store, router } = useApp();
  const list = store.openObligations.filter((o) => o.company.id === c.id).sort((a, b) => (a.due < b.due ? -1 : 1));
  return (
    <Card title="到期事项">
      {list.map((o) => {
        const left = D.daysBetween(store.today, o.due);
        return (
          <button key={o.key} className="cp-due" style={{ background: left < 0 ? "var(--danger-soft)" : left <= 30 ? "var(--amber-soft)" : "var(--band)" }} onClick={() => router.openDue(o.key)}>
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="ellipsis" style={{ fontWeight: 600 }}>{o.rule.name}</span>
              <span className="t-meta muted ellipsis">{D.long(o.due)}{o.record?.dateConfirmed ? " · 已确认" : " · 推算"} · {store.responsibleParty(o)?.name ?? "未指定中介"}</span>
            </span>
            <span className={`v4-chip ${left < 0 ? "bad" : left <= 30 ? "warn" : ""}`} style={{ background: left >= 0 && left > 30 ? "var(--surface)" : undefined }}>{leftText(left)}</span>
          </button>
        );
      })}
      {!list.length && <span className="muted t-meta" style={{ padding: "6px 0" }}>这家公司暂时没有到期事项。</span>}
    </Card>
  );
}

function Archive({ c, onUpload }: { c: Company; onUpload: (typeID: string) => void }) {
  const { store, router } = useApp();
  const items = store.archive(c);
  const counted = items.filter((i) => !isNotApplicable(i.state));
  const have = counted.filter((i) => hasFile(i.state)).length;
  const dot = (i: ArchiveItem) => i.state.kind === "expired" ? "var(--danger)" : i.state.kind === "expiring" || i.state.kind === "needsUpdate" || i.state.kind === "noDate" ? "var(--amber)" : hasFile(i.state) ? "#B5D334" : "var(--hairline)";
  return (
    <Card title="档案清单" aside={<span className="row gap10"><span className="t-meta muted num">{have} / {counted.length} 已归档</span><button className="link t-meta" onClick={() => router.open({ kind: "companyItems", companyID: c.id })}>调整清单</button></span>}>
      {items.filter((i) => !isNotApplicable(i.state)).map((i) => (
        <div key={i.typeID} className="cp-line" role="button" tabIndex={0} style={{ cursor: "default" }}
          onClick={() => i.document ? router.open({ kind: "document", id: i.document.id }) : onUpload(i.typeID)}
          onKeyDown={(e) => e.key === "Enter" && (i.document ? router.open({ kind: "document", id: i.document.id }) : onUpload(i.typeID))}>
          <span className="v4-dot" style={{ background: dot(i) }} />
          <span className="grow ellipsis" style={{ fontSize: 13.5, color: hasFile(i.state) ? undefined : "var(--muted)" }}>{archiveItemName(i)}{i.olderVersions > 0 && <span className="t-meta muted">　{i.olderVersions} 个旧版</span>}</span>
          <span className="t-meta num" style={{ color: i.state.kind === "expired" ? "var(--danger)" : i.state.kind === "valid" || i.state.kind === "missing" ? "var(--muted)" : "var(--amber-text)" }}>
            {i.state.kind === "valid" ? (i.document?.expiryDate ? `${D.long(i.document.expiryDate)}到期` : i.document?.issueDate ? D.long(i.document.issueDate) : "有效") : i.state.kind === "missing" ? "缺少 · 上传" : archiveStateLabel(i.state)}
          </span>
        </div>
      ))}
      <span className="t-meta muted" style={{ paddingTop: 8 }}>把文件拖到这张卡片上的任何地方即可归档，Charter 会识别类型和日期。</span>
    </Card>
  );
}

function Agent({ c }: { c: Company }) {
  const { store, router } = useApp();
  const p = store.party(c.defaultPartyID);
  const contact = p ? contactsOf(p)[0] : undefined;
  return (
    <Card title="默认中介" aside={p && <button className="link t-meta" onClick={() => router.openAgent(p.id)}>查看中介</button>}>
      <div className="cp-line">
        <SelectField options={[["", "未指定"] as [string, string], ...store.data.parties.map((x) => [x.id, x.name] as [string, string])]} value={c.defaultPartyID ?? ""}
          onChange={(v) => store.upsertCompany({ ...c, defaultPartyID: v || undefined })} minWidth={240} />
        <span className="grow" />
        {contact && <button className="link t-meta" title="复制邮箱" onClick={() => { void platform().copyText(contact.email); store.showToast("邮箱已复制。"); }}>{contact.name}{contact.email ? ` · ${contact.email}` : ""}</button>}
      </div>
      <span className="t-meta muted">到期事项默认交给它；单件事可以在“到期”里另外指定。</span>
    </Card>
  );
}
