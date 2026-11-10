// 5.5：材料包水印——设置栏、预览、签名确认。设计稿见 Figma「5.5 · 材料包水印」。

import { useEffect, useMemo, useRef, useState } from "react";
import type { PacketTemplate, PacketWatermark } from "../domain/models";
import { type PacketItem, type WMEligibility, packetIncluded, packetItemID, packetItemTitle, wmContext, wmEligibility } from "../services/packets";
import { type WMPart, type WMStyle, type WatermarkSettings, WM_COLORS, WM_TAGS, defaultWatermark, drawWatermark, kindOf, resolveText, tagLabel } from "../services/watermark";
import type { Company } from "../domain/models";
import type { Store } from "../state/store";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { Button, ColorSwatch, ConfirmSheet, MenuList, Note, Popover, Segmented, SelectField, Slider, TextField } from "../ui/kit";

export const defaultPacketWatermark = (): PacketWatermark => ({ enabled: false, settings: defaultWatermark(), skip: [], stripMeta: false });

/** 每个清单项能否加水印。签名 PDF 第一次出现时默认不加。 */
export function useEligibility(items: PacketItem[], store: Store) {
  const [map, setMap] = useState<Record<string, WMEligibility>>({});
  const key = items.map((i) => packetItemID(i) + (i.document?.id ?? "")).join(",");
  useEffect(() => {
    let live = true;
    void Promise.all(items.map(async (i) => [packetItemID(i), await wmEligibility(i, store)] as const)).then((r) => live && setMap(Object.fromEntries(r)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

export function eligibilityPill(e?: WMEligibility): { text: string; kind: "warn" | "neutral" } | null {
  if (!e) return null;
  if (!e.ok) return e.reason === "missing" ? null : { text: e.label, kind: "neutral" };
  return "signed" in e ? { text: "电子签名", kind: "warn" } : null;
}

// ---------- 水印文字：标签 + 自定义文字，可拖动、左右移 ----------

function TokenBuilder({ parts, onChange }: { parts: WMPart[]; onChange: (p: WMPart[]) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const move = (from: number, to: number) => { if (from === to || to < 0 || to >= parts.length) return; const p = [...parts]; const [x] = p.splice(from, 1); p.splice(to, 0, x); onChange(p); };
  const append = (x: WMPart) => { onChange([...parts, x]); setFresh(parts.length); };
  const addText = () => { const t = draft.trim(); if (!t) return; append({ kind: "text", text: t }); setDraft(""); };
  const name = (p: WMPart) => (p.kind === "tag" ? tagLabel(p.tag) : p.text);
  return <div className="col gap8">
    <div className="wm-tokens" aria-label="水印文字组成，可拖动调整顺序">
      {parts.map((p, i) => (
        <span key={`${i}-${name(p)}`} className={`wm-token ${p.kind} ${drag === i ? "dragging" : ""} ${fresh === i ? "fresh" : ""}`} draggable
          style={over === i && drag !== null && drag !== i ? { boxShadow: `${drag > i ? "-3px" : "3px"} 0 0 0 var(--green)` } : undefined}
          onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDrag(null); setOver(null); }}
          onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); setOver(null); }}>
          {name(p)}
          <button aria-label={`左移 ${name(p)}`} data-tip="左移" disabled={i === 0} onClick={() => move(i, i - 1)}><Icon name="chevron.left" size={10} /></button>
          <button aria-label={`右移 ${name(p)}`} data-tip="右移" disabled={i === parts.length - 1} onClick={() => move(i, i + 1)}><Icon name="chevron.right" size={10} /></button>
          <button aria-label={`移除 ${name(p)}`} data-tip="移除" onClick={() => onChange(parts.filter((_, k) => k !== i))}><Icon name="xmark" size={10} /></button>
        </span>
      ))}
      {!parts.length && <span className="t-meta muted" style={{ padding: "0 4px" }}>添加标签或文字</span>}
    </div>
    <div className="row gap8">
      <span ref={anchor} style={{ display: "inline-flex" }}><Button size="small" icon="plus" onClick={() => setMenu(true)}>插入标签</Button></span>
      <TextField value={draft} onChange={setDraft} placeholder="自定义文字，回车添加" onEnter={addText} style={{ flex: 1, minWidth: 0 }} />
      <Button size="small" disabled={!draft.trim()} onClick={addText}>添加</Button>
    </div>
    <Popover anchor={anchor} open={menu} onClose={() => setMenu(false)} minWidth={180}>
      <MenuList close={() => setMenu(false)} entries={WM_TAGS.map(([t, l]) => ({ kind: "item" as const, title: l, action: () => append({ kind: "tag", tag: t }) }))} />
    </Popover>
  </div>;
}

// ---------- 设置栏 ----------

export function WatermarkSettingsPanel({ wm, onChange, recipient, onRecipient, focusRecipient, onFocused }: { wm: PacketWatermark; onChange: (w: PacketWatermark) => void; recipient: string; onRecipient: (s: string) => void; focusRecipient?: boolean; onFocused?: () => void }) {
  const recBox = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!focusRecipient) return; const t = setTimeout(() => { recBox.current?.scrollIntoView({ block: "center", behavior: "smooth" }); recBox.current?.querySelector("input")?.focus(); onFocused?.(); }, 260); return () => clearTimeout(t); }, [focusRecipient]);
  const s = wm.settings;
  const set = (p: Partial<WatermarkSettings>) => onChange({ ...wm, settings: { ...s, ...p } });
  const custom = !WM_COLORS.some(([c]) => c.toLowerCase() === s.color.toLowerCase());
  const usesRecipient = s.parts.some((p) => p.kind === "tag" && p.tag === "recipient");
  const head = (t: string, right?: React.ReactNode) => <div className="row gap8"><span className="t-row grow">{t}</span>{right}</div>;
  return <div className="col" style={{ gap: 18 }}>
    <section className="col gap8">{head("水印文字", <span className="t-meta muted">拖动或用 ‹ › 调整顺序</span>)}<TokenBuilder parts={s.parts} onChange={(parts) => set({ parts })} /></section>
    <section className="col gap8">{head("语言", <Segmented options={[["zh", "中文"], ["en", "English"]]} value={s.lang} onChange={(lang) => set({ lang })} />)}
      {s.lang === "en" && <span className="t-meta muted">日期写作 10 Nov 2026，文件名称用英文类型名；公司名称、接收方和自定义文字照原样。</span>}</section>
    <section className="col gap8" ref={recBox as never}>{head("接收方", <span className="t-meta muted">每次导出时确认</span>)}
      <TextField value={recipient} onChange={onRecipient} placeholder="例如 汇丰银行" invalid={usesRecipient && !recipient.trim()} />
      {usesRecipient && !recipient.trim() && <span className="t-meta amber-text">水印里用了【接收方】，请填写。</span>}</section>
    <section className="col gap8">{head("样式", <Segmented<WMStyle> options={[["tile", "斜向平铺"], ["center", "居中大字"], ["footer", "页脚一行"]]} value={s.style} onChange={(style) => set({ style })} />)}</section>
    <section className="col gap12">
      <div className="col gap4"><div className="row gap8"><span className="t-label muted grow">不透明度</span><span className="wm-sample" style={{ color: s.color, opacity: Math.max(.08, s.opacity / 100) }} aria-hidden>水印 Aa</span></div>
        <Slider label="不透明度" min={1} max={100} value={s.opacity} onChange={(opacity) => set({ opacity })} format={(v) => `${v}%`} /></div>
      <div className="col gap4"><span className="t-label muted">字号（页宽）</span><Slider label="字号" min={1} max={12} step={0.5} value={s.size} onChange={(size) => set({ size })} format={(v) => `${v}%`} /></div>
      {s.style !== "footer" && <div className="col gap4"><span className="t-label muted">倾斜角度</span><Slider label="倾斜角度" min={-90} max={90} value={s.angle} onChange={(angle) => set({ angle })} format={(v) => `${v}°`} /></div>}
    </section>
    <section className="col gap8">{head("颜色")}
      <div className="row gap12 wrap">
        {WM_COLORS.map(([c, l]) => { const on = c.toLowerCase() === s.color.toLowerCase(); return <ColorSwatch key={c} color={c} label={l} selected={on} onPick={() => set({ color: c })} />; })}
        <label className={`swatch-custom ${custom ? "on" : ""}`} data-tip="自定义颜色">
          <span className="wheel" style={custom ? { background: s.color } : undefined} />{custom ? s.color.toUpperCase() : "自定义…"}
          <input type="color" aria-label="自定义颜色" value={/^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#25352C"} onChange={(e) => set({ color: e.target.value.toUpperCase() })} />
        </label>
      </div></section>
  </div>;
}

