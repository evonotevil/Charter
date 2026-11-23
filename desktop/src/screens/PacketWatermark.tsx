// 5.5：材料包水印——设置栏、预览、签名确认。设计稿见 Figma「5.5 · 材料包水印」。

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { sha256Bytes } from "../services/hash";
import type { PacketWatermark } from "../domain/models";
import { loadPdfReader } from "../services/extract";
import { emptyWatermarkMessage, type PacketItem, type WMEligibility, packetItemID, wmEligibility } from "../services/packets";
import { type WMStyle, type WatermarkSettings, defaultWatermark, drawWatermark } from "../services/watermark";
import type { Store } from "../state/store";
import { platform } from "../platform/platform";
import { PreviewPager } from "../ui/PreviewPager";
import { ConfirmSheet, Note, Segmented, SelectField, SliderRow, TextField } from "../ui/kit";
import { WatermarkTokens } from "./WatermarkTokens";

/** 5.5.3：水印固定墨色。 */
export const WM_INK = "#25352C";
export const inked = (s: WatermarkSettings): WatermarkSettings => ({ ...s, color: WM_INK });
export const defaultPacketWatermark = (): PacketWatermark => ({ enabled: false, settings: defaultWatermark(), skip: [], stripMeta: false });

/** 每个清单项能否加水印。签名 PDF 第一次出现时默认不加。 */
export function useEligibility(items: PacketItem[], store: Store, reviewBytes: boolean, revision: number) {
  const [result, setResult] = useState<{ key: string; map: Record<string, WMEligibility> } | null>(null);
  const key = JSON.stringify([reviewBytes, revision, items.map(i => [packetItemID(i), i.document?.id, i.document?.filePath])]);
  useEffect(() => {
    let live = true;
    let next = 0;
    const map: Record<string, WMEligibility> = {};
    const check = async () => {
      while (live && next < items.length) {
        const item = items[next++];
        map[packetItemID(item)] = await wmEligibility(item, store, reviewBytes);
      }
    };
    void Promise.all([check(), check()]).then(() => { if (live) setResult({ key, map }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, store]);
  return result?.key === key ? result.map : {};
}

export function eligibilityPill(e?: WMEligibility): { text: string; kind: "warn" | "neutral" } | null {
  if (!e) return null;
  if (!e.ok) return e.reason === "missing" ? null : { text: e.label, kind: "neutral" };
  return "signed" in e ? { text: "电子签名", kind: "warn" } : null;
}

// ---------- 设置栏 ----------

export function WatermarkSettingsPanel({ wm, onChange, recipient, onRecipient, focusRecipient, onFocused, emptyText }: { wm: PacketWatermark; onChange: (w: PacketWatermark) => void; recipient: string; onRecipient: (s: string) => void; focusRecipient?: boolean; onFocused?: () => void; emptyText: boolean }) {
  const recBox = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!focusRecipient) return; const t = setTimeout(() => { recBox.current?.scrollIntoView({ block: "center", behavior: "smooth" }); recBox.current?.querySelector("input")?.focus(); onFocused?.(); }, 260); return () => clearTimeout(t); }, [focusRecipient]);
  const s = wm.settings;
  const set = (p: Partial<WatermarkSettings>) => onChange({ ...wm, settings: { ...s, ...p } });
  const usesRecipient = s.parts.some((p) => p.kind === "tag" && p.tag === "recipient");
  const head = (t: string, right?: React.ReactNode) => <div className="row gap8"><span className="t-row grow">{t}</span>{right}</div>;
  return <div className="col" style={{ gap: 20 }}>
    <section className="col gap8"><span className="t-row">水印文字</span><WatermarkTokens parts={s.parts} onChange={(parts) => set({ parts })} />
      {emptyText && <span className="t-meta amber-text" role="status">{emptyWatermarkMessage}</span>}
      <span className="t-meta muted">拖动标签调整顺序，也可点按标签移动。拖动时按 Esc 取消。</span></section>
    <section className="col gap8">{head("语言", <Segmented options={[["zh", "中文"], ["en", "English"]]} value={s.lang} onChange={(lang) => set({ lang })} />)}
      {s.lang === "en" && <span className="t-meta muted">日期写作 10 Nov 2026，文件名称用英文类型名；公司名称、接收方和自定义文字照原样。</span>}</section>
    <section className="col gap8" ref={recBox as never}><span className="t-row">接收方</span>
      <TextField value={recipient} onChange={onRecipient} placeholder="例如 汇丰银行" invalid={usesRecipient && !recipient.trim()} />
      {usesRecipient && !recipient.trim() ? <span className="t-meta amber-text">水印里用了【接收方】，请填写。</span> : <span className="t-meta muted">每次导出时确认，会写进水印和文件名。</span>}</section>
    <section className="col gap8">{head("样式", <Segmented<WMStyle> options={[["tile", "斜向平铺"], ["center", "居中大字"], ["footer", "页脚一行"]]} value={s.style} onChange={(style) => set({ style })} />)}</section>
    <section className="col gap12">
      <SliderRow label="不透明度" min={1} max={100} value={s.opacity} onChange={(opacity) => set({ opacity })} format={(v) => `${v}%`} />
      <SliderRow label="字号" min={1} max={12} step={0.5} value={s.size} onChange={(size) => set({ size })} format={(v) => `${v}%`} />
      {s.style !== "footer" && <SliderRow label="倾斜角度" min={-90} max={90} value={s.angle} onChange={(angle) => set({ angle })} format={(v) => `${v}°`} />}
    </section>
    <span className="row gap8 wrap t-meta muted">
      <span className="swatch on" style={{ background: WM_INK }} aria-hidden="true" />
      <span>水印统一使用墨色（{WM_INK}），打印效果为黑色。字号按页宽的百分比计算。</span>
    </span>
  </div>;
}

