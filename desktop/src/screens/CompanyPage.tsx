// Charter 4 公司页：一页两栏。左：基本信息、股东、董事和高管、变更历史；右：到期事项、档案清单、默认中介。
// 字段直接改，改动自动记入变更历史；涉及申报义务的变更会自动出现在到期里。拖入文件直接归档。

import { TicketStub } from "../ui/TicketStub";
import { useRef, useState, type ReactNode } from "react";
import * as D from "../domain/day";
import { type Appointment, type ArchiveItem, type Company, type NodeRef, archiveItemName, companyStatusLabel, companyStatuses, completeness, contactsOf, hasFile, inView, ref } from "../domain/models";
import { percentLabel } from "../domain/engine";
import { useApp } from "../state/hooks";
import { quickArchive } from "../state/actions";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { ActionMenu, Avatar, Button, Card as KitCard, DateField, JurisdictionBadge, PageHeader, Pill, Popover, PopoverRow, ProgressTrack, SelectField, Tabs, divider, item } from "../ui/kit";
import { DropTarget } from "../ui/drop";
import { InlineText } from "./Agents";
import { leftText } from "./InfoCard";
import { useStageFile } from "./common";
import { useListMotion } from "../ui/motion";
import { EntrySheet, ProvenanceLine, VerifyChip } from "./Trust";
import { CompanyChips } from "./PropChips";
import { ExtraTags, StatusTag } from "./Status";
import { EvidenceList } from "./Evidence";
import { CustodyChip, FileViewToggle, ScopeSummary, ScopedItems, itemStatus, useFileView } from "./Scope";
import { roleByID, roleCategoryLabel, roleLabel, rolesFor } from "../domain/roles";
import { companyTint } from "../ui/uistyle";

const tabNames = ["概览", "人员与持股", "文件", "申报", "变更历史"] as const;

export function CompanyPage({ company: c }: { company: Company }) {
  const { store, router } = useApp();
  const [startStage, stageNode] = useStageFile();
  const unv = store.unverified.filter((x) => x.item.companyID === c.id).length;
  const [busy, setBusy] = useState(false);
  const tab = Math.min(router.companyTab, tabNames.length - 1);
  const cnt = store.companyCounts(c);
  const dues = store.openObligations.filter((o) => o.company.id === c.id);
  const people = new Set(store.officers(c.id).map((a) => a.personID)).size + store.directShareholders(c.id).length;
  const history = store.data.changes.filter((x) => x.companyID === c.id).length;
  const onDrop = async (paths: string[]) => {
    const t = setTimeout(() => setBusy(true), 300);
    let left: string[] = [];
    try { left = await quickArchive(store, paths, c.id); } finally { clearTimeout(t); setBusy(false); }
    if (left.length === 1) void startStage({ owner: ref("company", c.id), path: left[0] });
    else if (left.length > 1) router.startImport(left, { kind: "company", id: c.id });
  };
  const gs = store.groupsContaining(c.id);
  const facts = [store.jurisdictionName(c.jurisdiction), c.entityForm, c.registrationNumber].filter(Boolean).join(" · ");
  const upload = (typeID?: string) => void startStage({ owner: ref("company", c.id), typeID });
  return (
    <DropTarget message={`松开即可归档到 ${c.name}`} onDrop={(p) => void onDrop(p)} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="page"><div className="page-inner">
        <PageHeader crumb={<><button onClick={() => router.go("companies")}>公司总览</button><Icon name="chevron.right" size={10} />{gs.length ? gs.map((g) => g.name).join("、") : store.jurisdictionName(c.jurisdiction)}</>}
          title={<span className="row gap14" style={{ minWidth: 0 }}><JurisdictionBadge code={c.jurisdiction} size={44} tint={companyTint(store, c.id)} />
            <InlineText wrap value={c.name} label="公司名称" onCommit={(v) => v.trim() && store.editCompanyField(c, "name", v.trim(), "公司名称")} style={{ font: "inherit" }} /></span>}
          subtitle={<span className="row gap6 wrap"><CompanyChips c={c} />{unv > 0 && <button className="v4-chip btnlike chip-pending" onClick={() => router.go("verify")}>{unv} 条待核实 ›</button>}</span>}>
          {busy && <span className="busy-chip" role="status"><span className="ring" />正在识别…</span>}
          <Button icon="square.and.arrow.down" onClick={() => upload()}>上传材料</Button>
          <Button kind="primary" icon="shippingbox" onClick={() => router.open({ kind: "packet", companyID: c.id })}>准备文件包</Button>
          <ActionMenu icon="ellipsis" ariaLabel="更多" align="end" showsChevron={false} entries={[
            item("复制公司摘要", "doc.on.doc", () => { void platform().copyText(store.companySummary(c)); store.showToast("公司资料摘要已复制。"); }),
            item("导出全部档案…", "archivebox", () => router.open({ kind: "exportAll", companyID: c.id })),
            item("在股权结构中查看", "point.3.connected.trianglepath.dotted", () => router.update((r) => { r.section = "structure"; r.selectedCompanyID = c.id; })),
            item("更多资料（曾用名、别名、备注）…", "pencil", () => router.open({ kind: "editCompany", companyID: c.id })),
            divider,
            item("删除公司", "trash", () => { store.deleteCompany(c); router.update((r) => { r.selectedCompanyID = null; r.companyOpen = false; }); }, { destructive: true }),
          ]} />
        </PageHeader>
        <Snapshot c={c} />
        <Tabs<number> value={tab} onChange={(v) => router.set("companyTab", v)} tabs={[[0, "概览"], [1, "人员与持股", people], [2, "文件", cnt.files], [3, "申报", dues.length], [4, "变更历史", history]]} />
        <div className="swap-in" key={tab}>
          {tab === 0 && <div className="two">
            <div className="col gap24"><Basics c={c} /><PeopleSummary c={c} /><ArchiveSummary c={c} /></div>
            <div className="col gap24"><NextUp c={c} /><Agent c={c} /></div>
          </div>}
          {tab === 1 && <div className="col gap24"><Shareholders c={c} /><Officers c={c} /><EvidenceList target="company" id={c.id} title="其他文件里的证据" /></div>}
          {tab === 2 && <Archive c={c} onUpload={(typeID) => upload(typeID)} />}
          {tab === 3 && <div className="two"><Dues c={c} /><Agent c={c} /></div>}
          {tab === 4 && <History c={c} />}
        </div>
      </div></div>
      {stageNode}
    </DropTarget>
  );
}

