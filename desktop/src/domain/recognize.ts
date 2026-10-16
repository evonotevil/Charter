// 文件识别的关键词规则：类型、公司、编号、日期。移植自 Swift 版 Recognizer 的 heuristic 部分，全部在本机完成。

import * as D from "./day";
import type { Day } from "./day";

export interface Recognition {
  text: string;
  typeID?: string;
  companyID?: string;
  companyNameGuess?: string;
  jurisdiction?: string;
  registrationNumber?: string;
  incorporationDate?: Day;
  issueDate?: Day;
  expiryDate?: Day;
  evidence: string[];
  confidence: number;
  typeFromContent: boolean;
  usedOCR: boolean;
}

export interface RecognitionContext {
  types: { id: string; name: string; localNames: string[]; hints: string[]; jurisdictions: string[] }[];
  companies: { id: string; names: string[]; jurisdiction: string }[];
  jurisdictionCodes: string[];
  today: Day;
}

const len = (s: string) => [...s].length;

export function confidenceOf(r: Recognition, textLength: number): number {
  let c = 0.35;
  if (r.typeID) c += r.typeFromContent ? 0.3 : 0.12;
  if (r.companyID) c += 0.25;
  if (r.usedOCR) c -= 0.1;
  if (textLength === 0) c -= 0.2; else if (textLength < 80) c -= 0.12;
  return Math.min(Math.max(c, 0), 1);
}

export function recognizeText(pages: string[], fileName: string, usedOCR: boolean, ctx: RecognitionContext): Recognition {
  const r = heuristic(pages, fileName, ctx);
  r.text = pages.join("\n");
  r.usedOCR = usedOCR;
  if (usedOCR) r.evidence.push("扫描件，经文字识别（OCR）");
  const trimmed = r.text.trim();
  if (!trimmed) r.evidence.push("没有读到文字");
  r.confidence = confidenceOf(r, len(trimmed));
  return r;
}

export function heuristic(pages: string[], fileName: string, ctx: RecognitionContext): Recognition {
  const r: Recognition = { text: "", evidence: [], confidence: 0, typeFromContent: false, usedOCR: false };
  const text = pages.join("\n");
  const lowerPages = pages.map((p) => p.toLowerCase());
  const lowerName = fileName.toLowerCase();
  const hay = (fileName + "\n" + text).toLowerCase();

  let best: { id: string; score: number; keyword?: string; page?: number } | undefined;
  for (const t of ctx.types) {
    let score = 0;
    let bestKey: [string, number | undefined] | undefined;
    for (const k of [...t.localNames, ...t.hints, t.name]) {
      if (!k) continue;
      const lk = k.toLowerCase();
      if (!hay.includes(lk)) continue;
      score += len(k) > 6 ? 3 : 2;
      const pi = lowerPages.findIndex((p) => p.includes(lk));
      const page = pi >= 0 ? pi : undefined;
      if (bestKey) {
        const cur = (bestKey[1] !== undefined ? 1000 : 0) + len(bestKey[0]);
        const nw = (page !== undefined ? 1000 : 0) + len(k);
        if (nw > cur) bestKey = [k, page];
      } else bestKey = [k, page];
    }
    if (score > 0 && score > (best?.score ?? 0)) best = { id: t.id, score, keyword: bestKey?.[0], page: bestKey?.[1] };
  }
  r.typeID = best?.id;
  if (best?.keyword) {
    if (best.page !== undefined) {
      r.typeFromContent = true;
      const head = [...lowerPages[best.page]].slice(0, 300).join("");
      r.evidence.push(`第 ${best.page + 1} 页${head.includes(best.keyword.toLowerCase()) ? "标题" : "正文"}含“${best.keyword}”`);
    } else if (lowerName.includes(best.keyword.toLowerCase())) {
      r.evidence.push(`从文件名推断（含“${best.keyword}”）`);
    }
  } else r.evidence.push("未能判断文件类型");

  let bestCompany: [string, number, string] | undefined;
  for (const c of ctx.companies) for (const n of c.names) {
    if (len(n) < 3) continue;
    if (hay.includes(n.toLowerCase()) && len(n) > (bestCompany?.[1] ?? 0)) bestCompany = [c.id, len(n), n];
  }
  r.companyID = bestCompany?.[0];
  if (r.companyID) {
    r.jurisdiction = ctx.companies.find((c) => c.id === r.companyID)?.jurisdiction;
    r.evidence.push(`公司名称“${bestCompany![2]}”`);
  } else {
    const guess = companyNameGuess(text);
    if (guess) { r.companyNameGuess = guess; r.evidence.push(`文件上的公司名称“${guess}”，档案中还没有`); }
  }
  const no = registrationNumber(text);
  if (no) { r.registrationNumber = no; r.evidence.push(`编号 ${no}`); }

  const dates = findDates(text);
  const issueWords = ["date of issue", "issued", "dated", "签发", "簽發", "发出日期", "發出日期", "発行", "証明する", "this day", "발급", "date:"];
  const expiryWords = ["expiry", "expires", "expiration", "valid until", "有效期至", "届满", "屆滿", "到期", "有効期限", "만료"];
  const past = dates.filter((d) => d.day <= ctx.today).map((d) => d.day).sort();
  r.issueDate = dateNear(issueWords, text, dates) ?? past[past.length - 1];
  r.expiryDate = dateNear(expiryWords, text, dates);
  if (r.expiryDate === r.issueDate) r.expiryDate = undefined;
  return r;
}

