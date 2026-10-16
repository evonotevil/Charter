// 生成目录 PDF、ZIP 和 XLSX。PDF 使用系统里的中文字体（子集嵌入），找不到时退回只显示英文的字体。

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import JSZip from "jszip";
import { platform } from "../platform/platform";

export interface PDFSection { heading: string; lines: string[]; alert: boolean }

let fontCache: Uint8Array | null | undefined;
async function cjk(): Promise<Uint8Array | null> {
  if (fontCache === undefined) {
    try { fontCache = await platform().cjkFont(); } catch { fontCache = null; }
  }
  return fontCache;
}

const accent = rgb(0.659, 0.075, 0.169);

export async function writePDF(title: string, subtitle: string, sections: PDFSection[], footer?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = await cjk();
  let font: PDFFont, bold: PDFFont;
  let ascii = false;
  if (bytes) {
    font = await doc.embedFont(bytes, { subset: true });
    bold = font;
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
    ascii = true;
  }
  const clean = (s: string) => (ascii ? s.replace(/[^\x20-\x7e]/g, "?") : s);
  const W = 595, H = 842, left = 56, width = 483;
  let page = doc.addPage([W, H]);
  let y = 0;

  const wrap = (text: string, f: PDFFont, size: number): string[] => {
    const out: string[] = [];
    let line = "";
    for (const ch of [...clean(text)]) {
      const next = line + ch;
      if (f.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = ch; } else line = next;
    }
    out.push(line);
    return out;
  };
  const begin = (first: boolean) => {
    if (!first) page = doc.addPage([W, H]);
    if (first) {
      page.drawCircle({ x: left + 11, y: 771, size: 11, color: accent });
      let ty = 740;
      for (const l of wrap(title, bold, 24)) { page.drawText(l, { x: left, y: ty, size: 24, font: bold }); ty -= 30; }
      for (const l of wrap(subtitle, bold, 13)) { page.drawText(l, { x: left, y: ty - 4, size: 13, font: bold, color: accent }); ty -= 18; }
      y = ty - 24;
    } else y = 780;
  };
  const ensure = (h: number) => { if (y - h < 60) begin(false); };

  begin(true);
  for (const s of sections) {
    if (s.heading) {
      ensure(36);
      y -= 10;
      page.drawText(clean(s.heading), { x: left, y, size: 12, font: bold, color: s.alert ? accent : rgb(0, 0, 0) });
      y -= 22;
    }
    for (const line of s.lines) for (const l of wrap(line, font, 11)) {
      ensure(20);
      page.drawText(l, { x: left, y, size: 11, font, color: rgb(0.33, 0.33, 0.33) });
      y -= 18;
    }
  }
  if (footer) {
    ensure(40);
    y -= 16;
    for (const l of wrap(footer, bold, 10.5)) { page.drawText(l, { x: left, y, size: 10.5, font: bold, color: accent }); y -= 15; }
  }
  return await doc.save();
}

/** “仅存储”的 ZIP（PDF 本身已压缩），UTF-8 文件名，Windows 和 Mac 都能正确显示中文。 */
export async function writeZip(entries: { path: string; data: Uint8Array }[], onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const zip = new JSZip();
  entries.forEach((e, i) => { zip.file(e.path, e.data, { binary: true, createFolders: false }); onProgress?.(i + 1, entries.length); });
  return await zip.generateAsync({ type: "uint8array", compression: "STORE", platform: "UNIX" });
}

export async function writeXLSX(sheet: string, rows: string[][]): Promise<Uint8Array> {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const col = (i: number) => { let n = i, s = ""; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="6" customWidth="1"/><col min="2" max="2" width="28" customWidth="1"/><col min="3" max="5" width="14" customWidth="1"/><col min="6" max="6" width="40" customWidth="1"/><col min="7" max="7" width="40" customWidth="1"/></cols><sheetData>';
  rows.forEach((row, r) => {
    xml += `<row r="${r + 1}">`;
    row.forEach((v, c) => { if (v) xml += `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`; });
    xml += "</row>";
  });
  xml += "</sheetData></worksheet>";
  const z = new JSZip();
  z.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  z.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  z.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  z.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  z.file("xl/worksheets/sheet1.xml", xml);
  return await z.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** 在文件包文件夹里找一个不重名的位置写入。 */
export async function writeUnique(dir: string, base: string, ext: string, data: Uint8Array): Promise<string> {
  const p = platform();
  await p.mkdirs(dir);
  let target = p.join(dir, `${base}.${ext}`);
  for (let n = 2; (await p.stat(target)).exists; n++) target = p.join(dir, `${base} (${n}).${ext}`);
  await p.writeBytes(target, data);
  return target;
}
