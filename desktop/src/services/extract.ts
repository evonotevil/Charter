// 文字提取：PDF 先读文字层；文字太少的页面渲染成图片，交给系统 OCR。图片直接 OCR。

import type { PDFPageProxy } from "pdfjs-dist";
import workerURL from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extname, platform } from "../platform/platform";
import type { RecognitionContext, Recognition } from "../domain/recognize";
import { recognizeText } from "../domain/recognize";

export async function loadPdfReader() {
  const reader = await import("pdfjs-dist");
  reader.GlobalWorkerOptions.workerSrc = workerURL;
  return reader;
}

export interface Extracted { pages: string[]; usedOCR: boolean }

// 5.5.6：识别进度（“正在识别第 2/4 页”），界面用 useOcrStatus 订阅
let ocrStatus: string | null = null;
const statusListeners = new Set<() => void>();
function setOcrStatus(s: string | null) { if (s === ocrStatus) return; ocrStatus = s; statusListeners.forEach((l) => l()); }
export const subscribeOcrStatus = (l: () => void) => { statusListeners.add(l); return () => { statusListeners.delete(l); }; };
export const getOcrStatus = () => ocrStatus;

// 5.5.6：OCR 用 JPEG（编码比 PNG 快得多、文件小），长边 1800px 对证照类文字已经足够
async function pageToImage(page: PDFPageProxy): Promise<Uint8Array> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, 1800 / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.9));
  canvas.width = canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

/** 多张图一次识别并报告逐页进度；平台不支持批量时逐张识别。单张失败记为空文字。 */
export async function ocrMany(images: Uint8Array[]): Promise<string[]> {
  const p = platform();
  if (!images.length) return [];
  const total = images.length;
  const label = (done: number) => (total > 1 ? `正在识别第 ${Math.min(done + 1, total)}/${total} 页` : "正在识别");
  setOcrStatus(label(0));
  try {
    if (p.ocrBatch) { try { return await p.ocrBatch(images, (done) => setOcrStatus(label(done))); } catch { /* 回落逐张 */ } }
    const out: string[] = [];
    for (const [i, img] of images.entries()) { setOcrStatus(label(i)); try { out.push(await p.ocr(img)); } catch { out.push(""); } }
    return out;
  } finally { setOcrStatus(null); }
}

export async function extract(path: string): Promise<Extracted> {
  const p = platform();
  const ext = extname(path).toLowerCase();
  const bytes = await p.readBytes(path);
  if (ext === "pdf") {
    try {
      const pdfjs = await loadPdfReader();
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const pages: string[] = [];
      const need: { index: number; image: Uint8Array }[] = [];
      // 先读文字层；文字太少的页先全部渲染好，再一次交给系统 OCR（5.5.6：原来每页单独启动一次识别进程）
      for (let i = 1; i <= Math.min(doc.numPages, 4); i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        let s = "";
        for (const it of tc.items as { str?: string; hasEOL?: boolean }[]) { s += it.str ?? ""; if (it.hasEOL) s += "\n"; }
        s = s.trim();
        pages.push(s);
        if ([...s].length > 40) continue;
        try { need.push({ index: pages.length - 1, image: await pageToImage(page) }); } catch { /* 留文字层 */ }
        page.cleanup();
      }
      await doc.destroy();
      let usedOCR = false;
      const texts = await ocrMany(need.map((x) => x.image));
      need.forEach((x, k) => { const t = texts[k]?.trim(); if (t) { pages[x.index] = t; usedOCR = true; } });
      return { pages, usedOCR };
    } catch {
      return { pages: [""], usedOCR: false };
    }
  }
  if (["png", "jpg", "jpeg", "heic", "tif", "tiff", "bmp", "gif", "webp"].includes(ext)) {
    try {
      // PNG / JPEG 系统 OCR 能直接读，不再先转码（5.5.6）
      const img = ["png", "jpg", "jpeg"].includes(ext) ? bytes : await toPNG(bytes, ext);
      return { pages: [(await ocrMany([img]))[0] ?? ""], usedOCR: true };
    } catch { return { pages: [""], usedOCR: true }; }
  }
  try { return { pages: [new TextDecoder().decode(bytes)], usedOCR: false }; } catch { return { pages: [""], usedOCR: false }; }
}

async function toPNG(bytes: Uint8Array, ext: string): Promise<Uint8Array> {
  const type = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function recognizeFile(path: string, ctx: RecognitionContext): Promise<Recognition> {
  const ex = await extract(path);
  const name = path.split(/[\\/]/).pop() ?? "";
  return recognizeText(ex.pages, name.replace(/\.[^.]+$/, ""), ex.usedOCR, ctx);
}

/** PDF 首页缩略图（data URL）。 */
// 5.3.3：缩略图——同时最多解析 2 份；PDF 和图片都缩成小 JPEG（约 240px 宽），不再把原图当缩略图显示。
const thumbQueue: (() => void)[] = [];
let thumbActive = 0;
const thumbSlot = () => new Promise<void>((res) => { if (thumbActive < 2) { thumbActive++; res(); } else thumbQueue.push(() => { thumbActive++; res(); }); });
const thumbDone = () => { thumbActive--; thumbQueue.shift()?.(); };

export async function thumbnail(path: string, width = 240, signal?: { cancelled: boolean }): Promise<string | null> {
  await thumbSlot();
  try {
    if (signal?.cancelled) return null;
    const bytes = await platform().readBytes(path);
    if (signal?.cancelled) return null;
    const out = Math.round(width * 2);
    if (extname(path).toLowerCase() !== "pdf") {
      const bmp = await createImageBitmap(new Blob([bytes.slice()]), { resizeWidth: out, resizeQuality: "medium" });
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0); bmp.close();
      const url = c.toDataURL("image/jpeg", 0.8); c.width = c.height = 0;
      return url;
    }
    const pdfjs = await loadPdfReader();
    if (signal?.cancelled) return null;
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: out / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width; canvas.height = vp.height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const url = canvas.toDataURL("image/jpeg", 0.82); canvas.width = canvas.height = 0;
      return url;
    } finally { await doc.destroy(); }
  } catch { return null; } finally { thumbDone(); }
}
