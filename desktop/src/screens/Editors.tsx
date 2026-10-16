// 公司资料编辑、变更确认、持股与任职行、事项详情。移植自 Editors.swift。

import { useEffect, useState } from "react";
import * as D from "../domain/day";
import type { Day } from "../domain/day";
import {
  type Appointment, type ChangeRecord, type Company, type CompanyStatus, type Holding, type NodeRef, companyStatusLabel, handoffActionLabel, latinPad, newCompany,
  obligationStatusLabel, ref, sameRef, uuid,
} from "../domain/models";
import { type Obligation, HoldingValidationError, obligationDone, obligationStatus, percentLabel, validateHoldings } from "../domain/engine";
import { useApp } from "../state/hooks";
import { Store } from "../state/store";
import { recognitionContext } from "../state/actions";
import { recognizeFile } from "../services/extract";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { ActionMenu, Button, Checkbox, DateField, FieldRow, FormGroup, Modal, Pill, SelectField, SheetScaffold, Spinner, TextField, item } from "../ui/kit";
import { useDropTarget } from "../ui/drop";
import { DeadlineBasis, MonthDayField, NextStepControls, TrustBadge, obligationPill, useStageFile } from "./common";

const statuses: CompanyStatus[] = ["active", "forming", "dormant", "dissolving", "dissolved", "redomiciled"].filter((s) => s in companyStatusLabel) as CompanyStatus[];
const norm = (s: string) => s.toLowerCase().replace(/\s/g, "");
const split = (s: string) => s.split(/[,，、]/).map((x) => x.trim()).filter(Boolean);

