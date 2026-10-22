// 4.4 可信台账：录入股权/任职（新发生 / 补录、三种日期、依据、核实）、内联新建公司、出处行、待核实清单。

import type React from "react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "../state/hooks";
import type { Store } from "../state/store";
import * as D from "../domain/day";
import type { Day } from "../domain/day";
import { type Appointment, type Company, type Evidence, type Holding, type NodeRef, type Provenance, ref } from "../domain/models";
import { percentLabel } from "../domain/engine";
import { type RoleCategory, roleByID, roleCategoryLabel, roleLabel, rolesFor } from "../domain/roles";
import { Button, Checkbox, DateField, EmptyStateView, Modal, PageHeader, Popover, PopoverRow, Segmented, SelectField, SheetScaffold } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { companyTint } from "../ui/uistyle";

// MARK: - 出处文字

export function provenanceText(p: Provenance & { from?: Day }): string {
  const asOf = p.asOf ? `截至 ${p.asOf}` : "截至未填";
  if (p.from) return `生效 ${p.from} · ${asOf}`;
  return p.asOf ? `生效日期未知 · 最晚自 ${p.asOf}` : `生效日期未知 · ${asOf}`;
}

const docLabel = (store: Store, e?: Evidence) => {
  if (!e) return "";
  const d = store.data.documents.find((x) => x.id === e.documentID);
  const name = d ? (store.docType(d.typeID)?.name ?? d.originalFileName) : "已删除的文件";
  return `${name}${d?.issueDate ? ` ${D.year(d.issueDate)}` : ""}${e.page ? ` · 第 ${e.page} 页` : ""}`;
};

/** 某家公司（及其股东、董事本人）名下可作依据的文件。 */
function evidenceOptions(store: Store, companyID: string, extra: NodeRef[] = []) {
  const owners = [ref("company", companyID), ...extra];
  const docs = owners.flatMap((o) => store.ownedDocuments(o));
  return docs.map((d) => [d.id, `${store.docType(d.typeID)?.name ?? d.originalFileName}${d.issueDate ? ` · ${d.issueDate}` : ""}`] as [string, string]);
}

// MARK: - 核实状态标签（可点）

export function VerifyChip({ kind, item, companyID }: { kind: "holding" | "appointment"; item: Holding | Appointment; companyID: string }) {
  const { store } = useApp();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const v = !!item.verified;
  return (
    <>
      <button ref={anchor} className={`v4-chip btnlike trust-chip ${v ? "ok" : "pending"}`} onClick={() => setOpen((o) => !o)} aria-label={v ? "已核实，点按修改" : "待核实，点按核实"}>
        {v ? <><Icon name="checkmark" size={9} strokeWidth={3} />已核实</> : "待核实"}<Icon name="chevron.down" size={8} />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => { setOpen(false); setPicking(false); }} align="end">
        {picking ? <EvidenceForm store={store} companyID={companyID} initial={item.evidence} extra={kind === "holding" ? [(item as Holding).holder] : [ref("person", (item as Appointment).personID)]}
          onDone={(e) => { setOpen(false); setPicking(false); if (e) store.setProvenance(kind, item.id, { evidence: e, verified: true }, "关联依据"); }} />
          : <div className="col" style={{ minWidth: 220, padding: 4 }}>
            <PopoverRow title="已核实" icon="checkmark.circle" checked={v} disabled={!item.evidence} onClick={() => { setOpen(false); store.setProvenance(kind, item.id, { verified: true }, "标为已核实"); }} />
            <PopoverRow title="待核实" icon="questionmark.circle" checked={!v} onClick={() => { setOpen(false); store.setProvenance(kind, item.id, { verified: false }, "标为待核实"); }} />
            <PopoverRow title={item.evidence ? "换一份依据…" : "关联依据并核实…"} icon="paperclip" onClick={() => setPicking(true)} />
            {item.evidence && <PopoverRow title="去掉依据" icon="xmark" onClick={() => { setOpen(false); store.setProvenance(kind, item.id, { evidence: null as any }, "去掉依据"); }} />}
          </div>}
      </Popover>
    </>
  );
}

