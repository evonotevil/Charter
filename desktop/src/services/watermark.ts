// 5.5：材料包水印。
// 原件永远不动，只处理导出的副本：
// - PDF：用 pdf-lib 在每页叠一层文字（按页面实际显示方向计算，处理 /Rotate 和裁切框）；
// - 图片（JPG / PNG / HEIC 等）：画布上叠字后重新编码，顺带去掉 EXIF；
// - 压平：用 pdf.js 把每页渲染成图片，与水印合成后重组为 PDF，水印无法再用编辑器删除；
// - Word、Excel 等其他格式无法加水印，原样放入并在目录里注明。
// 带电子签名的 PDF 加水印会使签名失效，加密的 PDF 无法修改；这两类由界面提示。

import { PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { platform } from "../platform/platform";
import { brandFont, brandFontSubset } from "./brandfont";

export type WMTag = "date" | "file" | "company" | "packet" | "recipient";
export type WMPart = { kind: "tag"; tag: WMTag } | { kind: "text"; text: string };
export type WMStyle = "tile" | "center" | "footer";

export interface WatermarkSettings {
  parts: WMPart[];
  lang: "zh" | "en";
  style: WMStyle;
  /** 1–100（%） */
  opacity: number;
  /** 字号：页面（显示）宽度的百分比，1–12 */
  size: number;
  /** 倾斜角度，-90–90；页脚样式忽略 */
  angle: number;
  /** #RRGGBB */
  color: string;
  flatten: boolean;
}

export const WM_TAGS: [WMTag, string][] = [["date", "日期"], ["file", "文件名称"], ["company", "公司名称"], ["packet", "材料包名称"], ["recipient", "接收方"]];
export const tagLabel = (t: WMTag) => WM_TAGS.find(([k]) => k === t)?.[1] ?? t;
export const WM_COLORS: [string, string][] = [["#25352C", "墨色"], ["#738078", "灰"], ["#C0392B", "红"], ["#2F5FA8", "蓝"], ["#2F7A00", "绿"]];

export const defaultWatermark = (): WatermarkSettings => ({
  parts: [{ kind: "tag", tag: "recipient" }, { kind: "text", text: "专用" }, { kind: "tag", tag: "date" }, { kind: "text", text: "仅供指定用途使用" }],
  lang: "zh", style: "tile", opacity: 24, size: 4, angle: -30, color: "#25352C", flatten: false,
});

export interface WMContext { day: string; fileName: string; fileNameEn?: string; company: string; packet: string; recipient: string }

const isCJK = (ch: string | undefined) => !!ch && /[⺀-鿿가-힯＀-￯　-〿]/.test(ch);

/** 英文日期：10 Nov 2026 */
export function englishDate(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}

/** 把标签和自定义文字拼成一行。两段之间：两侧都是中日韩文字时不加空格，否则加一个空格。空的标签跳过。 */
export function resolveText(s: Pick<WatermarkSettings, "parts" | "lang">, c: WMContext): string {
  const val = (p: WMPart): string => {
    if (p.kind === "text") return p.text.trim();
    switch (p.tag) {
      case "date": return s.lang === "en" ? englishDate(c.day) : c.day;
      case "file": return s.lang === "en" ? (c.fileNameEn || c.fileName) : c.fileName;
      case "company": return c.company;
      case "packet": return c.packet;
      case "recipient": return c.recipient.trim();
    }
  };
  let out = "";
  for (const p of s.parts) {
    const v = val(p); if (!v) continue;
    if (out && !(isCJK(out.at(-1)) && isCJK(v[0]))) out += " ";
    out += v;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** 文件能不能加水印。 */
export type WMKind = "pdf" | "image" | "other";
export function kindOf(path: string): WMKind {
  const e = path.toLowerCase().split(".").pop() ?? "";
  if (e === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "bmp", "tif", "tiff"].includes(e)) return "image";
  return "other";
}

/** PDF 的特殊情况：带电子签名（加水印会使签名失效）、加密（无法修改）。只扫字节，不解析，大文件也快。 */
export function inspectPDF(bytes: Uint8Array): { signed: boolean; encrypted: boolean } {
  const s = new TextDecoder("latin1").decode(bytes);
  return { signed: /\/ByteRange\s*\[/.test(s) && /\/(Sig|DocTimeStamp)\b/.test(s), encrypted: /\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(s) };
}

// ---------- 几何：所有样式共用（PDF 与画布） ----------

export interface Glyph { x: number; y: number; angle: number }
/** 在“显示坐标”（左下角为原点、y 向上、单位 pt）里，返回每一行水印文字的起点和角度。 */
export function layout(style: WMStyle, W: number, H: number, textW: number, size: number, angle: number): Glyph[] {
  const a = (angle * Math.PI) / 180;
  if (style === "footer") return [{ x: Math.max(12, (W - textW) / 2), y: Math.max(10, size * 1.4), angle: 0 }];
  const cx = W / 2, cy = H / 2;
  const rot = (u: number, v: number) => ({ x: cx + u * Math.cos(a) - v * Math.sin(a), y: cy + u * Math.sin(a) + v * Math.cos(a) });
  if (style === "center") { const p = rot(-textW / 2, -size * 0.35); return [{ ...p, angle }]; }
  const gapX = textW + size * 4, gapY = size * 5, R = Math.hypot(W, H) / 2 + gapX;
  const out: Glyph[] = [];
  for (let v = -R, row = 0; v <= R; v += gapY, row++) {
    for (let u = -R - (row % 2 ? gapX / 2 : 0); u <= R; u += gapX) {
      const p = rot(u, v);
      const far = Math.hypot(p.x - cx, p.y - cy); if (far > R + textW) continue;
      out.push({ ...p, angle });
    }
  }
  return out;
}

/** 居中样式文字太长时缩小字号，让整行留在页面里（沿对角线方向）。 */
export function fitSize(style: WMStyle, W: number, H: number, textW1: number, size: number, angle: number) {
  if (style === "tile") return size;
  const a = Math.abs((angle * Math.PI) / 180);
  const limit = style === "footer" ? W * 0.9 : Math.min(W / Math.max(.2, Math.abs(Math.cos(a))), H / Math.max(.2, Math.abs(Math.sin(a))), Math.hypot(W, H)) * 0.86;
  return Math.min(size, limit / Math.max(1, textW1));
}

const hexToRgb = (hex: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex) ?? [, "25352C"]; const v = parseInt(m[1]!, 16); return { r: (v >> 16) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 }; };

// ---------- 字体 ----------

const subsetCache = new Map<string, Uint8Array | null>();
/** 只包含这段文字所需字形的字体（主进程用 HarfBuzz 取子集），拿不到时返回 null（退回系统字体）。 */
async function fontFor(text: string): Promise<Uint8Array | null> {
  const key = [...new Set(text)].sort().join("");
  if (!subsetCache.has(key)) { try { subsetCache.set(key, await brandFontSubset(key)); } catch { subsetCache.set(key, null); } }
  return subsetCache.get(key)!;
}
async function embed(doc: PDFDocument, text: string): Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  const sub = await fontFor(text);
  if (sub) return doc.embedFont(sub, { subset: false });
  const sys = await platform().cjkFont().catch(() => null);
  if (sys) return doc.embedFont(sys, { subset: true });
  return doc.embedFont("Helvetica");
}

// ---------- PDF ----------

export interface ApplyOptions { stripMeta: boolean; signal?: AbortSignal; onPage?: (i: number, n: number) => void }

/** 显示方向（考虑 /Rotate）下的页面尺寸，以及从显示坐标到页面坐标的换算。 */
function pageFrame(page: PDFPage) {
  const box = page.getCropBox(); const r = ((page.getRotation().angle % 360) + 360) % 360;
  const pw = box.width, ph = box.height, ox = box.x, oy = box.y;
  const W = r % 180 ? ph : pw, H = r % 180 ? pw : ph;
  const map = (vx: number, vy: number): [number, number] => r === 90 ? [ox + pw - vy, oy + vx] : r === 180 ? [ox + pw - vx, oy + ph - vy] : r === 270 ? [ox + vy, oy + ph - vx] : [ox + vx, oy + vy];
  return { W, H, r, map };
}

export function stripMetadata(doc: PDFDocument) {
  doc.setTitle(""); doc.setAuthor(""); doc.setSubject(""); doc.setKeywords([]); doc.setCreator("Charter"); doc.setProducer("Charter");
  // 5.5.5：不只解除引用，还要把 XMP 对象本身删掉，否则保存后仍留在文件里。页面、字体等对象上的 Metadata 一并处理。
  const M = PDFName.of("Metadata");
  const drop = (dict: { get(k: PDFName): unknown; delete(k: PDFName): void }) => {
    const v = dict.get(M);
    if (!v) return;
    dict.delete(M);
    if (v instanceof PDFRef) doc.context.delete(v);
  };
  try { drop(doc.catalog); } catch { /* 没有 XMP */ }
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (!dict) continue;
    if (dict.get(PDFName.of("Type")) === M || dict.get(PDFName.of("Subtype")) === PDFName.of("XML")) { doc.context.delete(ref); continue; }
    try { drop(dict); } catch { /* 忽略 */ }
  }
}