/** 关联到这家公司的个人文件（董事同意书、委任书等）。 */
function RelatedPersonFiles({ c }: { c: Company }) {
  const { store, router } = useApp();
  const docs = store.relatedPersonDocuments(c.id);
  if (!docs.length) return null;
  return (
    <KitCard title="相关的个人文件">
      <div className="col">{docs.map((d) => (
        <div key={d.id} className="doc-row">
          <span className="doc-ic"><Icon name="doc.text" size={15} /></span>
          <span className="col grow" style={{ minWidth: 0 }}><span className="ellipsis" style={{ fontWeight: 700 }}>{store.docType(d.typeID)?.name ?? "文件"}</span>
            <button className="link t-meta" style={{ textAlign: "left" }} onClick={() => router.openPerson(d.owner.id)}>{store.nameOf(d.owner)}</button></span>
          <span className="t-meta muted num">{d.issueDate ?? d.addedOn}</span>
          <Button size="small" kind="quiet" onClick={() => router.open({ kind: "document", id: d.id })}>查看</Button>
        </div>
      ))}</div>
    </KitCard>
  );
}

/** 概况条：登记状态、合规、档案完整度、默认中介。 */
function Snapshot({ c }: { c: Company }) {
  const { store, router } = useApp();
  const cnt = store.companyCounts(c);
  const pct = completeness(cnt);
  const next = store.openObligations.filter((o) => o.company.id === c.id).sort((a, b) => (a.due < b.due ? -1 : 1))[0];
  const left = next ? D.daysBetween(store.today, next.due) : null;
  const unv = store.unverified.filter((x) => x.item.companyID === c.id).length;
  const attDocs = store.documentsNeedingAttention.filter((d) => d.owner.kind === "company" && d.owner.id === c.id);
  const att = attDocs.length, attBad = attDocs.some((d) => store.freshness(d).kind === "expired");
  return (
    <div className="snapshot">
      {/* 5.3.4：概况条只放“要不要处理”的四件事；法域、类型、集团、状态都在标题下的属性里 */}
      <button className="cell" style={{ textAlign: "left" }} onClick={() => router.set("companyTab", 3)}><span className="t-label">申报</span><span>{left === null ? <span className="t-meta muted">没有待办</span> : left < 0 ? <Pill text={`逾期 ${-left} 天`} kind="bad" /> : left <= 30 ? <Pill text={`${left} 天后到期`} kind="warn" /> : <span className="t-meta">{left} 天后 · {next!.rule.name}</span>}</span></button>
      <div className="cell"><span className="t-label">我负责的材料</span>{pct === null
        ? <button className="row gap6" style={{ textAlign: "left" }} onClick={() => router.open({ kind: "scope", ownerKind: "company", owners: [c.id] })}><Pill text={cnt.configured ? "没有我负责的条目" : "未配置材料范围"} kind="neutral" /><span className="link t-meta">设置</span></button>
        : <span className="row gap8"><ProgressTrack value={pct} width={90} /><b className="num">{cnt.held}/{cnt.total}</b>{cnt.agent > 0 && <span className="t-meta muted">中介 {cnt.agent}</span>}</span>}</div>
      <button className="cell" style={{ textAlign: "left" }} onClick={() => router.go("verify")}><span className="t-label">待核实</span>{unv ? <Pill text={`${unv} 条`} kind="warn" /> : <span className="t-meta muted">都已核实</span>}</button>
      <button className="cell" style={{ textAlign: "left" }} onClick={() => router.set("companyTab", 2)}><span className="t-label">文件需处理</span>{att ? <Pill text={`${att} 份`} kind={attBad ? "bad" : "warn"} /> : <span className="t-meta muted">没有</span>}</button>
    </div>
  );
}

