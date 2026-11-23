// 申报日历里的独立清单 PDF。这里只负责印刷排版，不复用档案和材料包的通用 PDF。

import type { Color, PDFFont, PDFPage } from "pdf-lib";
import nunitoURL from "../assets/fonts/Nunito-Black-Print.ttf?url";
import { filingDueStatus, type FilingChecklistRow } from "../domain/filingChecklist";
import { platform } from "../platform/platform";
import { brandFontSubset } from "./brandfont";
import { wrapPDFText as wrap } from "./pdfText";

export interface FilingChecklistPDFData {
  rangeLabel: string;
  exportedOn: string;
  rows: FilingChecklistRow[];
}

const W = 595.28;
const H = 841.89;
const LEFT = 44;
const RIGHT = W - LEFT;
const CONTENT_BOTTOM = H - 66;

const DATE_X = LEFT;
const DATE_W = 72;
const MAIN_X = 126;
const MAIN_W = 224;
const AGENT_X = 362;
const AGENT_W = 102;
const STATUS_X = 476;
const STATUS_W = RIGHT - STATUS_X;

interface Fonts {
  body: PDFFont;
  display: PDFFont;
}

interface Palette {
  ink: Color;
  muted: Color;
  line: Color;
  green: Color;
  pale: Color;
  danger: Color;
  softDanger: Color;
}

interface PreparedRow {
  value: FilingChecklistRow;
  date: string[];
  company: string[];
  filing: string[];
  agent: string[];
  statuses: { text: string; tone: "danger" | "today" | "confirmed" | "estimated" }[];
  height: number;
  continued?: boolean;
}

function monthKey(due: string): string {
  const match = due.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "unknown";
}

function monthLabel(key: string): string {
  const match = key.match(/^(\d{4})-(\d{2})$/);
  return match ? `${Number(match[1])}年${Number(match[2])}月` : "日期未识别";
}

function cleanText(value: string) {
  return value.replace(/[\x00-\x1f]/g, " ").trim();
}

function color(rgb: (red: number, green: number, blue: number) => Color, hex: string) {
  return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
}

function prepared(row: FilingChecklistRow, exportedOn: string, fonts: Fonts, clean: (value: string) => string): PreparedRow {
  const date = wrap(clean(row.due), fonts.body, 9.2, DATE_W);
  const company = wrap(clean(row.company), fonts.body, 10.6, MAIN_W);
  const filing = wrap(clean([row.jurisdiction, row.filing].filter(Boolean).join(" · ")), fonts.body, 9.3, MAIN_W);
  const agent = wrap(clean(row.agent || "未指定中介"), fonts.body, 9.2, AGENT_W);
  const statuses: PreparedRow["statuses"] = [];
  const dueStatus = filingDueStatus(row, exportedOn);
  if (dueStatus === "已逾期") statuses.push({ text: dueStatus, tone: "danger" });
  else if (dueStatus === "今日截止") statuses.push({ text: dueStatus, tone: "today" });
  statuses.push(row.dateConfirmed ? { text: "已确认", tone: "confirmed" } : { text: "日期推算", tone: "estimated" });
  const mainHeight = company.length * 13.5 + 3 + filing.length * 12;
  const sideHeight = Math.max(date.length * 12, agent.length * 12, statuses.length * 18);
  return { value: row, date, company, filing, agent, statuses, height: Math.max(42, Math.ceil(Math.max(mainHeight, sideHeight) + 14)) };
}

function splitTallRow(row: PreparedRow, maxHeight: number): PreparedRow[] {
  if (row.height <= maxHeight) return [row];
  const chunks: PreparedRow[] = [];
  let dateAt = 0, companyAt = 0, filingAt = 0, agentAt = 0;
  let first = true;
  while (dateAt < row.date.length || companyAt < row.company.length || filingAt < row.filing.length || agentAt < row.agent.length || first) {
    const inner = Math.max(24, maxHeight - 14);
    const dateCount = Math.max(1, Math.floor(inner / 12));
    const agentCount = Math.max(1, Math.floor(inner / 12));
    const date = row.date.slice(dateAt, dateAt + dateCount);
    const agent = row.agent.slice(agentAt, agentAt + agentCount);
    dateAt += date.length;
    agentAt += agent.length;

    let used = 0;
    const company: string[] = [];
    const filing: string[] = [];
    while (companyAt < row.company.length && used + 13.5 <= inner) {
      company.push(row.company[companyAt++]); used += 13.5;
    }
    if (companyAt >= row.company.length && filingAt < row.filing.length && used + 3 + 12 <= inner) {
      used += 3;
      while (filingAt < row.filing.length && used + 12 <= inner) {
        filing.push(row.filing[filingAt++]); used += 12;
      }
    }
    const statuses = first ? row.statuses : [];
    const mainHeight = company.length * 13.5 + (filing.length ? 3 + filing.length * 12 : 0);
    const sideHeight = Math.max(date.length * 12, agent.length * 12, statuses.length * 18);
    chunks.push({ ...row, date, company, filing, agent, statuses, height: Math.max(42, Math.ceil(Math.max(mainHeight, sideHeight) + 14)), continued: !first });
    first = false;
  }
  return chunks;
}

