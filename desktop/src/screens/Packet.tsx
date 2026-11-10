// 文件包、用途编辑、导出全部档案、文件详情。移植自 PacketView.swift、PurposeEditor.swift、ExportSheet.swift、DocumentSheet.swift。

import { ExtraTags, StatusTag, statusOfFreshness } from "./Status";
import { useEffect, useRef, useState } from "react";
import { FilePreview } from "./FilePreview";
import * as D from "../domain/day";
import { type Document, type NodeRef, type PacketTemplate, type PacketWatermark, archiveStateLabel, ref, sameRef, stateNeedsAttention, typeAppliesTo, latinPadEnd } from "../domain/models";
import { expiryOf, freshnessLabel } from "../domain/engine";
import { EvidenceSheet, LinkChips } from "./Evidence";
import { useApp } from "../state/hooks";
import { type PacketItem, buildPacket, packetBaseName, exportAll, exportPlan, packetIncluded, packetItemID, packetItemTitle, packetItems, packetMissing, packetReason, recencyText } from "../services/packets";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { ActionMenu, Button, Checkbox, Note, ProgressBar, Tabs, useNarrow, ConfirmSheet, CopyTextSheet, DateField, FieldRow, FormGroup, Modal, Pill, Segmented, SelectField, SheetScaffold, Switch, TextField, divider, item } from "../ui/kit";
import { defaultPacketWatermark, eligibilityPill, useEligibility, WatermarkPreview, WatermarkSettingsPanel, SignedConfirm } from "./PacketWatermark";
import { estimateSize, kindOf, sizeLabel } from "../services/watermark";
import { ReissueRequestSheet, freshnessPill, statePill, useStageFile, refInfo, companyInfo } from "./common";

const lastPurposeKey = (cid: string) => `packet.lastPurpose.${cid}`;

export function purposeSummary(p: PacketTemplate): string {
  const parts = [p.categories.length ? "需要" + p.categories.join("、") : "未选文件类别"];
  if (p.includeDirectorsPassports) parts.push("附现任董事护照");
  if (p.maxAgeMonths) parts.push(`限时文件须在 ${p.maxAgeMonths} 个月内签发`);
  return parts.join("；") + "。";
}

type Phase = { kind: "choosing" } | { kind: "building" } | { kind: "failed"; message: string } | { kind: "done"; path: string; complete: boolean; missing: number; watermarked: boolean };

