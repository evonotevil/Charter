// 文件包、用途编辑、导出全部档案、文件详情。移植自 PacketView.swift、PurposeEditor.swift、ExportSheet.swift、DocumentSheet.swift。

import { ExtraTags, StatusTag, statusOfFreshness } from "./Status";
import { useEffect, useRef, useState } from "react";
import { pdfjs } from "../services/extract";
import * as D from "../domain/day";
import {
  type Document, type DocumentLink, type EvidenceLinkKind, type EvidenceTarget, type NodeRef, type PacketTemplate,
  archiveStateLabel, evidenceLinkKindLabel, ref, sameRef, stateNeedsAttention, typeAppliesTo, latinPadEnd,
} from "../domain/models";
import { expiryOf, freshnessLabel } from "../domain/engine";
import { useApp } from "../state/hooks";
import { type PacketItem, buildPacket, exportAll, exportPlan, packetIncluded, packetItemID, packetItemTitle, packetItems, packetMissing, packetReason, recencyText } from "../services/packets";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { ActionMenu, Button, Checkbox, ConfirmSheet, CopyTextSheet, DateField, FieldRow, FormGroup, Modal, Pill, Segmented, SelectField, SheetScaffold, Switch, TextField, divider, item } from "../ui/kit";
import { ReissueRequestSheet, freshnessPill, statePill, useStageFile } from "./common";

const lastPurposeKey = (cid: string) => `packet.lastPurpose.${cid}`;

export function purposeSummary(p: PacketTemplate): string {
  const parts = [p.categories.length ? "需要" + p.categories.join("、") : "未选文件类别"];
  if (p.includeDirectorsPassports) parts.push("附现任董事护照");
  if (p.maxAgeMonths) parts.push(`限时文件须在 ${p.maxAgeMonths} 个月内签发`);
  return parts.join("；") + "。";
}

function Banner({ icon, tint, bg, children }: { icon: string; tint: string; bg: string; children: React.ReactNode }) {
  return <div className="row start gap12" style={{ padding: 14, borderRadius: 14, background: bg }}><span style={{ color: tint }}><Icon name={icon} size={15} /></span><div className="col grow gap4">{children}</div></div>;
}

function Progress({ done, total }: { done: number; total: number }) {
  return <div style={{ height: 6, borderRadius: 3, background: "var(--hairline)", overflow: "hidden" }} role="progressbar" aria-valuenow={total ? Math.round(done / total * 100) : 0}>
    <div style={{ height: "100%", width: `${total ? (done / total) * 100 : 0}%`, background: "var(--ink)", transition: "width var(--standard) var(--ease)" }} />
  </div>;
}

type Phase = { kind: "choosing" } | { kind: "building" } | { kind: "failed"; message: string } | { kind: "done"; path: string; complete: boolean; missing: number };