export async function writeFilingChecklistPDF(data: FilingChecklistPDFData): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, LineCapStyle } = await import("pdf-lib");
  const { default: fontkit } = await import("@pdf-lib/fontkit");
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const staticText = [
    "Charter 申报日历清单 导出日 全部申报事项 共 件 推算日期尚待确认 逾期按导出日判断 截止日 公司 事项 中介 状态 已逾期 今日截止 未到期 已确认 日期推算 未指定中介 当前范围没有申报事项 请调整筛选范围后再导出 日期未识别 年 月 续 0123456789- / · ； “ ” 。",
    data.rangeLabel,
    data.exportedOn,
    ...data.rows.flatMap((row) => [row.due, row.company, row.jurisdiction, row.filing, row.agent]),
  ].join("");
  const brand = await brandFontSubset(staticText);
  const system = brand ? null : await platform().cjkFont().catch(() => null);
  // HarfBuzz 子集不可用时宁可保留完整系统字体，也不能让清单在某些桌面环境丢字。
  const bodyFeatures = { features: { liga: false, clig: false } };
  const body = brand ? await doc.embedFont(brand, { ...bodyFeatures, subset: true }) : system ? await doc.embedFont(system, bodyFeatures) : await doc.embedFont(StandardFonts.Helvetica);
  const display = await fetch(nunitoURL).then(async (response) => response.ok ? doc.embedFont(await response.arrayBuffer()) : undefined).catch(() => undefined)
    ?? await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts: Fonts = { body, display };
  const clean = (value: string) => {
    const text = cleanText(value);
    return brand || system ? text : text.replace(/[^\x20-\x7e]/g, "?");
  };
  const palette: Palette = {
    ink: color(rgb, "#25352c"),
    muted: color(rgb, "#5b675f"),
    line: color(rgb, "#dce4d8"),
    green: color(rgb, "#347607"),
    pale: color(rgb, "#f4f7f2"),
    danger: color(rgb, "#9f3027"),
    softDanger: color(rgb, "#fcece8"),
  };

  const rows = data.rows.map((row) => prepared(row, data.exportedOn, fonts, clean));
  const groups: { key: string; label: string; rows: PreparedRow[] }[] = [];
  for (const row of rows) {
    const key = monthKey(row.value.due);
    const tail = groups[groups.length - 1];
    if (!tail || tail.key !== key) groups.push({ key, label: monthLabel(key), rows: [] });
    groups[groups.length - 1].rows.push(row);
  }

  let page = doc.addPage([W, H]);
  let top = 0;
  const pages: PDFPage[] = [page];

  function text(value: string, x: number, baseline: number, size: number, font = body, fill = palette.ink) {
    page.drawText(clean(value), { x, y: H - baseline, font, size, color: fill });
  }
  function right(value: string, x: number, baseline: number, size: number, font = body, fill = palette.ink) {
    const shown = clean(value);
    text(shown, x - font.widthOfTextAtSize(shown, size), baseline, size, font, fill);
  }
  function rule(at: number, thickness = 0.65, fill = palette.line) {
    page.drawLine({ start: { x: LEFT, y: H - at }, end: { x: RIGHT, y: H - at }, thickness, color: fill });
  }
  function masthead(first: boolean) {
    page.drawCircle({ x: LEFT + 9, y: H - 47, size: 9, color: palette.green });
    page.drawLine({ start: { x: LEFT + 4.5, y: H - 47 }, end: { x: LEFT + 8, y: H - 50.5 }, thickness: 1.8, color: rgb(1, 1, 1), lineCap: LineCapStyle.Round });
    page.drawLine({ start: { x: LEFT + 8, y: H - 50.5 }, end: { x: LEFT + 14.3, y: H - 43.5 }, thickness: 1.8, color: rgb(1, 1, 1), lineCap: LineCapStyle.Round });
    text("Charter", LEFT + 25, 53, first ? 17 : 14, display, palette.green);
    right(`导出日 ${data.exportedOn}`, RIGHT, 51, 9.2, body, palette.muted);
    if (!first) rule(67);
  }
  function tableHeader() {
    text("截止日", DATE_X, top, 8.7, body, palette.muted);
    text("公司 / 事项", MAIN_X, top, 8.7, body, palette.muted);
    text("中介", AGENT_X, top, 8.7, body, palette.muted);
    text("状态", STATUS_X, top, 8.7, body, palette.muted);
    top += 9;
    rule(top, 1.4, color(rgb, "#b8cbb1"));
    top += 3;
  }
  function newPage(first: boolean, add = true) {
    if (add) { page = doc.addPage([W, H]); pages.push(page); }
    masthead(first);
    if (first) {
      text("申报日历清单", LEFT, 92, 27, body, palette.ink);
      text(clean(data.rangeLabel) || "全部申报事项", LEFT, 119, 10.8, body, palette.ink);
      right(`共 ${data.rows.length} 件`, RIGHT, 119, 10.8, body, palette.green);
      page.drawRectangle({ x: LEFT, y: H - 153, width: RIGHT - LEFT, height: 26, color: palette.pale });
      text("推算日期尚待确认；“逾期”按导出日判断。", LEFT + 11, 144, 9, body, palette.muted);
      top = 166;
    } else {
      text("申报日历清单", LEFT, 82, 15, body, palette.ink);
      right("续", RIGHT, 81, 9.3, body, palette.muted);
      top = 101;
    }
    tableHeader();
  }
  function monthHeading(label: string, count: number, continued = false) {
    page.drawRectangle({ x: LEFT, y: H - top - 28, width: RIGHT - LEFT, height: 28, color: palette.pale });
    text(label, LEFT + 9, top + 18.5, 11.3, body, palette.ink);
    right(`${count} 件${continued ? " · 续" : ""}`, RIGHT - 9, top + 18.5, 9.1, body, palette.muted);
    top += 28;
  }
  function statusPill(status: PreparedRow["statuses"][number], at: number) {
    const ink = status.tone === "danger" ? palette.danger : status.tone === "confirmed" ? palette.green : status.tone === "today" ? palette.ink : palette.muted;
    const label = clean(status.text);
    const width = Math.min(STATUS_W, Math.max(42, body.widthOfTextAtSize(label, 8.4) + 14));
    if (status.tone === "danger") page.drawRectangle({ x: STATUS_X, y: H - at - 5, width, height: 17, color: palette.softDanger });
    text(label, STATUS_X + 7, at, 8.4, body, ink);
  }
  function drawRow(row: PreparedRow) {
    const base = top + 14;
    if (row.continued) text("续", DATE_X, base, 8.4, body, palette.muted);
    row.date.forEach((line, index) => text(line, DATE_X, base + index * 12, 9.2, body, palette.ink));
    let main = base;
    row.company.forEach((line) => { text(line, MAIN_X, main, 10.6, body, palette.ink); main += 13.5; });
    main += 3;
    row.filing.forEach((line) => { text(line, MAIN_X, main, 9.3, body, palette.muted); main += 12; });
    row.agent.forEach((line, index) => text(line, AGENT_X, base + index * 12, 9.2, body, palette.ink));
    row.statuses.forEach((status, index) => statusPill(status, base + index * 20));
    top += row.height;
    rule(top);
  }

  newPage(true, false);
  if (!rows.length) {
    const boxTop = top + 28;
    page.drawRectangle({ x: LEFT, y: H - boxTop - 92, width: RIGHT - LEFT, height: 92, color: palette.pale, borderColor: palette.line, borderWidth: 0.8 });
    text("当前范围没有申报事项", LEFT + 18, boxTop + 38, 15, body, palette.ink);
    text(clean(data.rangeLabel) || "请调整筛选范围后再导出。", LEFT + 18, boxTop + 61, 9.5, body, palette.muted);
  } else {
    let entriesDrawn = 0;
    const continuationRowMax = CONTENT_BOTTOM - 157;
    for (const group of groups) {
      const first = splitTallRow(group.rows[0], continuationRowMax)[0];
      const firstPageCanStartTallRow = entriesDrawn === 0 && pages.length === 1 && CONTENT_BOTTOM - top - 28 >= 120;
      if (!firstPageCanStartTallRow && top + 28 + first.height > CONTENT_BOTTOM) newPage(false);
      monthHeading(group.label, group.rows.length);
      for (const source of group.rows) {
        const available = CONTENT_BOTTOM - top;
        let parts: PreparedRow[];
        if (source.height <= available) parts = [source];
        else if (entriesDrawn === 0 && pages.length === 1 && available >= 120) parts = splitTallRow(source, available);
        else {
          parts = splitTallRow(source, continuationRowMax);
          if (parts[0].height > available) {
            newPage(false);
            monthHeading(group.label, group.rows.length, true);
          }
        }
        for (const row of parts) {
          if (top + row.height > CONTENT_BOTTOM) {
            newPage(false);
            monthHeading(group.label, group.rows.length, true);
          }
          drawRow(row);
        }
        entriesDrawn++;
      }
    }
  }

  for (const [index, sheet] of pages.entries()) {
    page = sheet;
    rule(H - 53, 0.8);
    text(clean(data.rangeLabel) || "申报日历清单", LEFT, H - 34, 8.6, body, palette.muted);
    right(`${index + 1} / ${pages.length}`, RIGHT, H - 34, 10, display, palette.ink);
  }
  doc.setTitle("申报日历清单");
  doc.setSubject(`${clean(data.rangeLabel) || "全部申报事项"}，共 ${data.rows.length} 件`);
  doc.setProducer("Charter");
  return doc.save();
}