export function PacketView({ companyID: initialCompany, purposeID, recipient: initialRecipient, onClose }: { companyID?: string; purposeID?: string; recipient?: string; onClose: () => void }) {
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
  const [progress, setProgress] = useState<{ done: number; total: number; label?: string }>({ done: 0, total: 0 });
  const [confirmPartial, setConfirmPartial] = useState(false);
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const [reissue, setReissue] = useState<{ owner: NodeRef; typeIDs: string[] } | null>(null);
  const [note, setNote] = useState(false);
  const company = store.company(companyID);
  const template = packets.find((p) => p.id === templateID);
  // 水印设置：按用途记住（改动 400ms 后写回），接收方每次确认。
  const [wm, setWmLocal] = useState<PacketWatermark>(() => template?.watermark ?? defaultPacketWatermark());
  const [recipient, setRecipient] = useState(initialRecipient ?? "");
  const [signedOK, setSignedOK] = useState<string[]>([]);
  const [askSigned, setAskSigned] = useState<{ id: string; title: string } | null>(null);
  const [pane, setPane] = useState<"list" | "wm" | "preview">("list");
  const [previewTab, setPreviewTab] = useState<"toc" | "wm">("toc");
  const [estimate, setEstimate] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const abort = useRef<AbortController | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(host, wm.enabled ? 1120 : 760);
  useEffect(() => { setWmLocal(template?.watermark ?? defaultPacketWatermark()); setSignedOK([]); }, [templateID]);
  const setWm = (w: PacketWatermark) => {
    setWmLocal(w);
    clearTimeout(saveTimer.current);
    const id = templateID;
    saveTimer.current = setTimeout(() => store.saveLibrary((l) => { const t = l.packets.find((x) => x.id === id); if (t) t.watermark = structuredClone(w) as never; }), 400);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  const reload = () => { setItems(company && template ? packetItems(template, company, store) : []); setPhase({ kind: "choosing" }); };
  useEffect(reload, [companyID, templateID]);
  const included = packetIncluded(items), missing = packetMissing(items);
  const complete = missing.length === 0;
  const elig = useEligibility(items, store);
  /** 实际不加水印的项：手动排除的、不能加的、带签名但没确认的。 */
  const skipOf = (id: string) => { const e = elig[id]; return wm.skip.includes(id) || (e && !e.ok) || (!!e && "signed" in e && !signedOK.includes(id)); };
  const wmCount = included.filter((i) => !skipOf(packetItemID(i))).length;
  const effective: PacketWatermark = { ...wm, skip: items.map(packetItemID).filter(skipOf) };
  const needsRecipient = wm.enabled && wm.settings.parts.some((p) => p.kind === "tag" && p.tag === "recipient") && !recipient.trim();
  useEffect(() => {
    if (!wm.enabled) { setEstimate(null); return; }
    let live = true;
    void Promise.all(included.map(async (i) => { const st = await platform().stat(store.fileURL(i.document!)); const bytes = st.size ?? 0; const flat = wm.settings.flatten && !skipOf(packetItemID(i)) && kindOf(store.fileURL(i.document!)) === "pdf"; return { bytes, pages: Math.max(1, Math.round(bytes / 60_000)), flatten: flat }; }))
      .then((r) => live && setEstimate(estimateSize(r) + 40_000));
    return () => { live = false; };
  }, [wm.enabled, wm.settings.flatten, included.length, effective.skip.join()]);
  const typeName = (i: PacketItem) => (i.document ? store.docType(i.document.typeID)?.name : undefined);
  const build = async () => {
    if (!company || !template) return;
    const frozen = items;
    const ac = new AbortController(); abort.current = ac;
    setProgress({ done: 0, total: included.length + 1 });
    setPhase({ kind: "building" });
    try {
      const path = await buildPacket(frozen, template, company, store, {
        watermark: wm.enabled ? { wm: effective, recipient } : undefined, signal: ac.signal,
        onProgress: (done, total, label) => setProgress({ done, total, label }),
      });
      platform().prefSet(lastPurposeKey(company.id), template.id);
      setPhase({ kind: "done", path, complete, missing: missing.length, watermarked: wm.enabled });
    } catch (e) {
      if (ac.signal.aborted) { setPhase({ kind: "choosing" }); store.showToast("已取消导出"); }
      else setPhase({ kind: "failed", message: (e instanceof Error ? e.message : String(e)) });
    } finally { abort.current = null; }
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
  const fileName = company && template ? packetBaseName(company, template, store, complete, wm.enabled ? recipient : undefined) + ".zip" : "";

  let leading: React.ReactNode = null;
  if (building) {
    leading = <div className="col gap6" style={{ width: 360 }}>
      <span className="t-meta num ellipsis" style={{ fontWeight: 600 }}>{progress.label ? `正在处理 ${progress.label}` : "正在准备…"}<span className="muted" style={{ fontWeight: 400 }}>　{Math.min(progress.done + 1, progress.total)} / {progress.total}</span></span>
      <ProgressBar value={progress.total ? progress.done / progress.total : 0} label="导出进度" />
    </div>;
  } else if (choosing && wm.enabled) {
    leading = <div className="col gap6" style={{ minWidth: 0 }}>
      <span className="t-meta ellipsis selectable" data-tip={fileName}><span className="muted">文件名　</span>{fileName}</span>
      <div className="row gap16">
        <span className="t-meta muted num">{estimate === null ? "正在估算大小…" : `预计 ${sizeLabel(estimate)}`}</span>
        <Checkbox checked={wm.stripMeta} onChange={(stripMeta) => setWm({ ...wm, stripMeta })} title="去掉 PDF 的作者、标题、创建软件和图片的拍摄信息">清除文件元数据</Checkbox>
      </div>
    </div>;
  } else if (phase.kind === "failed") leading = <Button onClick={() => setPhase({ kind: "choosing" })}>返回清单</Button>;
  else if (phase.kind === "done") {
    leading = <>
      <Button onClick={() => void platform().reveal(phase.path)}>{platform().os === "windows" ? "在资源管理器中显示" : "在访达中显示"}</Button>
      <Button kind="accent" title="一段可直接粘贴进邮件的文字：包含哪些文件、还缺什么、预计何时补齐" onClick={() => setNote(true)}>复制发送说明</Button>
    </>;
  }
  const blocked = needsRecipient ? "水印里用了【接收方】，请先填写接收方" : undefined;
  const trailing = choosing || building ? <>
    {building ? <Button onClick={() => abort.current?.abort()}>取消</Button> : <Button onClick={onClose}>关闭</Button>}
    <Button kind="primary" disabled={!included.length || !choosing || !!blocked} title={blocked ?? (complete ? undefined : `缺 ${missing.length} 项，目录里会注明`)} onClick={() => (complete ? void build() : setConfirmPartial(true))}>
      {building ? "正在生成…" : complete ? "生成材料包" : "生成部分材料包"}</Button>
  </> : phase.kind === "failed" ? <><Button onClick={onClose}>关闭</Button><Button kind="primary" onClick={() => void build()}>重试</Button></> : <Button kind="primary" onClick={onClose}>完成</Button>;

  const toggleRowWM = (it: PacketItem) => {
    const id = packetItemID(it), e = elig[id];
    if (!e || !e.ok) return;
    if (!skipOf(id)) { setWm({ ...wm, skip: [...wm.skip.filter((x) => x !== id), id] }); setSignedOK(signedOK.filter((x) => x !== id)); return; }
    if ("signed" in e && !signedOK.includes(id)) { setAskSigned({ id, title: packetItemTitle(it, typeName(it)) }); return; }
    setWm({ ...wm, skip: wm.skip.filter((x) => x !== id) });
  };

  const listCol = <div className="col" style={{ gap: 18, minWidth: 0 }}>
    {!locked && <div className="col gap8"><span className="t-row">公司</span>
      <SelectField describe={(id) => companyInfo(store, id)} options={store.data.companies.map((c) => [c.id, c.name] as [string, string])} value={companyID} onChange={(v) => { setCompanyID(v); setTemplateID(pickTemplate(v)); }} placeholder="选择公司" minWidth={300} disabled={!choosing} />
    </div>}
    <div className="col gap10">
      <div className="row gap6"><span className="t-row grow">用途</span>
        <Button kind="quiet" size="small" icon="pencil" disabled={!template || !choosing} title="修改这个用途需要的文件类别和签发时限" onClick={() => setEditing({ id: templateID })}>编辑</Button>
        <Button kind="quiet" size="small" icon="plus" disabled={!choosing} onClick={() => setEditing({})}>新建用途</Button>
      </div>
      {!packets.length ? <span className="muted">还没有用途。点击“新建用途”，选择所需的文件类别。</span>
        : packets.length <= 4 && !wm.enabled ? <Segmented options={packets.map((p) => [p.id, p.name] as [string, string])} value={templateID} onChange={setTemplateID} />
          : <SelectField options={packets.map((p) => [p.id, p.name] as [string, string])} value={templateID} onChange={setTemplateID} placeholder="选择用途" minWidth={260} disabled={!choosing} />}
      {template && <span className="t-meta muted">{purposeSummary(template)}</span>}
    </div>
    <div className="col gap8">
      <div className="row baseline"><span className="t-row grow">清单</span>
        <span className={`t-meta ${complete ? "muted" : "amber-text"}`} style={{ fontWeight: 600 }}>需要 {items.length} 项，已选 {included.length} 项{wm.enabled ? `，${wmCount} 份加水印` : ""}</span></div>
      {!items.length ? <span className="muted" style={{ padding: "6px 0" }}>{!template ? "请先选择用途。" : !company ? "请先选择公司。" : "这个用途没有要求任何文件。"}</span> : (
        <div className="col panel-soft">
          {items.map((it, i) => {
            const id = packetItemID(it), pill = wm.enabled && it.included && it.document ? eligibilityPill(elig[id]) : null;
            const e = elig[id], canWM = !!e && e.ok;
            return <div key={id}>
              {i > 0 && <div className="hairline" style={{ marginLeft: 14 }} />}
              <div className="row gap10" style={{ padding: "10px 14px", minHeight: 44 }}>
                <span className={`grow ${it.document ? "" : "muted"}`} style={{ minWidth: 0 }}>
                  <Checkbox checked={it.included} disabled={!it.document || !choosing} onChange={(on) => setItems(items.map((x, k) => (k === i ? { ...x, included: on } : x)))}>
                    <span style={{ fontWeight: 500 }}>{packetItemTitle(it, typeName(it))}</span>
                  </Checkbox>
                </span>
                {pill && <Pill text={pill.text} kind={pill.kind} />}
                {!wm.enabled || !it.included || !it.document
                  ? <span className={`t-meta ${it.problem ? "amber-text" : "muted"}`} style={{ textAlign: "right", fontWeight: it.problem ? 600 : 400, maxWidth: 200 }}>{it.problem ?? (it.included ? recencyText(it) : "未选入")}</span>
                  : <button className="wm-row-toggle" role="checkbox" aria-checked={!skipOf(id)} disabled={!canWM || !choosing} aria-label={`给「${packetItemTitle(it, typeName(it))}」加水印`}
                      data-tip={!canWM ? (e && !e.ok ? `${e.label}，原样放入` : "正在检查…") : skipOf(id) ? "不加水印" : "加水印"} onClick={() => toggleRowWM(it)}>
                      <Icon name="checkmark" size={11} strokeWidth={3.5} /></button>}
              </div>
            </div>;
          })}
        </div>
      )}
    </div>
    <div className="row gap12 panel-soft" style={{ padding: "12px 14px" }}>
      <span className="col grow" style={{ gap: 2 }}><span className="t-row">加水印</span><span className="t-meta muted">{wm.enabled ? "只处理导出的副本，原件不变。" : "在导出的副本上加“仅供某用途使用”之类的文字，原件不变。"}</span></span>
      <Switch checked={wm.enabled} disabled={!choosing} onChange={(enabled) => { setWm({ ...wm, enabled }); if (enabled) setPreviewTab("wm"); else setPreviewTab("toc"); }} />
    </div>
  </div>;

  const statusNote = phase.kind === "failed" ? <Note tone="warn"><b>文件包生成失败</b><span className="t-meta selectable">{phase.message}</span></Note>
    : phase.kind === "done" ? <Note tone={phase.complete ? "ok" : "warn"}><b>{phase.complete ? "已生成完整材料包" : `已生成部分材料包，缺 ${phase.missing} 项。目录里已列出缺件。`}</b><span className="t-meta selectable">{phase.path.split(/[\\/]/).pop()}</span></Note> : null;

  const toc = <div className="col panel" style={{ padding: 24 }}>
    <div className="row gap10"><span className="t-meta muted grow" style={{ fontWeight: 600 }}>目录预览</span>
      {!complete && items.length > 0 && <Pill text={`部分材料包，缺 ${missing.length} 项`} kind="warn" />}
    </div>
    <span className="t-title" style={{ marginTop: 14 }}>{company?.name ?? "未选公司"}</span>
    <span className="t-body muted">{template?.name ?? ""}文件包，{D.long(store.today)}</span>
    <span className="t-row" style={{ marginTop: 20 }}>已包含（{included.length} 份）</span>
    {included.map((it, i) => (
      <div key={packetItemID(it)} className="row start gap10" style={{ padding: "5px 0" }}>
        <span className="num muted">{String(i + 1).padStart(2, "0")}</span>
        <span className="col" style={{ gap: 2 }}><span>{packetItemTitle(it, typeName(it))}</span><span className={`t-meta ${it.problem ? "amber-text" : "muted"}`}>{recencyText(it)}</span></span>
      </div>
    ))}
    {!included.length && <span className="muted" style={{ padding: "5px 0" }}>还没有选入任何文件。</span>}
    {missing.length > 0 && <>
      <span className="t-row amber-text" style={{ marginTop: 18 }}>尚缺（{missing.length} 项）</span>
      {missing.map((it) => <div key={packetItemID(it)} className="row baseline gap10" style={{ padding: "5px 0" }}><span className="amber-text">—</span><span className="grow">{packetItemTitle(it)}</span><span className="t-meta amber-text" style={{ fontWeight: 600, textAlign: "right" }}>{packetReason(it)}</span></div>)}
    </>}
    {wm.enabled && <>
      <span className="t-row" style={{ marginTop: 18 }}>水印（{wmCount} / {included.length} 份）</span>
      <span className="t-meta muted" style={{ padding: "5px 0" }}>目录本身不加水印，只在这里注明水印文字和每份文件的处理方式。</span>
    </>}
  </div>;

  const previewCol = <div className="col gap12" style={{ minWidth: 0 }}>
    {statusNote}
    {wm.enabled && <Tabs tabs={[["wm", "水印预览"], ["toc", "目录预览"]]} value={previewTab} onChange={setPreviewTab} />}
    {wm.enabled && previewTab === "wm" && company && template ? <WatermarkPreview items={items} template={template} company={company} store={store} wm={effective} recipient={recipient} /> : toc}
    {wm.enabled && previewTab === "wm" && included.some((i) => kindOf(store.fileURL(i.document!)) === "other") && <Note tone="warn">Word、Excel 等文件无法加水印，会原样放入，并在目录里注明。</Note>}
  </div>;

  const settingsCol = <div className="col" style={{ minWidth: 0 }}>
    <WatermarkSettingsPanel wm={wm} onChange={setWm} recipient={recipient} onRecipient={setRecipient} />
  </div>;

  return (
    <Modal onClose={() => !building && onClose()} dismissOnEscape={!building}>
      <SheetScaffold title="准备文件包" subtitle={locked && company ? `${company.name}。按用途挑选每类文件的最新版本，并标出缺少的文件。` : "按用途挑选每类文件的最新版本，并标出缺少的文件。"}
        width={wm.enabled ? 1336 : 1000} height={wm.enabled ? 840 : 780} leading={leading} trailing={trailing}>
        <div ref={host} style={{ minWidth: 0 }}>
          {narrow ? <div className="col gap16">
            <Tabs tabs={wm.enabled ? [["list", "清单"], ["wm", "水印"], ["preview", "预览"]] : [["list", "清单"], ["preview", "预览"]]} value={pane} onChange={setPane} />
            {pane === "list" ? listCol : pane === "wm" && wm.enabled ? settingsCol : previewCol}
          </div> : <div className="row start gap24">
            <div style={{ width: wm.enabled ? 380 : 420, flex: "none" }}>{listCol}</div>
            {wm.enabled && <div style={{ width: 340, flex: "none" }}>{settingsCol}</div>}
            <div className="grow" style={{ minWidth: 0 }}>{previewCol}</div>
          </div>}
        </div>
      </SheetScaffold>
      {confirmPartial && <ConfirmSheet title="生成部分材料包？" message={`目录和文件名会标明“部分材料包”，并列出缺少的 ${missing.length} 项。`} confirmTitle="生成部分材料包" onClose={() => setConfirmPartial(false)} onConfirm={() => { setConfirmPartial(false); void build(); }} />}
      {askSigned && <SignedConfirm title={askSigned.title} onClose={() => setAskSigned(null)} onConfirm={() => { setSignedOK([...signedOK, askSigned.id]); setWm({ ...wm, skip: wm.skip.filter((x) => x !== askSigned.id) }); }} />}
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
          {working && <Note icon="archivebox"><b className="num">{progress.total ? `正在写入 ${progress.done} / ${progress.total}…` : "正在准备目录…"}</b><ProgressBar value={progress.total ? progress.done / progress.total : 0} label="导出进度" /></Note>}
          {result && <Note tone="ok"><b>已导出</b><span className="t-meta selectable">{result.split(/[\\/]/).pop()}</span></Note>}
          {failure && <Note tone="warn"><b>导出失败</b><span className="t-meta selectable">{failure}</span></Note>}
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

export function DocumentSheet({ documentID, onClose }: { documentID: string; onClose: () => void }) {
  const { store, router } = useApp();
  const [linking, setLinking] = useState(false);
  const orig = store.data.documents.find((d) => d.id === documentID);
  const [doc, setDoc] = useState<Document | undefined>(orig ? { ...orig } : undefined);
  const [reissue, setReissue] = useState(false);
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
  const ruleExpiry = !doc.expiryDate ? expiryOf(doc, t) : undefined;
  const needsReissue = f.kind === "expired" || f.kind === "expiring" || f.kind === "needsUpdate";
  const waiting = store.openRequest(doc.owner, doc.typeID);
  const save = async () => {
    try {
      const u = await store.updateDocument(doc);
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
            ...(store.fileMissing(doc) ? [item("重新定位…", "folder", () => void store.relocateDocument(doc))] : [item("打开", "arrow.up.forward.app", () => void store.openDocument(doc)),
              item(reveal, "folder", () => void store.revealDocument(doc))]),
            item("归档新版…", "square.and.arrow.up", () => void startStage({ typeID: doc.typeID, owner: doc.owner, replaces: doc, form: doc.form, onArchived: (n) => setDoc({ ...n }) })),
            divider,
            item("移到废纸篓…", "trash", () => { onClose(); setTimeout(() => router.open({ kind: "trashDocs", ids: [doc.id] }), 150); }, { destructive: true }),
          ]} />
          {saveError && <span className="row gap6 t-meta amber-text" title={saveError} aria-label={`无法保存：${saveError}`}><Icon name="exclamationmark.triangle.fill" /><span className="ellipsis" style={{ maxWidth: 240 }}>{saveError}</span></span>}
        </>}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={() => void save()}>保存</Button></>}>
        <div className="row start" style={{ gap: 22 }}>
          <div style={{ width: 380, height: 540, flex: "none", borderRadius: "var(--r-control)", overflow: "hidden", background: "var(--band)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}><FilePreview key={doc.filePath + (store.fileMissing(doc) ? "#missing" : "")} path={store.fileURL(doc)} onOpenOriginal={() => void store.openDocument(doc)}
            onRelocate={() => void store.relocateDocument(doc)} onReissue={() => void startStage({ typeID: doc.typeID, owner: doc.owner, replaces: doc, form: doc.form, onArchived: (n) => setDoc({ ...n }) })} /></div>
          <div className="col grow gap16" style={{ minWidth: 0 }}>
            <div className="row gap8 wrap"><StatusTag s={statusOfFreshness(f)} />{doc.needsUpdate && f.kind !== "needsUpdate" && <StatusTag s={statusOfFreshness({ kind: "needsUpdate" })} />}<ExtraTags d={doc} t={store.docType(doc.typeID)} /></div>
            <FormGroup title="文件">
              <FieldRow label="类型"><SelectField options={typeChoices} value={doc.typeID} onChange={(typeID) => set({ typeID })} minWidth={260} /></FieldRow>
              <FieldRow label="归属"><SelectField describe={(r) => refInfo(store, r)} options={owners.map((r) => [r, store.nameOf(r)] as [NodeRef, string])} value={doc.owner} onChange={(owner) => set({ owner })} minWidth={260} keyOf={(r) => `${r.kind}:${r.id}`} /></FieldRow>
              <FieldRow label="形态"><SelectField options={formChoices.map((x) => [x, x] as [string, string])} value={doc.form} onChange={(form) => set({ form })} minWidth={260} /></FieldRow>
            </FormGroup>
            <FormGroup title="日期">
              <FieldRow label="签发日期"><DateField value={doc.issueDate} onChange={(issueDate) => set({ issueDate })} /></FieldRow>
              {(() => {
                // 5.3.2：到期日提示按类型说清楚——留空是否算长期
                const v = store.docType(doc.typeID)?.validity;
                const fixed = v === "permanent" || v === "untilChanged";
                const onDoc = !fixed && !ruleExpiry;
                return <>
                  <FieldRow label="到期日期" hint={ruleExpiry ? `留空时按规则算出：${D.long(ruleExpiry)}` : fixed ? "这类文件长期有效，不用填。" : onDoc && !doc.expiryDate && !doc.noExpiry ? "留空会算作“未填日期”，计入需处理。" : undefined}>
                    <DateField value={doc.expiryDate} onChange={(expiryDate) => set({ expiryDate, ...(expiryDate ? { noExpiry: undefined } : {}) })}
                      placeholder={fixed ? "长期有效，无需填写" : ruleExpiry ? "留空按规则计算" : doc.noExpiry ? "长期有效" : "填写文件上的到期日"} relativeTo={doc.issueDate} />
                  </FieldRow>
                  {onDoc && <Checkbox checked={!!doc.noExpiry && !doc.expiryDate} disabled={!!doc.expiryDate} title={doc.expiryDate ? "已填写到期日" : undefined}
                    onChange={(on) => set({ noExpiry: on || undefined })}>文件上写明长期有效 / 没有到期日</Checkbox>}
                </>;
              })()}
            </FormGroup>
            <FormGroup title="状态与备注">
              <Switch checked={doc.needsUpdate} onChange={(needsUpdate) => set({ needsUpdate })}>信息有变更，需要重开</Switch>
              {store.docType(doc.typeID)?.requiresSignature && <FieldRow label="签署日期" hint="这类文件需要签署；留空表示待签署。"><DateField value={doc.signedOn} onChange={(signedOn) => set({ signedOn })} placeholder="待签署" /></FieldRow>}
              <FieldRow label="核实" hint="与原件（或经认证副本）核对过的日期。"><DateField value={doc.verifiedOn} onChange={(verifiedOn) => set({ verifiedOn })} placeholder="未核实" /></FieldRow>
              <FieldRow label="备注"><TextField multiline rows={2} value={doc.notes} onChange={(notes) => set({ notes })} placeholder="可选" /></FieldRow>
            </FormGroup>
            <FormGroup title="证据关联">
              <div className="row gap8 wrap"><LinkChips doc={doc} onEdit={() => setLinking(true)} /><Button size="small" kind="quiet" onClick={() => setLinking(true)}>编辑关联…</Button></div>
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
      {linking && orig && <EvidenceSheet doc={orig} onClose={() => setLinking(false)} />}
    </Modal>
  );
}