// 预览在本次选中的文件快照上翻页。水印独立绘制，修改样式不重读原件。

export type PreviewFile = { id: string; title: string; url: string; kind: "pdf" | "image"; sha256: string; text: string };

export function WatermarkPreview({ files, index, onIndex, settings, onChanged }: { files: PreviewFile[]; index: number; onIndex: (i: number) => void; settings: WatermarkSettings; onChanged: (title: string) => void }) {
  const cur = files[Math.min(index, files.length - 1)];
  return <div className="col gap10 watermark-preview">
    <section className="col gap8 watermark-preview-control">
      <span className="t-row">预览文件</span>
      <div className="row gap8 watermark-preview-picker">
        <SelectField options={files.map((f, i) => [String(i), f.title] as [string, string])} value={String(index)} onChange={(v) => onIndex(Number(v))}
          placeholder="没有可预览的文件" minWidth={0} maxWidth={560} disabled={!files.length} ariaLabel="预览文件" />
        {cur && <span className="t-meta muted num watermark-preview-count">{index + 1} / {files.length} 份</span>}
        <span className="grow" />
        <span className="t-meta muted watermark-preview-hint">也可以在第一步的清单里点选</span>
      </div>
    </section>
    {!cur ? <Note>没有要加水印的文件：在第一步把至少一份文件设为“加水印”。</Note> :
      <WatermarkedPages key={`${cur.id}:${cur.url}:${cur.sha256}`} cur={cur} settings={settings} onChanged={onChanged} />}
  </div>;
}

