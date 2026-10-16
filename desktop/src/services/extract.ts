// 文字提取：PDF 先读文字层；文字太少的页面渲染成图片，交给系统 OCR。图片直接 OCR。

import * as pdfjs from "pdfjs-dist";
import workerURL from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extname, platform } from "../platform/platform";
import type { RecognitionContext, Recognition } from "../domain/recognize";
import { recognizeText } from "../domain/recognize";

pdfjs.GlobalWorkerOptions.workerSrc = workerURL;

export interface Extracted { pages: string[]; usedOCR: boolean }

async function pageToPNG(page: pdfjs.PDFPageProxy): Promise<Uint8Array> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 2200 / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function extract(path: string): Promise<Extracted> {
  const p = platform();
  const ext = extname(path).toLowerCase();
  const bytes = await p.readBytes(path);
  if (ext === "pdf") {
    try {
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const pages: string[] = [];
      let usedOCR = false;
      for (let i = 1; i <= Math.min(doc.numPages, 4); i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        let s = "";
        for (const it of tc.items as { str?: string; hasEOL?: boolean }[]) { s += it.str ?? ""; if (it.hasEOL) s += "\n"; }
        s = s.trim();
        if ([...s].length > 40) { pages.push(s); continue; }
        try {
          const text = await p.ocr(await pageToPNG(page));
          pages.push(text || s);
          usedOCR = usedOCR || !!text;
        } catch { pages.push(s); }
      }
      await doc.destroy();
      return { pages, usedOCR };
    } catch {
      return { pages: [""], usedOCR: false };
    }
  }
  if (["png", "jpg", "jpeg", "heic", "tif", "tiff", "bmp", "gif", "webp"].includes(ext)) {
    try {
      const png = ext === "png" ? bytes : await toPNG(bytes, ext);
      return { pages: [await p.ocr(png)], usedOCR: true };
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
export async function thumbnail(path: string, width = 240): Promise<string | null> {
  try {
    const bytes = await platform().readBytes(path);
    if (extname(path).toLowerCase() !== "pdf") return platform().fileURL(path);
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (width * 2) / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    await doc.destroy();
    return canvas.toDataURL("image/png");
  } catch { return null; }
}

export { pdfjs };