export function CompanyEditor({ companyID, groupID: initialGroup, onClose }: { companyID?: string; groupID?: string; onClose: () => void }) {
  const { store, router } = useApp();
  const original = store.company(companyID);
  const [draft, setDraft] = useState<Company>(() => original ? structuredClone(original) : newCompany("", store.data.library.jurisdictions.find((j) => j.code === "HK") ? "HK" : store.data.library.jurisdictions[0]?.code ?? "HK", store.today));
  const [holdings, setHoldings] = useState<Holding[]>(() => store.data.holdings.filter((h) => h.companyID === draft.id).map((h) => ({ ...h })));
  const [appointments, setAppointments] = useState<Appointment[]>(() => store.data.appointments.filter((a) => a.companyID === draft.id).map((a) => ({ ...a })));
  const [aliasText, setAliasText] = useState(draft.aliases.join("，"));
  const [formerText, setFormerText] = useState(draft.formerNames.join("，"));
  const [newPersonName, setNewPersonName] = useState("");
  const [askChange, setAskChange] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [groupID, setGroupID] = useState<string | null>(initialGroup ?? null);
  const [memberGroups, setMemberGroups] = useState<Set<string>>(() => new Set(original ? store.groupsContaining(original.id).map((g) => g.id) : []));
  const topCompany = (gid: string | null): NodeRef | null => { const g = store.group(gid); return g?.tops.find((t) => t.kind === "company" && store.company(t.id)) ?? null; };
  const [parentRef, setParentRef] = useState<NodeRef | null>(() => (original ? null : topCompany(initialGroup ?? null)));
  const [parentPercent, setParentPercent] = useState(100);
  const [parentNominee, setParentNominee] = useState(false);
  const [seedPath, setSeedPath] = useState<string | null>(null);
  const [seedReading, setSeedReading] = useState(false);
  const [seedNote, setSeedNote] = useState<string | null>(null);
  const [seedFailed, setSeedFailed] = useState(false);
  const set = (patch: Partial<Company>) => setDraft((d) => ({ ...d, ...patch }));

  const nameError = attempted && !draft.name.trim() ? "请填写注册名" : null;
  const reg = draft.registrationNumber.trim();
  const regDup = original && reg ? store.data.companies.find((c) => c.id !== draft.id && c.jurisdiction === draft.jurisdiction && c.registrationNumber.trim().toLowerCase() === reg.toLowerCase()) : undefined;
  const possibleDuplicate = !original && (norm(draft.name) || norm(reg)) ? store.data.companies.find((c) =>
    (norm(draft.name) && (norm(c.name) === norm(draft.name) || c.aliases.some((a) => norm(a) === norm(draft.name)))) || (norm(reg) && norm(c.registrationNumber) === norm(reg))) : undefined;
  const forms = store.jurisdiction(draft.jurisdiction)?.entityForms ?? [];
  const formChoices: [string, string][] = [["", "未指定"], ...forms.map((f) => [f, f] as [string, string]), ...(draft.entityForm && !forms.includes(draft.entityForm) ? [[draft.entityForm, draft.entityForm] as [string, string]] : [])];
  const personLabel = (id: string) => store.personLabelOf(id);
  const holderOptions: NodeRef[] = [...store.data.people.map((p) => ref("person", p.id)), ...store.data.companies.filter((c) => c.id !== draft.id).map((c) => ref("company", c.id))];
  const labelOf = (r: NodeRef) => (r.kind === "person" ? personLabel(r.id) : store.nameOf(r));

  const oldA = store.data.appointments.filter((a) => a.companyID === draft.id);
  const oldH = store.data.holdings.filter((h) => h.companyID === draft.id);
  const appointmentDiff = (() => {
    const out: string[] = [];
    for (const a of appointments) {
      const n = store.person(a.personID)?.name ?? "未知";
      const o = oldA.find((x) => x.id === a.id);
      if (o) { if (!o.to && a.to) out.push(`${n} 离任${a.title}（${D.long(a.to)}）`); else if (o.personID !== a.personID || o.title !== a.title) out.push(`${n} 任${a.title}`); }
      else out.push(`${n} 就任${a.title}`);
    }
    for (const o of oldA) if (!appointments.some((a) => a.id === o.id)) out.push(`删除了 ${store.person(o.personID)?.name ?? "未知"} 的${o.title}任职`);
    return out;
  })();
  const holdingDiff = (() => {
    const out: string[] = [];
    for (const h of holdings) {
      if (!h.holder.id) continue;
      const n = store.nameOf(h.holder);
      const o = oldH.find((x) => x.id === h.id);
      if (o) { if (!o.to && h.to) out.push(`${n} 不再持股`); else if (o.percent !== h.percent || !sameRef(o.holder, h.holder)) out.push(`${n} 持股改为 ${percentLabel(h.percent)}`); }
      else out.push(`${n} 新增持股 ${percentLabel(h.percent)}`);
    }
    for (const o of oldH) if (!holdings.some((h) => h.id === o.id)) out.push(`删除了 ${store.nameOf(o.holder)} 的持股记录`);
    return out;
  })();
  const changeDate = (items: [Day | undefined, Day | undefined][]) => items.flatMap(([a, b]) => [a, b]).filter((x): x is Day => !!x && x <= store.today).sort().pop() ?? store.today;
  const candidate = (): Holding[] => {
    const list = [...store.data.holdings.filter((h) => h.companyID !== draft.id), ...holdings];
    if (!original && parentRef) list.push({ id: uuid(), holder: parentRef, companyID: draft.id, percent: parentPercent, shares: "", shareClass: "", isNominee: parentNominee, from: draft.incorporationDate });
    return list;
  };

  const save = (asChange: boolean) => {
    const hs = candidate();
    try { validateHoldings(hs, new Set([...store.data.companies.map((c) => c.id), draft.id]), new Set(store.data.people.map((p) => p.id)), new Set([draft.id])); setSaveError(null); }
    catch (e) { setSaveError(e instanceof HoldingValidationError ? e.message : String(e)); return; }
    let note: string | undefined;
    const name = draft.name.trim();
    const final: Company = { ...draft, name, aliases: split(aliasText), formerNames: split(formerText) };
    store.undoable(original ? "保存公司资料" : "新建公司", () => {
      if (asChange) {
        const mk = (kind: ChangeRecord["kind"], lines: string[], d: Day): ChangeRecord => ({ id: uuid(), companyID: draft.id, kind, effectiveOn: d, recordedOn: store.today, summary: lines.slice(0, 2).join("；"), details: lines });
        if (appointmentDiff.length) store.recordChange(mk("directorChange", appointmentDiff, changeDate(appointments.filter((a) => JSON.stringify(oldA.find((o) => o.id === a.id)) !== JSON.stringify(a)).map((a) => [a.from, a.to]))));
        if (holdingDiff.length) store.recordChange(mk("shareholderChange", holdingDiff, changeDate(holdings.filter((h) => JSON.stringify(oldH.find((o) => o.id === h.id)) !== JSON.stringify(h)).map((h) => [h.from, h.to]))));
      }
      if (original && original.name !== name && !final.formerNames.includes(original.name)) {
        final.formerNames.push(original.name);
        store.recordChange({ id: uuid(), companyID: draft.id, kind: "nameChange", effectiveOn: store.today, recordedOn: store.today, summary: `由 ${original.name} 更名为 ${name}` });
      }
      store.upsertCompany(final);
      store.commit((d) => {
        d.holdings = hs as any;
        d.appointments = [...d.appointments.filter((a) => a.companyID !== draft.id), ...appointments] as any;
      });
      if (!original) { if (groupID) store.addToGroup(draft.id, groupID); }
      else {
        const before = new Set(store.groupsContaining(draft.id).map((g) => g.id));
        const added = [...memberGroups].filter((g) => !before.has(g));
        for (const g of added) store.addToGroup(draft.id, g);
        for (const g of before) if (!memberGroups.has(g)) note = store.moveOut(draft.id, g);
        if (!note && added.length) note = "已归入" + added.map((g) => store.group(g)?.name).filter(Boolean).join("、");
      }
      store.commit((d) => store.tidyGroups(d));
    });
    store.showToast(note ?? (original ? `已保存 ${name}` : `已添加 ${name}`));
    if (!original) { router.companyTab = 0; router.openCompany(draft.id); } else router.set("selectedCompanyID", draft.id);
    onClose();
    if (!original && seedPath) { const id = draft.id, p = seedPath; setTimeout(() => router.startImport([p], { kind: "company", id }), 400); }
  };
  const submit = () => {
    setAttempted(true);
    if (!draft.name.trim()) return;
    if (original && (appointmentDiff.length || holdingDiff.length)) setAskChange(true); else save(false);
  };

  const readSeed = async (path: string) => {
    setSeedPath(path); setSeedReading(true); setSeedFailed(false); setSeedNote(null);
    try {
      const r = await recognizeFile(path, recognitionContext(store));
      const filled: string[] = [];
      const patch: Partial<Company> = {};
      if (r.companyNameGuess && [...r.companyNameGuess.trim()].length > 2) { patch.name = r.companyNameGuess.trim(); filled.push("名称"); }
      if (r.jurisdiction && store.jurisdiction(r.jurisdiction)) {
        patch.jurisdiction = r.jurisdiction;
        const fs = store.jurisdiction(r.jurisdiction)?.entityForms ?? [];
        if (draft.entityForm && !fs.includes(draft.entityForm)) patch.entityForm = "";
        filled.push("法域");
      }
      if (r.registrationNumber) { patch.registrationNumber = r.registrationNumber; filled.push("注册编号"); }
      if (r.incorporationDate) { patch.incorporationDate = r.incorporationDate; filled.push("成立日期"); }
      set(patch);
      if (!filled.length) setSeedFailed(true);
      else setSeedNote(`已填写${filled.join("、")}，请核对。` + (r.evidence.length ? `依据：${r.evidence.join("，")}。` : ""));
    } catch { setSeedFailed(true); }
    setSeedReading(false);
  };
  const seedDrop = useDropTarget((paths) => { if (paths[0] && !seedReading) void readSeed(paths[0]); });
  const pickSeed = async () => { if (seedReading) return; const p = (await platform().pickFiles({ multiple: false, extensions: ["pdf", "png", "jpg", "jpeg", "heic", "tif", "tiff"] }))[0]; if (p) void readSeed(p); };

  const g = store.group(groupID);
  const parentOptions: NodeRef[] = [];
  if (g) {
    for (const t of g.tops) if (!parentOptions.some((x) => sameRef(x, t))) parentOptions.push(t);
    for (const r of store.rowsOf(g)) if (!r.unconnected && !parentOptions.some((x) => x.kind === "company" && x.id === r.companyID)) parentOptions.push(ref("company", r.companyID));
  }
  const dupes = store.possibleDuplicates(newPersonName);
  const pctBad = parentPercent <= 0 || parentPercent > 100;

  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={original ? "编辑公司资料" : "新建公司"} subtitle={original?.name} width={720} height={860} onSubmit={submit}
        leading={<>
          {original && <Button onClick={() => { store.deleteCompany(original); router.set("selectedCompanyID", null); onClose(); }}>删除公司</Button>}
          {saveError && <span className="row gap6 amber-text t-meta" title={saveError} aria-label={`无法保存：${saveError}`}><Icon name="exclamationmark.triangle.fill" /><span className="ellipsis" style={{ maxWidth: 260 }}>{saveError}</span></span>}
        </>}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={submit}>{original ? "保存" : "添加"}</Button></>}>
        <div className="col" style={{ gap: 18 }}>
          {!original && <FormGroup title="从文件开始（可选）">
            <div className="col gap8">
              <div ref={seedDrop.ref} data-drop role="button" tabIndex={0} title="拖入注册证书，或点按选择文件" onClick={() => void pickSeed()} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) void pickSeed(); }}
                className="row gap12" style={{ padding: "14px 18px", borderRadius: 16, color: "var(--on-lime)", background: seedDrop.targeted ? "var(--lime)" : "color-mix(in srgb, var(--lime) 85%, transparent)", cursor: "pointer",
                  outline: seedDrop.targeted ? "1.5px dashed color-mix(in srgb, var(--on-lime) 50%, transparent)" : undefined, outlineOffset: -6 }}>
                <Icon name={seedPath ? "doc.text" : "arrow.down.doc"} size={18} />
                <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                  <span className="t-row ellipsis">{seedPath ? seedPath.split(/[\\/]/).pop() : "拖入注册证书，自动填写名称、编号和成立日期"}</span>
                  <span className="t-meta" style={{ opacity: .75 }}>{seedPath ? "保存后这份文件会归档到新公司。" : "也可以点这里选择文件。保存后这份文件会归档到新公司。"}</span>
                </div>
                {seedReading ? <Spinner /> : seedPath && <Button kind="quiet" size="small" onClick={(e) => { e.stopPropagation(); setSeedPath(null); setSeedNote(null); setSeedFailed(false); }}>移除</Button>}
              </div>
              {seedFailed ? <span className="t-meta muted">未能读出公司信息，请手动填写。</span> : seedNote && <span className="t-meta muted">{seedNote}</span>}
            </div>
          </FormGroup>}
          <FormGroup title="基本信息">
            <FieldRow label="注册名" error={nameError}><TextField value={draft.name} onChange={(name) => set({ name })} placeholder="注册名（原文）" autoFocus={!original} invalid={!!nameError} /></FieldRow>
            <FieldRow label="别名" hint="中文简称等，用逗号分隔，仅用于搜索"><TextField value={aliasText} onChange={setAliasText} placeholder="可选" /></FieldRow>
            <FieldRow label="曾用名" hint="用逗号分隔"><TextField value={formerText} onChange={setFormerText} placeholder="可选" /></FieldRow>
            <FieldRow label="法域"><SelectField options={store.data.library.jurisdictions.map((j) => [j.code, `${j.name}（${j.code}）`] as [string, string])} value={draft.jurisdiction} onChange={(jurisdiction) => set({ jurisdiction })} minWidth={220} /></FieldRow>
            <FieldRow label="公司类型"><SelectField options={formChoices} value={draft.entityForm} onChange={(entityForm) => set({ entityForm })} minWidth={220} /></FieldRow>
            <FieldRow label="注册编号" error={regDup ? `与 ${regDup.name} 的注册编号相同，请核对` : null}><TextField value={draft.registrationNumber} onChange={(registrationNumber) => set({ registrationNumber })} placeholder="可选" /></FieldRow>
            {possibleDuplicate && <div className="row gap8 amber-text t-meta appear" style={{ paddingLeft: "calc(var(--label-w, 120px) + 12px)" }}>
              <Icon name="exclamationmark.triangle.fill" />可能已存在：{possibleDuplicate.name}
              <Button kind="quiet" size="small" onClick={() => { router.companyTab = 0; router.openCompany(possibleDuplicate.id); onClose(); }}>打开这家公司</Button>
            </div>}
            <FieldRow label="成立日期"><DateField value={draft.incorporationDate} onChange={(incorporationDate) => set({ incorporationDate })} /></FieldRow>
            <MonthDayField title="财年结束日" value={draft.fiscalYearEnd} onChange={(fiscalYearEnd) => set({ fiscalYearEnd })} />
            <FieldRow label="状态"><SelectField options={statuses.map((s) => [s, companyStatusLabel[s]] as [CompanyStatus, string])} value={draft.status} onChange={(status) => set({ status })} minWidth={160} /></FieldRow>
            <FieldRow label="注册地址"><TextField multiline rows={2} value={draft.registeredAddress} onChange={(registeredAddress) => set({ registeredAddress })} placeholder="可选" /></FieldRow>
          </FormGroup>
          <FormGroup title="集团">
            {original ? <>
              {!store.data.groups.length && <span className="muted">还没有集团。</span>}
              {store.data.groups.map((gr) => {
                const m = store.membership(original.id, gr);
                return <div key={gr.id} className="row gap8" title={store.membershipExplanation(original.id, gr)}>
                  <Checkbox checked={memberGroups.has(gr.id)} onChange={(on) => { const s = new Set(memberGroups); if (on) s.add(gr.id); else s.delete(gr.id); setMemberGroups(s); }}>{gr.name}</Checkbox>
                  {m.kind !== "none" && <Pill text={({ top: "顶层", derived: "股权推导", manual: "手动加入", excluded: "已排除" } as Record<string, string>)[m.kind]} kind={m.kind === "excluded" ? "outline" : "neutral"} />}
                </div>;
              })}
              <span className="t-meta muted">取消勾选即移出。按股权推导出的公司移出后记为“已排除”，之后股权变化也不会再自动纳入。</span>
            </> : <FieldRow label="归入集团"><SelectField options={[[null, "不归入"] as [string | null, string], ...store.data.groups.map((x) => [x.id, x.name] as [string, string])]} value={groupID} onChange={(v) => { setGroupID(v); setParentRef(topCompany(v)); }} minWidth={220} /></FieldRow>}
            {!original && g && <>
              <FieldRow label="上级公司" hint="默认挂在集团顶层公司下面，保存后出现在股权结构图里。">
                <SelectField options={[[null, "暂不设置"] as [NodeRef | null, string], ...parentOptions.map((r) => [r, store.nameOf(r)] as [NodeRef, string])]} value={parentRef} onChange={setParentRef} minWidth={220} keyOf={(r) => (r ? `${r.kind}:${r.id}` : "")} />
              </FieldRow>
              {parentRef && <>
                <FieldRow label="持股比例" error={pctBad ? "持股比例需大于 0、不超过 100%" : null}><PercentField value={parentPercent} onChange={setParentPercent} invalid={pctBad} /></FieldRow>
                <FieldRow label="代持"><Checkbox checked={parentNominee} onChange={setParentNominee}>上级公司代他人持有</Checkbox></FieldRow>
              </>}
            </>}
          </FormGroup>
          <FormGroup title="负责方与提醒">
            <FieldRow label="默认负责方"><SelectField options={[[null, "未指定"] as [string | null, string], ...store.data.parties.map((p) => [p.id, `${p.name}（${({ agent: "外部代理", department: "内部部门", person: "个人" })[p.kind]}）`] as [string, string])]}
              value={draft.defaultPartyID ?? null} onChange={(v) => set({ defaultPartyID: v ?? undefined })} minWidth={220} /></FieldRow>
            <FieldRow label="开始跟踪" hint="此日期之前的截止日不再提醒。补录已有公司时，可设为今天。"><DateField value={draft.trackingSince} onChange={(d) => d && set({ trackingSince: d })} allowsClear={false} /></FieldRow>
          </FormGroup>
          <FormGroup title="股东">
            {holdings.map((h) => <HoldingRow key={h.id} h={h} options={holderOptions} labelOf={labelOf} onChange={(n) => setHoldings((l) => l.map((x) => (x.id === h.id ? n : x)))} onDelete={() => setHoldings((l) => l.filter((x) => x.id !== h.id))} />)}
            <span><Button kind="quiet" size="small" icon="plus" onClick={() => {
              const first = store.data.people[0] ? ref("person", store.data.people[0].id) : ref("company", store.data.companies.find((c) => c.id !== draft.id)?.id ?? "");
              setHoldings((l) => [...l, { id: uuid(), holder: first, companyID: draft.id, percent: 100, shares: "", shareClass: "", isNominee: false, from: draft.incorporationDate }]);
            }}>添加股东</Button></span>
          </FormGroup>
          <FormGroup title="任职人员">
            {appointments.map((a) => <AppointmentRow key={a.id} a={a} roles={Store.roleSuggestions(draft.entityForm)} onChange={(n) => setAppointments((l) => l.map((x) => (x.id === a.id ? n : x)))} onDelete={() => setAppointments((l) => l.filter((x) => x.id !== a.id))} />)}
            <span><Button kind="quiet" size="small" icon="plus" disabled={!store.data.people.length} onClick={() => {
              const p = store.data.people[0];
              if (p) setAppointments((l) => [...l, { id: uuid(), personID: p.id, companyID: draft.id, title: Store.roleSuggestions(draft.entityForm)[0] ?? "" }]);
            }}>添加任职人员</Button></span>
            <FieldRow label="新建人员" hint={dupes.length ? `已有同名或别名一致的人员：${dupes.map((p) => store.personLabel(p)).join("；")}。请直接在上方选择，避免重复。` : "新建人员后，可在上方的任职中选择"}>
              <div className="row gap8">
                <TextField value={newPersonName} onChange={setNewPersonName} placeholder="姓名" onEnter={() => { if (newPersonName.trim()) { store.createPerson(newPersonName.trim()); setNewPersonName(""); } }} />
                <Button disabled={!newPersonName.trim()} onClick={() => { store.createPerson(newPersonName.trim()); setNewPersonName(""); }}>{dupes.length ? "仍然新建" : "添加"}</Button>
              </div>
            </FieldRow>
          </FormGroup>
          <FormGroup title="备注"><TextField multiline rows={3} value={draft.notes} onChange={(notes) => set({ notes })} placeholder="可选" /></FormGroup>
        </div>
      </SheetScaffold>
      {askChange && <RecordChangePrompt changes={[...appointmentDiff, ...holdingDiff]} onClose={() => setAskChange(false)} onRecord={() => { setAskChange(false); save(true); }} onCorrect={() => { setAskChange(false); save(false); }} />}
    </Modal>
  );
}

