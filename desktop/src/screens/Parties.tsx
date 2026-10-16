// 负责方：外部代理、内部部门或个人；等回件、负责的事项与公司。移植自 PartiesView.swift。

import { useEffect, useRef, useState } from "react";
import { type Party, type PartyKind, newParty, obligationStatusLabel, partyKindLabel } from "../domain/models";
import { obligationStatus } from "../domain/engine";
import { useApp } from "../state/hooks";
import { Icon } from "../ui/Icon";
import { Avatar, Button, EmptyStateView, FieldRow, FormGroup, JurisdictionBadge, Modal, Pill, SelectField, SheetScaffold, TextField, divider, item, useContextMenu } from "../ui/kit";
import { KitStepper, ObligationRow, WaitingRequestRow } from "./common";

const kinds: PartyKind[] = ["agent", "department", "person"];

export function PartiesView() {
  const { store, router } = useApp();
  const [selection, setSelection] = useState<string | null>(store.data.parties[0]?.id ?? null);
  const [editing, setEditing] = useState<Party | null>(null);
  const firstRequest = useRef(router.newPartyRequest);
  useEffect(() => { if (router.newPartyRequest !== firstRequest.current) { firstRequest.current = router.newPartyRequest; setEditing(newParty("")); } }, [router.newPartyRequest]);
  const remove = (p: Party) => {
    const list = store.data.parties;
    let next = selection;
    if (selection === p.id) { const i = list.findIndex((x) => x.id === p.id); next = list[i + 1]?.id ?? list[i - 1]?.id ?? null; }
    store.deleteParty(p);
    if (!store.party(p.id)) setSelection(next);
  };
  const selected = store.party(selection);
  return (
    <div className="col grow" style={{ minHeight: 0 }}>
      <div className="row start" style={{ padding: "24px var(--page-edge)" }}>
        <div className="col gap4 grow"><h1 className="t-page">负责方</h1><span className="t-body muted">管理合规事项和文件补发的办理方。</span></div>
        <Button kind="primary" icon="plus" onClick={() => setEditing(newParty(""))}>新建负责方</Button>
      </div>
      <div className="row grow" style={{ alignItems: "stretch", minHeight: 0 }}>
        <div className="col surface scroll" style={{ width: 300, flex: "none", padding: 12, gap: 2, margin: "0 0 var(--page-edge) var(--page-edge)" }}>
          {kinds.map((k) => {
            const list = store.data.parties.filter((p) => p.kind === k);
            if (!list.length) return null;
            return <div key={k} className="col" style={{ gap: 2 }}>
              <span className="t-micro muted" style={{ padding: "16px 8px 4px" }}>{partyKindLabel[k]}</span>
              {list.map((p) => <PartyRow key={p.id} p={p} on={selection === p.id} onSelect={() => setSelection(p.id)} onEdit={() => setEditing(p)} onDelete={() => remove(p)} />)}
            </div>;
          })}
          {!store.data.parties.length && <span className="t-body muted" style={{ padding: 16, textAlign: "center" }}>还没有负责方</span>}
        </div>
        <div className="col grow" style={{ minWidth: 480, minHeight: 0 }}>
          {selected ? <PartyDetail key={selected.id} party={selected} onEdit={() => setEditing(selected)} onDelete={() => remove(selected)} /> : (
            <div className="surface col grow" style={{ margin: "0 var(--page-edge) var(--page-edge) 16px", justifyContent: "center" }}>
              <EmptyStateView symbol="person.2" title="负责方" message="负责方可以是外部代理、公司内部的部门，或某个人。事项和文件补发都会交给他们。" actionTitle="添加负责方" action={() => setEditing(newParty(""))} />
            </div>
          )}
        </div>
      </div>
      {editing && <PartyEditor party={editing} onClose={() => setEditing(null)} onSave={(p) => setSelection(p.id)} />}
    </div>
  );
}

