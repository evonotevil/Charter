// 5.5：材料包水印——设置栏、预览、签名确认。设计稿见 Figma「5.5 · 材料包水印」。

import { useEffect, useMemo, useRef, useState } from "react";
import type { PacketTemplate, PacketWatermark } from "../domain/models";
import { type PacketItem, type WMEligibility, packetIncluded, packetItemID, packetItemTitle, wmContext, wmEligibility } from "../services/packets";
import { type WMPart, type WMStyle, type WatermarkSettings, WM_COLORS, WM_TAGS, defaultWatermark, drawWatermark, kindOf, resolveText, tagLabel } from "../services/watermark";
import type { Company } from "../domain/models";
import type { Store } from "../state/store";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { Button, ColorSwatch, ConfirmSheet, MenuList, Note, Popover, Segmented, Slider, Switch, TextField } from "../ui/kit";

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

// ---------- 水印文字：标签 + 自定义文字，可拖动排序 ----------

function TokenBuilder({ parts, onChange }: { parts: WMPart[]; onChange: (p: WMPart[]) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const move = (from: number, to: number) => { if (from === to) return; const p = [...parts]; const [x] = p.splice(from, 1); p.splice(to, 0, x); onChange(p); };
  const addText = () => { const t = draft.trim(); if (!t) return; onChange([...parts, { kind: "text", text: t }]); setDraft(""); };
  return <div className="col gap8">
    <div className="wm-tokens" aria-label="水印文字组成，可拖动调整顺序">
      {parts.map((p, i) => (
        <span key={i} className={`wm-token ${p.kind} ${drag === i ? "dragging" : ""}`} draggable
          onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDrag(null)}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); }}>
          {p.kind === "tag" ? tagLabel(p.tag) : p.text}
          <button aria-label={`左移 ${p.kind === "tag" ? tagLabel(p.tag) : p.text}`} data-tip="左移" disabled={i === 0} onClick={() => move(i, i - 1)} hidden={i === 0}><Icon name="chevron.left" size={10} /></button>
          <button aria-label={`移除 ${p.kind === "tag" ? tagLabel(p.tag) : p.text}`} data-tip="移除" onClick={() => onChange(parts.filter((_, k) => k !== i))}><Icon name="xmark" size={10} /></button>
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
      <MenuList close={() => setMenu(false)} entries={WM_TAGS.map(([t, l]) => ({ kind: "item" as const, title: l, action: () => onChange([...parts, { kind: "tag", tag: t }]) }))} />
    </Popover>
  </div>;
}

// ---------- 设置栏 ----------

