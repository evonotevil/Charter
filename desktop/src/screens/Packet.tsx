// 文件包、用途编辑、导出全部档案、文件详情。移植自 PacketView.swift、PurposeEditor.swift、ExportSheet.swift、DocumentSheet.swift。

import { ExtraTags, StatusTag, statusOfFreshness } from "./Status";
import { useEffect, useRef, useState } from "react";
import { FilePreview } from "./FilePreview";
import * as D from "../domain/day";
import { type Document, type NodeRef, type PacketTemplate, type PacketWatermark, archiveStateLabel, ref, sameRef, stateNeedsAttention, typeAppliesTo, latinPadEnd } from "../domain/models";
import { expiryOf, freshnessLabel } from "../domain/engine";
import { EvidenceSheet, LinkChips } from "./Evidence";
import { useApp } from "../state/hooks";
import { type PacketItem, buildPacket, packetBaseName, wmContext, exportAll, exportPlan, packetIncluded, packetItemID, packetItemTitle, packetItems, packetMissing, packetReason, recencyText } from "../services/packets";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { ActionMenu, Button, Checkbox, type Fate, FileFate, Note, OptionCard, ProgressBar, StepBar, Tabs, useNarrow, ConfirmSheet, CopyTextSheet, DateField, FieldRow, FormGroup, Modal, Pill, Segmented, SelectField, SheetScaffold, Switch, TextField, divider, item } from "../ui/kit";
import { defaultPacketWatermark, inked, eligibilityPill, type PreviewFile, useEligibility, WatermarkPreview, WatermarkSettingsPanel, SignedConfirm } from "./PacketWatermark";
import { estimateSize, kindOf, resolveText, sizeLabel } from "../services/watermark";
import { ReissueRequestSheet, freshnessPill, statePill, useStageFile, refInfo, companyInfo } from "./common";

const lastPurposeKey = (cid: string) => `packet.lastPurpose.${cid}`;

export function purposeSummary(p: PacketTemplate): string {
  const parts = [p.categories.length ? "需要" + p.categories.join("、") : "未选文件类别"];
  if (p.includeDirectorsPassports) parts.push("附现任董事护照");
  if (p.maxAgeMonths) parts.push(`限时文件须在 ${p.maxAgeMonths} 个月内签发`);
  return parts.join("；") + "。";
}