function WatermarkedPages({ cur, settings, onChanged }: { cur: PreviewFile; settings: WatermarkSettings; onChanged: (title: string) => void }) {
  const [source, setSource] = useState<PDFDocumentProxy | ImageBitmap | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [dims, setDims] = useState<{ w: number; h: number; scale: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const base = useRef<HTMLCanvasElement>(null), top = useRef<HTMLCanvasElement>(null);
  const maxW = Math.round(560 * (window.devicePixelRatio || 1));
  useEffect(() => {
    let live = true;
    let loading: PDFDocumentLoadingTask | undefined;
    let image: ImageBitmap | undefined;
    const load = async () => {
      const bytes = await platform().readBytes(cur.url);
      const digest = await sha256Bytes(bytes);
      if (!live) return;
      if (digest !== cur.sha256) { onChanged(cur.title); return; }
      if (cur.kind === "image") {
        image = await createImageBitmap(new Blob([bytes as BlobPart]));
        if (!live) { image.close(); return; }
        setSource(image); setPages(1);
      } else {
        const reader = await loadPdfReader();
        if (!live) return;
        loading = reader.getDocument({ data: bytes });
        const pdf = await loading.promise;
        if (live) { setSource(pdf); setPages(pdf.numPages); }
      }
    };
    void load().catch(e => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; image?.close(); void loading?.destroy().catch(() => undefined); };
  }, [cur.url, cur.sha256, cur.kind, cur.title, onChanged]);

  useEffect(() => {
    if (!source) return;
    let live = true;
    let render: RenderTask | undefined;
    const paint = async () => {
      const c = base.current, overlay = top.current;
      if (!c || !overlay) return;
      let w: number, h: number;
      if ("getPage" in source) {
        const pg = await source.getPage(page);
        if (!live) return;
        const box = pg.getViewport({ scale: 1 });
        w = box.width; h = box.height;
        const viewport = pg.getViewport({ scale: maxW / w });
        c.width = overlay.width = Math.floor(viewport.width);
        c.height = overlay.height = Math.floor(viewport.height);
        render = pg.render({ canvasContext: c.getContext("2d")!, viewport });
        await render.promise;
      } else {
        w = c.width = overlay.width = source.width;
        h = c.height = overlay.height = source.height;
        c.getContext("2d")!.drawImage(source, 0, 0);
      }
      if (live) { setDims({ w, h, scale: c.width / w }); setErr(null); }
    };
    void paint().catch(e => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; render?.cancel(); };
  }, [source, page, maxW]);
  useEffect(() => {
    const c = top.current; if (!c || !dims) return;
    let raf = requestAnimationFrame(() => { const ctx = c.getContext("2d")!; ctx.clearRect(0, 0, c.width, c.height); void drawWatermark(ctx, dims.w, dims.h, dims.scale, cur.text, settings); });
    return () => cancelAnimationFrame(raf);
  }, [dims, cur.text, settings]);
  return <>
    <div className="row" style={{ justifyContent: "center", padding: 16, borderRadius: "var(--r-tile)", background: "var(--surface-sunken)" }}>
      {err ? <Note tone="warn">预览失败：{err}</Note> :
        <span className="wm-stage page-fade" key={page} style={{ height: 440, aspectRatio: dims ? `${dims.w} / ${dims.h}` : "210 / 297", maxWidth: "100%" }}>
          <canvas ref={base} className="wm-page" style={{ width: "100%", height: "100%" }} aria-label={`水印预览：${cur.title} 第 ${page} 页`} />
          <canvas ref={top} aria-hidden />
        </span>}
    </div>
    {(!err || pages > 0) && <div className="row" style={{ justifyContent: "center" }}>
      <PreviewPager page={page} pages={pages} onPageChange={(next) => { setErr(null); setPage(next); }} />
    </div>}
    <span className="t-meta muted selectable" style={{ textAlign: "center" }}>{cur.text || "（水印文字为空）"}</span>
  </>;
}

export function SignedConfirm({ title, onClose, onConfirm }: { title: string; onClose: () => void; onConfirm: () => void }) {
  return <ConfirmSheet title="给带电子签名的文件加水印？" message={`「${title}」带电子签名。加水印会改动文件，副本里的签名会显示为失效；原件不受影响。对方如需验证签名，请不要加水印。`}
    warn cancelTitle="不加，保留签名" confirmTitle="仍然加水印" onClose={onClose} onConfirm={onConfirm} />;
}
