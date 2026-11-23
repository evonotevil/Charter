// 文字提取：PDF 先读文字层；文字太少的页面渲染成图片，交给系统 OCR。图片直接 OCR；DOCX 只读正文 XML。

import type { PDFPageProxy, RenderTask } from "pdfjs-dist";
import workerURL from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { basename, extname, platform } from "../platform/platform";
import type { RecognitionContext, Recognition } from "../domain/recognize";
import { recognizeText } from "../domain/recognize";
import { officeDocumentExtensions } from "../domain/importFormats";
import { xlsxText } from "./xlsxText";

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

/** 只读取 DOCX 的正文 XML，不解释字段、关系或嵌入对象。 */
async function docxText(bytes: Uint8Array) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const document = zip.file("word/document.xml");
  if (!document) return "";
  const xml = await document.async("string");
  if (xml.length > 8 * 1024 * 1024) return "";
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  const root = parsed.documentElement;
  const wordNamespaces = new Set([
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "http://purl.oclc.org/ooxml/wordprocessingml/main",
  ]);
  if (!root || root.localName !== "document" || !wordNamespaces.has(root.namespaceURI ?? "")) return "";
  const parts: string[] = [];
  let remaining = 200_000;
  const append = (text: string) => { if (remaining > 0) { parts.push(text.slice(0, remaining)); remaining -= text.length; } };
  const stack: { node: globalThis.Node; exit: boolean }[] = [{ node: root, exit: false }];
  while (stack.length && remaining > 0) {
    const entry = stack.pop()!;
    const node = entry.node;
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    const name = wordNamespaces.has(element.namespaceURI ?? "") ? element.localName : "";
    if (entry.exit) {
      if (name === "tc") append("\t");
      else if (name === "p" || name === "tr") append("\n");
      continue;
    }
    if (name === "t") { append(element.textContent ?? ""); continue; }
    if (name === "tab") { append("\t"); continue; }
    if (name === "br" || name === "cr") { append("\n"); continue; }
    stack.push({ node, exit: true });
    for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push({ node: node.childNodes.item(i)!, exit: false });
  }
  return parts.join("")
    .replace(/[ \f\v]+\n/g, "\n")
    .replace(/\n+\t/g, "\t")
    .replace(/\t+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
  if (ext === "docx") {
    try { return { pages: [await docxText(bytes)], usedOCR: false }; }
    catch { return { pages: [""], usedOCR: false }; }
  }
  if (ext === "xlsx") return { pages: await xlsxText(bytes), usedOCR: false };
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

export async function recognizeFile(path: string, ctx: RecognitionContext, sourceName = basename(path)): Promise<Recognition> {
  const ex = await extract(path);
  return recognizeText(ex.pages, sourceName.replace(/\.[^.]+$/, ""), ex.usedOCR, ctx, extname(path).toLowerCase() === "xlsx" ? "workbook" : "document");
}

// 文件列表、公司档案和导入预览共用两个缩略图生成名额。
const thumbQueue = new Set<() => void>();
let thumbActive = 0;

function acquireThumbSlot(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (thumbActive < 2) {
    thumbActive++;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const start = () => {
      thumbQueue.delete(start);
      signal.removeEventListener("abort", cancel);
      thumbActive++;
      resolve(true);
    };
    const cancel = () => {
      thumbQueue.delete(start);
      resolve(false);
    };
    thumbQueue.add(start);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

async function drawPdfThumbnail(canvas: HTMLCanvasElement, bytes: Uint8Array, width: number, signal: AbortSignal) {
  const pdfjs = await loadPdfReader();
  if (signal.aborted) return false;
  // 缩略图画布在 CPU 上编码 JPEG。让 worker 传回像素，省去为原图创建 GPU 位图。
  const loading = pdfjs.getDocument({ data: bytes.slice(), isOffscreenCanvasSupported: false });
  let rendering: RenderTask | undefined;

  const draw = async () => {
    const doc = await loading.promise;
    if (signal.aborted) return false;
    const page = await doc.getPage(1);
    if (signal.aborted) return false;
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    rendering = page.render({ canvasContext: ctx, viewport });
    await rendering.promise;
    return !signal.aborted;
  };

  // 加载中的 PDF 被销毁时，正在等待的加载 promise 可能不会结束。
  // 取消直接唤醒调用方，同时终止已经开始绘制的那一页。
  let finishAbort!: () => void;
  const aborted = new Promise<false>((resolve) => { finishAbort = () => resolve(false); });
  const cancel = () => { rendering?.cancel(); finishAbort(); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    return await Promise.race([draw(), aborted]);
  } finally {
    signal.removeEventListener("abort", cancel);
    await loading.destroy();
  }
}

async function thumbnailURL(canvas: HTMLCanvasElement, quality: number, signal: AbortSignal): Promise<string | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob || signal.aborted) return null;
  const reader = new FileReader();
  const cancel = () => reader.abort();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    return await new Promise<string | null>((resolve) => {
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.readAsDataURL(blob);
    });
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

/** PDF 首页或图片的 JPEG 缩略图（data URL）。 */
export async function thumbnail(path: string, width = 240, signal = new AbortController().signal): Promise<string | null> {
  if (officeDocumentExtensions.includes(extname(path).toLowerCase())) return null;
  if (!await acquireThumbSlot(signal)) return null;
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (signal.aborted) return null;
    const bytes = await platform().readBytes(path);
    if (signal.aborted) return null;
    canvas = document.createElement("canvas");
    const out = Math.round(width * 2);
    const pdf = extname(path).toLowerCase() === "pdf";
    if (pdf) {
      if (!await drawPdfThumbnail(canvas, bytes, out, signal)) return null;
    } else {
      const bmp = await createImageBitmap(new Blob([bytes.slice()]), { resizeWidth: out, resizeQuality: "medium" });
      try {
        if (signal.aborted) return null;
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        canvas.getContext("2d", { willReadFrequently: true })!.drawImage(bmp, 0, 0);
      } finally { bmp.close(); }
    }
    if (signal.aborted) return null;
    return await thumbnailURL(canvas, pdf ? 0.82 : 0.8, signal);
  } catch {
    return null;
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    thumbActive--;
    thumbQueue.values().next().value?.();
  }
}