export function PacketView({ companyID: initialCompany, purposeID, onClose }: { companyID?: string; purposeID?: string; onClose: () => void }) {
  const { store } = useApp();
  const locked = !!initialCompany;
  const [companyID, setCompanyID] = useState<string>(initialCompany ?? store.data.companies[0]?.id ?? "");
  const packets = store.data.library.packets;
  const pickTemplate = (cid: string) => {
    if (purposeID && packets.some((p) => p.id === purposeID)) return purposeID;
    const last = platform().prefGet(lastPurposeKey(cid));
    return last && packets.some((p) => p.id === last) ? last : packets[0]?.id ?? "";
  };
  const [templateID, setTemplateID] = useState(() => pickTemplate(companyID));
  const [items, setItems] = useState<PacketItem[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "choosing" });
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [confirmPartial, setConfirmPartial] = useState(false);
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const [reissue, setReissue] = useState<{ owner: NodeRef; typeIDs: string[] } | null>(null);
  const [note, setNote] = useState(false);
  const company = store.company(companyID);
  const template = packets.find((p) => p.id === templateID);
  const reload = () => { setItems(company && template ? packetItems(template, company, store) : []); setPhase({ kind: "choosing" }); };
  useEffect(reload, [companyID, templateID, store.data.library.packets]);
  const included = packetIncluded(items), missing = packetMissing(items);
  const complete = missing.length === 0;
  const typeName = (i: PacketItem) => (i.document ? store.docType(i.document.typeID)?.name : undefined);
  const requestable = () => {
    if (!company) return [];
    const archive = store.archive(company);
    const out: string[] = [];
    for (const it of missing) {
      if (it.isPersonal || !it.problem) continue;
      const id = it.document?.typeID ?? archive.find((a) => a.type?.category === it.category)?.typeID;
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  };
  const build = async () => {
    if (!company || !template) return;
    const frozen = items;
    setProgress({ done: 0, total: included.length + 1 });
    setPhase({ kind: "building" });
    try {
      const path = await buildPacket(frozen, template, company, store, (done, total) => setProgress({ done, total }));
      platform().prefSet(lastPurposeKey(company.id), template.id);
      setPhase({ kind: "done", path, complete, missing: missing.length });
    } catch (e) { setPhase({ kind: "failed", message: (e instanceof Error ? e.message : String(e)) }); }
  };
  const sendNote = () => {
    const lines = [`${company?.name ?? ""} ${latinPadEnd(template?.name ?? "")}文件包（${D.long(store.today)}）`, "", `已包含（${included.length} 份）：`,
      ...included.map((it, i) => `${String(i + 1).padStart(2, "0")} ${packetItemTitle(it, typeName(it))}${it.document?.issueDate ? `，${D.long(it.document.issueDate)}签发` : ""}`)];
    if (missing.length) {
      lines.push("", `尚缺（${missing.length} 项）：`, ...missing.map((it) => `— ${packetItemTitle(it)}：${packetReason(it)}`));
      lines.push("", "缺少的文件补齐后另行发送。");
    }
    return lines.join("\n");
  };
  const building = phase.kind === "building";
  const choosing = phase.kind === "choosing";

  let leading: React.ReactNode = null;
  if (choosing || building) {
  } else if (phase.kind === "failed") leading = <Button onClick={() => setPhase({ kind: "choosing" })}>返回清单</Button>;
  else if (phase.kind === "done") {
    leading = <>
      <Button onClick={() => void platform().reveal(phase.path)}>{platform().os === "windows" ? "在资源管理器中显示" : "在访达中显示"}</Button>
      <Button kind="accent" title="一段可直接粘贴进邮件的文字：包含哪些文件、还缺什么、预计何时补齐" onClick={() => setNote(true)}>复制发送说明</Button>
    </>;
  }
  const trailing = choosing || building ? <>
    <Button disabled={building} onClick={onClose}>关闭</Button>
    <Button kind="primary" disabled={!included.length || !choosing} title={complete ? undefined : `缺 ${missing.length} 项，目录里会注明`} onClick={() => (complete ? void build() : setConfirmPartial(true))}>
      {building ? "正在生成…" : complete ? "生成材料包" : "生成部分材料包"}</Button>
  </> : phase.kind === "failed" ? <><Button onClick={onClose}>关闭</Button><Button kind="primary" onClick={() => void build()}>重试</Button></> : <Button kind="primary" onClick={onClose}>完成</Button>;

  return (
    <Modal onClose={() => !building && onClose()} dismissOnEscape={!building}>
      <SheetScaffold title="准备文件包" subtitle={locked && company ? `${company.name}。按用途挑选每类文件的最新版本，并标出缺少的文件。` : "按用途挑选每类文件的最新版本，并标出缺少的文件。"}
        width={1000} height={780} leading={leading} trailing={trailing}>
        <div className="row start gap24">
          <div className="col" style={{ width: 420, flex: "none", gap: 18 }}>
            {!locked && <div className="col gap8"><span className="t-row">公司</span>
              <SelectField options={store.data.companies.map((c) => [c.id, c.name] as [string, string])} value={companyID} onChange={(v) => { setCompanyID(v); setTemplateID(pickTemplate(v)); }} placeholder="选择公司" minWidth={300} disabled={!choosing} />
            </div>}
            <div className="col gap10">
              <div className="row gap6"><span className="t-row grow">用途</span>
                <Button kind="quiet" size="small" icon="pencil" disabled={!template || !choosing} title="修改这个用途需要的文件类别和签发时限" onClick={() => setEditing({ id: templateID })}>编辑</Button>
                <Button kind="quiet" size="small" icon="plus" disabled={!choosing} onClick={() => setEditing({})}>新建用途</Button>
              </div>
              {!packets.length ? <span className="muted">还没有用途。点击“新建用途”，选择所需的文件类别。</span>
                : packets.length <= 4 ? <Segmented options={packets.map((p) => [p.id, p.name] as [string, string])} value={templateID} onChange={setTemplateID} />
                  : <SelectField options={packets.map((p) => [p.id, p.name] as [string, string])} value={templateID} onChange={setTemplateID} placeholder="选择用途" minWidth={260} disabled={!choosing} />}
              {template && <span className="t-meta muted">{purposeSummary(template)}</span>}
            </div>
            <div className="col gap8">
              <div className="row baseline"><span className="t-row grow">清单</span>
                <span className="t-meta" style={{ fontWeight: 600, color: complete ? "var(--muted)" : "var(--amber-text)" }}>需要 {items.length} 项，已选 {included.length} 项</span></div>
              {!items.length ? <span className="muted" style={{ padding: "6px 0" }}>{!template ? "请先选择用途。" : !company ? "请先选择公司。" : "这个用途没有要求任何文件。"}</span> : (
                <div className="col" style={{ borderRadius: 14, background: "color-mix(in srgb, var(--band) 55%, transparent)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}>
                  {items.map((it, i) => (
                    <div key={packetItemID(it)}>
                      {i > 0 && <div className="hairline" style={{ marginLeft: 14 }} />}
                      <div className="row baseline gap10" style={{ padding: "10px 14px", minHeight: 44 }}>
                        <span style={{ opacity: it.document ? 1 : 0.55 }} className="grow">
                          <Checkbox checked={it.included} disabled={!it.document || !choosing} onChange={(on) => setItems(items.map((x, k) => (k === i ? { ...x, included: on } : x)))}>
                            <span style={{ fontWeight: 500 }}>{packetItemTitle(it, typeName(it))}</span>
                          </Checkbox>
                        </span>
                        <span className="t-meta" style={{ textAlign: "right", fontWeight: it.problem ? 600 : 400, color: it.problem ? "var(--amber-text)" : "var(--muted)", maxWidth: 200 }}>{it.problem ?? (it.included ? recencyText(it) : "未选入")}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="col gap12 grow" style={{ minWidth: 0 }}>
            {phase.kind === "building" && <Banner icon="shippingbox" tint="var(--ink)" bg="var(--band)"><span className="num" style={{ fontWeight: 600 }}>{progress.total <= 1 && !progress.done ? "正在准备目录…" : `正在打包 ${progress.done} / ${progress.total}…`}</span><Progress {...progress} /></Banner>}
            {phase.kind === "failed" && <Banner icon="exclamationmark.triangle.fill" tint="var(--amber-text)" bg="var(--amber-soft)"><b className="amber-text">文件包生成失败</b><span className="t-meta selectable">{phase.message}</span></Banner>}
            {phase.kind === "done" && <Banner icon={phase.complete ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"} tint={phase.complete ? "var(--lime-text)" : "var(--amber-text)"} bg={phase.complete ? "var(--lime-soft)" : "var(--amber-soft)"}>
              <b style={{ color: phase.complete ? "var(--lime-text)" : "var(--amber-text)" }}>{phase.complete ? "已生成完整材料包" : `已生成部分材料包，缺 ${phase.missing} 项。目录里已列出缺件。`}</b>
              <span className="t-meta selectable">{phase.path.split(/[\\/]/).pop()}</span>
            </Banner>}
            <div className="col" style={{ padding: 24, borderRadius: 18, background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}>
              <div className="row gap10"><span className="t-meta muted grow" style={{ fontWeight: 600 }}>目录预览</span>
                {!complete && items.length > 0 && <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--amber-text)", background: "var(--amber-soft)", padding: "0 9px", height: 22, lineHeight: "22px", borderRadius: 999 }}>部分材料包，缺 {missing.length} 项</span>}
              </div>
              <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, marginTop: 14 }}>{company?.name ?? "未选公司"}</span>
              <span className="t-body muted">{template?.name ?? ""}文件包，{D.long(store.today)}</span>
              <span className="t-row" style={{ marginTop: 20 }}>已包含（{included.length} 份）</span>
              {included.map((it, i) => (
                <div key={packetItemID(it)} className="row start gap10" style={{ padding: "5px 0" }}>
                  <span className="num muted">{String(i + 1).padStart(2, "0")}</span>
                  <span className="col" style={{ gap: 2 }}><span>{packetItemTitle(it, typeName(it))}</span><span className="t-meta" style={{ color: it.problem ? "var(--amber-text)" : "var(--muted)" }}>{recencyText(it)}</span></span>
                </div>
              ))}
              {!included.length && <span className="muted" style={{ padding: "5px 0" }}>还没有选入任何文件。</span>}
              {missing.length > 0 && <>
                <span className="t-row amber-text" style={{ marginTop: 18 }}>尚缺（{missing.length} 项）</span>
                {missing.map((it) => <div key={packetItemID(it)} className="row baseline gap10" style={{ padding: "5px 0" }}><span className="amber-text">—</span><span className="grow">{packetItemTitle(it)}</span><span className="t-meta amber-text" style={{ fontWeight: 600, textAlign: "right" }}>{packetReason(it)}</span></div>)}
              </>}
            </div>
          </div>
        </div>
      </SheetScaffold>
      {confirmPartial && <ConfirmSheet title="生成部分材料包？" message={`目录和文件名会标明“部分材料包”，并列出缺少的 ${missing.length} 项。`} confirmTitle="生成部分材料包" onClose={() => setConfirmPartial(false)} onConfirm={() => { setConfirmPartial(false); void build(); }} />}
      {editing && <PurposeEditor purposeID={editing.id} onClose={() => setEditing(null)} onSaved={(id) => { if (id === templateID) reload(); else setTemplateID(id); }} onDeleted={() => setTemplateID(store.data.library.packets[0]?.id ?? "")} />}
      {reissue && <ReissueRequestSheet owner={reissue.owner} typeIDs={reissue.typeIDs} onClose={() => setReissue(null)} />}
      {note && <CopyTextSheet title="发送说明" subtitle="可直接粘贴进邮件正文，列出包含的文件和尚缺的材料。" initial={sendNote()} onClose={() => setNote(false)} />}
    </Modal>
  );
}

export function PurposeEditor({ purposeID, onClose, onSaved, onDeleted }: { purposeID?: string; onClose: () => void; onSaved?: (id: string) => void; onDeleted?: () => void }) {
  const { store } = useApp();
  const existing = store.data.library.packets.find((p) => p.id === purposeID);
  const isNew = !existing;
  const [draft, setDraft] = useState<PacketTemplate>(() => existing ? structuredClone(existing) : { id: `custom.${crypto.randomUUID().slice(0, 8).toLowerCase()}`, name: "", categories: [], includeDirectorsPassports: false });
  const [attempted, setAttempted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const name = draft.name.trim();
  const taken = store.data.library.packets.some((p) => p.id !== draft.id && p.name === name);
  const nameError = taken ? "已有同名用途" : attempted && !name ? "请填写名称" : null;
  const contentError = attempted && !draft.categories.length && !draft.includeDirectorsPassports ? "至少选择一个文件类别，或打开“附上现任董事的护照”" : null;
  const canSave = !!name && !taken && (draft.categories.length > 0 || draft.includeDirectorsPassports);
  const cats = [...new Set([...store.data.library.documentTypes.map((t) => t.category).filter(Boolean), ...draft.categories])].sort((a, b) => a.localeCompare(b, "zh"));
  const ages = [...new Set([1, 3, 6, 12, ...(draft.maxAgeMonths ? [draft.maxAgeMonths] : [])])].sort((a, b) => a - b);
  const save = () => {
    setAttempted(true);
    if (!canSave) return;
    const p = { ...draft, name };
    store.saveLibrary((l) => { const i = l.packets.findIndex((x) => x.id === p.id); if (i >= 0) l.packets[i] = p as any; else l.packets.push(p as any); });
    onSaved?.(p.id);
    store.showToast(isNew ? `已创建用途 ${p.name}` : `已保存 ${p.name}`);
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={isNew ? "新建用途" : "编辑用途"} subtitle="选择这个用途所需的文件类别。准备文件包时，Charter 会按它挑出每类最新的一份。" width={600} height={760} onSubmit={save}
        leading={!isNew ? <Button onClick={() => setConfirmDelete(true)}>删除用途</Button> : null}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={save}>{isNew ? "创建用途" : "保存"}</Button></>}>
        <div className="col" style={{ gap: 18 }}>
          <FormGroup title="基本信息"><FieldRow label="名称" error={nameError}><TextField value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="例如：银行开户" invalid={taken} autoFocus={isNew} /></FieldRow></FormGroup>
          <div className="col gap6">
            <FormGroup title={`需要的文件类别（已选 ${draft.categories.length} 类）`}>
              {!cats.length ? <span className="muted">模板库里还没有文件类别。先在“设置 → 档案清单”里添加条目。</span> : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px" }}>
                  {cats.map((c) => <Checkbox key={c} checked={draft.categories.includes(c)} onChange={(on) => setDraft({ ...draft, categories: on ? [...draft.categories, c] : draft.categories.filter((x) => x !== c) })}>{c}</Checkbox>)}
                </div>
              )}
            </FormGroup>
            {contentError ? <span className="ferror" style={{ paddingLeft: 4 }}>{contentError}</span> : <span className="t-meta muted" style={{ paddingLeft: 4 }}>类别按条目的“通用类别”划分，跨法域把同类文件放在一起。</span>}
          </div>
          <FormGroup title="其他要求">
            <Switch checked={draft.includeDirectorsPassports} onChange={(v) => setDraft({ ...draft, includeDirectorsPassports: v })}>附上现任董事的护照</Switch>
            <FieldRow label="签发时限" hint="限时文件须在这个时间内签发。只约束“签发后若干个月有效”的文件，例如存续证明。">
              <SelectField options={[[0, "不限"] as [number, string], ...ages.map((m) => [m, `${m} 个月内`] as [number, string])]} value={draft.maxAgeMonths ?? 0} onChange={(v) => setDraft({ ...draft, maxAgeMonths: v || undefined })} minWidth={140} />
            </FieldRow>
          </FormGroup>
        </div>
      </SheetScaffold>
      {confirmDelete && <ConfirmSheet title={`删除用途“${name || "未命名"}”？`} message="删除后准备文件包时不再能选这个用途。已经生成的文件包不受影响。" confirmTitle="删除" destructive onClose={() => setConfirmDelete(false)}
        onConfirm={() => { store.saveLibrary((l) => { l.packets = l.packets.filter((p) => p.id !== draft.id); }); onDeleted?.(); setConfirmDelete(false); onClose(); }} />}
    </Modal>
  );
}

// MARK: - 导出全部档案

export function ExportSheet({ companyID, onClose }: { companyID: string; onClose: () => void }) {
  const { store, router } = useApp();
  const [includeOld, setIncludeOld] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [failure, setFailure] = useState<string | null>(null);
  const c = store.company(companyID);
  if (!c) return <Modal onClose={onClose}><SheetScaffold title="找不到这家公司" subtitle="它可能已被删除。" width={420} trailing={<Button kind="primary" onClick={onClose}>关闭</Button>}><span /></SheetScaffold></Modal>;
  const plan = exportPlan(c, store);
  const run = async () => {
    setWorking(true); setFailure(null); setProgress({ done: 0, total: 0 });
    try { setResult(await exportAll(c, store, includeOld, (done, total) => setProgress({ done, total }))); }
    catch (e) { setFailure((e instanceof Error ? e.message : String(e))); }
    finally { setWorking(false); }
  };
  return (
    <Modal onClose={() => !working && onClose()} dismissOnEscape={!working}>
      <SheetScaffold title="导出全部档案" subtitle={`${c.name}。导出为一个 ZIP，附目录和公司资料摘要。`} width={580} height={680}
        leading={result ? <Button onClick={() => void platform().reveal(result)}>{platform().os === "windows" ? "在资源管理器中显示" : "在访达中显示"}</Button>
          : <Button disabled={working} title="例如银行开户、审计、KYC：按清单挑选文件" onClick={() => router.open({ kind: "packet", companyID: c.id })}>按用途挑选导出…</Button>}
        trailing={result ? <Button kind="primary" onClick={onClose}>完成</Button> : <>
          <Button disabled={working} onClick={onClose}>取消</Button>
          <Button kind="primary" disabled={working || !plan.included.length} onClick={() => void run()}>{working ? "正在导出…" : failure ? "重试" : "导出 ZIP"}</Button>
        </>}>
        <div className="col" style={{ gap: 18 }}>
          {working && <Banner icon="archivebox" tint="var(--ink)" bg="var(--band)"><b className="num">{progress.total ? `正在写入 ${progress.done} / ${progress.total}…` : "正在准备目录…"}</b><Progress {...progress} /></Banner>}
          {result && <Banner icon="checkmark.circle.fill" tint="var(--lime-text)" bg="var(--lime-soft)"><b className="lime-text">已导出</b><span className="t-meta selectable">{result.split(/[\\/]/).pop()}</span></Banner>}
          {failure && <Banner icon="exclamationmark.triangle.fill" tint="var(--amber-text)" bg="var(--amber-soft)"><b className="amber-text">导出失败</b><span className="t-meta selectable">{failure}</span></Banner>}
          <FormGroup title={`将包含 ${plan.included.length} 份现行文件`}>
            {!plan.included.length && <span className="muted">还没有可以导出的文件。</span>}
            {plan.included.map((it, i) => (
              <div key={i} className="row baseline gap8">
                <span className="grow">{it.type?.name ?? "未知条目"}</span>
                {stateNeedsAttention(it.state) && <Pill text={archiveStateLabel(it.state)} kind={statePill(it.state)} />}
                <span className="t-meta muted num">{it.document?.issueDate ? `${it.document.issueDate} 签发` : "未注明签发日期"}</span>
              </div>
            ))}
          </FormGroup>
          {plan.excluded.length > 0 && <FormGroup title={`不包含 ${plan.excluded.length} 项，目录里会注明原因`}>
            {plan.excluded.map((it, i) => <div key={i} className="row baseline gap8"><span className="grow">{it.type?.name ?? "未知条目"}</span><span className="t-meta amber-text" style={{ textAlign: "right" }}>{it.note ? `${archiveStateLabel(it.state)}，${it.note}` : archiveStateLabel(it.state)}</span></div>)}
          </FormGroup>}
          {plan.oldVersions > 0 && <FormGroup title="选项"><Checkbox checked={includeOld} disabled={working || !!result} onChange={setIncludeOld}>同时导出 {plan.oldVersions} 份旧版文件（放在“旧版”文件夹）</Checkbox></FormGroup>}
          <span className="t-meta muted">另附：目录（PDF 和 Excel 各一份），以及根据已录入的公司、董事和持股关系生成的公司资料摘要。</span>
        </div>
      </SheetScaffold>
    </Modal>
  );
}

// MARK: - 文件详情

const forms = ["扫描件", "原件", "核证副本", "公证件", "海牙认证", "翻译件"];

// 用 pdf.js 逐页渲染：各平台 WebView 对内嵌 PDF 的支持不一致（Linux 完全不支持）。
function FilePreview({ path }: { path: string }) {
  const pdf = path.toLowerCase().endsWith(".pdf");
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bytes = await platform().readBytes(path);
        if (!pdf) { if (!cancelled) setState("ok"); return; }
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        const host = box.current; if (!host || cancelled) return;
        host.replaceChildren();
        for (let i = 1; i <= Math.min(doc.numPages, 20) && !cancelled; i++) {
          const page = await doc.getPage(i);
          const width = host.clientWidth - 24;
          const vp = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * devicePixelRatio });
          const c = document.createElement("canvas");
          c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
          c.style.cssText = `width:${width}px;display:block;margin:12px auto 0;background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.12)`;
          await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
          host.appendChild(c);
        }
        if (!cancelled) setState("ok");
      } catch { if (!cancelled) setState("missing"); }
    })();
    return () => { cancelled = true; };
  }, [path, pdf]);
  if (state === "missing") return (
    <div className="col gap8 muted" style={{ height: "100%", padding: 24, textAlign: "center", alignItems: "center", justifyContent: "center" }}>
      <Icon name="doc.text" size={28} />
      <span className="t-row" style={{ color: "var(--ink)" }}>找不到原始文件</span>
      <span className="t-meta">数据文件夹里没有这份文件，可能还没同步下来，或已被移动。归档新版即可补上。</span>
    </div>);
  if (!pdf) return state === "ok" ? <img src={platform().fileURL(path)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : null;
  return <div ref={box} className="scroll" style={{ height: "100%", paddingBottom: 12 }} aria-busy={state === "loading"} />;
}