export function companyNameGuess(text: string): string | undefined {
  const suffixes = ["limited", "ltd", "inc.", "incorporated", "corporation", "corp.", "pte", "llc", "有限公司", "株式会社", "주식회사"];
  for (const raw of text.split(/\r?\n/).slice(0, 80)) {
    const line = raw.trim();
    if (len(line) < 4 || len(line) > 80) continue;
    const l = line.toLowerCase();
    if (!suffixes.some((s) => l.includes(s))) continue;
    if (l.startsWith("this ") || l.startsWith("i ") || l.includes(" is ") || l.includes(" was ")) continue;
    return line;
  }
}

export function registrationNumber(text: string): string | undefined {
  const re = /(?:company\s+(?:no|number)|registration\s+(?:no|number)|certificate\s+(?:no|number)|incorporation\s+(?:no|number)|registered\s+no|编号|編號|登记号码|登記號碼|公司编号|公司編號)\.?\s*[:：.]?\s*([A-Z0-9][A-Z0-9-]{3,19})/i;
  const m = re.exec(text);
  if (!m) return;
  return /\d/.test(m[1]) ? m[1] : undefined;
}

export function matchCompany(name: string, ctx: RecognitionContext): string | undefined {
  const n = name.toLowerCase();
  return ctx.companies.find((c) => c.names.some((x) => { const m = x.toLowerCase(); return len(m) >= 3 && (n.includes(m) || m.includes(n)); }))?.id;
}

interface FoundDate { day: Day; offset: number }

export function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  const add = (y: number, m: number, d: number, at: number) => {
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return;
    if (y > 1950 && y < 2100) out.push({ day: D.makeDay(y, m, d), offset: at });
  };
  const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  for (const m of text.matchAll(/(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})/g)) add(+m[1], +m[2], +m[3], m.index!);
  for (const m of text.matchAll(/令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) add(2018 + (m[1] === "元" ? 1 : +m[1]), +m[2], +m[3], m.index!);
  for (const m of text.matchAll(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?([A-Za-z]{3,9})[,]?\s+(\d{4})/g)) {
    const mo = months[m[2].toLowerCase().slice(0, 3)];
    if (mo) add(+m[3], mo, +m[1], m.index!);
  }
  for (const m of text.matchAll(/([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/g)) {
    const mo = months[m[1].toLowerCase().slice(0, 3)];
    if (mo) add(+m[3], mo, +m[2], m.index!);
  }
  return out.sort((a, b) => a.offset - b.offset);
}

export function dateNear(words: string[], text: string, dates: FoundDate[]): Day | undefined {
  const lower = text.toLowerCase();
  let best: [Day, number] | undefined;
  for (const w of words) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(w, from);
      if (at < 0) break;
      for (const d of dates) {
        if (d.offset >= at && d.offset - at < 80) {
          const dist = d.offset - at;
          if (dist < (best?.[1] ?? Infinity)) best = [d.day, dist];
        }
      }
      from = at + w.length;
    }
  }
  return best?.[0];
}