/** 右栏：下一件事 + 接下来。 */
function NextUp({ c }: { c: Company }) {
  const { store, router } = useApp();
  const list = store.openObligations.filter((o) => o.company.id === c.id).sort((a, b) => (a.due < b.due ? -1 : 1));
  const next = list[0];
  if (!next) return (
    <KitCard tone="green-card"><span className="row gap10"><span className="doc-ic"><Icon name="checkmark" size={16} strokeWidth={3} /></span><span className="col"><span className="t-subtitle">没有待办</span><span className="t-meta muted">这家公司暂时没有要申报的事。</span></span></span></KitCard>
  );
  const left = D.daysBetween(store.today, next.due);
  const party = store.responsibleParty(next);
  return (
    <>
      <KitCard tone={left < 0 ? "red" : left <= 30 ? "amber" : undefined} className="nextup">
        <span className="cue"><Icon name={left < 0 ? "exclamationmark.circle.fill" : "clock"} size={14} />下一件事</span>
        <div className="t-headline">{next.rule.name}</div>
        <p className="why">{D.long(next.due)}截止 · {leftText(left)}{next.record?.dateConfirmed ? "" : " · 日期按规则推算"}</p>
        <span className="t-meta why">{party ? `交给 ${party.name}` : "还没有指定中介"}</span>
        <div className="row gap8"><Button onClick={() => router.openDue(next.key)}>去处理</Button>{!next.record?.dateConfirmed && <Button onClick={() => store.confirmDue(next)}>确认日期</Button>}</div>
      </KitCard>
      {list.length > 1 && <KitCard title="接下来">
        <div className="horizon">{list.slice(1, 6).map((o) => (
          <button key={o.key} onClick={() => router.openDue(o.key)}><span className="d">{D.short(o.due)}</span><span style={{ fontWeight: 600 }}>{o.rule.name}</span></button>
        ))}</div>
      </KitCard>}
    </>
  );
}