const evidenceTargetLabel: Record<EvidenceTarget, string> = {
  company: "公司",
  person: "人员",
  appointment: "任职",
  holding: "持股",
};
const evidenceTargets: EvidenceTarget[] = ["company", "person", "appointment", "holding"];
const evidenceKinds = Object.keys(evidenceLinkKindLabel) as EvidenceLinkKind[];

export function EvidenceLinksChip({ doc, onEdit }: { doc: Document; onEdit: () => void }) {
  const { store } = useApp();
  const current = store.data.documents.find((item) => item.id === doc.id) ?? doc;
  const links = store.linksOf(current);
  return (
    <button
      className="row gap4"
      style={{ minWidth: 0, maxWidth: 260, flexWrap: "nowrap", flexShrink: 1 }}
      title="证据关联：这份文件还证明了哪些公司、人员、任职或持股"
      onClick={(event) => { event.stopPropagation(); onEdit(); }}
    >
      {links.length ? <>
        {links.slice(0, 2).map((link, index) => (
          <span key={`${link.target}:${link.id}:${index}`} className="v4-chip btnlike" style={{ maxWidth: 140, minWidth: 0, flexShrink: 1 }}>
            <Icon name={link.target === "person" ? "users" : link.target === "company" ? "building.2" : "arrow.triangle.branch"} size={10} />
            <span className="ellipsis">{store.evidenceTargetName(link)}</span>
          </span>
        ))}
        {links.length > 2 && <span className="t-meta muted" style={{ whiteSpace: "nowrap", flex: "none" }}>另 {links.length - 2} 条</span>}
      </> : <span className="v4-chip btnlike" style={{ color: "var(--muted)" }}><Icon name="plus" size={10} />关联</span>}
    </button>
  );
}