function EvidenceForm({ store, companyID, initial, extra, onDone }: { store: Store; companyID: string; initial?: Evidence; extra?: NodeRef[]; onDone: (e?: Evidence) => void }) {
  const opts = evidenceOptions(store, companyID, extra);
  const [docID, setDocID] = useState(initial?.documentID ?? opts[0]?.[0] ?? "");
  const [page, setPage] = useState(initial?.page ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  if (!opts.length) return <div className="col gap8" style={{ width: 280, padding: 10 }}><b>还没有可用的文件</b><span className="t-meta muted">先把股东名册、周年申报等归档到这家公司，再回来关联。</span><Button size="small" onClick={() => onDone()}>好</Button></div>;
  return (
    <div className="col gap8" style={{ width: 320, padding: 10 }}>
      <b>依据</b>
      <SelectField options={opts} value={docID} onChange={setDocID} minWidth={300} />
      <div className="row gap8"><input className="v4-input" value={page} onChange={(e) => setPage(e.target.value)} placeholder="页码" aria-label="页码" style={{ width: 80 }} />
        <input className="v4-input grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（可选）" aria-label="备注" /></div>
      <div className="row gap8" style={{ justifyContent: "flex-end" }}><Button size="small" kind="quiet" onClick={() => onDone()}>取消</Button>
        <Button size="small" kind="primary" disabled={!docID} onClick={() => onDone({ documentID: docID, ...(page.trim() ? { page: page.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) })}>关联并核实</Button></div>
    </div>
  );
}

/** 股权、任职行的第二行：日期 + 依据。 */
export function ProvenanceLine({ p, onOpenDoc }: { p: Provenance & { from?: Day }; onOpenDoc?: () => void }) {
  const { store } = useApp();
  return (
    <div className="row gap8 t-meta muted trust-line" style={{ flexWrap: "wrap" }}>
      <span>{provenanceText(p)}</span>
      {p.evidence && <button className="v4-link" style={{ color: "var(--ink)" }} onClick={onOpenDoc ?? (() => { const d = store.data.documents.find((x) => x.id === p.evidence!.documentID); if (d) void store.openDocument(d); })}>
        <Icon name="doc.text" size={11} /> {docLabel(store, p.evidence)}</button>}
    </div>
  );
}

// MARK: - 录入表单

type HolderChoice = { kind: "existing"; ref: NodeRef } | { kind: "newPerson"; name: string } | { kind: "newCompany"; name: string } | null;

export function EntrySheet({ company: c, mode, onClose }: { company: Company; mode: "holding" | "appointment"; onClose: () => void }) {
  const { store } = useApp();
  const holding = mode === "holding";
  const [q, setQ] = useState("");
  const [holder, setHolder] = useState<HolderChoice>(null);
  const [pct, setPct] = useState(String(Math.max(0, 100 - store.directShareholders(c.id).reduce((a, h) => a + h.percent, 0)) || 100));
  const [nominee, setNominee] = useState(false);
  const [roleID, setRoleID] = useState<string>(holding ? "" : (rolesFor(c.jurisdiction, c.entityForm, "manager")[0]?.id ?? "common.director"));
  const [title, setTitle] = useState("");
  const [unknown, setUnknown] = useState(true);
  const [effective, setEffective] = useState<Day | undefined>(undefined);
  const [asOf, setAsOf] = useState<Day | undefined>(undefined);
  const [natureTouched, setNatureTouched] = useState(false);
  const [backfillChoice, setBackfill] = useState(true);
  const backfill = natureTouched ? backfillChoice : store.defaultBackfill(unknown ? undefined : effective);
  const [docID, setDocID] = useState("");
  const [page, setPage] = useState("");
  const [verified, setVerified] = useState(false);
  // 内联新建公司
  const [jur, setJur] = useState("");
  const [form, setForm] = useState("");
  const [groupID, setGroupID] = useState("");
  const extra = holder?.kind === "existing" ? [holder.ref] : [];
  const evOpts = evidenceOptions(store, c.id, extra);
  const ql = q.trim().toLowerCase();
  const matches = useMemo(() => !ql || holder ? [] : holding ? [
    ...store.data.companies.filter((x) => x.id !== c.id && x.name.toLowerCase().includes(ql)).slice(0, 5).map((x) => ({ r: ref("company", x.id), name: x.name, code: x.jurisdiction })),
    ...store.data.people.filter((x) => (x.name + " " + x.aliases.join(" ")).toLowerCase().includes(ql)).slice(0, 4).map((x) => ({ r: ref("person", x.id), name: x.name, code: [...x.name][0] })),
  ] : store.data.people.filter((x) => (x.name + " " + x.aliases.join(" ")).toLowerCase().includes(ql)).slice(0, 6).map((x) => ({ r: ref("person", x.id), name: x.name, code: [...x.name][0] })), [ql, holder, holding]);
  const suggestion = holder?.kind === "newCompany" ? store.suggestJurisdiction(holder.name) : null;
  const jurisdictions = store.data.library.jurisdictions;
  const forms = store.jurisdiction(jur)?.entityForms ?? [];
  const holderName = holder?.kind === "existing" ? store.nameOf(holder.ref) : holder?.name ?? q.trim();
  const p = parseFloat(pct);
  const ownerRoles = rolesFor(c.jurisdiction, c.entityForm, "owner").filter((r) => r.id !== "common.shareholder");
  const officerRoles = [...rolesFor(c.jurisdiction, c.entityForm, "manager"), ...rolesFor(c.jurisdiction, c.entityForm, "representative")];
  const role = roleByID(roleID);
  const evidence: Evidence | undefined = docID ? { documentID: docID, ...(page.trim() ? { page: page.trim() } : {}) } : undefined;
  const isVerified = !!evidence && verified;

  const problems: string[] = [];
  if (!holderName) problems.push(holding ? "选择或输入股东" : "输入姓名");
  if (holding && !(p > 0 && p <= 100)) problems.push("比例在 0–100 之间");
  if (holder?.kind === "newCompany" && !jur) problems.push("选择新公司的法域");
  if (!holding && !role && !title.trim()) problems.push("选择职务");

  const summary = (() => {
    const who = holderName || "（未选）";
    const what = holding ? `${who} ${role ? role.name + " " : "持有 "}${p > 0 ? percentLabel(p) : "?"}` : `${who} 任${title.trim() || role?.name || "?"}`;
    const when = unknown || !effective ? (asOf ? `生效日期未知，最晚自 ${asOf}` : "生效日期未知") : `自 ${effective} 生效${asOf ? `，资料截至 ${asOf}` : ""}`;
    const ev = evidence ? `依据${docLabel(store, evidence)}，${isVerified ? "已核实" : "待核实"}` : "没有依据，记为待核实";
    return { what, when, ev, nature: backfill ? "补录，不生成提醒" : "新发生的变更，会按规则生成提醒" };
  })();

  const save = () => {
    if (problems.length) return;
    const common = { companyID: c.id, backfill, effectiveOn: unknown ? undefined : effective, asOf, evidence, verified: isVerified };
    const ok = holding
      ? store.recordHolding({ ...common, percent: p, isNominee: nominee, roleID: roleID || undefined,
        holder: holder?.kind === "existing" ? holder : holder?.kind === "newCompany" ? { kind: "newCompany", entity: { name: holder.name, jurisdiction: jur, entityForm: form || undefined, groupID: groupID || undefined } } : { kind: "newPerson", name: holderName } })
      : store.recordAppointment({ ...common, personID: holder?.kind === "existing" ? holder.ref.id : undefined, personName: holderName, title: title.trim() || role?.name || "", roleID: roleID || undefined });
    if (ok) onClose();
  };

  const row = (label: string, children: ReactNode, hint?: string) => (
    <div className="entry-row"><span className="entry-label">{label}</span><div className="col gap6 grow" style={{ minWidth: 0 }}>{children}{hint && <span className="t-meta muted">{hint}</span>}</div></div>
  );

  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={holding ? "添加股东" : "添加董事或高管"} subtitle={c.name} width={640} height={860} onSubmit={save}
        leading={problems.length ? <span className="t-meta muted">还差：{problems.join("、")}</span> : null}
        trailing={<><Button kind="quiet" onClick={onClose}>取消</Button><Button kind="primary" disabled={problems.length > 0} onClick={save}>{holder?.kind === "newCompany" ? "新建并保存" : "保存"}</Button></>}>
        <div className="col entry">
          {row(holding ? "股东" : "姓名", <>
            {holder ? (
              <div className="field-chip">
                {holder.kind === "existing" ? <span className="v4-code" style={holder.ref.kind === "person" ? { borderRadius: "50%" } : companyTint(store, holder.ref.id)}>{holder.ref.kind === "company" ? store.company(holder.ref.id)?.jurisdiction : [...holderName][0]}</span>
                  : <span className="v4-code dark" style={holder.kind === "newPerson" ? { borderRadius: "50%" } : undefined}>+</span>}
                <b className="grow ellipsis">{holderName}</b>
                <span className="t-meta muted">{holder.kind === "existing" ? (holder.ref.kind === "company" ? store.jurisdictionName(store.company(holder.ref.id)?.jurisdiction ?? "") + " · 已有" : "已有的人") : holder.kind === "newPerson" ? "新建个人" : "新建公司"}</span>
                <button className="v4-x" aria-label="重新选择" onClick={() => { setHolder(null); setJur(""); setForm(""); setGroupID(""); }}><Icon name="xmark" size={10} /></button>
              </div>
            ) : <>
              <input className="v4-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={holding ? "输入公司或人名…" : "输入姓名，已有的人会自动关联…"} aria-label={holding ? "股东" : "姓名"} />
              {ql && <div className="v4-menu">
                {matches.map((o) => <button key={o.r.kind + o.r.id} className="v4-opt" onClick={() => setHolder({ kind: "existing", ref: o.r })}>
                  <span className="v4-code" style={o.r.kind === "person" ? { borderRadius: "50%" } : companyTint(store, o.r.id)}>{o.code}</span><span className="grow ellipsis">{o.name}</span></button>)}
                <button className="v4-opt" onClick={() => setHolder({ kind: "newPerson", name: q.trim() })}><span className="v4-code dark" style={{ borderRadius: "50%" }}>+</span><span className="grow ellipsis" style={{ fontWeight: 600 }}>新建个人“{q.trim()}”</span></button>
                {holding && <button className="v4-opt" onClick={() => setHolder({ kind: "newCompany", name: q.trim() })}><span className="v4-code dark">+</span><span className="grow ellipsis" style={{ fontWeight: 600 }}>新建公司“{q.trim()}”</span><span className="t-meta muted">要选法域</span></button>}
              </div>}
            </>}
            {holder?.kind === "newCompany" && (
              <div className="newco">
                <div className="newco-grid">
                  <div className="col gap6"><span className="entry-mini">法域 · 必选</span>
                    <div className={jur ? "" : "req-wrap"}><SelectField options={jurisdictions.map((j) => [j.code, `${j.code} ${j.name}`] as [string, string])} value={jur} placeholder="选择法域" onChange={(v) => { setJur(v); setForm(""); }} minWidth={240} /></div>
                  </div>
                  <div className="col gap6"><span className="entry-mini">实体类型</span>
                    <SelectField options={forms.map((f) => [f, f] as [string, string])} value={form} placeholder={jur ? "可以之后再填" : "先选法域"} disabled={!jur} onChange={setForm} minWidth={240} /></div>
                </div>
                {suggestion && !jur && <span className="row gap6 t-meta muted" style={{ whiteSpace: "nowrap" }}>建议：<button className="v4-chip btnlike" onClick={() => setJur(suggestion.code)}>{store.jurisdictionName(suggestion.code)}</button>{suggestion.why}，点一下才算选</span>}
                {suggestion && jur === suggestion.code && <span className="t-meta muted">按名称建议{store.jurisdictionName(jur)}，已由你确认</span>}
                <div className="col gap6"><span className="entry-mini">集团归属</span>
                  <div className="row gap6 wrap">
                    {[...store.data.groups].sort((a, b) => a.name.localeCompare(b.name)).map((g) => (
                      <button key={g.id} className={`v4-chip btnlike ${groupID === g.id ? "picked" : ""}`} aria-pressed={groupID === g.id} onClick={() => setGroupID(g.id)}
                        >
                        <span className="v4-dot" style={{ background: store.brandColor(g) }} />{g.name}</button>
                    ))}
                    <button className={`v4-chip btnlike ${groupID === "" ? "picked" : ""}`} aria-pressed={groupID === ""} onClick={() => setGroupID("")}>暂不分组</button>
                  </div>
                </div>
                <span className="t-meta muted">这家新公司自己的股东先不填，会显示“股东待补”。</span>
                <div className="newco-preview"><span className="t-meta muted" style={{ width: 44 }}>将新建</span>
                  <span className="v4-code" style={groupID ? companyTintFor(store, groupID) : undefined}>{jur || "?"}</span>
                  <span className="col grow" style={{ minWidth: 0 }}><b className="ellipsis">{holder.name}</b>
                    <span className="t-meta muted">{[jur ? store.jurisdictionName(jur) : "法域未选", form || "实体类型未填", groupID ? store.group(groupID)?.name : "不属于集团", "股东待补"].join(" · ")}</span></span></div>
              </div>
            )}
          </>)}
          {holding ? row("比例", <div className="row gap12">
            <span className="row gap6"><input className="v4-input num" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))} aria-label="持股比例" style={{ width: 90, textAlign: "right" }} /><span className="muted">%</span></span>
            <Checkbox checked={nominee} onChange={setNominee}>代持</Checkbox>
            {ownerRoles.length > 0 && <SelectField options={[["", "股东"] as [string, string], ...ownerRoles.map((r) => [r.id, roleLabel(r)] as [string, string])]} value={roleID} onChange={setRoleID} minWidth={150} />}
          </div>, ownerRoles.length ? "合同会社、LLC 等用本地的所有者名称（社員、Member）。" : undefined)
            : row("职务", <div className="row gap8">
              <SelectField options={officerRoles.map((r) => [r.id, `${roleLabel(r)} · ${roleCategoryLabel[r.category]}`] as [string, string])} value={roleID} onChange={setRoleID} minWidth={240} />
              <input className="v4-input grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="自定义职务名（可选）" aria-label="自定义职务" />
            </div>, "按法域的角色表选；结构图和检索按“所有者 / 管理者 / 秘书与代表”理解。")}
          {row("这是", <Segmented options={[[false, "新发生的变更"], [true, "补录已有事实"]] as [boolean, string][]} value={backfill} onChange={(v) => { setNatureTouched(true); setBackfill(v); }} />,
            backfill ? "补录不会生成任何提醒。生效日期早于 30 天或未知时默认选这个。" : "会记入变更历史，并按规则生成需要申报的事项。")}
          {row("生效日期", <div className="row gap12">
            {unknown ? <span className="v4-input muted" style={{ width: 170, display: "inline-flex", alignItems: "center" }}>未知</span> : <DateField value={effective} onChange={setEffective} />}
            <Checkbox checked={unknown} onChange={(v) => { setUnknown(v); if (!v && !effective) setEffective(store.today); }}>不知道生效日期</Checkbox>
          </div>, "法律上自哪天起。周年申报只能证明“当时是”，不能证明“从那天起”。")}
          {row("资料截至", <DateField value={asOf} onChange={setAsOf} placeholder="可留空" />, "依据文件反映的是哪一天的状态。")}
          {row("依据", <>
            {evOpts.length ? <SelectField options={[["", "暂时没有依据"] as [string, string], ...evOpts]} value={docID} onChange={(v) => { setDocID(v); setVerified(!!v); }} minWidth={420} />
              : <span className="t-meta muted">这家公司还没有归档文件。先保存为待核实，之后在“待核实”里关联。</span>}
            {docID && <input className="v4-input" value={page} onChange={(e) => setPage(e.target.value)} placeholder="页码（可选）" aria-label="页码" style={{ width: 140 }} />}
          </>)}
          {row("核实", <Segmented options={[[true, "已核实"], [false, "待核实"]] as [boolean, string][]} value={isVerified} onChange={(v) => evidence && setVerified(v)} />, evidence ? undefined : "有依据时才能选“已核实”。")}
          <div className="entry-summary"><Icon name="info.circle" size={14} />
            <span>将记录：<b>{summary.what}</b>，{summary.when}；{summary.ev}。<b>{summary.nature}。</b></span></div>
        </div>
      </SheetScaffold>
    </Modal>
  );
}