export function PercentField({ value, onChange, invalid }: { value: number; onChange: (n: number) => void; invalid?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (parseFloat(text) !== value) setText(String(value)); }, [value]);
  return (
    <span className="row gap6">
      <input className={`field num ${invalid ? "invalid" : ""}`} style={{ width: 90, textAlign: "right" }} value={text} inputMode="decimal"
        onChange={(e) => { setText(e.target.value); const n = parseFloat(e.target.value); onChange(Number.isFinite(n) ? n : 0); }} />
      <span className="muted">%</span>
    </span>
  );
}

function RecordChangePrompt({ changes, onClose, onRecord, onCorrect }: { changes: string[]; onClose: () => void; onRecord: () => void; onCorrect: () => void }) {
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title="要记为一次变更吗？" width={520} onSubmit={onRecord}
        subtitle="如果这是一次真实的董事或股东变更，记为变更会写入变更记录、把相关文件标为需要更新，并生成需要申报的事项。如果只是补录或更正错误，选“只更正资料”。"
        leading={<Button onClick={onCorrect}>只更正资料</Button>}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" title="写入变更记录并生成申报事项" onClick={onRecord}>记为变更</Button></>}>
        <div className="col gap6" style={{ padding: 12, borderRadius: 12, background: "var(--band)" }}>
          {changes.slice(0, 6).map((l, i) => <span key={i} className="row baseline gap8"><span style={{ width: 4, height: 4, borderRadius: 2, background: "var(--muted)", flex: "none", transform: "translateY(-2px)" }} />{l}</span>)}
          {changes.length > 6 && <span className="t-meta muted">另有 {changes.length - 6} 处改动</span>}
        </div>
      </SheetScaffold>
    </Modal>
  );
}