/** 给 PDF 每页叠文字水印。text 为空时只清除元数据。 */
export async function watermarkPDF(bytes: Uint8Array, text: string, s: WatermarkSettings | null, o: ApplyOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (s && text) {
    const font = await embed(doc, text);
    const color = hexToRgb(s.color), opacity = Math.max(.01, Math.min(1, s.opacity / 100));
    const pages = doc.getPages();
    pages.forEach((page, i) => {
      if (o.signal?.aborted) throw new DOMException("已取消", "AbortError");
      const { W, H, r, map } = pageFrame(page);
      const size0 = Math.max(6, (W * s.size) / 100);
      const size = fitSize(s.style, W, H, font.widthOfTextAtSize(text, 1), size0, s.angle);
      const tw = font.widthOfTextAtSize(text, size);
      for (const g of layout(s.style, W, H, tw, size, s.style === "footer" ? 0 : s.angle)) {
        const [x, y] = map(g.x, g.y);
        page.drawText(text, { x, y, size, font, color: rgb(color.r, color.g, color.b), opacity, rotate: degrees(g.angle + r) });
      }
      o.onPage?.(i + 1, pages.length);
    });
  }
  if (o.stripMeta) stripMetadata(doc);
  return doc.save();
}

// ---------- 画布（图片与压平共用） ----------