export function WatermarkSettingsPanel({ wm, onChange, recipient, onRecipient }: { wm: PacketWatermark; onChange: (w: PacketWatermark) => void; recipient: string; onRecipient: (s: string) => void }) {
  const s = wm.settings;
  const set = (p: Partial<WatermarkSettings>) => onChange({ ...wm, settings: { ...s, ...p } });
  const custom = !WM_COLORS.some(([c]) => c.toLowerCase() === s.color.toLowerCase());
  const [hex, setHex] = useState(s.color);
  useEffect(() => setHex(s.color), [s.color]);
  const usesRecipient = s.parts.some((p) => p.kind === "tag" && p.tag === "recipient");
  return <div className="col" style={{ gap: 18 }}>
    <section className="col gap8"><span className="t-row">水印文字</span><TokenBuilder parts={s.parts} onChange={(parts) => set({ parts })} /></section>
    <section className="col gap8"><div className="row gap8"><span className="t-row grow">语言</span>
      <Segmented options={[["zh", "中文"], ["en", "English"]]} value={s.lang} onChange={(lang) => set({ lang })} /></div>
      {s.lang === "en" && <span className="t-meta muted">日期写作 10 Nov 2026，文件名称用英文类型名；公司名称、接收方和自定义文字照原样。</span>}</section>
    <section className="col gap8"><span className="t-row">接收方 <span className="t-meta muted" style={{ fontWeight: 400 }}>每次导出时确认，不随用途保存</span></span>
      <TextField value={recipient} onChange={onRecipient} placeholder="例如 汇丰银行" invalid={usesRecipient && !recipient.trim()} />
      {usesRecipient && !recipient.trim() && <span className="t-meta amber-text">水印里用了【接收方】，请填写。</span>}</section>
    <section className="col gap8"><span className="t-row">样式</span>
      <Segmented<WMStyle> options={[["tile", "斜向平铺"], ["center", "居中大字"], ["footer", "页脚一行"]]} value={s.style} onChange={(style) => set({ style })} /></section>
    <section className="col gap10">
      <div className="col gap4"><span className="t-label muted">浓淡</span><Slider label="浓淡" min={1} max={100} value={s.opacity} onChange={(opacity) => set({ opacity })} format={(v) => `${v}%`} /></div>
      <div className="col gap4"><span className="t-label muted">字号（页宽）</span><Slider label="字号" min={1} max={12} step={0.5} value={s.size} onChange={(size) => set({ size })} format={(v) => `${v}%`} /></div>
      {s.style !== "footer" && <div className="col gap4"><span className="t-label muted">倾斜角度</span><Slider label="倾斜角度" min={-90} max={90} value={s.angle} onChange={(angle) => set({ angle })} format={(v) => `${v}°`} /></div>}
    </section>
    <section className="col gap8"><span className="t-row">颜色</span>
      <div className="row gap10 wrap">
        {WM_COLORS.map(([c, l]) => <ColorSwatch key={c} color={c} label={l} selected={c.toLowerCase() === s.color.toLowerCase()} onPick={() => set({ color: c })} />)}
        <ColorSwatch color={custom ? s.color : "var(--surface-sunken)"} label="自定义颜色" selected={custom} onPick={() => set({ color: /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#5F6D66" })} />
        <input className="field num" style={{ width: 104, height: 32, minHeight: 32 }} aria-label="自定义颜色（十六进制）" value={hex} onChange={(e) => setHex(e.target.value)}
          onBlur={() => { if (/^#[0-9a-f]{6}$/i.test(hex)) set({ color: hex.toUpperCase() }); else setHex(s.color); }} />
      </div></section>
    <section className="col gap6">
      <Switch checked={s.flatten} onChange={(flatten) => set({ flatten })}><span className="col" style={{ gap: 2 }}><span className="t-row">压平</span><span className="t-meta muted">每页转成图片再合成水印，水印无法被编辑器删除；文字不可再选中，文件会变大。</span></span></Switch>
    </section>
  </div>;
}

// ---------- 预览：按文件、按页翻看 ----------

type Src = { item: PacketItem; title: string };

export function WatermarkPreview({ items, template, company, store, wm, recipient }: { items: PacketItem[]; template: PacketTemplate; company: Company; store: Store; wm: PacketWatermark; recipient: string }) {
  const files: Src[] = useMemo(() => packetIncluded(items).filter((i) => !wm.skip.includes(packetItemID(i)) && kindOf(store.fileURL(i.document!)) !== "other")
    .map((i) => ({ item: i, title: packetItemTitle(i, store.docType(i.document!.typeID)?.name) })), [items, wm.skip, store]);
  const [fi, setFi] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cur = files[Math.min(fi, files.length - 1)];
  const text = cur ? resolveText(wm.settings, wmContext(cur.item, template, company, store, recipient)) : "";
  useEffect(() => { setPage(1); }, [fi]);
  useEffect(() => {
    if (!cur) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const bytes = await platform().readBytes(store.fileURL(cur.item.document!));
        const c = canvas.current; if (!c || !live) return;
        const ctx = c.getContext("2d")!;
        const maxW = 520 * (window.devicePixelRatio || 1);
        if (kindOf(store.fileURL(cur.item.document!)) === "pdf") {
          const { pdfjs } = await import("../services/extract");
          const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
          if (!live) return;
          setPages(doc.numPages);
          const pg = await doc.getPage(Math.min(page, doc.numPages));
          const vp1 = pg.getViewport({ scale: 1 });
          const scale = maxW / vp1.width;
          const vp = pg.getViewport({ scale });
          c.width = vp.width; c.height = vp.height;
          await pg.render({ canvasContext: ctx, viewport: vp, canvas: c } as never).promise;
          await drawWatermark(ctx, vp1.width, vp1.height, scale, text, wm.settings);
          void doc.destroy();
        } else {
          setPages(1);
          const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
          const scale = Math.min(1, maxW / bmp.width);
          c.width = bmp.width * scale; c.height = bmp.height * scale;
          ctx.drawImage(bmp, 0, 0, c.width, c.height);
          await drawWatermark(ctx, bmp.width, bmp.height, scale, text, wm.settings);
        }
        setErr(null);
      } catch (e) { if (live) setErr(e instanceof Error ? e.message : String(e)); }
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [cur?.item.document?.id, page, text, wm.settings]);
  if (!cur) return <Note>没有可预览的文件：已选文件都不加水印，或都是 Word、Excel 等无法加水印的格式。</Note>;
  return <div className="col gap12" style={{ alignItems: "stretch" }}>
    <div className="row gap8">
      <Button size="small" icon="chevron.left" ariaLabel="上一份文件" disabled={fi <= 0} onClick={() => setFi(fi - 1)} />
      <span className="grow ellipsis t-row" style={{ textAlign: "center" }}>{cur.title}<span className="t-meta muted num" style={{ fontWeight: 400 }}>　{fi + 1} / {files.length} 份</span></span>
      <Button size="small" icon="chevron.right" ariaLabel="下一份文件" disabled={fi >= files.length - 1} onClick={() => setFi(fi + 1)} />
    </div>
    <div className="row" style={{ justifyContent: "center", padding: 16, borderRadius: "var(--r-tile)", background: "var(--surface-sunken)" }}>
      {err ? <Note tone="warn">预览失败：{err}</Note> : <canvas ref={canvas} className="wm-page" style={{ width: "100%", maxWidth: 520, height: "auto" }} aria-label={`水印预览：${cur.title} 第 ${page} 页`} />}
    </div>
    {pages > 1 && <div className="row gap8" style={{ justifyContent: "center" }}>
      <Button size="small" kind="quiet" icon="chevron.left" ariaLabel="上一页" disabled={page <= 1} onClick={() => setPage(page - 1)} />
      <span className="t-meta muted num">第 {page} / {pages} 页</span>
      <Button size="small" kind="quiet" icon="chevron.right" ariaLabel="下一页" disabled={page >= pages} onClick={() => setPage(page + 1)} />
    </div>}
    <span className="t-meta muted selectable" style={{ textAlign: "center" }}>{text || "（水印文字为空）"}</span>
  </div>;
}

export function SignedConfirm({ title, onClose, onConfirm }: { title: string; onClose: () => void; onConfirm: () => void }) {
  return <ConfirmSheet title="给带电子签名的文件加水印？" message={`「${title}」带电子签名。加水印会改动文件，副本里的签名会显示为失效；原件不受影响。对方如需验证签名，请不要加水印。`}
    warn cancelTitle="不加，保留签名" confirmTitle="仍然加水印" onClose={onClose} onConfirm={onConfirm} />;
}