function Disclosure({ label, children, defaultOpen }: { label: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="col">
      <button className="row gap8" style={{ textAlign: "left", minHeight: 28 }} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`chev muted ${open ? "open" : ""}`}><Icon name="chevron.right" size={10} /></span>{label}
      </button>
      {open && <div className="col gap10 appear" style={{ paddingTop: 8, paddingLeft: 18 }}>{children}</div>}
    </div>
  );
}

function HoldingRow({ h, options, labelOf, onChange, onDelete }: { h: Holding; options: NodeRef[]; labelOf: (r: NodeRef) => string; onChange: (h: Holding) => void; onDelete: () => void }) {
  const { store } = useApp();
  const set = (patch: Partial<Holding>) => onChange({ ...h, ...patch });
  const key = (r: NodeRef | null) => (r ? `${r.kind}:${r.id}` : "");
  return (
    <Disclosure label={<span className="row gap8 grow">
      <span style={{ fontWeight: 500 }}>{store.nameOf(h.holder)}</span>{h.isNominee && <Pill text="代持" />}<span className="spacer" />
      <b className="num">{percentLabel(h.percent)}</b><span className="t-meta muted num">{h.to ? `${h.from ?? "?"} 至 ${h.to}` : `自 ${h.from ?? "?"}`}</span>
    </span>}>
      <FieldRow label="股东"><SelectField options={options.map((r) => [r, labelOf(r)] as [NodeRef, string])} value={h.holder} onChange={(holder) => set({ holder })} minWidth={240} keyOf={key} /></FieldRow>
      <FieldRow label="持股比例"><PercentField value={h.percent} onChange={(percent) => set({ percent })} /></FieldRow>
      <FieldRow label="股份数"><TextField value={h.shares} onChange={(shares) => set({ shares })} placeholder="可选" /></FieldRow>
      <FieldRow label="股份类别"><TextField value={h.shareClass} onChange={(shareClass) => set({ shareClass })} placeholder="可选" /></FieldRow>
      <FieldRow label="代持"><Checkbox checked={h.isNominee} onChange={(isNominee) => set({ isNominee })}>这是一笔代持</Checkbox></FieldRow>
      {h.isNominee && <FieldRow label="实际受益人"><SelectField options={[[null, "未指定"] as [NodeRef | null, string], ...options.map((r) => [r, labelOf(r)] as [NodeRef, string])]} value={h.beneficialOwner ?? null} onChange={(v) => set({ beneficialOwner: v ?? undefined })} minWidth={240} keyOf={key} /></FieldRow>}
      <FieldRow label="生效日期"><DateField value={h.from} onChange={(from) => set({ from })} /></FieldRow>
      <FieldRow label="结束日期"><DateField value={h.to} onChange={(to) => set({ to })} placeholder="仍持有可留空" /></FieldRow>
      <div className="row" style={{ justifyContent: "flex-end" }}><Button kind="quiet" size="small" icon="trash" onClick={onDelete}>删除这条持股</Button></div>
    </Disclosure>
  );
}