function PartyRow({ p, on, onSelect, onEdit, onDelete }: { p: Party; on: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void }) {
  const ctx = useContextMenu();
  return (
    <div role="button" tabIndex={0} className={`row gap10 party-row ${on ? "" : "hover-band"}`} onClick={onSelect} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onSelect(); if (e.key === "Delete" || e.key === "Backspace") onDelete(); }}
      onContextMenu={(e) => ctx.open(e, [item("编辑", "pencil", onEdit), divider, item("删除", "trash", onDelete, { destructive: true })])} aria-current={on || undefined} aria-label={p.name}
      style={{ height: 52, padding: "0 8px", borderRadius: "var(--r-row)", background: on ? "var(--selection)" : undefined, color: on ? "var(--on-selection)" : "var(--ink)", flex: "none" }}>
      <Avatar name={p.name} size={34} highlighted={on} />
      <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
        <span className="t-row ellipsis">{p.name}</span>
        <span className="ellipsis" style={{ fontSize: 12, opacity: .65 }}>{p.contactName || p.email || "未填联系人"}</span>
      </span>
      <button className="del" title="删除负责方" aria-hidden tabIndex={-1} onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ width: 26, height: 26, display: "grid", placeItems: "center" }}><Icon name="trash" size={12} /></button>
      {ctx.node}
    </div>
  );
}

function PartyDetail({ party, onEdit, onDelete }: { party: Party; onEdit: () => void; onDelete: () => void }) {
  const { store, router } = useApp();
  const companies = store.data.companies.filter((c) => c.defaultPartyID === party.id || Object.values(c.rulePartyIDs).includes(party.id));
  const open = store.openObligations.filter((o) => store.responsibleParty(o)?.id === party.id);
  const requests = store.openRequestsForParty(party.id);
  const fact = (label: string, value: string) => (
    <div className="col" style={{ gap: 6, padding: "16px 24px", minWidth: 130 }}>
      <span className="t-meta muted">{label}</span><span className="selectable" style={{ fontSize: 14, fontWeight: 500, color: value ? "var(--ink)" : "var(--muted)" }}>{value || "未填写"}</span>
    </div>
  );
  const head = (title: string, trailing?: string, action?: () => void) => (
    <div className="row baseline" style={{ padding: "0 4px" }}><span className="t-section">{title}</span><span className="spacer" />
      {trailing && (action ? <Button kind="quiet" size="small" onClick={action}>{trailing}</Button> : <span className="t-meta muted">{trailing}</span>)}</div>
  );
  return (
    <div className="scroll grow">
      <div className="surface appear" style={{ margin: "0 var(--page-edge) var(--page-edge) 16px", maxWidth: 1000 }}>
        <div className="row start gap16" style={{ padding: 24 }}>
          <Avatar name={party.name} size={56} />
          <div className="col gap6 grow" style={{ minWidth: 0 }}><span className="t-title selectable">{party.name}</span><div className="row gap6"><Pill text={partyKindLabel[party.kind]} /></div></div>
          <div className="row gap8">
            <Button title="删除这个负责方，并清除指向它的引用" onClick={onDelete}>删除</Button>
            <Button onClick={onEdit}>编辑</Button>
            {store.complianceOn && <Button kind="primary" title={`在合规日历中查看${party.name}下个月的全部事项，可一并交办或导出`} onClick={() => router.openCalendar({ partyID: party.id, range: { kind: "nextMonth" } })}>下月事项</Button>}
          </div>
        </div>
        <div className="hairline" />
        <div className="row wrap" style={{ alignItems: "stretch" }}>
          {fact("联系人", party.contactName)}<span className="vrule" />{fact("邮箱", party.email)}<span className="vrule" />{fact("电话", party.phone)}<span className="vrule" />{fact("催办提醒", `${party.followUpDays} 天`)}
        </div>
        <div className="hairline" />
        {requests.length > 0 && <><div className="col gap8" style={{ padding: 24 }}>
          <span className="t-section">等回件</span>
          <div className="col" style={{ margin: "0 -16px" }}>{requests.map((r, i) => <div key={r.id}>{i > 0 && <div className="hairline" style={{ margin: "0 16px" }} />}<WaitingRequestRow request={r} showsParty={false} /></div>)}</div>
        </div><div className="hairline" /></>}
        {store.complianceOn && <><div className="col gap8" style={{ padding: 24 }}>
          {head("正在负责的事项", "在日历中查看全部", () => router.openCalendar({ partyID: party.id, range: { kind: "all" } }))}
          {!open.length && <span className="t-body muted" style={{ padding: "12px 0" }}>目前没有正在负责的事项。</span>}
          {open.map((o) => <ObligationRow key={o.key} o={o} detail={`${o.company.name}，${obligationStatusLabel[obligationStatus(o)]}`} onTap={() => router.open({ kind: "obligation", key: o.key })} />)}
        </div><div className="hairline" /></>}
        <div className="col gap8" style={{ padding: 24 }}>
          {head("负责的公司", `${companies.length} 家`)}
          {!companies.length && <span className="t-body muted" style={{ padding: "12px 0" }}>还没有公司指定这个负责方。</span>}
          <div className="col" style={{ margin: "0 -8px" }}>
            {companies.map((c, i) => <div key={c.id}>{i > 0 && <div className="hairline" />}
              <button className="row gap12 hover-band" style={{ width: "100%", height: 52, padding: "0 8px", borderRadius: "var(--r-row)", textAlign: "left" }} onClick={() => router.openCompany(c.id)}>
                <JurisdictionBadge code={c.jurisdiction} size={34} /><span className="t-row grow ellipsis">{c.name}</span>
                <span className="t-meta muted">{c.defaultPartyID === party.id ? "默认负责方" : "部分事项"}</span>
              </button></div>)}
          </div>
        </div>
        {party.notes && <><div className="hairline" /><div className="col gap6" style={{ padding: 24 }}><span className="t-meta muted">备注</span><span className="t-body selectable" style={{ whiteSpace: "pre-wrap" }}>{party.notes}</span></div></>}
      </div>
    </div>
  );
}