let fontFace: Promise<string> | null = null;
/** 画布用的字体：把随包附带的思源黑体载入为 FontFace；失败时用系统字体。 */
function canvasFont(): Promise<string> {
  fontFace ??= (async () => {
    try {
      const bytes = await brandFont(); if (!bytes) throw 0;
      const f = new FontFace("CharterWatermark", bytes.slice().buffer as ArrayBuffer); await f.load(); (document.fonts as unknown as { add: (f: FontFace) => void }).add(f);
      return `"CharterWatermark", ${getComputedStyle(document.documentElement).getPropertyValue("--font") || "sans-serif"}`;
    } catch { return getComputedStyle(document.documentElement).getPropertyValue("--font") || "sans-serif"; }
  })();
  return fontFace;
}

/** 在画布上画水印。W/H 为显示尺寸（pt），scale 为 pt→像素。 */
export async function drawWatermark(ctx: CanvasRenderingContext2D, W: number, H: number, scale: number, text: string, s: WatermarkSettings) {
  const family = await canvasFont();
  ctx.save();
  const c = hexToRgb(s.color);
  ctx.fillStyle = `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${Math.max(.01, s.opacity / 100)})`;
  ctx.font = `500 100px ${family}`; const w1 = ctx.measureText(text).width / 100;
  const size = fitSize(s.style, W, H, w1, Math.max(6, (W * s.size) / 100), s.angle);
  ctx.font = `500 ${size * scale}px ${family}`; ctx.textBaseline = "alphabetic";
  const tw = w1 * size;
  for (const g of layout(s.style, W, H, tw, size, s.style === "footer" ? 0 : s.angle)) {
    ctx.save(); ctx.translate(g.x * scale, (H - g.y) * scale); ctx.rotate((-g.angle * Math.PI) / 180); ctx.fillText(text, 0, 0); ctx.restore();
  }
  ctx.restore();
}

const blobOf = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("图片编码失败"))), type, q));

/** 图片加水印。JPG 输出 JPG，其余输出 PNG。重新编码同时去掉 EXIF 等元数据。返回新字节和扩展名。 */
/** 只重新编码图片（去掉 EXIF 等拍摄信息），不加水印。 */
export async function reencodeImage(bytes: Uint8Array, ext: string): Promise<{ bytes: Uint8Array; ext: string }> {
  const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  const jpg = type === "image/jpeg";
  const blob = await blobOf(c, jpg ? "image/jpeg" : "image/png", .92);
  c.width = c.height = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: jpg ? "jpg" : "png" };
}

export async function watermarkImage(bytes: Uint8Array, ext: string, text: string, s: WatermarkSettings): Promise<{ bytes: Uint8Array; ext: string }> {
  const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d")!; ctx.drawImage(bmp, 0, 0);
  // 图片按 72 dpi 折算成 pt，字号百分比与 PDF 一致
  await drawWatermark(ctx, bmp.width, bmp.height, 1, text, s);
  const jpg = type === "image/jpeg";
  const blob = await blobOf(c, jpg ? "image/jpeg" : "image/png", .92);
  c.width = c.height = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: jpg ? "jpg" : "png" };
}

/** 压平：每页渲染成 150 dpi 图片并合成水印，重组为新 PDF（没有文字层，也不保留元数据）。 */
export async function flattenPDF(bytes: Uint8Array, text: string, s: WatermarkSettings, o: ApplyOptions): Promise<Uint8Array> {
  const { pdfjs } = await import("./extract");
  const src = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const out = await PDFDocument.create();
  try {
    for (let i = 1; i <= src.numPages; i++) {
      if (o.signal?.aborted) throw new DOMException("已取消", "AbortError");
      const page = await src.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });            // 已按 /Rotate 转成显示方向，单位 pt
      const scale = 150 / 72, vp = page.getViewport({ scale });
      const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (text) await drawWatermark(ctx, vp1.width, vp1.height, scale, text, s);
      const jpg = new Uint8Array(await (await blobOf(c, "image/jpeg", .85)).arrayBuffer());
      c.width = c.height = 0; page.cleanup();
      const img = await out.embedJpg(jpg);
      out.addPage([vp1.width, vp1.height]).drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      o.onPage?.(i, src.numPages);
    }
  } finally { await src.destroy(); }
  stripMetadata(out);
  return out.save();
}

/** 预计大小：普通水印几乎不变；压平按每页约 220 KB 估算。 */
export function estimateSize(sizes: { bytes: number; pages: number; flatten: boolean }[]) {
  return sizes.reduce((a, x) => a + (x.flatten ? x.pages * 220_000 : x.bytes * 1.01 + 6_000), 0);
}
export const sizeLabel = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