/** 公司背后的人：股东和董事一览，点进人员与持股页签编辑。 */
function PeopleSummary({ c }: { c: Company }) {
  const { store, router } = useApp();
  const hs = store.directShareholders(c.id);
  const os = store.officers(c.id);
  const pids = [...new Set(os.map((a) => a.personID))];
  return (
    <KitCard title="公司背后的人" action={<button className="link t-meta" onClick={() => router.set("companyTab", 1)}>编辑</button>}>
      {hs.length || pids.length ? <div className="people-grid" role="table" aria-label="股东和董事">
        {hs.map((h) => (
          <div key={h.id} className="people-row" role="row">
            <span className="row gap10" style={{ minWidth: 0 }}>
              {h.holder.kind === "person" ? <Avatar name={store.nameOf(h.holder)} size={30} /> : <JurisdictionBadge code={store.company(h.holder.id)?.jurisdiction ?? ""} size={30} tint={companyTint(store, h.holder.id)} />}
              <button className="v4-link name-2" title={store.nameOf(h.holder)} style={{ textAlign: "left", color: "var(--ink)" }} onClick={() => h.holder.kind === "company" ? router.openCompany(h.holder.id) : router.openPerson(h.holder.id)}>{store.nameOf(h.holder)}</button>
            </span>
            <span className="t-meta muted ellipsis role">股东{h.isNominee ? " · 代持" : ""}</span>
            <span className="pct num">{percentLabel(h.percent)}</span>
          </div>
        ))}
        {pids.map((pid) => (
          <div key={pid} className="people-row" role="row">
            <span className="row gap10" style={{ minWidth: 0 }}><Avatar name={store.person(pid)?.name ?? "?"} size={30} />
              <button className="v4-link name-2" title={store.person(pid)?.name} style={{ textAlign: "left", color: "var(--ink)" }} onClick={() => router.openPerson(pid)}>{store.person(pid)?.name}</button></span>
            {(() => { const t = [...new Set(os.filter((a) => a.personID === pid).map((a) => a.title))].join("、"); return <span className="t-meta muted ellipsis role" title={t}>{t}</span>; })()}
            <span className="pct num" aria-label="无持股比例" />
          </div>
        ))}
      </div> : <span className="muted">还没有股东和董事。<button className="link" onClick={() => router.set("companyTab", 1)}>去添加</button></span>}
    </KitCard>
  );
}

/** 样样都在：档案清单的结论 + 缺的几项。 */
function ArchiveSummary({ c }: { c: Company }) {
  const { store, router } = useApp();
  const items = store.archive(c);
  const cnt = store.companyCounts(c);
  const owner = ref("company", c.id);
  const missing = items.filter((i) => i.custody === "mine" && !hasFile(i.state));
  const attention = items.filter((i) => hasFile(i.state) && inView(i.custody) && i.state.kind !== "valid");
  const list = [...missing, ...attention];
  const title = !cnt.configured ? "材料范围还没设置" : !list.length ? "样样都在" : missing.length ? "我负责的还差几样" : "有文件需要处理";
  return (
    <KitCard title={title} action={<button className="link t-meta" onClick={() => router.set("companyTab", 2)}>全部文件</button>}>
      <ScopeSummary counts={cnt} onConfigure={() => router.open({ kind: "scope", ownerKind: "company", owners: [c.id] })} />
      {!cnt.configured && <span className="t-meta muted">Charter 不再按法域清单猜你缺什么。先定哪些材料由你保管，完整度只算这些。</span>}
      {list.slice(0, 5).map((i) => (
        <div key={i.typeID} className="doc-row">
          <span className={`doc-ic ${!hasFile(i.state) ? "missing" : i.state.kind === "expired" ? "bad" : "warn"}`}><Icon name={!hasFile(i.state) ? "plus" : "doc.text"} size={15} /></span>
          <span className="grow ellipsis" style={{ fontWeight: 600 }}>{archiveItemName(i)}</span>
          <StatusTag s={itemStatus(i)} />
          <CustodyChip owner={owner} item={i} />
          {i.document ? <button className="link t-meta" onClick={() => router.open({ kind: "document", id: i.document!.id })}>查看</button> : <button className="link t-meta" onClick={() => router.set("companyTab", 2)}>上传</button>}
        </div>
      ))}
      {cnt.configured && !list.length && <span className="t-meta muted">我负责的材料都在，也没有快过期的。</span>}
    </KitCard>
  );
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return <KitCard title={title} action={aside}><div className="col">{children}</div></KitCard>;
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
      <KV k="财年结束"><InlineText value={c.fiscalYearEnd} label="财年结束（月-日）" className="mono" style={{ textAlign: "right", width: 90 }} onCommit={(v) => /^\d{2}-\d{2}$/.test(v.trim()) && store.editCompanyField(c, "fiscalYearEnd", v.trim(), "财年结束日")} /></KV>
    </Card>
  );
}