// ---------- 预览：页面只渲染一次并缓存，水印画在上层，拖动滑块逐帧重绘 ----------

const pageCache = new Map<string, Promise<{ bmp: ImageBitmap; w: number; h: number; pages: number }>>();
function renderPage(url: string, kind: "pdf" | "image", page: number, maxW: number) {
  const key = `${url}#${page}@${maxW}`;
  if (!pageCache.has(key)) {
    pageCache.set(key, (async () => {
      const bytes = await platform().readBytes(url);
      if (kind === "image") { const bmp = await createImageBitmap(new Blob([bytes as BlobPart])); return { bmp, w: bmp.width, h: bmp.height, pages: 1 }; }
      const { pdfjs } = await import("../services/extract");
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const pg = await doc.getPage(Math.min(page, doc.numPages));
      const vp1 = pg.getViewport({ scale: 1 }); const vp = pg.getViewport({ scale: maxW / vp1.width });
      const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
      await pg.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c } as never).promise;
      const r = { bmp: await createImageBitmap(c), w: vp1.width, h: vp1.height, pages: doc.numPages }; void doc.destroy(); return r;
    })());
    pageCache.get(key)!.catch(() => pageCache.delete(key));
  }
  return pageCache.get(key)!;
}

export type PreviewFile = { id: string; title: string; url: string; kind: "pdf" | "image"; text: string };

