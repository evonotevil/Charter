// 多个页面共用的组件：事项行与下一步、文件行与缩略图、等回件、请补发、规则核对、待确认归档。

import { TicketStub } from "../ui/TicketStub";
import { companyTint } from "../ui/uistyle";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as D from "../domain/day";
import type { Day } from "../domain/day";
import {
  type Document, type DocumentRequest, type NodeRef, type Party, type RuleTrust, type RuleVerification, type Schedule,
  changeKindLabel, changeKinds, isHandedOff, latinPad, newVerification, normalizedStatus, pendingTypeIDs, ref, sameRef,
  scheduleKindLabel, scheduleKinds, sourceKinds, partyKindLabel, typeAppliesTo,
} from "../domain/models";
import { type Freshness, type Obligation, daysLeft, expiryLabel, expiryOf, freshnessLabel, freshnessNeedsAttention, obligationStatus } from "../domain/engine";
import { type ArchiveState, archiveStateLabel } from "../domain/models";
import { useApp } from "../state/hooks";
import type { Store } from "../state/store";
import { type StagedFile, commitStaged, discardStaged, stage } from "../state/actions";
import { copyMessage, copyHandoff, packetItems, packetMissing, packetItemTitle, packetReason } from "../services/packets";
import { thumbnail } from "../services/extract";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import {
  ActionMenu, Button, Checkbox, CopyTextSheet, DateField, FieldRow, FormGroup, type MenuEntry, Modal, type PillKind, Pill, RadioGroup,
  SelectField, SheetScaffold, Skeleton, Spinner, TextField, divider, header, item, useContextMenu, JurisdictionBadge,
} from "../ui/kit";

// MARK: - 状态到样式

export function freshnessPill(f: Freshness): PillKind {
  switch (f.kind) {
    case "expired": return "bad";
    case "expiring": case "needsUpdate": case "unknown": return "warn";
    case "valid": return "valid";
    default: return "neutral";
  }
}

export function statePill(s: ArchiveState): PillKind {
  switch (s.kind) {
    case "valid": return "valid";
    case "noDate": case "expiring": case "needsUpdate": return "warn";
    case "expired": return "bad";
    case "marked": return s.mark === "notObtained" || s.mark === "restricted" ? "outline" : s.mark === "unverified" ? "warn" : "neutral";
    case "missing": return "outline";
  }
}
export const stateColor = (s: ArchiveState) => (s.kind === "expired" ? "var(--danger)" : s.kind === "expiring" || s.kind === "needsUpdate" ? "var(--amber-text)" : "var(--muted)");
export const StatusPill = ({ state }: { state: ArchiveState }) => <Pill text={archiveStateLabel(state)} kind={statePill(state)} />;

export function obligationPill(o: Obligation): PillKind {
  switch (obligationStatus(o)) {
    case "pending": return "neutral";
    case "drafted": return "warn";
    case "handedOff": case "waiting": return "strong";
    case "done": return "neutral";
  }
}

// MARK: - 规则可信度

export function TrustBadge({ trust, showConfirmed }: { trust: RuleTrust; showConfirmed?: boolean }) {
  if (trust.kind === "confirmed" && !showConfirmed) return null;
  const text = trust.kind === "draft" ? "待核对" : trust.kind === "needsReview" ? "需复核" : "已确认";
  const icon = trust.kind === "draft" ? "questionmark.circle" : trust.kind === "needsReview" ? "clock.arrow.circlepath" : "checkmark.seal";
  const help = trust.kind === "draft" ? "这条规则尚未向中介或官方来源核对，截止日仅供参考"
    : trust.kind === "needsReview" ? `上次确认于 ${trust.on ? D.long(trust.on) : "未知日期"}，已超过 12 个月` : `${trust.scope}，${trust.on ? D.long(trust.on) : ""}确认`;
  const style = trust.kind === "confirmed" ? { background: "var(--lime-soft)", color: "var(--lime-text)" }
    : trust.kind === "needsReview" ? { background: "var(--amber-soft)", color: "var(--amber-text)" }
      : { color: "var(--muted)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--muted) 50%, transparent)" };
  return <span className="row gap4" title={help} style={{ height: 22, padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, flex: "none", ...style }}><Icon name={icon} size={11} />{text}</span>;
}

// MARK: - 数字输入

export function KitStepper({ value, onChange, min, max, unit }: { value: number; onChange: (n: number) => void; min: number; max: number; unit?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="row gap6">
      <Button kind="quiet" size="small" icon="minus" disabled={value <= min} onClick={() => onChange(clamp(value - 1))} ariaLabel="减少" />
      <input className="field num" style={{ width: 72, textAlign: "right" }} value={text} onChange={(e) => setText(e.target.value)}
        onBlur={() => { const n = parseInt(text, 10); if (Number.isFinite(n)) onChange(clamp(n)); else setText(String(value)); }} />
      <Button kind="quiet" size="small" icon="plus" disabled={value >= max} onClick={() => onChange(clamp(value + 1))} ariaLabel="增加" />
      {unit && <span className="muted">{unit}</span>}
    </div>
  );
}

