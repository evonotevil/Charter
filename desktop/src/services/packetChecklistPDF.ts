// 材料包里的「00 目录.pdf」。这里单独排版，不影响到期清单和全部档案导出的通用 PDF。

import type { Color, PDFFont, PDFPage } from "pdf-lib";
import illustrations from "../assets/packet-illustrations.json";
import nunitoURL from "../assets/fonts/Nunito-Black-Print.ttf?url";
import { long, parseDay } from "../domain/day";
import { platform } from "../platform/platform";
import { wrapPDFText as wrap } from "./pdfText";
import { brandFontSubset } from "./brandfont";

export interface PacketChecklistFile {
  number: number;
  fileName: string;
  issueText: string;
  warning?: string;
}

export interface PacketChecklistMissing {
  title: string;
  reason: string;
}

export interface PacketChecklistData {
  company: string;
  purpose: string;
  day: string;
  files: PacketChecklistFile[];
  missing: PacketChecklistMissing[];
  summary?: {
    total: number;
    watermarked?: number;
    cleaned?: number;
    watermarkText?: string;
  };
}

const W = 595.28;
const H = 841.89;
const LEFT = 48;
const RIGHT = W - LEFT;
const BOTTOM = 58;

function roundedRect(page: PDFPage, x: number, y: number, w: number, h: number, radius: number, color: Color) {
  const r = Math.min(radius, w / 2, h / 2);
  page.drawRectangle({ x: x + r, y, width: w - r * 2, height: h, color });
  page.drawRectangle({ x, y: y + r, width: w, height: h - r * 2, color });
  for (const [cx, cy] of [[x + r, y + r], [x + w - r, y + r], [x + r, y + h - r], [x + w - r, y + h - r]]) {
    page.drawCircle({ x: cx, y: cy, size: r, color });
  }
}

function drawRight(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color: Color) {
  page.drawText(text, { x: x - font.widthOfTextAtSize(text, size), y, font, size, color });
}