function Shareholders({ c }: { c: Company }) {
  const { store, router } = useApp();
  const hs = store.directShareholders(c.id);
  const { isNew, rowRef } = useListMotion(hs.map((h) => h.id));
  const total = hs.reduce((a, h) => a + h.percent, 0);
  const [adding, setAdding] = useState(false);
  return (
    <Card title="股东" aside={<span className="t-meta muted">合计 <b className="num" style={{ color: total > 0 && Math.abs(total - 100) > 0.01 ? "var(--amber-text)" : "var(--ink)" }}>{percentLabel(total)}</b></span>}>
      {hs.map((h) => {
        const role = roleByID(h.roleID);
        return (
          <div key={h.id} ref={rowRef(h.id)} className={`cp-row2 ${isNew(h.id) ? "cp-new" : ""}`}>
            <div className="cp-line">
              {h.holder.kind === "person" ? <Avatar name={store.nameOf(h.holder)} size={30} /> : <span className="v4-code" style={companyTint(store, h.holder.id)}>{store.company(h.holder.id)?.jurisdiction}</span>}
              <button className="v4-link ellipsis grow" style={{ textAlign: "left" }} onClick={() => h.holder.kind === "company" ? router.openCompany(h.holder.id) : router.openPerson(h.holder.id)}>{store.nameOf(h.holder)}{h.isNominee ? <span className="muted" style={{ fontWeight: 400 }}>（名义）</span> : null}</button>
              <span className="t-meta muted ellipsis cp-role" title={role?.name}>{role?.name ?? ""}</span>
              <InlineText value={String(h.percent)} label="持股比例" className="num" style={{ width: 56, textAlign: "right", fontWeight: 600 }} onCommit={(v) => store.setHoldingPercent(h, parseFloat(v))} />
              <span className="muted">%</span>
              <span className="cp-verify"><VerifyChip kind="holding" item={h} companyID={c.id} /></span>
              <button className="v4-x cp-hide" aria-label={`移除股东 ${store.nameOf(h.holder)}`} title="移除（记为不再持股）" onClick={() => store.endHolding(h)}><Icon name="xmark" size={10} /></button>
            </div>
            <ProvenanceLine p={h} />
          </div>
        );
      })}
      {!hs.length && <span className="row gap8" style={{ padding: "6px 0" }}><span className="v4-chip chip-pending">股东待补</span><span className="muted t-meta">还不知道股东，可以先空着。</span></span>}
      <button className="cp-add" onClick={() => setAdding(true)}>+ 添加股东</button>
      {adding && <EntrySheet company={c} mode="holding" onClose={() => setAdding(false)} />}
    </Card>
  );
}

function Officers({ c }: { c: Company }) {
  const { store, router } = useApp();
  const os = store.officers(c.id);
  const { isNew, rowRef } = useListMotion(os.map((a) => a.id));
  const [adding, setAdding] = useState(false);
  return (
    <Card title="董事和高管">
      {[...new Set(os.map((a) => a.personID))].map((pid) => {
        const p = store.person(pid);
        const mine = os.filter((a) => a.personID === pid);
        return (
          <div key={pid} ref={rowRef(mine[0].id)} className={`cp-row2 ${mine.some((a) => isNew(a.id)) ? "cp-new" : ""}`}>
            <div className="cp-line" style={{ alignItems: "flex-start", paddingTop: 8 }}>
              <Avatar name={p?.name ?? "?"} size={30} />
              <button className="v4-link grow name-2" style={{ textAlign: "left", paddingTop: 5 }} title={p?.name} onClick={() => router.openPerson(pid)}>{p?.name}</button>
              {mine.length > 1 && <span className="t-meta muted" style={{ paddingTop: 6, whiteSpace: "nowrap" }}>{mine.length} 个职务</span>}
            </div>
            {mine.map((a) => {
              const role = roleByID(a.roleID);
              return (
                <div key={a.id} className="col role-line">
                  <div className="row gap8">
                    <RoleChip a={a} c={c} />
                    {role && <span className="t-meta muted" style={{ whiteSpace: "nowrap" }}>{roleCategoryLabel[role.category]}</span>}
                    <span className="spacer" />
                    <span className="cp-verify"><VerifyChip kind="appointment" item={a} companyID={c.id} /></span>
                    <button className="v4-x cp-hide" aria-label={`移除 ${p?.name} 的${a.title}`} title="卸任（记入历史）" onClick={() => store.endAppointment(a)}><Icon name="xmark" size={10} /></button>
                  </div>
                  <ProvenanceLine p={a} />
                </div>
              );
            })}
          </div>
        );
      })}
      {!os.length && <span className="muted t-meta" style={{ padding: "6px 0" }}>还没有董事或高管。</span>}
      <button className="cp-add" onClick={() => setAdding(true)}>+ 添加董事或高管</button>
      {adding && <EntrySheet company={c} mode="appointment" onClose={() => setAdding(false)} />}
    </Card>
  );
}