export function EvidenceEditor({ doc, onClose }: { doc: Document; onClose: () => void }) {
  const { store } = useApp();
  const [links, setLinks] = useState<DocumentLink[]>(() => store.linksOf(doc).map((link) => ({ ...link })));
  const [target, setTarget] = useState<EvidenceTarget | null>(null);
  const [query, setQuery] = useState("");
  const t = store.docType(doc.typeID);
  const candidates = (kind: EvidenceTarget) => {
    const q = query.trim().toLowerCase();
    const list = kind === "company"
      ? store.data.companies.map((c) => ({ id: c.id, name: `${c.jurisdiction} ${c.name}` }))
      : kind === "person"
        ? store.data.people.map((p) => ({ id: p.id, name: p.name }))
        : kind === "appointment"
          ? store.data.appointments.map((a) => ({ id: a.id, name: store.evidenceTargetName({ target: "appointment", id: a.id }) }))
          : store.data.holdings.map((h) => ({ id: h.id, name: store.evidenceTargetName({ target: "holding", id: h.id }) }));
    return list.filter((item) => !links.some((link) => link.target === kind && link.id === item.id) && !(doc.owner.kind === kind && doc.owner.id === item.id) && (!q || item.name.toLowerCase().includes(q))).slice(0, 30);
  };
  const defaultKind = (kind: EvidenceTarget): EvidenceLinkKind =>
    kind === "appointment" ? "appointment"
      : kind === "holding" ? "shareholding"
        : doc.typeID === "common.passport" || doc.typeID === "person.idcard" ? "identity"
          : doc.typeID === "common.address" ? "address"
            : doc.typeID === "person.kyc" ? "kyc" : "other";
  const save = () => {
    store.setLinks(doc.id, links);
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <SheetScaffold
        title="证据关联"
        width={720}
        height={720}
        subtitle={`${t?.name ?? "文件"} · ${store.nameOf(doc.owner)}。这份文件除了属于${doc.owner.kind === "company" ? "这家公司" : "这个人"}，还能证明哪些公司、人员、任职或持股。`}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={save}>保存</Button></>}
      >
        <div className="col gap16">
          {doc.sourcePath && <span className="t-meta muted">来源：<span className="mono selectable">{doc.sourcePath}</span></span>}
          <div className="card flush">
            {!links.length && <div className="muted" style={{ padding: 18 }}>还没有关联。例如：一份合并 KYC 可以同时关联几位董事；一份董事会决议可以关联几项任职。</div>}
            {links.map((link, index) => (
              <div key={`${link.target}:${link.id}:${index}`} className="list-row" style={{ alignItems: "center" }}>
                <span className="pill neutral">{evidenceTargetLabel[link.target]}</span>
                <span className="col grow" style={{ minWidth: 0 }}><span className="ellipsis" style={{ fontWeight: 600 }}>{store.evidenceTargetName(link)}</span></span>
                <SelectField minWidth={130} value={link.kind} options={evidenceKinds.map((kind) => [kind, evidenceLinkKindLabel[kind]] as [EvidenceLinkKind, string])}
                  onChange={(kind) => setLinks((items) => items.map((item, i) => i === index ? { ...item, kind } : item))} />
                <input className="field" style={{ width: 80 }} placeholder="页码" aria-label="页码" value={link.page ?? ""}
                  onChange={(event) => setLinks((items) => items.map((item, i) => i === index ? { ...item, page: event.target.value || undefined } : item))} />
                <button className="v4-x" aria-label="移除这条关联" onClick={() => setLinks((items) => items.filter((_, i) => i !== index))}><Icon name="xmark" size={11} /></button>
              </div>
            ))}
          </div>
          <div className="col gap8">
            <span className="row gap8 wrap"><span className="t-label">添加关联</span>
              {evidenceTargets.map((kind) => <Button key={kind} size="small" kind={target === kind ? "primary" : "secondary"} onClick={() => { setTarget(target === kind ? null : kind); setQuery(""); }}>{evidenceTargetLabel[kind]}</Button>)}
            </span>
            {target && <div className="card" style={{ padding: 10, gap: 6 }}>
              <input className="field" autoFocus placeholder={`搜索${evidenceTargetLabel[target]}…`} value={query} onChange={(event) => setQuery(event.target.value)} />
              <div className="col scroll" style={{ maxHeight: 240 }}>
                {candidates(target).map((item) => <button key={item.id} className="v4-opt" onClick={() => setLinks((items) => [...items, { target, id: item.id, kind: defaultKind(target) }])}>
                  <span className="ellipsis grow">{item.name}</span><Icon name="plus" size={12} />
                </button>)}
                {!candidates(target).length && <span className="t-meta muted" style={{ padding: 8 }}>没有可选的。</span>}
              </div>
            </div>}
          </div>
        </div>
      </SheetScaffold>
    </Modal>
  );
}