export function PartyEditor({ party, onClose, onSave }: { party: Party; onClose: () => void; onSave?: (p: Party) => void }) {
  const { store } = useApp();
  const [p, setP] = useState<Party>({ ...party });
  const [attempted, setAttempted] = useState(false);
  const isNew = !store.party(party.id);
  const error = attempted && !p.name.trim() ? "请填写名称" : null;
  const save = () => {
    setAttempted(true);
    if (!p.name.trim()) return;
    const saved = { ...p, name: p.name.trim() };
    store.upsertParty(saved);
    onSave?.(saved);
    store.showToast(isNew ? `已添加负责方 ${saved.name}` : `已保存 ${saved.name}`);
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={isNew ? "添加负责方" : "编辑负责方"} subtitle="事项和文件补发会交给负责方办理。" width={500} onSubmit={save}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={save}>{isNew ? "添加" : "保存"}</Button></>}>
        <div className="col" style={{ gap: 18 }}>
          <FormGroup>
            <FieldRow label="名称" error={error}><TextField value={p.name} onChange={(name) => setP({ ...p, name })} placeholder="例如：Lime Tree 秘书公司" autoFocus={isNew} invalid={!!error} /></FieldRow>
            <FieldRow label="类型"><SelectField options={kinds.map((k) => [k, partyKindLabel[k]] as [PartyKind, string])} value={p.kind} onChange={(kind) => setP({ ...p, kind })} minWidth={180} /></FieldRow>
            <FieldRow label="联系人"><TextField value={p.contactName} onChange={(contactName) => setP({ ...p, contactName })} placeholder="可选" /></FieldRow>
            <FieldRow label="邮箱"><TextField value={p.email} onChange={(email) => setP({ ...p, email })} placeholder="可选" /></FieldRow>
            <FieldRow label="电话"><TextField value={p.phone} onChange={(phone) => setP({ ...p, phone })} placeholder="可选" /></FieldRow>
          </FormGroup>
          <FormGroup>
            <FieldRow label="催办提醒" hint="交办后超过这个天数未回复，提醒催办。"><KitStepper value={p.followUpDays} onChange={(followUpDays) => setP({ ...p, followUpDays })} min={1} max={90} unit="天" /></FieldRow>
            <FieldRow label="备注"><TextField multiline rows={3} value={p.notes} onChange={(notes) => setP({ ...p, notes })} placeholder="服务范围、合同到期日等" /></FieldRow>
          </FormGroup>
        </div>
      </SheetScaffold>
    </Modal>
  );
}