function AppointmentRow({ a, roles, onChange, onDelete }: { a: Appointment; roles: string[]; onChange: (a: Appointment) => void; onDelete: () => void }) {
  const { store } = useApp();
  const set = (patch: Partial<Appointment>) => onChange({ ...a, ...patch });
  return (
    <Disclosure label={<span className="row gap8 grow">
      <span style={{ fontWeight: 500 }}>{store.person(a.personID)?.name ?? "未选择"}</span><span className="muted">{a.title || "未填职位"}</span><span className="spacer" />
      {!a.from && <span className="t-meta muted">日期未知</span>}{a.to && <Pill text="已离任" />}
    </span>}>
      <FieldRow label="人员"><SelectField options={store.data.people.map((p) => [p.id, store.personLabel(p)] as [string, string])} value={a.personID} onChange={(personID) => set({ personID })} minWidth={220} /></FieldRow>
      <FieldRow label="职位" hint="按实体类型给出常用角色，也可以直接输入。">
        <div className="row gap6">
          <TextField value={a.title} onChange={(title) => set({ title })} placeholder={roles[0] ?? "职位"} />
          <ActionMenu title="常用" kind="quiet" size="small" entries={roles.map((r) => item(r, a.title === r ? "checkmark" : undefined, () => set({ title: r })))} />
        </div>
      </FieldRow>
      <FieldRow label="就任日期" hint="不清楚可留空，会显示为“日期未知”，不会用今天代替。"><DateField value={a.from} onChange={(from) => set({ from })} placeholder="日期未知" /></FieldRow>
      <FieldRow label="离任日期"><DateField value={a.to} onChange={(to) => set({ to })} placeholder="在任可留空" /></FieldRow>
      <div className="row" style={{ justifyContent: "flex-end" }}><Button kind="quiet" size="small" icon="trash" onClick={onDelete}>删除这条任职</Button></div>
    </Disclosure>
  );
}

