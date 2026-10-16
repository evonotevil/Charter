// 记录变更：改了什么 → 证明文件 → 确认。只有最后确认才写入。移植自 ChangeWizard.swift。

import { useEffect, useState } from "react";
import { type Appointment, type ChangeKind, type CompanyStatus, type Holding, type NodeRef, changeKindLabel, changeKinds, companyStatusLabel, companyStatuses, isActiveOn, newPerson, ref, sameRef, uuid } from "../domain/models";
import { percentLabel } from "../domain/engine";
import { useApp } from "../state/hooks";
import { type ChangeEffect, type ChangePlan, applyChange, autoSummary, changeEffects, detailLines, newPlan } from "../state/actions";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { ActionMenu, Button, Checkbox, DateField, FieldRow, FormGroup, Modal, Pill, SelectField, SheetScaffold, Spinner, TextField, item } from "../ui/kit";
import { PercentField } from "./Editors";

export function ChangeWizard({ companyID, kind = "directorChange", endingAppointmentID, endingHoldingID, onClose }: {
  companyID: string; kind?: ChangeKind; endingAppointmentID?: string; endingHoldingID?: string; onClose: () => void;
}) {
  const { store } = useApp();
  const company = store.company(companyID);
  const roles = store.roleSuggestions(companyID);
  const reset = (p: ChangePlan): ChangePlan => ({ ...p, endingAppointmentIDs: [], newAppointments: [], endingHoldingIDs: [], newHoldings: [], newPeople: [],
    newAddress: p.kind === "addressChange" ? company?.registeredAddress : undefined, newName: p.kind === "nameChange" ? company?.name : undefined, newStatus: p.kind === "statusChange" ? company?.status : undefined });
  const [plan, setPlan] = useState<ChangePlan>(() => {
    const p = reset(newPlan(companyID, kind));
    const today = p.effectiveOn;
    if (kind === "directorChange" && endingAppointmentID && store.data.appointments.some((a) => a.id === endingAppointmentID && a.companyID === companyID && isActiveOn(a, today))) p.endingAppointmentIDs = [endingAppointmentID];
    if (kind === "shareholderChange" && endingHoldingID && store.data.holdings.some((h) => h.id === endingHoldingID && h.companyID === companyID && isActiveOn(h, today))) p.endingHoldingIDs = [endingHoldingID];
    return p;
  });
  const [step, setStep] = useState(0);
  const [personID, setPersonID] = useState("");
  const [personName, setPersonName] = useState("");
  const [title, setTitle] = useState(roles[0] ?? "董事");
  const [holder, setHolder] = useState<NodeRef | null>(null);
  const [percent, setPercent] = useState(100);
  const [nominee, setNominee] = useState(false);
  const [beneficial, setBeneficial] = useState<NodeRef | null>(null);
  const [working, setWorking] = useState(false);
  const set = (patch: Partial<ChangePlan>) => setPlan((p) => ({ ...p, ...patch }));
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));
  const nameOf = (id: string) => store.person(id)?.name ?? plan.newPeople.find((p) => p.id === id)?.name ?? "未命名";
  const holderName = (r: NodeRef) => (r.kind === "person" ? nameOf(r.id) : store.nameOf(r));
  const currentA = store.data.appointments.filter((a) => a.companyID === companyID && isActiveOn(a, plan.effectiveOn));
  const currentH = store.data.holdings.filter((h) => h.companyID === companyID && isActiveOn(h, plan.effectiveOn));
  const hasContent = !(plan.kind === "nameChange" && !(plan.newName ?? "").trim()) && (detailLines(store, plan).length > 0 || !!plan.summary.trim());
  const holderOptions: NodeRef[] = [...store.data.people.map((p) => ref("person", p.id)), ...plan.newPeople.map((p) => ref("person", p.id)), ...store.data.companies.filter((c) => c.id !== companyID).map((c) => ref("company", c.id))];
  const keyOf = (r: NodeRef | null) => (r ? `${r.kind}:${r.id}` : "");
  const evidenceTypes = store.data.library.documentTypes.filter((t) => (!t.jurisdictions.length || t.jurisdictions.includes(company?.jurisdiction ?? "")) && t.owner === "company" && t.id !== "common.receipt" && t.id !== "common.confirmation");

  const addAppointment = () => {
    let pid = personID;
    const extra = [];
    if (!pid) { const p = newPerson(personName.trim()); extra.push(p); pid = p.id; }
    const a: Appointment = { id: uuid(), personID: pid, companyID, title: title || roles[0] || "董事", from: plan.effectiveOn };
    set({ newPeople: [...plan.newPeople, ...extra], newAppointments: [...plan.newAppointments, a] });
    setPersonID(""); setPersonName("");
  };
  const removeAppointment = (a: Appointment) => {
    const rest = plan.newAppointments.filter((x) => x.id !== a.id);
    const keep = rest.some((x) => x.personID === a.personID) || plan.newHoldings.some((h) => h.holder.id === a.personID);
    set({ newAppointments: rest, newPeople: keep ? plan.newPeople : plan.newPeople.filter((p) => p.id !== a.personID) });
  };
  const addHolding = () => {
    if (!(percent > 0 && percent <= 100)) return;
    let r = holder;
    const extra = [];
    if (!r) { const p = newPerson(personName.trim()); extra.push(p); r = ref("person", p.id); }
    const h: Holding = { id: uuid(), holder: r, companyID, percent, shares: "", shareClass: "", isNominee: nominee, beneficialOwner: nominee ? beneficial ?? undefined : undefined, from: plan.effectiveOn };
    set({ newPeople: [...plan.newPeople, ...extra], newHoldings: [...plan.newHoldings, h] });
    setHolder(null); setPersonName(""); setNominee(false); setBeneficial(null);
  };
  const commit = async () => {
    if (working) return;
    setWorking(true);
    try { await applyChange(store, plan); onClose(); }
    catch (e) { store.setError(`变更未完成：${(e as Error).message}`); }
    finally { setWorking(false); }
  };
  const pickEvidence = async () => { const p = (await platform().pickFiles({ multiple: false, extensions: ["pdf", "png", "jpg", "jpeg", "heic", "tif", "tiff"] }))[0]; if (p) set({ evidencePath: p }); };
  const kept = currentH.filter((h) => !plan.endingHoldingIDs.includes(h.id)).reduce((a, h) => a + h.percent, 0);
  const total = kept + plan.newHoldings.reduce((a, h) => a + h.percent, 0);
  const dupes = store.possibleDuplicates(personName);
  const effects = step === 2 ? changeEffects(store, plan) : [];
  const steps = ["改了什么", "证明文件", "确认"];
  const group = (t: string, kind: ChangeEffect["kind"], icon: string) => {
    const list = effects.filter((e) => e.kind === kind);
    if (!list.length) return null;
    return <div className="col gap6"><span className="row gap6 t-meta muted" style={{ fontWeight: 600 }}><Icon name={icon} size={12} />{t}</span>
      <div className="col gap6" style={{ padding: 14, borderRadius: 14, background: "var(--band)" }}>{list.map((e, i) => <span key={i}>{e.text}</span>)}</div></div>;
  };

  return (
    <Modal onClose={() => !working && onClose()} dismissOnEscape={!working}>
      <SheetScaffold title="记录变更" subtitle={company?.name} width={640} height={780}
        onSubmit={() => { if (step < 2) { if (step > 0 || hasContent) setStep(step + 1); } else void commit(); }}
        leading={step > 0 ? <Button disabled={working} onClick={() => setStep(step - 1)}>上一步</Button> : null}
        trailing={<>
          {working && <Spinner />}
          <Button disabled={working} onClick={onClose}>取消</Button>
          {step < 2 ? <Button kind="primary" disabled={step === 0 && !hasContent} onClick={() => setStep(step + 1)}>{step === 1 && !plan.evidencePath ? "跳过" : "下一步"}</Button>
            : <Button kind="primary" disabled={working} onClick={() => void commit()}>{working ? "正在保存…" : "确认变更"}</Button>}
        </>}>
        <div className="col" style={{ gap: 18, opacity: working ? .6 : 1, pointerEvents: working ? "none" : undefined }}>
          <div className="row gap10" aria-label={`第 ${step + 1} 步，共 3 步`}>
            {steps.map((t, i) => (
              <span key={t} className="row gap10" style={{ flex: i < steps.length - 1 ? 1 : "none" }}>
                <span className="row gap6" style={{ flex: "none" }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, background: i <= step ? "var(--selection)" : "var(--band)", color: i <= step ? "var(--on-selection)" : "var(--muted)" }}>{i + 1}</span>
                  <span style={{ fontSize: 13, fontWeight: i === step ? 600 : 400, color: i === step ? "var(--ink)" : "var(--muted)" }}>{t}</span>
                </span>
                {i < steps.length - 1 && <span className="hairline grow" />}
              </span>
            ))}
          </div>

          {step === 0 && <>
            <FormGroup title="变更">
              <FieldRow label="变更类型"><SelectField options={changeKinds.map((k) => [k, changeKindLabel[k]] as [ChangeKind, string])} value={plan.kind} onChange={(k) => { setPlan((p) => reset({ ...p, kind: k })); setTitle(roles[0] ?? "董事"); }} minWidth={220} /></FieldRow>
              <FieldRow label="生效日期"><DateField value={plan.effectiveOn} onChange={(d) => d && set({ effectiveOn: d })} allowsClear={false} /></FieldRow>
            </FormGroup>
            {plan.kind === "directorChange" && <>
              <FormGroup title="现任：勾选离任人员">
                {!currentA.length && <span className="muted">还没有记录现任{store.officerNoun(companyID)}。</span>}
                {currentA.map((a) => {
                  const on = plan.endingAppointmentIDs.includes(a.id);
                  return <Checkbox key={a.id} checked={on} onChange={(v) => set({ endingAppointmentIDs: toggle(plan.endingAppointmentIDs, a.id, v) })}>
                    <span className="row gap8 grow"><b style={{ fontWeight: 500 }}>{nameOf(a.personID)}</b><span className="muted">{a.title}</span>{on && <span className="amber-text" style={{ fontWeight: 600, marginLeft: "auto" }}>离任</span>}</span>
                  </Checkbox>;
                })}
              </FormGroup>
              <FormGroup title="新任">
                {plan.newAppointments.map((a) => <div key={a.id} className="row gap8"><b style={{ fontWeight: 500 }}>{nameOf(a.personID)}</b><span className="muted grow">{a.title}</span><Button kind="quiet" size="small" onClick={() => removeAppointment(a)}>移除</Button></div>)}
                <FieldRow label="人员"><SelectField options={[["", "新建人员…"] as [string, string], ...store.data.people.map((p) => [p.id, store.personLabel(p)] as [string, string])]} value={personID} onChange={setPersonID} minWidth={220} /></FieldRow>
                {!personID && <FieldRow label="姓名"><TextField value={personName} onChange={setPersonName} placeholder="新人员的姓名" /></FieldRow>}
                {!personID && dupes[0] && <div className="row gap8"><span className="t-meta amber-text">可能是已有的 {store.personLabel(dupes[0])}</span><Button kind="quiet" size="small" onClick={() => { setPersonID(dupes[0].id); setPersonName(""); }}>使用此人</Button></div>}
                <FieldRow label="职位"><div className="row gap6"><TextField value={title} onChange={setTitle} placeholder={roles[0] ?? "职位"} /><ActionMenu title="常用" kind="quiet" size="small" entries={roles.map((r) => item(r, undefined, () => setTitle(r)))} /></div></FieldRow>
                <span><Button size="small" disabled={!personID && !personName.trim()} onClick={addAppointment}>加入新任名单</Button></span>
              </FormGroup>
            </>}
            {plan.kind === "shareholderChange" && <>
              <FormGroup title="现有股东：勾选转出或结束的持股">
                {!currentH.length && <span className="muted">还没有记录股东。</span>}
                {currentH.map((h) => {
                  const on = plan.endingHoldingIDs.includes(h.id);
                  return <Checkbox key={h.id} checked={on} onChange={(v) => set({ endingHoldingIDs: toggle(plan.endingHoldingIDs, h.id, v) })}>
                    <span className="row gap8 grow"><b style={{ fontWeight: 500 }}>{store.nameOf(h.holder)}</b><span className="num" style={{ marginLeft: "auto", textDecoration: on ? "line-through" : undefined }}>{percentLabel(h.percent)}</span></span>
                  </Checkbox>;
                })}
              </FormGroup>
              <div className="col gap8">
                <FormGroup title="新增或调整后的持股">
                  {plan.newHoldings.map((h) => <div key={h.id} className="row gap8"><b style={{ fontWeight: 500 }}>{holderName(h.holder)}</b>{h.isNominee && <Pill text="代持" />}<span className="spacer" /><span className="num">{percentLabel(h.percent)}</span>
                    <Button kind="quiet" size="small" onClick={() => set({ newHoldings: plan.newHoldings.filter((x) => x.id !== h.id) })}>移除</Button></div>)}
                  <FieldRow label="股东"><SelectField options={[[null, "新建人员…"] as [NodeRef | null, string], ...holderOptions.map((r) => [r, holderName(r)] as [NodeRef, string])]} value={holder} onChange={setHolder} minWidth={240} keyOf={keyOf} /></FieldRow>
                  {!holder && <FieldRow label="姓名"><TextField value={personName} onChange={setPersonName} placeholder="新人员的姓名" /></FieldRow>}
                  <FieldRow label="持股比例"><PercentField value={percent} onChange={setPercent} /></FieldRow>
                  <FieldRow label="代持"><Checkbox checked={nominee} onChange={setNominee}>这是一笔代持</Checkbox></FieldRow>
                  {nominee && <FieldRow label="实际受益人" hint={beneficial ? undefined : "这部分持股会计入未识别比例，不会算作名义股东的最终受益。"}>
                    <SelectField options={[[null, "尚未确认"] as [NodeRef | null, string], ...holderOptions.filter((r) => !holder || !sameRef(r, holder)).map((r) => [r, holderName(r)] as [NodeRef, string])]} value={beneficial} onChange={setBeneficial} minWidth={240} keyOf={keyOf} />
                  </FieldRow>}
                  <span><Button size="small" disabled={!(percent > 0 && percent <= 100) || (!holder && !personName.trim())} onClick={addHolding}>加入新持股</Button></span>
                </FormGroup>
                <span className="t-meta" style={{ paddingLeft: 4, color: Math.abs(total - 100) > 0.01 ? "var(--amber-text)" : "var(--muted)" }}>变更后合计 {percentLabel(total)}{Math.abs(total - 100) > 0.01 ? "，不是 100%，请检查。" : "。"}</span>
              </div>
            </>}
            {plan.kind === "addressChange" && <FormGroup title="新的注册地址"><TextField multiline rows={3} value={plan.newAddress ?? ""} onChange={(newAddress) => set({ newAddress })} placeholder="注册地址" /></FormGroup>}
            {plan.kind === "nameChange" && <FormGroup title="新名称"><FieldRow label="注册名" hint="原名称会自动记为曾用名。"><TextField value={plan.newName ?? ""} onChange={(newName) => set({ newName })} placeholder="注册名（原文）" /></FieldRow></FormGroup>}
            {plan.kind === "statusChange" && <FormGroup title="新状态"><FieldRow label="状态"><SelectField options={companyStatuses.map((s) => [s, companyStatusLabel[s]] as [CompanyStatus, string])} value={plan.newStatus ?? company?.status ?? "active"} onChange={(newStatus) => set({ newStatus })} minWidth={180} /></FieldRow></FormGroup>}
            <FormGroup title="说明"><FieldRow label="说明" hint="可留空，Charter 会根据以上内容自动生成。"><TextField multiline rows={2} value={plan.summary} onChange={(summary) => set({ summary })} placeholder={autoSummary(store, plan)} /></FieldRow></FormGroup>
          </>}

          {step === 1 && <div className="col gap8">
            <FormGroup title="证明文件（可选）">
              {plan.evidencePath ? <>
                <div className="row gap8"><Icon name="doc.fill" className="muted" /><span className="ellipsis grow">{plan.evidencePath.split(/[\\/]/).pop()}</span>
                  <Button size="small" onClick={() => void pickEvidence()}>更换文件…</Button><Button kind="quiet" size="small" onClick={() => set({ evidencePath: undefined })}>移除</Button></div>
                <FieldRow label="文件类型"><SelectField options={evidenceTypes.map((t) => [t.id, t.name] as [string, string])} value={plan.evidenceTypeID} onChange={(evidenceTypeID) => set({ evidenceTypeID })} minWidth={240} /></FieldRow>
              </> : <span><Button onClick={() => void pickEvidence()}>选择文件…</Button></span>}
            </FormGroup>
            <span className="t-meta muted" style={{ paddingLeft: 4 }}>例如董事会决议、辞任函或股份转让文书。确认变更时才会归档；暂时没有可以跳过，之后在“文件”中补充。</span>
          </div>}

          {step === 2 && <div className="col gap16">
            <span className="t-section">确认后会一次完成以下 {effects.length} 项</span>
            {group("变更记录", "record", "clock.arrow.circlepath")}
            {group("董事与任期", "appointment", "person.crop.circle")}
            {group("股东", "holding", "chart.pie")}
            {group("公司资料", "company", "building.2")}
            {group("文件状态", "document", "doc.badge.clock")}
            {group("申报事项", "obligation", "calendar.badge.plus")}
            {group("证明文件", "evidence", "paperclip")}
            {store.complianceOn && !effects.some((e) => e.kind === "obligation") && <span className="muted">这类变更在{store.jurisdictionName(company?.jurisdiction ?? "")}没有对应的申报规则，不会生成事项。</span>}
            <span className="muted">确认后可以在提示条里撤销。</span>
          </div>}
        </div>
      </SheetScaffold>
    </Modal>
  );
}

void useEffect;