export async function writePacketChecklistPDF(data: PacketChecklistData): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, LineCapStyle, pushGraphicsState, popGraphicsState, setTextRenderingMode, TextRenderingMode, setLineWidth, setStrokingColor } = await import("pdf-lib");
  const { default: fontkit } = await import("@pdf-lib/fontkit");
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const day = parseDay(data.day);
  const stamp = `导出于 ${day ? long(day) : data.day}`;
  const footer = `${data.purpose} · 材料清单`;
  const count = `${data.files.length} 份`;
  const missingLabel = `缺件 ${data.missing.length} 项`;
  const fileHeading = "随包文件";
  const headers = ["编号", "文件名", "签发日期"];
  const { watermarked, cleaned, watermarkText } = data.summary ?? {};
  const summary = [
    watermarked !== undefined && `${watermarked} 份已加水印`,
    cleaned !== undefined && `${cleaned} 份已清除文件信息`,
  ].filter(Boolean).join("，");
  const handling = [summary, watermarkText && watermarked ? `水印为「${watermarkText}」` : ""].filter(Boolean).join("。");
  const lead = !summary && data.files.length ? "均按原样放入" : data.missing.length ? `尚缺 ${data.missing.length} 项，见末页` : "";
  const missing = data.missing.map(({ title, reason }) => reason && reason !== "还没有这份文件" ? `${title}（${reason}）` : title);
  const alphabet = [stamp, footer, fileHeading, count, missingLabel, ...headers, lead, handling, ...missing, "。 · 续、0123456789", data.company,
    ...data.files.flatMap(({ fileName, issueText, warning }) => [fileName, issueText, warning])].join("");
  const brand = await brandFontSubset(alphabet);
  const system = brand ? null : await platform().cjkFont().catch(() => null);
  const textFont = brand ?? system;
  const font = textFont ? await doc.embedFont(textFont, { subset: true }) : await doc.embedFont(StandardFonts.Helvetica);
  const latin = await fetch(nunitoURL).then(async r => r.ok ? doc.embedFont(await r.arrayBuffer()) : undefined).catch(() => undefined) ?? await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = (value: string) => {
    const text = value.replace(/[\x00-\x1f]/g, " ");
    return brand || system ? text : text.replace(/[^\x20-\x7e]/g, "?");
  };
  const color = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
  const ink = color("#25352c"), muted = color("#535f57"), line = color("#dce4d8"), green = color("#347607");
  const amber = color("#8a5b00"), softAmber = color("#fff3cf");
  const short = data.files.length < 7;
  // All layout measurements are PDF points down from the top of the A4 page.
  const nameX = LEFT + 39.7;
  const nameW = RIGHT - nameX - 87;
  let page = doc.addPage([W, H]);
  let top = 0;
  const bottom = H - BOTTOM - 10;

  function label(text: string, x: number, baseline: number, size: number, fill = ink, weight = 0) {
    if (weight) page.pushOperators(pushGraphicsState(), setLineWidth(weight), setStrokingColor(fill), setTextRenderingMode(TextRenderingMode.FillAndOutline));
    page.drawText(clean(text), { x, y: H - baseline, font, size, color: fill });
    if (weight) page.pushOperators(popGraphicsState());
  }
  function rule(at: number, thickness = 0.65, fill = line) {
    page.drawLine({ start: { x: LEFT, y: H - at }, end: { x: RIGHT, y: H - at }, thickness, color: fill });
  }
  function illustration(name: keyof typeof illustrations, x: number, at: number, width: number) {
    // Flattened vector paths from the approved print illustrations; scale also applies to their strokes.
    const layers: { d: string; fill?: string; stroke?: string; width?: number }[] = illustrations[name];
    const scale = width / (name === "mark" ? 120 : 192);
    for (const layer of layers) page.drawSvgPath(layer.d, { x, y: H - at, scale, color: layer.fill ? color(layer.fill) : undefined,
      borderColor: layer.stroke ? color(layer.stroke) : undefined, borderWidth: layer.width, borderLineCap: LineCapStyle.Round });
  }
  function masthead(first: boolean) {
    const markWidth = first ? 22 : 16.5;
    illustration("mark", LEFT, 41, markWidth);
    page.drawText("Charter", { x: LEFT + markWidth + 5.8, y: H - (first ? 60 : 55), font: latin, size: first ? 18 : 14, color: green });
    drawRight(page, clean(stamp), RIGHT, H - (first ? 57 : 54), font, 9.6, muted);
    if (!first) rule(69);
  }
  function continuation() {
    page = doc.addPage([W, H]);
    masthead(false);
    // The full names appear on the first page. Keep subsequent pages usable even with unusually long titles.
    const listing = wrap(clean(footer), font, 16, RIGHT - LEFT);
    label(listing[0], LEFT, 94, 16, ink, 0.3);
    const company = wrap(clean(data.company), font, 10, RIGHT - LEFT);
    company.slice(0, 2).forEach((text, i) => label(text, LEFT, 112 + i * 14, 10, muted));
    top = 139 + (Math.min(company.length, 2) - 1) * 14;
  }
  function flow(lines: string[], x: number, size: number, pitch: number, fill = ink, weight = 0) {
    for (const text of lines) {
      if (top + pitch > bottom) continuation();
      label(text, x, top, size, fill, weight);
      top += pitch;
    }
  }
  masthead(true);
  const heroWidth = RIGHT - LEFT - (short ? 155 : 136);
  const folderWidth = short ? 139 : 122;
  illustration("folder", RIGHT - folderWidth, short ? 90 : 81, folderWidth);
  top = short ? 124 : 102;
  flow(wrap(clean(data.purpose), font, 13, heroWidth), LEFT, 13, 18, green, 0.3);
  top += 24;
  label("材料清单", LEFT, top, 34, ink, 0.65);
  top += 28;
  flow(wrap(clean(data.company), font, 12, heroWidth), LEFT, 12, 18);
  top += short ? 41 : 24;

  function tableHeader(continued: boolean) {
    label(fileHeading, LEFT, top, 17, ink, 0.35);
    label(continued ? count + " · 续" : count, LEFT + 75, top, 10.5, muted);
    if (!continued) drawRight(page, clean(lead), RIGHT, H - top, font, 9, muted);
    top += 25;
    if (!continued && handling) {
      flow(wrap(clean(handling + "。"), font, 9.5, RIGHT - LEFT), LEFT, 9.5, 14, muted);
      top += 5;
    }
    label(headers[0], LEFT, top, 9, muted);
    label(headers[1], nameX, top, 9, muted);
    drawRight(page, clean(headers[2]), RIGHT, H - top, font, 9, muted);
    top += 8;
    rule(top, 1.7, color("#b8cbb1"));
  }
  function nextTable() { continuation(); tableHeader(true); }
  if (top + 66 > bottom) continuation();
  tableHeader(false);
  for (const item of data.files) {
    const size = short ? 13 : 11.5;
    const pitch = short ? 18 : 16;
    const inset = short ? 15 : 5;
    const fileName = clean(item.fileName);
    const ext = fileName.match(/\.[\w]{1,10}$/)?.[0];
    const nameLines = wrap(fileName, font, size, nameW);
    // Keep an extension with at least the end of its filename at a line break.
    if (ext && nameLines.length > 1 && nameLines[nameLines.length - 1] === ext) {
      const prior = [...nameLines[nameLines.length - 2]];
      const tail = prior.splice(-2).join("");
      nameLines.splice(-2, 2, ...[prior.join(""), tail + ext].filter(Boolean));
    }
    const warningLines = item.warning ? wrap(clean(item.warning), font, 9.3, nameW) : [];
    const height = 2 * inset + pitch * nameLines.length + 13 * warningLines.length;
    if (top + Math.min(height, bottom - 200) > bottom) nextTable();
    let baseline = top + inset + size;
    page.drawText(String(item.number).padStart(2, "0"), { x: LEFT, y: H - baseline, font: latin, size: short ? 16 : 13.3, color: green });
    for (const [i, text] of nameLines.entries()) {
      if (baseline + 3 > bottom) { nextTable(); baseline = top + inset + size; }
      const hasExt = ext && i === nameLines.length - 1 && text.endsWith(ext);
      const base = hasExt ? text.slice(0, -ext.length) : text;
      label(base, nameX, baseline, size);
      if (hasExt) label(ext, nameX + font.widthOfTextAtSize(base, size), baseline, 9.6, muted);
      if (i === 0) drawRight(page, clean(item.issueText), RIGHT, H - baseline, font, short ? 10.5 : 9.8, muted);
      baseline += pitch;
    }
    for (const note of warningLines) {
      if (baseline + 3 > bottom) { nextTable(); baseline = top + inset + 9.3; }
      label(note, nameX, baseline, 9.3, amber);
      baseline += 13;
    }
    top = baseline - pitch + (short ? 14 : 8);
    rule(top);
  }

  if (missing.length) {
    const size = short ? 11.5 : 11;
    const width = (RIGHT - LEFT) * 0.76;
    const lines: string[] = [];
    let part = "";
    for (const title of missing) {
      const value = clean(title), candidate = part ? part + clean("、") + value : value;
      if (font.widthOfTextAtSize(candidate, size) <= width) { part = candidate; continue; }
      if (part) lines.push(part);
      const pieces = wrap(value, font, size, width);
      lines.push(...pieces.slice(0, -1));
      part = pieces[pieces.length - 1];
    }
    if (part) lines.push(part);
    top += short ? 18 : 15;
    if (top + Math.min(lines.length * 18, 72) > bottom) continuation();
    function badge() {
      const width = 25 + font.widthOfTextAtSize(clean(missingLabel), 9);
      roundedRect(page, LEFT, H - top - 16, width, 16, 6, softAmber);
      page.drawSvgPath("M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v6h6M8 13h8M8 17h6", {
        x: LEFT + 6, y: H - top - 3.5, scale: 0.37, borderColor: amber, borderWidth: 2, borderLineCap: LineCapStyle.Round,
      });
      label(missingLabel, LEFT + 18, top + 11.5, 9, amber, 0.2);
    }
    badge();
    for (const text of lines) {
      if (top + 16 > bottom) { continuation(); badge(); }
      drawRight(page, text, RIGHT, H - top - 12.5, font, size, ink);
      top += 18;
    }
  }
  const pages = doc.getPages();
  pages.forEach((sheet, i) => {
    page = sheet;
    rule(H - 58, 0.9);
    const number = `${i + 1} / ${pages.length}`;
    const maxWidth = RIGHT - LEFT - latin.widthOfTextAtSize(number, 11) - 12;
    const footerLines = wrap(clean(footer), font, 9, maxWidth);
    label(footerLines.length === 1 ? footerLines[0] : "材料清单", LEFT, H - 38, 9, muted);
    drawRight(page, number, RIGHT, 38, latin, 11, ink);
  });
  doc.setTitle(`${data.company} · ${data.purpose}材料清单`);
  doc.setProducer("Charter");
  return doc.save();
}