export function MonthDayField({ title, value, onChange }: { title: string; value: D.MonthDay; onChange: (v: D.MonthDay) => void }) {
  const [m, d] = D.mdParts(value);
  return (
    <FieldRow label={title}>
      <div className="row gap8">
        <SelectField options={Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1} 月`] as [number, string])} value={m} onChange={(x) => onChange(D.md(x, Math.min(d, D.daysIn(2024, x))))} minWidth={90} />
        <SelectField options={Array.from({ length: D.daysIn(2024, m) }, (_, i) => [i + 1, `${i + 1} 日`] as [number, string])} value={d} onChange={(x) => onChange(D.md(m, x))} minWidth={90} />
      </div>
    </FieldRow>
  );
}

export function ScheduleEditor({ schedule, onChange }: { schedule: Schedule; onChange: (s: Schedule) => void }) {
  const { store } = useApp();
  const s = schedule;
  const set = (patch: Partial<Schedule>) => onChange({ ...s, ...patch });
  return (
    <>
      <FieldRow label="方式"><SelectField options={scheduleKinds.map((k) => [k, scheduleKindLabel[k]] as [typeof k, string])} value={s.kind} onChange={(kind) => set({ kind })} minWidth={220} /></FieldRow>
      {s.kind === "annualFixed" && <MonthDayField title="每年" value={s.date ?? "12-31"} onChange={(date) => set({ date })} />}
      {s.kind === "afterAnniversary" && <FieldRow label="周年日后"><KitStepper value={s.days ?? 0} onChange={(days) => set({ days })} min={0} max={365} unit="天" /></FieldRow>}
      {s.kind === "afterFiscalYearEnd" && <>
        <FieldRow label="财年结束后"><KitStepper value={s.months ?? 0} onChange={(months) => set({ months })} min={0} max={24} unit="个月" /></FieldRow>
        <FieldRow label="再加"><KitStepper value={s.days ?? 0} onChange={(days) => set({ days })} min={0} max={60} unit="天" /></FieldRow>
      </>}
      {s.kind === "incorporationHalf" && <>
        <MonthDayField title="1–6 月成立" value={s.firstHalf ?? "05-31"} onChange={(firstHalf) => set({ firstHalf })} />
        <MonthDayField title="7–12 月成立" value={s.secondHalf ?? "11-30"} onChange={(secondHalf) => set({ secondHalf })} />
      </>}
      {s.kind === "documentExpiry" && <FieldRow label="文件类型">
        <SelectField options={[["", "未选择"] as [string, string], ...store.data.library.documentTypes.map((t) => [t.id, t.name] as [string, string])]}
          value={s.documentTypeID ?? ""} onChange={(documentTypeID) => set({ documentTypeID: documentTypeID || undefined })} minWidth={220} />
      </FieldRow>}
      {s.kind === "event" && <>
        <FieldRow label="变更类型"><SelectField options={changeKinds.map((k) => [k, changeKindLabel[k]] as [typeof k, string])} value={s.event ?? "directorChange"} onChange={(event) => set({ event })} minWidth={220} /></FieldRow>
        <FieldRow label="变更后"><KitStepper value={s.days ?? 0} onChange={(days) => set({ days })} min={0} max={180} unit="天内" /></FieldRow>
      </>}
    </>
  );
}

// MARK: - 事项状态说明

export function stateLine(store: Store, o: Obligation): string {
  const p = store.party(o.record?.partyID) ?? store.responsibleParty(o);
  const who = latinPad(p?.name ?? "中介");
  switch (normalizedStatus(obligationStatus(o))) {
    case "pending": return p ? `通常由${who}办理，尚未交办。` : "还没有指定中介。";
    case "drafted": return `${o.record?.draftedOn ? D.ago(o.record.draftedOn, store.today) : ""}给${who}起草了消息，尚未确认发出。`;
    case "handedOff": {
      const since = o.record?.handedOffOn;
      if (!since) return `已交给${who}。`;
      const days = D.daysBetween(since, store.today);
      if (store.waitingTooLong(o)) return `${D.ago(since, store.today)}交给${who}，${days} 天未回复。`;
      return days === 0 ? `今天交给了${who}，等回件。` : `${D.ago(since, store.today)}交给${who}，等回件。`;
    }
    default: return "已完成。";
  }
}

// MARK: - 文件选择后进入“待确认归档”

/** 选择一个文件，复制到临时区并识别，然后弹出确认框。返回 [开始, 弹窗节点, 是否正在识别]。 */
export function useStageFile(): [(opts: { typeID?: string; owner?: NodeRef; replaces?: Document; form?: string; onArchived?: (d: Document) => void; path?: string }) => Promise<void>, ReactNode, boolean] {
  const { store } = useApp();
  const [file, setFile] = useState<StagedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async (opts: { typeID?: string; owner?: NodeRef; replaces?: Document; form?: string; onArchived?: (d: Document) => void; path?: string }) => {
    const path = opts.path ?? (await platform().pickFiles({ multiple: false, extensions: ["pdf", "png", "jpg", "jpeg", "heic", "tif", "tiff", "eml", "msg", "txt"] }))[0];
    if (!path) return;
    setBusy(true);
    try { setFile(await stage(store, path, opts)); }
    catch (e) { store.setError(`读取文件失败：${(e instanceof Error ? e.message : String(e))}`); }
    finally { setBusy(false); }
  };
  return [start, file ? <ArchiveConfirmSheet file={file} onClose={() => { void discardStaged(file.id); setFile(null); }} /> : null, busy];
}

export const versionNotice = (old: Document, keepBoth: boolean) => {
  const y = D.year(old.issueDate ?? old.addedOn);
  return keepBoth ? `另存为一份，${y} 年版本仍为现行` : `将替换 ${y} 年版本，旧版保留在历史版本中`;
};

export function ArchiveConfirmSheet({ file, onClose }: { file: StagedFile; onClose: () => void }) {
  const { store } = useApp();
  const [typeID, setTypeID] = useState(file.typeID ?? "");
  const [owner, setOwner] = useState<NodeRef | null>(file.owner ?? file.replaces?.owner ?? null);
  const [issued, setIssued] = useState<Day | undefined>(file.recognition.issueDate);
  const [expiry, setExpiry] = useState<Day | undefined>(file.recognition.expiryDate);
  const [noExpiry, setNoExpiry] = useState(false);
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [keepBoth, setKeepBoth] = useState(false);
  const target = owner?.kind === "company" ? store.company(owner.id) : undefined;
  const typeChoices = store.data.library.documentTypes.filter((t) => owner?.kind === "person" ? t.owner === "person" : !target || (t.owner === "company" && typeAppliesTo(t, target.jurisdiction)));
  const selectedType = typeChoices.find((t) => t.id === typeID);
  const needsPrintedExpiry = selectedType?.validity === "expiryOnDocument";
  useEffect(() => { setAck(false); if (!typeChoices.some((t) => t.id === typeID)) setTypeID(""); }, [owner?.id]);
  const conflicts: string[] = [];
  if (owner?.kind === "company" && target) {
    const r = file.recognition;
    if (r.companyID && r.companyID !== target.id) conflicts.push(`文件内容像是“${store.company(r.companyID)?.name ?? "其他公司"}”的文件，不是“${target.name}”。`);
    else if (r.companyNameGuess && !r.companyID && ![target.name, ...target.aliases, ...target.formerNames].some((n) => n.includes(r.companyNameGuess!) || r.companyNameGuess!.includes(n)))
      conflicts.push(`文件上写的公司名是“${r.companyNameGuess}”，与“${target.name}”不一致。`);
    if (r.jurisdiction && r.jurisdiction !== target.jurisdiction) conflicts.push(`文件像是${store.jurisdictionName(r.jurisdiction)}的材料，目标公司在${store.jurisdictionName(target.jurisdiction)}。`);
  }
  const current = owner && typeID ? store.data.documents.find((d) => sameRef(d.owner, owner) && d.typeID === typeID && !d.supersededBy && !((d.issueDate ?? store.today) > (issued ?? store.today))) : undefined;
  const canConfirm = !working && typeChoices.some((t) => t.id === typeID) && !!owner && (!conflicts.length || ack);
  const ownerOptions: [NodeRef | null, string][] = [...store.data.companies.map((c) => [ref("company", c.id), c.name] as [NodeRef, string]),
    ...store.data.people.map((p) => [ref("person", p.id), `人员：${p.name}`] as [NodeRef, string])];
  const confirm = async () => {
    if (!canConfirm || !owner) return;
    setWorking(true);
    try {
      await commitStaged(store, file.id, { typeID, owner, issued, expiry, noExpiry, form: file.form, note, keepBoth: keepBoth && !!current });
      onClose();
    } catch (e) { setError(`归档未完成：${(e instanceof Error ? e.message : String(e))}`); }
    finally { setWorking(false); }
  };
  const card = (title: string, date: Day | undefined, name: string) => (
    <div className="col gap4 grow" style={{ padding: 12, background: "var(--surface)", borderRadius: 12 }}>
      <span className="t-meta muted">{title}</span><span className="t-row ellipsis">{name}</span>
      <span className="t-meta muted">{date ? `${D.long(date)}签发` : "签发日期未知"}</span>
    </div>
  );
  return (
    <Modal onClose={() => !working && onClose()}>
      <SheetScaffold title="确认归档" subtitle="确认前不会改动档案。取消会删除这份待确认的副本。" width={600} height={760} onSubmit={confirm}
        leading={working ? <><Spinner /><span className="muted">正在归档…</span></> : null}
        trailing={<>
          <Button onClick={onClose} disabled={working}>取消</Button>
          <Button kind="primary" onClick={confirm} disabled={!canConfirm}>{working ? "正在归档…" : "确认归档"}</Button>
        </>}>
        <div className="col" style={{ gap: 18, opacity: working ? .6 : 1, pointerEvents: working ? "none" : undefined }}>
          {!file.recognition.typeID && !file.recognition.issueDate && <div className="row gap6 muted"><Icon name="info.circle" />这份文件没有被自动识别。请手动选择类别和日期。</div>}
          <FormGroup title="这份文件将归档为">
            <FieldRow label="文件"><span className="ellipsis" title={file.originalName}>{file.originalName}</span></FieldRow>
            <FieldRow label="归属"><SelectField options={ownerOptions} value={owner} onChange={setOwner} minWidth={280} /></FieldRow>
            <FieldRow label="材料类别"><SelectField options={typeChoices.map((t) => [t.id, t.name] as [string, string])} value={typeID} onChange={(v) => { setTypeID(v); setAck(false); }} placeholder="请选择（未识别）" minWidth={280} /></FieldRow>
            <FieldRow label="签发日期" hint={issued ? undefined : "尚未填写签发日期，建议补充。"}><DateField value={issued} onChange={setIssued} /></FieldRow>
            <FieldRow
              label="到期日期"
              hint={selectedType?.validity === "permanent" || selectedType?.validity === "untilChanged"
                ? "这类文件长期有效，无需填写。"
                : needsPrintedExpiry && !expiry && !noExpiry
                  ? "文件上写明长期有效的，请勾选下方选项；否则留空会显示为“未填日期”。"
                  : "填写到期日后，Charter 会按设置中的天数提前提醒；留空则按条目的有效期规则判断。"}
            >
              <DateField value={expiry} onChange={(value) => { setExpiry(value); if (value) setNoExpiry(false); }} placeholder={noExpiry ? "长期有效" : selectedType?.validity === "permanent" || selectedType?.validity === "untilChanged" ? "长期有效，无需填写" : "填写文件上的到期日"} relativeTo={issued} />
            </FieldRow>
            {needsPrintedExpiry && <Checkbox checked={noExpiry && !expiry} disabled={!!expiry} title={expiry ? "已填写到期日" : undefined} onChange={(value) => setNoExpiry(value)}>文件上写明长期有效 / 没有到期日</Checkbox>}
            <FieldRow label="备注"><TextField value={note} onChange={setNote} placeholder="可选" /></FieldRow>
          </FormGroup>
          {current && (
            <div className="row baseline gap12" style={{ padding: "0 4px" }}>
              <span className="t-meta muted grow">{versionNotice(current, keepBoth)}</span>
              <Checkbox checked={keepBoth} onChange={setKeepBoth} title="勾选后不替换现有版本，两份都保留为现行文件"><span className="t-meta">另存为一份</span></Checkbox>
            </div>
          )}
          {file.replaces && (
            <FormGroup title="新旧版本">
              <div className="row start gap16">
                {card("旧版（保留）", file.replaces.issueDate, file.replaces.originalFileName)}
                <span className="muted" style={{ paddingTop: 28 }}><Icon name="arrow.right" /></span>
                {card("待归档文件", issued, file.originalName)}
              </div>
            </FormGroup>
          )}
          {conflicts.length > 0 && (
            <FormGroup title="请核对">
              {conflicts.map((c, i) => <div key={i} className="row gap6 amber-text"><Icon name="exclamationmark.triangle.fill" />{c}</div>)}
              <Checkbox checked={ack} onChange={setAck}>我已核对，仍归到这里</Checkbox>
            </FormGroup>
          )}
          {error && <div className="row gap6 amber-text"><Icon name="exclamationmark.triangle.fill" />{error}</div>}
        </div>
      </SheetScaffold>
    </Modal>
  );
}

// MARK: - 下一步

export function NextStepControls({ o, large = true, emphasized = true }: { o: Obligation; large?: boolean; emphasized?: boolean }) {
  const { store, router } = useApp();
  const [startStage, stageNode] = useStageFile();
  const party = store.party(o.record?.partyID) ?? store.responsibleParty(o);
  const size = large ? "large" : "regular";
  const kind = emphasized ? "primary" : "secondary";
  const sendDraft = (p: Party) => { void copyHandoff(p, [o]); store.draft([o], p, "邮件"); };
  const copy = (p: Party) => { void copyMessage([o]); store.draft([o], p, "消息"); };
  const nudgeMail = () => { if (!party) return; void copyHandoff(party, [o], true); store.nudge(o, "邮件"); };
  const attach = () => void startStage({ typeID: "common.receipt", owner: ref("company", o.company.id), onArchived: (d) => store.complete(o, d) });
  const more = (entries: MenuEntry[]) => <ActionMenu icon="chevron.down" size={size} entries={entries} ariaLabel="其他方式" />;
  const st = normalizedStatus(obligationStatus(o));
  let body: ReactNode;
  if (st === "pending") {
    if (party) {
      const others = store.data.parties.filter((q) => q.id !== party.id);
      body = <>
        <Button kind={kind} size={size} onClick={() => sendDraft(party)} title={`复制交办文字，发给${latinPad(party.name)}后点“确认已发送”`}>{large ? <>交给{latinPad(party.name)}办理</> : "复制交办文字"}</Button>
        {more([
          item("复制邮件格式文字", "envelope", () => sendDraft(party)),
          item("复制简短消息（企业微信、飞书等）", "doc.on.doc", () => copy(party)),
          item("已通过其他方式交办", "paperplane", () => store.confirmSent([o], party, "其他")),
          ...(others.length ? [divider, header("交给其他中介"), ...others.map((q) => item(`${q.name}（${partyKindLabel[q.kind]}）`, undefined, () => sendDraft(q)))] : []),
          divider, item("已自行完成", "checkmark", () => store.complete(o)),
        ])}
      </>;
    } else body = <Button kind={kind} size={size} onClick={() => router.open({ kind: "obligation", key: o.key })}>指定中介…</Button>;
  } else if (st === "drafted") {
    body = <>
      <Button kind={kind} size={size} onClick={() => store.confirmSent([o], undefined, o.record?.log?.[o.record.log.length - 1]?.channel)} title="把复制的文字发出后点此确认，Charter 将开始计算等待回件的天数">确认已发送</Button>
      <ActionMenu icon="ellipsis" kind="quiet" size={size} entries={[
        ...(party ? [item("重新复制邮件格式文字", "envelope", () => sendDraft(party)), item("重新复制简短消息", "doc.on.doc", () => copy(party)), divider] : []),
        item("退回待交办", "arrow.uturn.backward", () => store.revertToPending(o)),
      ]} />
    </>;
  } else if (st === "handedOff") {
    const late = daysLeft(o, store.today) < 0 || store.waitingTooLong(o);
    body = late ? <>
      <Button kind={kind} size={size} onClick={nudgeMail}>催办</Button>
      {more([
        item("复制催办文字（邮件格式）", "envelope", nudgeMail),
        item("复制简短催办消息", "doc.on.doc", () => { void copyMessage([o], true); store.nudge(o, "消息"); }),
        divider,
        item("收到回执并完成…", "paperclip", attach),
        item("没有回执，直接完成", "checkmark", () => store.complete(o)),
        item("退回待交办", "arrow.uturn.backward", () => store.revertToPending(o)),
      ])}
    </> : <>
      <Button kind={kind} size={size} onClick={attach} title="回执可选；也可以在菜单里直接完成">收到回执并完成…</Button>
      {more([
        item("收到回执并完成…", "paperclip", attach),
        item("没有回执，直接完成", "checkmark", () => store.complete(o)),
        divider,
        item("复制催办文字（邮件格式）", "envelope", nudgeMail),
        item("退回待交办", "arrow.uturn.backward", () => store.revertToPending(o)),
      ])}
    </>;
  } else {
    const r = store.receipt(o);
    body = r ? <Button size={size} onClick={() => void store.openDocument(r)}>查看回执</Button>
      : <span className="muted">已完成{o.record?.completedOn ? `于 ${D.short(o.record.completedOn)}` : ""}</span>;
  }
  return <div className="row gap8" style={{ flex: "none" }}>{body}{stageNode}</div>;
}

export function obligationMenu(store: Store, router: ReturnType<typeof useApp>["router"], o: Obligation): MenuEntry[] {
  return [item("标记完成", "checkmark", () => store.complete(o)), item("详情…", "info.circle", () => router.open({ kind: "obligation", key: o.key })),
    item("打开公司", "building.2", () => router.openCompany(o.company.id))];
}

export function ObligationRow({ o, detail, emphasize, onTap }: { o: Obligation; detail: string; emphasize?: boolean; onTap: () => void }) {
  const { store, router } = useApp();
  const ctx = useContextMenu();
  const left = daysLeft(o, store.today);
  return (
    <button className="row gap12 hover-band tk" onClick={onTap} onContextMenu={(e) => ctx.open(e, obligationMenu(store, router, o))}
      style={{ padding: "0 12px", height: 62, borderRadius: "var(--r-row)", width: "100%", textAlign: "left" }}>
      <TicketStub due={o.due} today={store.today} />
      <JurisdictionBadge code={o.company.jurisdiction} size={38} tint={companyTint(store, o.company.id)} />
      <span className="col grow" style={{ gap: 2 }}>
        <span className="row gap6"><span className="t-row ellipsis">{o.rule.name}</span><TrustBadge trust={store.trust(o)} /></span>
        <span className="t-meta ellipsis" style={{ color: emphasize ? "var(--amber-text)" : "var(--muted)" }}>{detail}</span>
      </span>
      <span className="col" style={{ alignItems: "flex-end", gap: 2 }}>
        <span className="num" style={{ fontSize: 16, fontWeight: 600, color: left < 0 ? "var(--danger)" : left <= 7 ? "var(--amber-text)" : "var(--ink)" }}>{left < 0 ? `逾期 ${-left} 天` : `${left} 天`}</span>
        <span className="t-meta muted">{D.display(o.due, store.today)}</span>
      </span>
      <Icon name="chevron.right" size={11} className="muted" />
      {ctx.node}
    </button>
  );
}

// MARK: - 文件行

const thumbCache = new Map<string, string | null>();
export function FileThumb({ doc, alert, width = 34, height = 42 }: { doc: Document; alert?: boolean; width?: number; height?: number }) {
  const { store } = useApp();
  const path = store.fileURL(doc);
  const key = path + "|" + width;
  const [src, setSrc] = useState<string | null | undefined>(thumbCache.get(key));
  useEffect(() => {
    if (thumbCache.has(key)) { setSrc(thumbCache.get(key)); return; }
    let live = true;
    void thumbnail(path, width).then((s) => { thumbCache.set(key, s); if (live) setSrc(s); });
    return () => { live = false; };
  }, [key]);
  const frame = { width, height, borderRadius: 6, flex: "none", boxShadow: `0 2px 6px rgba(0,0,0,.12), 0 0 0 ${alert ? 1.5 : 0.5}px ${alert ? "var(--danger)" : "rgba(0,0,0,.12)"}` } as const;
  if (src === undefined && width >= 80) return <Skeleton width={width} height={height} />;
  if (src) return <img src={src} alt="" style={{ ...frame, objectFit: "cover", objectPosition: "top", background: "#fff" }} />;
  return (
    <span className="col" style={{ ...frame, background: "var(--surface)", padding: 7 * (width / 36), gap: 3 * (width / 36), alignItems: "flex-start" }}>
      <span style={{ width: 14 * (width / 36), height: 3, borderRadius: 2, background: alert ? "var(--danger)" : "var(--ink)" }} />
      {[0.9, 0.7, 0.84].map((w, i) => <span key={i} style={{ width: 22 * w * (width / 36), height: 2, borderRadius: 2, background: "color-mix(in srgb, var(--muted) 30%, transparent)" }} />)}
    </span>
  );
}

export const FileColumns = { state: 104, date: 92, actions: 176, spacing: 12 };

export function FileHeaderRow() {
  return (
    <div className="band-header" style={{ gap: FileColumns.spacing }}>
      <span className="grow">文件</span>
      <span style={{ width: FileColumns.state }}>状态</span>
      <span style={{ width: FileColumns.date }}>签发</span>
      <span style={{ width: FileColumns.date }}>到期</span>
      <span style={{ width: FileColumns.actions }} />
    </div>
  );
}

export function DocumentRow({ d, showOwner = true, extraMenu, selected, onSelect }: { d: Document; showOwner?: boolean; extraMenu?: MenuEntry[]; selected?: boolean; onSelect?: (e: React.MouseEvent) => void }) {
  const { store, router } = useApp();
  const [startStage, stageNode, busy] = useStageFile();
  const ctx = useContextMenu();
  const t = store.docType(d.typeID);
  const f = store.freshness(d);
  const expiry = expiryOf(d, t);
  const sub = d.notes ? `备注：${d.notes}` : t?.localNames[0] && t.localNames[0] !== t.name ? t.localNames[0]
    : /^[0-9A-F-]{36}$/i.test(d.originalFileName.replace(/\.[^.]+$/, "")) ? "" : d.originalFileName;
  const owner = d.owner.kind === "company" ? store.company(d.owner.id) : undefined;
  const upload = () => void startStage({ typeID: d.typeID, owner: d.owner, replaces: d, form: d.form, onArchived: (n) => router.open({ kind: "document", id: n.id }) });
  const menu: MenuEntry[] = [
    ...(extraMenu ? [...extraMenu, divider] : []),
    item("打开", "arrow.up.forward.app", () => void store.openDocument(d)),
    item(platform().os === "windows" ? "在资源管理器中显示" : "在访达中显示", "folder", () => void store.revealDocument(d)),
    item("归档新版…", "square.and.arrow.up", upload),
    item(d.needsUpdate ? "取消“需要更新”" : "标为需要更新", "exclamationmark.triangle", () => store.commit((x) => { const doc = x.documents.find((y) => y.id === d.id); if (doc) doc.needsUpdate = !doc.needsUpdate; })),
    divider,
    item("从 Charter 移除记录", "trash", () => store.deleteDocument(d), { destructive: true }),
  ];
  return (
    <div className="row hover-band" tabIndex={0} role="button" onClick={(e) => (onSelect ? onSelect(e) : router.open({ kind: "document", id: d.id }))}
      onDoubleClick={() => router.open({ kind: "document", id: d.id })}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) router.open({ kind: "document", id: d.id }); }}
      onContextMenu={(e) => ctx.open(e, menu)}
      style={{ gap: FileColumns.spacing, padding: "0 16px", minHeight: 60, borderRadius: "var(--r-row)", background: selected ? "color-mix(in srgb, var(--lime) 30%, transparent)" : undefined }}
      aria-label={`${t?.name ?? "文件"}，${store.nameOf(d.owner)}，${freshnessLabel(f)}`}>
      <div className="row gap12 grow">
        <FileThumb doc={d} alert={freshnessPill(f) === "bad"} />
        <div className="col grow" style={{ gap: 2 }}>
          <span className="ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>{t?.name ?? "文件"}</span>
          <span className="row gap6 muted" style={{ fontSize: 12 }}>
            {showOwner ? <>
              {owner && <span style={{ fontSize: 10, fontWeight: 700, padding: "0 5px", height: 16, lineHeight: "16px", borderRadius: 5, background: "var(--band)", color: "var(--ink)" }}>{owner.jurisdiction}</span>}
              <span className="ellipsis">{store.nameOf(d.owner)}</span>
            </> : <span className="ellipsis">{sub}</span>}
          </span>
        </div>
      </div>
      <span style={{ width: FileColumns.state, flex: "none" }}><Pill text={freshnessLabel(f)} kind={freshnessPill(f)} /></span>
      <span className="mono" style={{ width: FileColumns.date, flex: "none", fontSize: 12.5, color: d.issueDate ? "var(--ink)" : "var(--muted)" }}>{d.issueDate ?? "—"}</span>
      <span className="mono" style={{ width: FileColumns.date, flex: "none", fontSize: 12.5, color: freshnessPill(f) === "bad" && expiry ? "var(--danger)" : expiry ? "var(--ink)" : "var(--muted)" }}>{expiryLabel(d, t)}</span>
      <span className="row gap6" style={{ width: FileColumns.actions, flex: "none", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
        {busy ? <Spinner /> : f.kind === "unknown" ? <Button size="small" onClick={() => router.open({ kind: "document", id: d.id })}>补充日期</Button>
          : freshnessNeedsAttention(f) ? <>
            <Button size="small" onClick={upload} title="类型和归属沿用这份，旧版保留">归档新版</Button>
          </> : <Button size="small" kind="quiet" onClick={() => void store.openDocument(d)}>打开</Button>}
      </span>
      {stageNode}
      {ctx.node}
    </div>
  );
}

// MARK: - 请补发

export function ReissueRequestSheet({ owner, typeIDs, onClose }: { owner: NodeRef; typeIDs: string[]; onClose: () => void }) {
  const { store } = useApp();
  const [partyID, setPartyID] = useState(store.defaultRequestParty(owner)?.id ?? "");
  const [selected, setSelected] = useState(new Set(typeIDs));
  const [days, setDays] = useState(store.followUpDays(store.defaultRequestParty(owner)?.id));
  const chosen = typeIDs.filter((t) => selected.has(t));
  const pid = partyID || undefined;
  const gen = useMemo(() => store.reissueText(owner, chosen.length ? chosen : typeIDs, pid), [partyID, [...selected].join()]);
  const [message, setMessage] = useState(gen);
  const [generated, setGenerated] = useState(gen);
  useEffect(() => { if (message === generated) setMessage(gen); setGenerated(gen); }, [gen]);
  const p = store.party(pid);
  const hint = !p ? (store.data.parties.length ? undefined : "还没有中介，可以先复制文字自行发送。")
    : p.email.trim() ? p.email : "这个中介没有填邮箱。";
  const stateText = (id: string) => {
    const r = store.openRequest(owner, id);
    if (r) return `已在等${latinPad(store.party(r.partyID)?.name ?? "中介")}补发`;
    const g = store.gapDescription(owner, id);
    return g.hasFile ? g.state : "未归档";
  };
  const send = async () => {
    if (!chosen.length) return;
    await platform().copyText(message);
    store.recordRequest(owner, chosen, pid, message, days);
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title="请补发" subtitle={`${store.nameOf(owner)}。复制文字发给中介，Charter 会记在“在等回件”里，到期提醒你催办。`} width={560}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" disabled={!chosen.length} onClick={() => void send()}>复制并记录</Button></>}>
        <div className="col gap24">
          <FormGroup title="发给">
            <FieldRow label="中介" hint={hint}>
              <SelectField options={[["", "未指定中介"] as [string, string], ...store.data.parties.map((x) => [x.id, x.name] as [string, string])]}
                value={partyID} onChange={(v) => { setPartyID(v); setDays(store.followUpDays(v || undefined)); }} placeholder="选择中介" />
            </FieldRow>
            <FieldRow label="跟进" hint={`到 ${D.short(D.addDays(store.today, days))}还没收到，总览会提醒你催办。`}>
              <KitStepper value={days} onChange={setDays} min={1} max={90} unit="天" />
            </FieldRow>
          </FormGroup>
          <FormGroup title={typeIDs.length > 1 ? "要补发的文件" : "文件"}>
            {typeIDs.map((id) => (
              <div key={id} className="row gap8">
                <Checkbox checked={selected.has(id)} onChange={(on) => { const s = new Set(selected); if (on) s.add(id); else s.delete(id); setSelected(s); }}>{store.docType(id)?.name ?? "文件"}</Checkbox>
                <span className="spacer" />
                <span className="t-meta muted ellipsis">{stateText(id)}</span>
              </div>
            ))}
          </FormGroup>
          <div className="col gap8">
            <div className="row">
              <span className="t-meta muted" style={{ fontWeight: 600, paddingLeft: 4 }}>文字</span>
              <span className="spacer" />
              {message !== generated && <Button kind="quiet" size="small" onClick={() => setMessage(generated)}>按所选重新生成</Button>}
            </div>
            <textarea className="field" style={{ minHeight: 160 }} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
        </div>
      </SheetScaffold>
    </Modal>
  );
}

// MARK: - 等回件






export function CompanyWaitingLine({ companyID }: { companyID: string }) {
  const { store } = useApp();
  const list = store.openRequestsFor(ref("company", companyID));
  if (!list.length) return null;
  const oldest = list.reduce((m, r) => (r.createdAt < m.createdAt ? r : m));
  const count = list.reduce((a, r) => a + pendingTypeIDs(r).length, 0);
  const parties = new Set(list.map((r) => r.partyID ?? ""));
  const who = parties.size > 1 ? `${parties.size} 个中介` : store.party(oldest.partyID)?.name ?? "未指定中介";
  const waited = store.daysWaiting(oldest);
  const due = list.some((r) => store.isFollowUpDue(r));
  return (
    <span className="row gap6 t-meta" style={{ color: due ? "var(--amber-text)" : "var(--muted)" }} title={list.map((r) => store.typeNames(pendingTypeIDs(r))).join("、")}>
      <Icon name="hourglass" size={12} />在等 {count} 份补发（{who}，{waited === 0 ? "今天发出" : `已等 ${waited} 天`}）{due ? "，该催办了" : ""}
    </span>
  );
}

// MARK: - 截止日依据与规则确认

export function DeadlineBasis({ o }: { o: Obligation }) {
  const { store, router } = useApp();
  const trust = store.trust(o);
  const v = store.verification(o.rule.id, o.company);
  const ev = v?.status === "confirmed" && v.evidenceDocumentID ? store.data.documents.find((d) => d.id === v.evidenceDocumentID) : undefined;
  return (
    <>
      <div className="col gap4">{store.explain(o).map((l, i) => <span key={i}>{l}</span>)}</div>
      <FieldRow label="核对状态"><TrustBadge trust={trust} showConfirmed /></FieldRow>
      {v?.status === "confirmed" ? <>
        <FieldRow label="依据"><span className="selectable">{v.source ? `${v.sourceKind}：${v.source}` : v.sourceKind}</span></FieldRow>
        {v.conditions && <FieldRow label="适用条件"><span className="selectable">{v.conditions}</span></FieldRow>}
        <FieldRow label="核对人"><span>{v.confirmedBy || "—"}</span></FieldRow>
        <FieldRow label="核对日期"><span>{v.confirmedOn ? D.long(v.confirmedOn) : "—"}</span></FieldRow>
      </> : <span className="muted">这条规则尚未核对。截止日按草稿算法得出，请向中介或官方来源确认后记录。</span>}
      <div className="row gap8">
        {ev && <Button size="small" onClick={() => void store.openDocument(ev)}>打开确认文件</Button>}
        <Button size="small" onClick={() => router.open({ kind: "confirmRule", ruleID: o.rule.id, companyID: o.company.id })}>{trust.kind === "confirmed" ? "修改核对信息…" : "确认这条规则…"}</Button>
        <span className="spacer" />
        <button className="row gap6 muted t-meta" onClick={() => router.openSettings("rules")} title="在设置中打开“合规规则”"><Icon name="slider.horizontal.3" size={12} />截止日算法不对？</button>
      </div>
    </>
  );
}


// MARK: - 文件包准备度

export interface PurposeReadiness {
  companyID: string; companyName: string; jurisdiction: string; templateID: string; templateName: string;
  got: number; total: number; missing: string[]; missingDetail: string[]; missingTypeIDs: string[]; complete: boolean;
}

export function computeReadiness(store: Store, companyIDs: string[]): PurposeReadiness[] {
  const out: PurposeReadiness[] = [];
  for (const cid of companyIDs) {
    const c = store.company(cid);
    if (!c) continue;
    const archive = store.archive(c);
    for (const t of store.data.library.packets) {
      const items = packetItems(t, c, store);
      if (!items.length) continue;
      const missing = packetMissing(items);
      const typeIDs: string[] = [];
      for (const it of missing) {
        if (it.isPersonal || !it.problem) continue;
        const id = it.document?.typeID ?? archive.find((a) => a.type?.category === it.category)?.typeID;
        if (id && !typeIDs.includes(id)) typeIDs.push(id);
      }
      out.push({ companyID: c.id, companyName: c.name, jurisdiction: c.jurisdiction, templateID: t.id, templateName: t.name,
        got: items.length - missing.length, total: items.length, missing: missing.map((m) => packetItemTitle(m)),
        missingDetail: missing.map((m) => `${packetItemTitle(m)}：${packetReason(m)}`), missingTypeIDs: typeIDs, complete: !missing.length });
    }
  }
  return out;
}

export function PurposeReadinessAction({ row, onReissue }: { row: PurposeReadiness; onReissue: (owner: NodeRef, typeIDs: string[]) => void }) {
  const { store, router } = useApp();
  if (row.complete) return <Button size="small" onClick={() => router.open({ kind: "packet", companyID: row.companyID })}>准备文件包</Button>;
  return <span className="t-meta muted">缺 {row.missingTypeIDs.length || row.missing.length} 份</span>;
}

export { isHandedOff };