/** 职务标签：点开按法域角色表改。 */
function RoleChip({ a, c }: { a: Appointment; c: Company }) {
  const { store } = useApp();
  const ref0 = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const role = roleByID(a.roleID);
  const list = [...rolesFor(c.jurisdiction, c.entityForm, "manager"), ...rolesFor(c.jurisdiction, c.entityForm, "representative")];
  return (
    <>
      <button ref={ref0} className="v4-chip btnlike" onClick={() => setOpen((o) => !o)} title="点按修改职务">{a.title || role?.name}<Icon name="chevron.down" size={8} /></button>
      <Popover anchor={ref0} open={open} onClose={() => setOpen(false)} align="end">
        <div className="col" style={{ minWidth: 240, padding: 4, maxHeight: 360, overflow: "auto" }}>
          {list.map((r) => <PopoverRow key={r.id} title={`${roleLabel(r)} · ${roleCategoryLabel[r.category]}`} checked={a.roleID === r.id}
            onClick={() => { setOpen(false); store.setAppointmentRole(a, r.id); }} />)}
        </div>
      </Popover>
    </>
  );
}

function History({ c }: { c: Company }) {
  const { store } = useApp();
  const list = store.data.changes.filter((x) => x.companyID === c.id).sort((a, b) => (a.effectiveOn < b.effectiveOn ? 1 : a.effectiveOn > b.effectiveOn ? -1 : 0));
  const { isNew, rowRef } = useListMotion(list.map((x) => x.id));
  return (
    <Card title="变更历史" aside={<span className="t-meta muted">生效、截至、录入分开记</span>}>
      {list.slice(0, 30).map((x) => (
        <div key={x.id} ref={rowRef(x.id)} className={`cp-line ${isNew(x.id) ? "cp-new" : ""}`} style={{ alignItems: "flex-start", paddingTop: 8, paddingBottom: 8 }}>
          <span className="col grow" style={{ minWidth: 0, gap: 2 }}>
            <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>{x.summary}</span>
            <span className="t-meta muted">{x.effectiveUnknown ? `生效日期未知${x.asOf ? ` · 最晚自 ${x.asOf}` : ""}` : `生效 ${x.effectiveOn}`} · 录入 {x.recordedOn}{x.backfill ? " · 补录" : ""}</span>
          </span>
          {x.effectiveUnknown ? <DateField value={undefined} placeholder="补生效日期" onChange={(d) => d && store.setChangeDate(x.id, d)} minWidth={140} />
            : <DateField value={x.effectiveOn} onChange={(d) => d && store.setChangeDate(x.id, d)} allowsClear={false} minWidth={140} />}
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
    <Card title="申报事项">
      {list.map((o) => {
        const left = D.daysBetween(store.today, o.due);
        return (
          <div key={o.key} className="doc-row tk">
            <button className="row gap12 grow" style={{ textAlign: "left", minWidth: 0 }} onClick={() => router.openDue(o.key)}>
            <TicketStub due={o.due} today={store.today} />
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="ellipsis" style={{ fontWeight: 600 }}>{o.rule.name}</span>
              <span className="t-meta muted row gap6" style={{ minWidth: 0 }}><span style={{ whiteSpace: "nowrap" }}>{D.long(o.due)}</span>
                {o.record?.dateConfirmed ? <span>· 已确认</span> : <span>· 推算日期</span>}
                <span className="ellipsis">· {store.responsibleParty(o)?.name ?? "未指定中介"}</span></span>
            </span>
            <span className={`pill ${left < 0 ? "bad" : left <= 30 ? "warn" : "neutral"}`}>{leftText(left)}</span>
            </button>
            {!o.record?.dateConfirmed && <button className="v4-chip btnlike" style={{ height: 24, fontSize: 12, flexShrink: 0 }} title="按推算日期确认" onClick={() => store.confirmDue(o)}>确认日期</button>}
          </div>
        );
      })}
      {!list.length && <span className="muted t-meta" style={{ padding: "6px 0" }}>这家公司暂时没有到期事项。</span>}
    </Card>
  );
}

function Archive({ c, onUpload }: { c: Company; onUpload: (typeID: string) => void }) {
  const { store, router } = useApp();
  const items = store.archive(c);
  const cnt = store.companyCounts(c);
  const view = useFileView();
  const owner = ref("company", c.id);
  const row = (i: ArchiveItem) => {
    const d = i.document;
    const date = d ? (d.expiryDate ? `${d.expiryDate} 到期` : d.issueDate ? `${d.issueDate} 签发` : "") : "";
    return (
      <div key={i.typeID} className="cp-line archive-line" role="button" tabIndex={0} style={{ cursor: "default" }}
        title={d ? d.originalFileName : itemStatus(i).hint}
        onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; if (d) router.open({ kind: "document", id: d.id }); else if (i.custody === "mine") onUpload(i.typeID); }}
        onKeyDown={(e) => e.key === "Enter" && (d ? router.open({ kind: "document", id: d.id }) : onUpload(i.typeID))}>
        <span className="col grow" style={{ minWidth: 0, gap: 1 }}>
          <span className="name-1" style={{ fontSize: 13.5, fontWeight: 600, color: d ? undefined : "var(--muted)" }}>{archiveItemName(i)}{i.suggested && !i.explicit && !d ? <span className="t-meta muted" style={{ fontWeight: 400 }}>　法域常见</span> : null}</span>
          {(i.copies > 0 || i.olderVersions > 0 || i.note) && <span className="t-meta muted name-1">
            {[i.copies > 0 ? `另有 ${i.copies} 份同类现行` : "", i.olderVersions > 0 ? `${i.olderVersions} 个旧版` : "", i.note].filter(Boolean).join(" · ")}</span>}
        </span>
        <span className="t-meta muted num" style={{ whiteSpace: "nowrap" }}>{date}</span>
        <StatusTag s={itemStatus(i)} />
        {d && <ExtraTags d={d} t={i.type} />}
        {view === "review" && <CustodyChip owner={owner} item={i} />}
        {!d && i.custody !== "agent" && <button className="link t-meta" style={{ whiteSpace: "nowrap" }} onClick={() => onUpload(i.typeID)}>上传</button>}
      </div>
    );
  };
  const hidden = items.filter((i) => !inView(i.custody)).length;
  return (
    <Card title={view === "held" ? "已有材料" : "完整性审阅"} aside={<span className="row gap10"><FileViewToggle /></span>}>
      <div className="row gap10 wrap" style={{ paddingBottom: 8 }}>
        <ScopeSummary counts={cnt} onConfigure={() => router.open({ kind: "scope", ownerKind: "company", owners: [c.id] })} />
        <span className="spacer" />
        <button className="link t-meta" onClick={() => router.open({ kind: "companyItems", companyID: c.id })}>增减条目</button>
      </div>
      <ScopedItems items={items} view={view} row={row}
        empty={<span className="muted" style={{ padding: "8px 0" }}>{view === "held" ? "还没有归档文件。把文件拖进这一页即可归档。" : "没有需要审阅的条目。"}</span>} />
      {view === "review" && hidden > 0 && <button className="link t-meta" style={{ alignSelf: "flex-start", paddingTop: 8 }} onClick={() => router.open({ kind: "scope", ownerKind: "company", owners: [c.id] })}>不在范围或不适用的 {hidden} 项已隐藏，去范围设置里查看</button>}
      <span className="t-meta muted" style={{ paddingTop: 8 }}>把文件拖进这一页的任何地方即可归档，Charter 会识别类型和日期。</span>
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
      </div>
      {contact && (
        <div className="cp-kv">
          <span className="muted">主对接人</span>
          <span className="row gap8" style={{ minWidth: 0, flex: 1, justifyContent: "flex-end" }}>
            <span className="ellipsis" style={{ fontWeight: 600, flex: "none", maxWidth: "40%" }}>{contact.name}</span>
            {contact.email && <button className="link t-meta ellipsis" style={{ minWidth: 0 }} title="复制邮箱" onClick={() => { void platform().copyText(contact.email); store.showToast("邮箱已复制。"); }}>{contact.email}</button>}
          </span>
        </div>
      )}
      <span className="t-meta muted">申报事项默认交给它；单件事可以在申报日历里另外指定。</span>
    </Card>
  );
}