function companyTintFor(store: Store, groupID: string) {
  const g = store.group(groupID);
  return g ? ({ "--g": store.brandColor(g) } as React.CSSProperties) : undefined;
}

// MARK: - 待核实清单

export function VerifyView() {
  const { store, router } = useApp();
  const [mode, setMode] = useState<"company" | "missing">("company");
  const all = store.unverified;
  const companyOf = (x: (typeof all)[number]) => x.item.companyID;
  const total = store.data.holdings.filter((h) => !h.to).length + store.data.appointments.filter((a) => !a.to).length;
  const migrated = all.filter((x) => x.item.migrated).length;
  const missing = all.filter((x) => !x.item.evidence).length;
  const groups = new Map<string, typeof all>();
  for (const x of mode === "missing" ? all.filter((y) => !y.item.evidence) : all) {
    const k = companyOf(x); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(x);
  }
  const order = [...groups.keys()].sort((a, b) => (store.company(a)?.name ?? "").localeCompare(store.company(b)?.name ?? ""));
  return (
    <div className="col grow scroll" style={{ minHeight: 0, padding: "0 var(--page-edge) 32px" }}>
      <PageHeader title="待核实" subtitle={`${all.length} 条股权和任职还没有依据或未核实`} stats={[
        { label: "待核实", value: all.length, unit: "条", tone: all.length ? "warn" : undefined },
        { label: "已核实", value: Math.max(0, total - all.length), unit: "条" },
        { label: "缺依据文件", value: missing, unit: "条" },
        ...(migrated ? [{ label: "其中从 4.3 迁移", value: migrated, unit: "条", tone: "accent" as const }] : []),
      ]}>
        <Segmented options={[["company", "按公司"], ["missing", "只看缺依据"]] as ["company" | "missing", string][]} value={mode} onChange={setMode} />
      </PageHeader>
      {migrated > 0 && <span className="t-meta muted" style={{ margin: "10px 2px 0" }}>升级到 4.4 时，已有的股权和任职都标为待核实，原来的日期当作“资料截至日期”。逐条关联文件后标为已核实。</span>}
      {!order.length ? <EmptyStateView symbol="checkmark.seal" title="全部已核实" message="每条股权和任职都关联了依据文件。" /> : (
        <div className="col" style={{ gap: 12, marginTop: 16 }}>
          {order.map((cid) => {
            const c = store.company(cid);
            if (!c) return null;
            const g = store.brandOf(cid);
            return (
              <section key={cid} className="surface col" style={{ padding: "16px 20px", gap: 2 }}>
                <div className="row gap10" style={{ marginBottom: 6 }}>
                  <span className="v4-code" style={companyTint(store, cid)}>{c.jurisdiction}</span>
                  <button className="v4-link" style={{ fontWeight: 700, fontSize: 15 }} onClick={() => router.openCompany(cid)}>{c.name}</button>
                  {g && <span className="v4-chip"><span className="v4-dot" style={{ background: store.brandColor(g) }} />{g.name}</span>}
                  <span className="spacer" /><span className="t-meta muted">{groups.get(cid)!.length} 条</span>
                </div>
                {groups.get(cid)!.map((x) => <VerifyRow key={x.item.id} x={x} company={c} />)}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VerifyRow({ x, company }: { x: { kind: "holding" | "appointment"; item: Holding | Appointment }; company: Company }) {
  const { store } = useApp();
  const isH = x.kind === "holding";
  const h = x.item as Holding, a = x.item as Appointment;
  const role = roleByID(x.item.roleID);
  const who = isH ? store.nameOf(h.holder) : store.person(a.personID)?.name ?? "";
  const what = isH ? `${role ? role.name + " · " : ""}${percentLabel(h.percent)}` : `${role ? roleCategoryLabel[role.category] : a.title}`;
  const opts = evidenceOptions(store, company.id, isH ? [h.holder] : [ref("person", a.personID)]);
  const [docID, setDocID] = useState(x.item.evidence?.documentID ?? "");
  const [page, setPage] = useState(x.item.evidence?.page ?? "");
  return (
    <div className="row gap12 verify-row">
      <span className="v4-chip" style={{ width: 80, justifyContent: "center", flex: "none" }}>{isH ? (role?.name ?? "股东") : (role?.name ?? a.title)}</span>
      <span className="col" style={{ width: 240, flex: "none", minWidth: 0 }}><b className="ellipsis">{who}</b><span className="t-meta muted ellipsis">{what} · {provenanceText(x.item)}</span></span>
      {opts.length ? <SelectField options={[["", "选择依据文件"] as [string, string], ...opts]} value={docID} onChange={setDocID} minWidth={260} maxWidth={320} />
        : <span className="t-meta muted">没有可用文件，先归档</span>}
      {docID && <input className="v4-input" value={page} onChange={(e) => setPage(e.target.value)} placeholder="页码" aria-label="页码" style={{ width: 70 }} />}
      <span className="spacer" />
      <Button size="small" kind={docID ? "primary" : "secondary"} disabled={!docID} icon="checkmark"
        onClick={() => store.setProvenance(x.kind, x.item.id, { evidence: { documentID: docID, ...(page.trim() ? { page: page.trim() } : {}) }, verified: true }, "标为已核实")}>标为已核实</Button>
    </div>
  );
}

export const roleCategoryOf = (roleID?: string): RoleCategory | undefined => roleByID(roleID)?.category;