// MARK: - 事项详情

export function ObligationSheet({ obligationKey, onClose }: { obligationKey: string; onClose: () => void }) {
  const { store } = useApp();
  const o = store.allObligations.find((x) => x.key === obligationKey);
  const [note, setNote] = useState(o?.record?.note ?? "");
  const [overrideDay, setOverrideDay] = useState<Day | undefined>(o?.record?.overrideDue);
  const [partyID, setPartyID] = useState<string | null>(o?.record?.partyID ?? null);
  const [startStage, stageNode] = useStageFile();
  if (!o) return (
    <Modal onClose={onClose}><SheetScaffold title="找不到这个事项" subtitle="它可能已经完成或规则已关闭。" width={420} trailing={<Button kind="primary" onClick={onClose}>关闭</Button>}><span /></SheetScaffold></Modal>
  );
  const done = obligationDone(o);
  const fallback = store.party(o.company.rulePartyIDs[o.rule.id] ?? o.company.defaultPartyID)?.name ?? "未指定";
  const saveEdits = (x: Obligation) => {
    if (note !== (x.record?.note ?? "")) store.setObligationNote(x, note);
    if (overrideDay !== x.record?.overrideDue) store.reschedule(x, overrideDay);
    if (partyID && partyID !== x.record?.partyID && store.party(partyID)) store.setObligationParty(x, partyID);
  };
  const fmt = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const history: string[] = [];
  const r = o.record;
  if (r?.log?.length) for (const e of r.log) {
    const dt = D.fromStamp(e.at);
    let line = `${dt.getMonth() + 1}月${dt.getDate()}日 ${fmt.format(dt).split(" ").pop()}　${handoffActionLabel[e.action]}`;
    const p = store.party(e.partyID);
    if (p && ["drafted", "copied", "sent"].includes(e.action)) line += `（${p.name}）`;
    if (e.channel && e.action !== "drafted") line += `，通过${e.channel}`;
    history.push(line);
  } else if (r) {
    if (r.handedOffOn) history.push(`${D.long(r.handedOffOn)}交给${latinPad(store.party(r.partyID)?.name ?? "负责方")}`);
    if (r.completedOn) history.push(`${D.long(r.completedOn)}标记完成`);
  }
  if (!history.length) history.push("还没有处理");
  const receipt = store.receipt(o);
  const attach = () => void startStage({ typeID: "common.receipt", owner: ref("company", o.company.id), onArchived: (doc) => { saveEdits(o); if (done) store.attachReceipt(doc, o); else store.complete(o, doc); onClose(); } });
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={o.rule.name} subtitle={o.company.name} width={600} height={780}
        leading={done ? <Button onClick={() => { store.revertToPending(o); onClose(); }}>改回未完成</Button> : null}
        trailing={<>
          <Button onClick={onClose}>取消</Button>
          <Button kind={done ? "primary" : "secondary"} onClick={() => { saveEdits(o); onClose(); }}>保存</Button>
          {!done && <NextStepControls o={o} large={false} />}
        </>}>
        <div className="col" style={{ gap: 18 }}>
          <div className="row gap8"><Pill text={obligationStatusLabel[obligationStatus(o)]} kind={obligationPill(o)} /><TrustBadge trust={store.trust(o)} /></div>
          <FormGroup title="事项">
            <FieldRow label="截止日"><span>{o.due === o.originalDue ? D.long(o.originalDue) : `${D.long(o.due)}（原定 ${D.long(o.originalDue)}）`}</span></FieldRow>
            {o.rule.penalty && <FieldRow label="逾期后果"><span>{o.rule.penalty}</span></FieldRow>}
            {o.rule.notes && <span className="muted">{o.rule.notes}</span>}
          </FormGroup>
          <FormGroup title="截止日依据"><DeadlineBasis o={o} /></FormGroup>
          <FormGroup title="进度">
            {history.map((l, i) => <span key={i} className="row gap10"><span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--amber-text)", flex: "none" }} />{l}</span>)}
            {receipt && <span><Button size="small" onClick={() => void store.openDocument(receipt)}>打开回执</Button></span>}
          </FormGroup>
          <FormGroup title="处理">
            <FieldRow label="负责方"><SelectField options={[[null, `用默认（${fallback}）`] as [string | null, string], ...store.data.parties.map((p) => [p.id, p.name] as [string, string])]} value={partyID} onChange={setPartyID} minWidth={240} /></FieldRow>
            <FieldRow label="改期到" hint="留空则按规则算出的截止日"><DateField value={overrideDay} onChange={setOverrideDay} placeholder="不改期" /></FieldRow>
            <FieldRow label="备注"><TextField multiline rows={2} value={note} onChange={setNote} placeholder="可选" /></FieldRow>
            {!done ? <span><Button size="small" onClick={attach}>附上回执并标记完成…</Button></span> : !r?.receiptDocumentID && <span><Button size="small" onClick={attach}>补传回执…</Button></span>}
          </FormGroup>
        </div>
        {stageNode}
      </SheetScaffold>
    </Modal>
  );
}