export function WatermarkPreview({ files, index, onIndex, settings }: { files: PreviewFile[]; index: number; onIndex: (i: number) => void; settings: WatermarkSettings }) {
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [dims, setDims] = useState<{ w: number; h: number; scale: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const base = useRef<HTMLCanvasElement>(null), top = useRef<HTMLCanvasElement>(null);
  const cur = files[Math.min(index, files.length - 1)];
  const maxW = Math.round(560 * (window.devicePixelRatio || 1));
  useEffect(() => setPage(1), [cur?.id]);
  useEffect(() => {
    if (!cur) return; let live = true;
    void renderPage(cur.url, cur.kind, page, maxW).then((r) => {
      if (!live) return;
      const scale = Math.min(maxW / r.w, cur.kind === "image" ? 1 : Infinity);
      for (const c of [base.current, top.current]) if (c) { c.width = r.bmp.width; c.height = r.bmp.height; }
      base.current?.getContext("2d")!.drawImage(r.bmp, 0, 0);
      setPages(r.pages); setDims({ w: r.w, h: r.h, scale: r.bmp.width / r.w || scale }); setErr(null);
      // 预读下一页
      if (page < r.pages) void renderPage(cur.url, cur.kind, page + 1, maxW);
    }).catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [cur?.url, page]);
  useEffect(() => {
    const c = top.current; if (!c || !dims || !cur) return;
    let raf = requestAnimationFrame(() => { const ctx = c.getContext("2d")!; ctx.clearRect(0, 0, c.width, c.height); void drawWatermark(ctx, dims.w, dims.h, dims.scale, cur.text, settings); });
    return () => cancelAnimationFrame(raf);
  }, [dims, cur?.text, settings]);
  if (!cur) return <Note>没有要加水印的文件：在上一步把至少一份文件设为“加水印”。</Note>;
  return <div className="col gap10">
    <div className="row gap8">
      <SelectField options={files.map((f, i) => [String(i), f.title] as [string, string])} value={String(index)} onChange={(v) => onIndex(Number(v))} minWidth={240} />
      <span className="t-meta muted num">{index + 1} / {files.length} 份</span>
      <span className="grow" />
      <span className="t-meta muted">在左侧清单点一份文件，也会切换到它</span>
    </div>
    <div className="row" style={{ justifyContent: "center", padding: 16, borderRadius: "var(--r-tile)", background: "var(--surface-sunken)" }}>
      {err ? <Note tone="warn">预览失败：{err}</Note> :
        <span className="wm-stage page-fade" key={`${cur.id}-${page}`} style={{ height: 440, aspectRatio: dims ? `${dims.w} / ${dims.h}` : "210 / 297", maxWidth: "100%" }}>
          <canvas ref={base} className="wm-page" style={{ width: "100%", height: "100%" }} aria-label={`水印预览：${cur.title} 第 ${page} 页`} />
          <canvas ref={top} aria-hidden />
        </span>}
    </div>
    <div className="row gap8" style={{ justifyContent: "center" }}>
      <Button size="small" kind="quiet" icon="chevron.left" ariaLabel="上一页" disabled={page <= 1} onClick={() => setPage(page - 1)} />
      <span className="t-meta muted num" style={{ minWidth: 88, textAlign: "center" }}>第 {page} / {pages} 页</span>
      <Button size="small" kind="quiet" icon="chevron.right" ariaLabel="下一页" disabled={page >= pages} onClick={() => setPage(page + 1)} />
    </div>
    <span className="t-meta muted selectable" style={{ textAlign: "center" }}>{cur.text || "（水印文字为空）"}</span>
  </div>;
}

export function SignedConfirm({ title, onClose, onConfirm }: { title: string; onClose: () => void; onConfirm: () => void }) {
  return <ConfirmSheet title="给带电子签名的文件加水印？" message={`「${title}」带电子签名。加水印会改动文件，副本里的签名会显示为失效；原件不受影响。对方如需验证签名，请不要加水印。`}
    warn cancelTitle="不加，保留签名" confirmTitle="仍然加水印" onClose={onClose} onConfirm={onConfirm} />;
}