type Phase = { kind: "choosing" } | { kind: "building" } | { kind: "failed"; message: string } | { kind: "done"; path: string; complete: boolean; missing: number; files: number; watermarked: number };
type RowState = { state: "wait" | "run" | "done"; note: string };
const lastDirKey = "packet.lastDir";

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
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [rowState, setRowState] = useState<RowState[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [confirmPartial, setConfirmPartial] = useState(false);
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const [reissue, setReissue] = useState<{ owner: NodeRef; typeIDs: string[] } | null>(null);
  const [note, setNote] = useState(false);
  const company = store.company(companyID);
  const template = packets.find((p) => p.id === templateID);
  const [wm, setWmLocal] = useState<PacketWatermark>(() => template?.watermark ?? defaultPacketWatermark());
  const [recipient, setRecipient] = useState(initialRecipient ?? "");
  const [signedOK, setSignedOK] = useState<string[]>([]);
  const [askSigned, setAskSigned] = useState<{ id: string; title: string } | null>(null);
  const [step, setStepRaw] = useState(0);
  const [dir, setDir] = useState<"r" | "l">("r");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [focusRecipient, setFocusRecipient] = useState(false);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [askClose, setAskClose] = useState(false);
  const lastDir = platform().prefGet(lastDirKey);
  const [dest, setDest] = useState<{ kind: "packets" } | { kind: "last"; dir: string } | { kind: "path"; path: string }>({ kind: "packets" });
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { setWmLocal(template?.watermark ?? defaultPacketWatermark()); setSignedOK([]); }, [templateID]);
  const setWm = (w: PacketWatermark) => {
    setWmLocal(w); clearTimeout(saveTimer.current);
    const id = templateID;
    saveTimer.current = setTimeout(() => store.saveLibrary((l) => { const t = l.packets.find((x) => x.id === id); if (t) t.watermark = structuredClone(w) as never; }), 400);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  const reload = () => { setItems(company && template ? packetItems(template, company, store) : []); setPhase({ kind: "choosing" }); setStepRaw(0); };
  useEffect(reload, [companyID, templateID]);
  const included = packetIncluded(items), missing = packetMissing(items);
  const complete = missing.length === 0;
  const elig = useEligibility(items, store);
  const canWM = (id: string) => { const e = elig[id]; return !!e && e.ok; };
  const skipOf = (id: string) => { const e = elig[id]; return wm.skip.includes(id) || !e || !e.ok || ("signed" in e && !signedOK.includes(id)); };
  const wmItems = wm.enabled ? included.filter((i) => !skipOf(packetItemID(i))) : [];
  const effective: PacketWatermark = { ...wm, settings: inked(wm.settings), skip: items.map(packetItemID).filter(skipOf) };
  const needsRecipient = wm.enabled && wm.settings.parts.some((p) => p.kind === "tag" && p.tag === "recipient") && !recipient.trim();
  const steps = wm.enabled ? ["选文件", "水印", "导出"] : ["选文件", "导出"];
  const stage = wm.enabled ? (["files", "watermark", "export"] as const)[step] : (["files", "export"] as const)[Math.min(step, 1)];
  const go = (n: number) => { setDir(n > step ? "r" : "l"); setStepRaw(n); };
  useEffect(() => {
    if (stage !== "export") return; let live = true;
    void Promise.all(included.map(async (i) => { const st = await platform().stat(store.fileURL(i.document!)); const bytes = st.size ?? 0; const flat = wm.enabled && wm.settings.flatten && !skipOf(packetItemID(i)) && kindOf(store.fileURL(i.document!)) === "pdf"; return { bytes, pages: Math.max(1, Math.round(bytes / 60_000)), flatten: flat }; }))
      .then((r) => live && setEstimate(estimateSize(r) + 40_000));
    return () => { live = false; };
  }, [stage, wm.settings.flatten, included.length, effective.skip.join()]);
  const typeName = (i: PacketItem) => (i.document ? store.docType(i.document.typeID)?.name : undefined);
  const title = (i: PacketItem) => packetItemTitle(i, typeName(i));
  const fateOf = (it: PacketItem): Fate => (!it.included ? "omit" : wm.enabled && !skipOf(packetItemID(it)) ? "wm" : "asis");
  const setFate = (i: number, f: Fate) => {
    const it = items[i], id = packetItemID(it);
    setItems(items.map((x, k) => (k === i ? { ...x, included: f !== "omit" } : x)));
    if (f === "wm") {
      const e = elig[id];
      if (e && e.ok && "signed" in e && !signedOK.includes(id)) { setAskSigned({ id, title: title(it) }); return; }
      if (wm.skip.includes(id)) setWm({ ...wm, skip: wm.skip.filter((x) => x !== id) });
    } else if (f === "asis" && wm.enabled && !wm.skip.includes(id)) { setWm({ ...wm, skip: [...wm.skip, id] }); setSignedOK(signedOK.filter((x) => x !== id)); }
  };
  const previewFiles: PreviewFile[] = wmItems.map((i) => ({ id: packetItemID(i), title: title(i), url: store.fileURL(i.document!), kind: kindOf(store.fileURL(i.document!)) === "image" ? "image" : "pdf",
    text: company && template ? resolveText(wm.settings, wmContext(i, template, company, store, recipient)) : "" }));
  const fileName = company && template ? packetBaseName(company, template, store, complete, wm.enabled ? recipient : undefined) + ".zip" : "";
  const destLabel = dest.kind === "path" ? dest.path.replace(/[\\/][^\\/]*$/, "") : dest.kind === "last" ? dest.dir : store.folder.packetsDir;
  const shownName = dest.kind === "path" ? dest.path.split(/[\\/]/).pop()! : nameEdit ?? fileName;
  const build = async () => {
    if (!company || !template) return;
    if (dest.kind !== "path") { const d = dest.kind === "last" ? dest.dir : store.folder.packetsDir; if (!(await platform().stat(d)).exists) { setPhase({ kind: "failed", message: `找不到保存位置：${d}。请换一个位置。` }); return; } }
    const ac = new AbortController(); abort.current = ac;
    setRowState(included.map(() => ({ state: "wait", note: "等待" })));
    setProgress({ done: 0, total: included.length + 1 }); setStartedAt(Date.now());
    setPhase({ kind: "building" });
    try {
      const path = await buildPacket(items, template, company, store, {
        watermark: wm.enabled ? { wm: effective, recipient } : undefined, signal: ac.signal,
        outDir: dest.kind === "last" ? dest.dir : undefined, outPath: dest.kind === "path" ? dest.path : undefined, outName: nameEdit ?? undefined, stripMeta: wm.stripMeta,
        onProgress: (done, total) => setProgress({ done, total }),
        onItem: (i, state, n) => setRowState((rs) => rs.map((r, k) => (k === i ? { state, note: state === "run" ? (n ? `处理中 · ${n}` : "处理中") : n } : r))),
      });
      if (dest.kind !== "packets") platform().prefSet(lastDirKey, dest.kind === "path" ? path.replace(/[\\/][^\\/]*$/, "") : dest.dir);
      platform().prefSet(lastPurposeKey(company.id), template.id);
      const rec = store.data.sends[0];
      setPhase({ kind: "done", path, complete, missing: missing.length, files: included.length, watermarked: rec?.path === path ? rec.watermarked : 0 });
    } catch (e) {
      if (ac.signal.aborted) { setPhase({ kind: "choosing" }); store.showToast("已取消，未生成文件"); }
      else setPhase({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
    } finally { abort.current = null; }
  };
  const sendNote = () => {
    const lines = [`${company?.name ?? ""} ${latinPadEnd(template?.name ?? "")}文件包（${D.long(store.today)}）`, "", `已包含（${included.length} 份）：`,
      ...included.map((it, i) => `${String(i + 1).padStart(2, "0")} ${title(it)}${it.document?.issueDate ? `，${D.long(it.document.issueDate)}签发` : ""}`)];
    if (missing.length) lines.push("", `尚缺（${missing.length} 项）：`, ...missing.map((it) => `— ${packetItemTitle(it)}：${packetReason(it)}`), "", "缺少的文件补齐后另行发送。");
    return lines.join("\n");
  };
  const building = phase.kind === "building";
  const elapsed = (Date.now() - startedAt) / 1000;
  const remain = progress.done > 0 ? Math.max(1, Math.round((elapsed / progress.done) * (progress.total - progress.done))) : null;

  const toc = <div className="col panel" style={{ padding: 22, gap: 2 }}>
    <span className="t-label muted">目录预览</span>
    <span className="t-title" style={{ marginTop: 8 }}>{company?.name ?? "未选公司"}</span>
    <span className="t-meta muted">{template?.name ?? ""}文件包 · {D.long(store.today)}</span>
    <span className="t-row" style={{ marginTop: 14 }}>已包含（{included.length} 份）</span>
    {included.map((it, i) => <div key={packetItemID(it)} className="row gap10" style={{ padding: "3px 0" }}><span className="num faint t-meta">{String(i + 1).padStart(2, "0")}</span><span>{title(it)}</span></div>)}
    {!included.length && <span className="muted" style={{ padding: "3px 0" }}>还没有放入任何文件。</span>}
    {missing.length > 0 && <><span className="t-row amber-text" style={{ marginTop: 12 }}>尚缺（{missing.length} 项）</span>
      {missing.map((it) => <span key={packetItemID(it)} className="amber-text" style={{ padding: "3px 0" }}>— {packetItemTitle(it)}</span>)}</>}
    {wm.enabled && <><span className="t-row" style={{ marginTop: 12 }}>水印（{wmItems.length} / {included.length} 份）</span>
      <span className="t-meta muted">目录本身不加水印，这里会注明每份文件的处理方式。</span></>}
  </div>;

  // ---------- ① 选文件 ----------
  const filesStep = <div className="row start gap24">
    <div className="col grow" style={{ gap: 16, minWidth: 0 }}>
      {!locked && <div className="row gap12"><span className="t-row grow">公司</span>
        <SelectField describe={(id) => companyInfo(store, id)} options={store.data.companies.map((c) => [c.id, c.name] as [string, string])} value={companyID} onChange={(v) => { setCompanyID(v); setTemplateID(pickTemplate(v)); }} placeholder="选择公司" minWidth={300} /></div>}
      <div className="row gap12"><span className="t-row grow">用途</span>
        {packets.length <= 4 ? <Segmented options={packets.map((p) => [p.id, p.name] as [string, string])} value={templateID} onChange={setTemplateID} />
          : <SelectField options={packets.map((p) => [p.id, p.name] as [string, string])} value={templateID} onChange={setTemplateID} placeholder="选择用途" minWidth={240} />}
        <Button kind="quiet" size="small" disabled={!template} title="修改这个用途需要的文件类别和签发时限" onClick={() => setEditing({ id: templateID })}>编辑</Button>
        <Button kind="quiet" size="small" onClick={() => setEditing({})}>新建</Button>
      </div>
      <div className="row gap12">
        <span className="col grow" style={{ gap: 2 }}><span className="t-row">水印</span><span className="t-meta muted">{wm.enabled ? "下一步设置水印文字和样式，只处理导出的副本。" : "导出的副本不加水印。"}</span></span>
        <Segmented options={[[false, "不加水印"], [true, "加水印"]]} value={wm.enabled} onChange={(enabled) => setWm({ ...wm, enabled })} />
      </div>
      <div className="row baseline" style={{ paddingTop: 4 }}><span className="t-row grow">清单</span>
        <span className={`t-meta ${complete ? "muted" : "amber-text"}`} style={{ fontWeight: 600 }}>需要 {items.length} 项 · 放入 {included.length} 份{wm.enabled ? ` · ${wmItems.length} 份加水印` : ""}</span></div>
      {!items.length ? <span className="muted">{!template ? "请先选择用途。" : !company ? "请先选择公司。" : "这个用途没有要求任何文件。"}</span> :
        <div className="col panel-soft">
          {items.map((it, i) => {
            const id = packetItemID(it), pill = wm.enabled && it.document ? eligibilityPill(elig[id]) : null;
            return <div key={id}>
              {i > 0 && <div className="hairline" style={{ marginLeft: 16 }} />}
              <div className={`row gap12 ${fateOf(it) === "wm" && wm.enabled ? "pointer" : ""}`} style={{ padding: "9px 14px 9px 16px", minHeight: 52 }}
                onClick={() => { const k = wmItems.findIndex((x) => packetItemID(x) === id); if (k >= 0) setPreviewIndex(k); }}>
                <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
                  <span className="row gap8"><span className={`t-row ellipsis ${it.document ? "" : "muted"}`}>{title(it)}</span>{pill && <Pill text={pill.text} kind={pill.kind} />}</span>
                  <span className={`t-meta ${it.problem ? "amber-text" : "muted"}`}>{it.problem ?? recencyText(it)}</span>
                </span>
                {it.document ? <span onClick={(e) => e.stopPropagation()}><FileFate label={title(it)} value={fateOf(it)} onChange={(f) => setFate(i, f)} limited={!wm.enabled || !canWM(id)} /></span>
                  : null}
              </div>
            </div>;
          })}
        </div>}
    </div>
    <div style={{ width: 340, flex: "none" }}>{toc}</div>
  </div>;

  // ---------- ② 水印 ----------
  const watermarkStep = <div className="row start" style={{ gap: 36 }}>
    <div style={{ width: 380, flex: "none" }}><WatermarkSettingsPanel wm={wm} onChange={setWm} recipient={recipient} onRecipient={setRecipient} focusRecipient={focusRecipient} onFocused={() => setFocusRecipient(false)} /></div>
    <div className="col grow gap12" style={{ minWidth: 0 }}>
      <WatermarkPreview files={previewFiles} index={Math.min(previewIndex, Math.max(0, previewFiles.length - 1))} onIndex={setPreviewIndex} settings={inked(wm.settings)} />
      {included.some((i) => kindOf(store.fileURL(i.document!)) === "other") && <Note>Word、Excel 等文件无法加水印，会原样放入，并在目录里注明。</Note>}
    </div>
  </div>;

  // 能清除文件信息的份数：可读的 PDF / 图片；带签名且不加水印的 PDF 保留原样。
  const cleanable = included.filter((i) => { const id = packetItemID(i), e = elig[id]; return !!e && e.ok && !("signed" in e && fateOf(i) !== "wm"); });
  const notCleanable = included.length - cleanable.length;
  // ---------- ③ 导出 ----------
  const blocked = needsRecipient ? "水印里用了【接收方】，请先在“水印”一步填写接收方" : !included.length ? "还没有放入任何文件" : undefined;
  const pickPath = async () => { const p = await platform().saveDialog({ defaultName: shownName, extensions: ["zip"], title: "保存材料包" }); if (p) setDest({ kind: "path", path: p }); };
  const exportStep = <div className="row start gap24">
    <div className="col grow" style={{ gap: 20, minWidth: 0 }}>
      {building ? <>
        <div className="row baseline gap8"><span className="t-title grow">正在生成…</span><span className="t-meta muted num">第 {Math.min(progress.done + 1, included.length)} / {included.length} 份{remain ? ` · 约 ${remain} 秒` : ""}</span></div>
        <ProgressBar value={progress.total ? progress.done / progress.total : 0} label="导出进度" />
        <div className="col panel-soft">
          {included.map((it, i) => { const r = rowState[i] ?? { state: "wait", note: "等待" }; return <div key={packetItemID(it)}>
            {i > 0 && <div className="hairline" style={{ marginLeft: 16 }} />}
            <div className="row gap12" style={{ padding: "10px 16px" }}>
              {r.state === "run" ? <span className="run-ring" aria-hidden /> : r.state === "done" ? <span className="state-dot done tick-pop" aria-hidden><Icon name="checkmark" size={12} /></span> : <span className="state-dot wait" aria-hidden />}
              <span className={`grow ${r.state === "wait" ? "muted" : "t-row"}`}>{title(it)}</span>
              <span className={`t-meta ${r.state === "run" ? "run-note" : "muted"}`}>{r.note}</span>
            </div></div>; })}
        </div>
        <span className="t-meta muted">每份文件处理完会打勾；取消后不会留下半成品。</span>
      </> : <>
        {phase.kind === "failed" && <Note tone="warn"><b>没有生成材料包</b><span className="t-meta selectable">{phase.message}</span></Note>}
        <section className="col gap8"><span className="t-row">保存到</span>
          <div className="row gap10">
            <SelectField options={[["packets", "材料包文件夹"] as [string, string], ...(lastDir ? [["last", "上次的位置"] as [string, string]] : []), ...(dest.kind === "path" ? [["path", "自选位置"] as [string, string]] : [])]}
              value={dest.kind} onChange={(v) => setDest(v === "last" && lastDir ? { kind: "last", dir: lastDir } : v === "path" ? dest : { kind: "packets" })} minWidth={180} />
            <div className="row gap8 grow t-meta muted" style={{ minWidth: 0, height: 40, padding: "0 12px", borderRadius: "var(--r-input)", background: "var(--surface-sunken)" }}><Icon name="folder" size={14} /><span className="ellipsis selectable" data-tip={destLabel}>{destLabel}</span></div>
            <Button size="small" onClick={() => void pickPath()}>更改…</Button>
          </div>
          <span className="t-meta muted">下拉里可选“上次的位置”；“更改…”打开系统存储窗口。</span>
        </section>
        <section className="col gap8"><span className="t-row">文件名</span>
          <TextField value={shownName} onChange={(v) => { if (dest.kind === "path") setDest({ kind: "path", path: dest.path.replace(/[^\\/]*$/, v) }); else setNameEdit(v); }} />
          <span className="t-meta muted">可以直接修改{wm.enabled && recipient ? "；接收方已写进文件名" : ""}。</span></section>
        <section className="col gap8"><span className="t-row">导出选项</span>
          <div className="row gap12 start">
            <OptionCard checked={wm.stripMeta} onChange={(stripMeta) => setWm({ ...wm, stripMeta })} icon="checkmark.shield" title="清除文件信息">去掉 PDF 的作者、标题、创建软件和照片的拍摄地点、时间。{wm.stripMeta ? ` 将清除 ${cleanable.length} / ${included.length} 份。` : ""}{notCleanable > 0 ? `带电子签名（不加水印时）、加密的 PDF 和 Word、Excel 等文件不会清除${wm.stripMeta ? `（${notCleanable} 份）` : ""}，目录里会逐份注明。` : ""}</OptionCard>
            {wm.enabled && <OptionCard checked={wm.settings.flatten} onChange={(flatten) => setWm({ ...wm, settings: { ...wm.settings, flatten } })} icon="doc.richtext" title="压平">每页转成图片再合成水印，水印无法被编辑器删除。文字不能再选中，文件会变大。</OptionCard>}
          </div></section>
        {blocked && <Note tone="warn" action={needsRecipient && wm.enabled ? <Button size="small" onClick={() => { go(1); setFocusRecipient(true); }}>去填写</Button> : undefined}>
          <b>还不能生成</b><span>{needsRecipient ? "水印文字里用了【接收方】，但还没有填写接收方。" : "还没有放入任何文件，请回到第一步选择。"}</span></Note>}
        <div className="row gap16" style={{ padding: "12px 16px", borderRadius: "var(--r-control)", background: "var(--surface-sunken)" }}>
          <span className="t-row">{estimate === null ? "正在估算大小…" : `预计 ${sizeLabel(estimate)}`}</span>
          <span className="t-meta muted">{included.length} 份文件{wm.enabled ? ` · ${wmItems.length} 份加水印` : ""}</span></div>
      </>}
    </div>
    <div style={{ width: 340, flex: "none" }}>{toc}</div>
  </div>;

  const doneView = phase.kind === "done" && <div className="col" style={{ alignItems: "center", justifyContent: "center", minHeight: 460 }}>
    <div className="col panel rise-in" style={{ width: 560, padding: 32, gap: 14, alignItems: "center", textAlign: "center" }}>
      <span className="tick-pop" style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--green-soft)", color: "var(--green-text)", display: "inline-flex", alignItems: "center", justifyContent: "center", animationDelay: "160ms" }}><Icon name="checkmark" size={28} /></span>
      <span className="t-headline">{phase.complete ? "已生成材料包" : "已生成部分材料包"}</span>
      <span className="t-meta muted selectable">{phase.path.split(/[\\/]/).pop()}</span>
      <div className="row gap8" style={{ justifyContent: "center" }}><Pill text={`${phase.files} 份文件`} kind="neutral" />{phase.watermarked > 0 && <Pill text={`${phase.watermarked} 份已加水印`} kind="valid" />}{phase.missing > 0 && <Pill text={`缺 ${phase.missing} 项`} kind="warn" />}</div>
      <span className="t-meta muted">已记入公司页“材料包发送记录”。</span>
      <div className="row gap10" style={{ paddingTop: 6 }}>
        <Button onClick={() => void platform().reveal(phase.path)}>{platform().os === "windows" ? "在资源管理器中显示" : "在访达中显示"}</Button>
        <Button onClick={() => setNote(true)}>复制发送说明</Button>
      </div>
    </div>
  </div>;

  const lastStep = steps.length - 1;
  const leading = phase.kind === "done" || building || step === 0 ? null : <Button kind="quiet" onClick={() => go(step - 1)}>上一步</Button>;
  const requestClose = () => (building ? setAskClose(true) : onClose());
  const trailing = phase.kind === "done" ? <Button kind="primary" onClick={onClose}>完成</Button>
    : building ? <><Button onClick={() => abort.current?.abort()}>取消</Button><Button kind="primary" disabled>正在生成…</Button></>
    : step < lastStep ? <Button kind="primary" disabled={!included.length} onClick={() => { if (stage === "watermark" && needsRecipient) { setFocusRecipient(true); return; } go(step + 1); }}>{`下一步：${steps[step + 1]}`}</Button>
    : <Button kind="primary" softDisabled={!!blocked} title={blocked} onClick={() => (complete ? void build() : setConfirmPartial(true))}>{phase.kind === "failed" ? "重试" : complete ? "生成材料包" : "生成部分材料包"}</Button>;

  return (
    <Modal onClose={requestClose}>
      <SheetScaffold title="准备文件包" subtitle={company ? `${company.name} · ${template?.name ?? ""}` : "按用途挑选每类文件的最新版本"} width={1120} height={820} fixedHeight onCloseButton={requestClose}
        headerTrailing={<StepBar steps={steps} current={phase.kind === "done" ? steps.length : Math.min(step, lastStep)} />} leading={leading} trailing={trailing}>
        {phase.kind === "done" ? doneView : <div key={`${stage}`} className={dir === "r" ? "step-in-r" : "step-in-l"}>
          {stage === "files" ? filesStep : stage === "watermark" ? watermarkStep : exportStep}
        </div>}
      </SheetScaffold>
      {askClose && <ConfirmSheet title="取消导出并关闭？" message="正在生成的材料包会被丢弃，不会留下半成品。" cancelTitle="继续生成" confirmTitle="取消并关闭" destructive onClose={() => setAskClose(false)} onConfirm={() => { setAskClose(false); abort.current?.abort(); onClose(); }} />}
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