export function RelatedEvidence({ target, id, title = "相关证据" }: { target: EvidenceTarget; id: string; title?: string }) {
  const { store, router } = useApp();
  const [editing, setEditing] = useState<Document | null>(null);
  const evidence = store.evidenceFor(target, id);
  if (!evidence.length) return null;
  const grouped = new Map<string, { doc: Document; links: DocumentLink[] }>();
  for (const { doc, link } of evidence) {
    const row = grouped.get(doc.id) ?? { doc, links: [] };
    row.links.push(link);
    grouped.set(doc.id, row);
  }
  return (
    <section className="card">
      <div className="card-head"><h2 className="t-card">{title}</h2><span className="t-meta muted">{grouped.size} 份文件</span></div>
      <div className="col">
        {[...grouped.values()].map(({ doc, links }) => (
          <div key={doc.id} className="doc-row">
            <span className="doc-ic"><Icon name="doc.text" size={15} /></span>
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="ellipsis" style={{ fontWeight: 700 }}>{store.docType(doc.typeID)?.name ?? "文件"}<span className="t-meta muted" style={{ fontWeight: 400 }}>　{store.nameOf(doc.owner)} 名下</span></span>
              <span className="t-meta muted ellipsis">{links.map((link) => `${evidenceLinkKindLabel[link.kind]}：${store.evidenceTargetName(link)}${link.page ? `（第 ${link.page} 页）` : ""}`).join("；")}</span>
            </span>
            <Button size="small" kind="quiet" onClick={() => setEditing(doc)}>关联</Button>
            <Button size="small" kind="quiet" onClick={() => router.open({ kind: "document", id: doc.id })}>查看</Button>
          </div>
        ))}
      </div>
      {editing && <EvidenceEditor doc={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

export function DocumentSheet({ documentID, onClose }: { documentID: string; onClose: () => void }) {
  const { store } = useApp();
  const orig = store.data.documents.find((d) => d.id === documentID);
  const [doc, setDoc] = useState<Document | undefined>(orig ? { ...orig } : undefined);
  const [reissue, setReissue] = useState(false);
  const [editingLinks, setEditingLinks] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [startStage, stageNode] = useStageFile();
  if (!doc) return <Modal onClose={onClose}><SheetScaffold title="找不到这份文件" subtitle="它可能已被移除。" width={420} trailing={<Button kind="primary" onClick={onClose}>关闭</Button>}><span /></SheetScaffold></Modal>;
  const set = (patch: Partial<Document>) => setDoc({ ...doc, ...patch });
  const f = store.freshness(doc);
  const t = store.docType(doc.typeID);
  const j = doc.owner.kind === "company" ? store.company(doc.owner.id)?.jurisdiction : undefined;
  const typeChoices: [string, string][] = store.data.library.documentTypes.filter((x) => x.owner === doc.owner.kind && (!j || typeAppliesTo(x, j))).map((x) => [x.id, x.name]);
  if (!typeChoices.some(([id]) => id === doc.typeID)) typeChoices.push([doc.typeID, t?.name ?? "未知类型"]);
  const owners: NodeRef[] = [...store.data.companies.map((c) => ref("company", c.id)), ...store.data.people.map((p) => ref("person", p.id))];
  const formChoices = forms.includes(doc.form) ? forms : [...forms, doc.form];
  const ruleExpiry = !doc.expiryDate && !doc.noExpiry ? expiryOf(doc, t) : undefined;
  const needsPrintedExpiry = t?.validity === "expiryOnDocument";
  const needsReissue = f.kind === "expired" || f.kind === "expiring" || f.kind === "needsUpdate";
  const waiting = store.openRequest(doc.owner, doc.typeID);
  const save = async () => {
    try {
      const latestLinks = store.data.documents.find((item) => item.id === doc.id)?.links;
      const u = await store.updateDocument({ ...doc, links: latestLinks });
      let text = "文件信息已保存";
      if (orig && !sameRef(orig.owner, doc.owner)) text = `已改归属到 ${store.nameOf(doc.owner)}`;
      else if (orig && orig.typeID !== doc.typeID) text = `已改为“${store.docType(doc.typeID)?.name ?? "文件"}”`;
      store.showToast(text, u ? () => store.undoID(u) : undefined);
      onClose();
    } catch (e) { setSaveError((e instanceof Error ? e.message : String(e))); }
  };
  const reveal = platform().os === "windows" ? "在资源管理器中显示" : "在访达中显示";
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={t?.name ?? "文件"} subtitle={store.nameOf(doc.owner)} width={960} height={780} onSubmit={() => void save()}
        leading={<>
          <ActionMenu title="更多" placement="top" entries={[
            item("打开", "arrow.up.forward.app", () => void store.openDocument(doc)),
            item(reveal, "folder", () => void store.revealDocument(doc)),
            item("归档新版…", "square.and.arrow.up", () => void startStage({ typeID: doc.typeID, owner: doc.owner, replaces: doc, form: doc.form, onArchived: (n) => setDoc({ ...n }) })),
            divider,
            item("从 Charter 移除记录", "trash", () => { store.deleteDocument(doc); onClose(); }, { destructive: true }),
          ]} />
          {saveError && <span className="row gap6 t-meta amber-text" title={saveError} aria-label={`无法保存：${saveError}`}><Icon name="exclamationmark.triangle.fill" /><span className="ellipsis" style={{ maxWidth: 240 }}>{saveError}</span></span>}
        </>}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={() => void save()}>保存</Button></>}>
        <div className="row start" style={{ gap: 22 }}>
          <div style={{ width: 380, height: 540, flex: "none", borderRadius: 14, overflow: "hidden", background: "var(--band)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}><FilePreview key={doc.filePath} path={store.fileURL(doc)} /></div>
          <div className="col grow gap16" style={{ minWidth: 0 }}>
            <div className="row gap8 wrap"><StatusTag s={statusOfFreshness(f)} />{doc.needsUpdate && f.kind !== "needsUpdate" && <StatusTag s={statusOfFreshness({ kind: "needsUpdate" })} />}<ExtraTags d={doc} t={store.docType(doc.typeID)} /></div>
            <FormGroup title="文件">
              <FieldRow label="类型"><SelectField options={typeChoices} value={doc.typeID} onChange={(typeID) => set({ typeID })} minWidth={260} /></FieldRow>
              <FieldRow label="归属"><SelectField options={owners.map((r) => [r, store.nameOf(r)] as [NodeRef, string])} value={doc.owner} onChange={(owner) => set({ owner })} minWidth={260} keyOf={(r) => `${r.kind}:${r.id}`} /></FieldRow>
              <FieldRow label="形态"><SelectField options={formChoices.map((x) => [x, x] as [string, string])} value={doc.form} onChange={(form) => set({ form })} minWidth={260} /></FieldRow>
            </FormGroup>
            <FormGroup title="日期">
              <FieldRow label="签发日期"><DateField value={doc.issueDate} onChange={(issueDate) => set({ issueDate })} /></FieldRow>
              <FieldRow
                label="到期日期"
                hint={ruleExpiry ? `留空时按规则算出：${D.long(ruleExpiry)}` : t?.validity === "permanent" || t?.validity === "untilChanged"
                  ? "这类文件长期有效，不用填。"
                  : needsPrintedExpiry && !doc.expiryDate && !doc.noExpiry
                    ? "留空会算作“未填日期”，计入需处理。"
                    : undefined}
              >
                <DateField value={doc.expiryDate} onChange={(expiryDate) => set({ expiryDate, ...(expiryDate ? { noExpiry: undefined } : {}) })}
                  placeholder={t?.validity === "permanent" || t?.validity === "untilChanged" ? "长期有效，无需填写" : ruleExpiry ? "留空按规则计算" : doc.noExpiry ? "长期有效" : "填写文件上的到期日"} relativeTo={doc.issueDate} />
              </FieldRow>
              {needsPrintedExpiry && <Checkbox checked={!!doc.noExpiry && !doc.expiryDate} disabled={!!doc.expiryDate} title={doc.expiryDate ? "已填写到期日" : undefined}
                onChange={(noExpiry) => set({ noExpiry: noExpiry || undefined })}>文件上写明长期有效 / 没有到期日</Checkbox>}
            </FormGroup>
            <FormGroup title="状态与备注">
              <Switch checked={doc.needsUpdate} onChange={(needsUpdate) => set({ needsUpdate })}>信息有变更，需要重开</Switch>
              {store.docType(doc.typeID)?.requiresSignature && <FieldRow label="签署日期" hint="这类文件需要签署；留空表示待签署。"><DateField value={doc.signedOn} onChange={(signedOn) => set({ signedOn })} placeholder="待签署" /></FieldRow>}
              <FieldRow label="核实" hint="与原件（或经认证副本）核对过的日期。"><DateField value={doc.verifiedOn} onChange={(verifiedOn) => set({ verifiedOn })} placeholder="未核实" /></FieldRow>
              <FieldRow label="备注"><TextField multiline rows={2} value={doc.notes} onChange={(notes) => set({ notes })} placeholder="可选" /></FieldRow>
            </FormGroup>
            <FormGroup title="证据关联">
              <div className="row gap8 wrap">
                <EvidenceLinksChip doc={doc} onEdit={() => setEditingLinks(true)} />
                <Button size="small" kind="quiet" onClick={() => setEditingLinks(true)}>编辑关联…</Button>
              </div>
            </FormGroup>
            <FormGroup title="记录">
              <FieldRow label="原始文件名"><span className="ellipsis selectable" title={doc.originalFileName}>{doc.originalFileName || "—"}</span></FieldRow>
              <FieldRow label="归档日期"><span>{D.long(doc.addedOn)}</span></FieldRow>
              <FieldRow label="Charter 副本"><span className="mono selectable t-meta" style={{ overflowWrap: "anywhere" }}>{doc.filePath}</span></FieldRow>
              <FieldRow label="原件位置" hint="导入时的位置，只作记录；Charter 不会改动原件。"><span className="mono selectable t-meta" style={{ overflowWrap: "anywhere" }}>{doc.sourcePath || "未记录（5.3 之前归档）"}</span></FieldRow>
              {(() => { const older = store.data.documents.filter((x) => x.supersededBy === doc.id); const newer = doc.supersededBy ? store.data.documents.find((x) => x.id === doc.supersededBy) : undefined;
                return <FieldRow label="版本">{newer ? <span>旧版，已被 {newer.issueDate ?? "新版"} 的版本替代</span> : <span>现行{older.length ? `，替代了 ${older.length} 个旧版` : ""}</span>}</FieldRow>; })()}
            </FormGroup>
          </div>
        </div>
        {stageNode}
      </SheetScaffold>
      {reissue && <ReissueRequestSheet owner={doc.owner} typeIDs={[doc.typeID]} onClose={() => setReissue(false)} />}
      {editingLinks && <EvidenceEditor doc={doc} onClose={() => {
        const latest = store.data.documents.find((item) => item.id === doc.id);
        setDoc((value) => value ? { ...value, links: latest?.links } : value);
        setEditingLinks(false);
      }} />}
    </Modal>
  );
}
