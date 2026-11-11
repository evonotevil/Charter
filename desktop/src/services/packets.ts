// 文件包、全部材料导出、交办邮件与提醒。移植自 Packager / ArchiveExporter / Mailer / Notifier / CalendarSync。

import * as D from "../domain/day";
import { type ArchiveItem, type Company, type Document, type PacketTemplate, type PacketWatermark, type Party, archiveStateLabel, isNotApplicable, ref, stateNeedsAttention, latinPad, latinPadEnd, latinPadStart } from "../domain/models";
import { type Obligation, expiryLabel, expiryOf, obligationStatus, reminderDays } from "../domain/engine";
import { safeName } from "../domain/folder";
import { extname, platform } from "../platform/platform";
import type { Store } from "../state/store";
import { writePDF, writeUnique, writeXLSX, writeZip, type PDFSection } from "./files";
import { type WMContext, flattenPDF, inspectPDF, kindOf, resolveText, watermarkImage, reencodeImage, watermarkPDF } from "./watermark";
import { englishDocName } from "../domain/docnames";

// MARK: 文件包

export interface PacketItem {
  category: string;
  ownerName: string;
  /** 5.5.5：主人的 ID（个人项目按人去重、区分同名）。 */
  ownerID?: string;
  isPersonal: boolean;
  document?: Document;
  problem?: string;
  included: boolean;
  maxAgeMonths?: number;
}
export const packetItemID = (i: PacketItem) => i.category + "|" + (i.isPersonal && i.ownerID ? `person:${i.ownerID}` : i.ownerName);
/** 5.5.4 及以前按姓名生成的标识；读取旧的“跳过水印”设置时一并识别。 */
export const legacyPacketItemID = (i: PacketItem) => i.category + "|" + i.ownerName;
export const packetItemTitle = (i: PacketItem, typeName?: string) => (i.isPersonal ? `${typeName ?? i.category}（${i.ownerName}）` : typeName ?? i.category);

export function recencyText(i: PacketItem): string {
  if (i.maxAgeMonths === undefined) {
    return i.document?.issueDate ? `${D.long(i.document.issueDate)}签发` : "未注明签发日期";
  }
  if (!i.document?.issueDate) return `要求 ${i.maxAgeMonths} 个月内签发，未注明签发日期，无法确认`;
  return `要求 ${i.maxAgeMonths} 个月内签发，${D.long(i.document.issueDate)}签发` + (i.problem ? "" : "，符合");
}

export const packetIncluded = (items: PacketItem[]) => items.filter((i) => i.included && i.document);
export const packetMissing = (items: PacketItem[]) => items.filter((i) => !(i.included && i.document));
export const packetReason = (i: PacketItem) => i.problem ?? (i.document ? "未选入" : "还没有这份文件");

export function packetItems(t: PacketTemplate, c: Company, s: Store): PacketItem[] {
  const out: PacketItem[] = [];
  const docs = s.ownedDocuments(ref("company", c.id));
  const archive = s.archive(c);
  const check = (doc?: Document): string | undefined => {
    if (!doc) return "还没有这份文件";
    const f = s.freshness(doc);
    if (f.kind === "expired") return `已过期 ${f.days} 天`;
    if (f.kind === "needsUpdate") return "信息有变更，需要重开";
    if (t.maxAgeMonths && s.docType(doc.typeID)?.validity === "monthsAfterIssue") {
      if (!doc.issueDate) return `未注明签发日期，无法确认是否在 ${t.maxAgeMonths} 个月内`;
      if (D.addMonths(doc.issueDate, t.maxAgeMonths) < s.today) return `签发已超过 ${t.maxAgeMonths} 个月`;
    }
    return undefined;
  };
  const maxAgeOf = (doc?: Document) => (doc && s.docType(doc.typeID)?.validity === "monthsAfterIssue" ? t.maxAgeMonths : undefined);
  for (const cat of t.categories) {
    const doc = docs.find((d) => s.docType(d.typeID)?.category === cat);
    let problem: string | undefined;
    if (!doc) {
      const marked = archive.filter((a) => a.type?.category === cat && a.state.kind === "marked");
      problem = marked.length ? marked.map((a) => `${a.type?.name ?? "条目"}：${archiveStateLabel(a.state)}${a.note ? `，${a.note}` : ""}`).join("；") : "还没有这份文件";
    } else problem = check(doc);
    out.push({ category: cat, ownerName: c.name, isPersonal: false, document: doc, problem, included: !!doc && !problem, maxAgeMonths: maxAgeOf(doc) });
  }
  if (t.includeDirectorsPassports) {
    const seen = new Set<string>();
    for (const p of s.directors(c.id)) {
      if (seen.has(p.id)) continue; seen.add(p.id);
      const doc = s.ownedDocuments(ref("person", p.id)).find((d) => s.docType(d.typeID)?.category === "护照");
      const problem = check(doc);
      out.push({ category: "护照", ownerName: p.name, ownerID: p.id, isPersonal: true, document: doc, problem, included: !!doc && !problem, maxAgeMonths: maxAgeOf(doc) });
    }
  }
  return out;
}

const stampOf = (s: Store) => s.today.replace(/-/g, "");
const two = (n: number) => String(n).padStart(2, "0");

/** 5.5：材料包导出选项。 */
export interface PacketWatermarkRun {
  wm: PacketWatermark;
  recipient: string;
}
export interface BuildOptions {
  watermark?: PacketWatermarkRun;
  signal?: AbortSignal;
  /** done/total 按份计；label 为当前处理的文件（和页码）。 */
  onProgress?: (done: number, total: number, label?: string) => void;
  /** 每份文件开始 / 进展 / 完成时回调，给导出中的逐行状态用。index 为在“已放入”中的序号。 */
  onItem?: (index: number, state: "run" | "done", note: string) => void;
  /** 保存到这个文件夹（自动避开重名）；不给时为公司文件夹。 */
  outDir?: string;
  /** 清除文件信息（PDF 作者、标题等，图片拍摄信息）；不加水印时也生效。 */
  stripMeta?: boolean;
  /** 5.5.5：处理失败的文件怎么办（按 packetItemID）。没给的失败项会抛 PacketFailuresError。 */
  failed?: Record<string, "omit" | "asis">;
  /** 改过的文件名（不含 .zip）；为空时用默认名。 */
  outName?: string;
  /** 直接保存为这个完整路径（来自系统“存储为”窗口，已由系统确认覆盖）。 */
  outPath?: string;
}

/** 每份文件能否加水印，以及原因。 */
export type WMEligibility = { ok: true } | { ok: false; reason: "other" | "encrypted" | "missing"; label: string } | { ok: true; signed: true };
export async function wmEligibility(item: PacketItem, s: Store): Promise<WMEligibility> {
  if (!item.document) return { ok: false, reason: "missing", label: "还没有这份文件" };
  const src = s.fileURL(item.document);
  const k = kindOf(src);
  if (k === "other") return { ok: false, reason: "other", label: "无法加水印" };
  if (k === "image") return { ok: true };
  try {
    const info = inspectPDF(await platform().readBytes(src));
    if (info.encrypted) return { ok: false, reason: "encrypted", label: "已加密" };
    if (info.signed) return { ok: true, signed: true };
  } catch { return { ok: false, reason: "missing", label: "读不到文件" }; }
  return { ok: true };
}

export const packetBaseName = (c: Company, t: PacketTemplate, s: Store, complete: boolean, recipient?: string) =>
  safeName(`${c.name}_${t.name}${recipient?.trim() ? `_${recipient.trim()}` : ""}${complete ? "" : "_部分"}_${stampOf(s)}`);

/** 每份文件的水印上下文。 */
export function wmContext(item: PacketItem, t: PacketTemplate, c: Company, s: Store, recipient: string): WMContext {
  const zh = packetItemTitle(item, item.document ? s.docType(item.document.typeID)?.name : undefined);
  const typeName = item.document ? s.docType(item.document.typeID)?.name ?? item.category : item.category;
  const en = englishDocName(typeName) + (item.isPersonal ? ` (${item.ownerName})` : "");
  return { day: s.today, fileName: zh, fileNameEn: en, company: c.name, packet: t.name, recipient };
}

/** 5.5.5：生成服务返回的实际结果；完成页、发送说明、发送记录都以它为准。 */
export interface PacketResult { path: string; files: number; watermarked: number; missing: number; complete: boolean; missingTitles: string[]; lostTitles: string[]; omittedTitles: string[] }
export interface PacketFailure { id: string; title: string; reason: string }
/** 有文件加水印或清除信息失败、且还没决定怎么处理时抛出；什么都没写入。 */
export class PacketFailuresError extends Error {
  constructor(public failures: PacketFailure[]) { super(`${failures.length} 份文件没能处理`); this.name = "PacketFailuresError"; }
}

export async function buildPacket(items: PacketItem[], t: PacketTemplate, c: Company, s: Store, opts: BuildOptions = {}): Promise<PacketResult> {
  const p = platform();
  const { watermark: run, signal, onProgress, onItem } = opts;
  const abort = () => { if (signal?.aborted) throw new DOMException("已取消", "AbortError"); };
  // 记录在、但文件不在数据文件夹里（比如另一台电脑还没同步过来）：不让整包失败，算作缺件并注明原因。
  const lost = new Set<string>();
  const lostTitles: string[] = [];
  for (const i of packetIncluded(items)) if (!(await p.stat(s.fileURL(i.document!))).exists) { lost.add(packetItemID(i)); lostTitles.push(packetItemTitle(i, s.docType(i.document!.typeID)?.name)); }
  items = items.map((i) => (lost.has(packetItemID(i)) ? { ...i, included: false, problem: "文件不在数据文件夹里，可能还没同步过来" } : i));
  const included = packetIncluded(items), missing = packetMissing(items);
  const complete = missing.length === 0;
  const wm = run?.wm.enabled ? run.wm : undefined;
  const recipient = run?.recipient.trim() ?? "";
  const base = packetBaseName(c, t, s, complete, wm ? recipient : undefined);
  type Done = { entry: { path: string; data: Uint8Array }; inc: string; wm: string[]; marked: boolean; cleaned: boolean | null; metaLine: string | null; failure?: PacketFailure; omit?: boolean; asIs?: boolean };
  const strip = opts.stripMeta ?? !!wm?.stripMeta;
  const one = async (i: number, item: PacketItem): Promise<Done> => {
    abort();
    const doc = item.document!;
    const title = packetItemTitle(item, s.docType(doc.typeID)?.name);
    const src = s.fileURL(doc);
    let ext = extname(src) || "pdf";
    let data = await p.readBytes(src);
    const label = `${two(i + 1)} ${title}`;
    const wmLines: string[] = []; let marked = false;
    // 清除文件信息与水印无关：不加水印时也要生效。null = 没要求清除。
    let cleaned: boolean | null = strip ? false : null; let keepReason = "";
    onItem?.(i, "run", "");
    const kind = kindOf(src);
    const want = !!wm && !wm.skip.includes(packetItemID(item));
    if (kind === "pdf") {
      const info = inspectPDF(data);
      if (info.encrypted) { if (want) wmLines.push(`${label}：已加密，无法加水印，原样放入`); keepReason = "已加密"; }
      else if (want || (strip && !info.signed)) {
        const text = want ? resolveText(wm!.settings, wmContext(item, t, c, s, recipient)) : "";
        const onPage = (n: number, total: number) => onItem?.(i, "run", `第 ${n} / ${total} 页`);
        let ok = true;
        try {
          data = want && wm!.settings.flatten ? await flattenPDF(data, text, wm!.settings, { stripMeta: true, signal, onPage })
            : await watermarkPDF(data, text, want ? wm!.settings : null, { stripMeta: strip, signal, onPage });
        } catch (e) { if (signal?.aborted) throw e; ok = false; keepReason = "PDF 无法读取"; if (want) wmLines.push(`${label}：PDF 无法读取，未加水印，原样放入`); }
        if (ok && cleaned !== null) cleaned = true;
        if (want && ok) { marked = true; wmLines.push(`${label}：已加水印${wm!.settings.flatten ? "（已压平）" : ""}${info.signed ? "；原件带电子签名，本副本签名已失效" : ""}`); }
      } else {
        if (info.signed) keepReason = "带电子签名，保留原签名";
        if (wm) wmLines.push(`${label}：${info.signed ? "带电子签名，未加水印，保留原签名" : "未加水印"}`);
      }
    } else if (kind === "image") {
      if (want || strip) {
        const text = want ? resolveText(wm!.settings, wmContext(item, t, c, s, recipient)) : "";
        let ok = true;
        try { const r = want ? await watermarkImage(data, ext.toLowerCase(), text, wm!.settings) : await reencodeImage(data, ext.toLowerCase()); data = r.bytes; ext = r.ext; }
        catch { ok = false; keepReason = "图片无法读取"; if (want) wmLines.push(`${label}：图片无法读取，未加水印，原样放入`); }
        if (ok && cleaned !== null) cleaned = true;
        if (want && ok) { marked = true; wmLines.push(`${label}：已加水印`); }
      } else if (wm) wmLines.push(`${label}：未加水印`);
    } else { keepReason = `${ext.toUpperCase()} 文件无法处理`; if (wm) wmLines.push(`${label}：${ext.toUpperCase()} 文件无法加水印，原样放入`); }
    const metaLine = cleaned === null ? null : cleaned ? null : `${label}：未清除（${keepReason || "原样放入"}）`;
    // 5.5.5：要求加水印或清除信息却没处理成功——先停下让用户决定（默认不放入）。
    let failure: PacketFailure | undefined, omit = false, asIs = false;
    const failedProcessing = (want && !marked && /无法读取/.test(wmLines.join())) || (cleaned === false && /无法读取/.test(keepReason));
    if (failedProcessing) {
      const id = packetItemID(item), decided = opts.failed?.[id];
      if (decided === "asis") asIs = true; else if (decided === "omit") omit = true;
      else failure = { id, title, reason: keepReason || "无法读取" };
    }
    onItem?.(i, "done", marked ? "已加水印" : "原样放入");
    return { entry: { path: `${base}/${safeName(label)}.${ext}`, data }, inc: `${two(i + 1)}  ${title}：${recencyText(item)}${asIs ? "（处理失败，原样放入）" : ""}`, wm: wmLines, marked, cleaned, metaLine, failure, omit, asIs };
  };
  // 两份并行：读写和 PDF 处理交错，整体更快；结果按清单顺序装入。
  const results: Done[] = new Array(included.length);
  let next = 0, finished = 0;
  onProgress?.(0, included.length + 1, included[0] ? packetItemTitle(included[0]) : "目录");
  const worker = async () => { while (next < included.length) { const i = next++; results[i] = await one(i, included[i]); finished++; onProgress?.(finished, included.length + 1, included[next] ? packetItemTitle(included[next]) : "目录"); } };
  await Promise.all([worker(), worker()]);
  const failures = results.flatMap((r) => (r.failure ? [r.failure] : []));
  if (failures.length) throw new PacketFailuresError(failures);
  const omittedTitles = included.filter((_, i) => results[i].omit).map((it) => packetItemTitle(it, s.docType(it.document!.typeID)?.name));
  const kept = results.filter((r) => !r.omit);
  // 去掉“不放入”的文件后重新编号
  const renum = (x: string, n: number) => x.replace(/^\d{2}/, two(n));
  const entries = kept.map((r, k) => ({ ...r.entry, path: r.entry.path.replace(/\/\d{2} /, `/${two(k + 1)} `) })), incLines = kept.map((r, k) => renum(r.inc, k + 1)), wmLines = kept.flatMap((r) => r.wm);
  const watermarked = kept.filter((r) => r.marked).length;
  abort();
  onProgress?.(included.length, included.length + 1, "目录");
  const misLines = [...missing.map((m) => `—  ${packetItemTitle(m)}：${packetReason(m)}`), ...omittedTitles.map((t2) => `—  ${t2}：处理失败，未放入`)];
  const done = misLines.length === 0;
  const finalBase = done === complete ? base : packetBaseName(c, t, s, done, wm ? recipient : undefined);
  if (finalBase !== base) for (const e of entries) e.path = e.path.replace(base + "/", finalBase + "/");
  const sections: PDFSection[] = [{ heading: `已包含（${incLines.length} 份）`, lines: incLines, alert: false }];
  if (misLines.length) sections.push({ heading: `尚缺（${misLines.length} 项）`, lines: misLines, alert: true });
  const sample = wm ? resolveText(wm.settings, { day: s.today, fileName: "【文件名称】", fileNameEn: "[File name]", company: c.name, packet: t.name, recipient }) : "";
  if (wm) sections.push({ heading: `水印（${watermarked} / ${included.length} 份）`, lines: [`水印文字：${sample}`, ...(recipient ? [`接收方：${recipient}`] : []), ...wmLines], alert: false });
  if (strip) {
    const n = results.filter((r) => r.cleaned).length, keep = results.flatMap((r) => (r.metaLine ? [r.metaLine] : []));
    sections.push({ heading: `文件信息（已清除 ${n} / ${included.length} 份）`, lines: ["已去掉作者、标题、创建软件和照片拍摄信息。", ...keep], alert: false });
  }
  const toc = await writePDF(c.name,
    done ? `${latinPadEnd(t.name)}文件包　${D.long(s.today)}` : `${latinPadEnd(t.name)}文件包（部分材料，缺 ${misLines.length} 项）　${D.long(s.today)}`,
    sections, done ? undefined : "这是部分材料包。缺少的文件补齐后会另行发送。");
  entries.unshift({ path: `${finalBase}/00 目录.pdf`, data: toc });
  abort();
  const zip = await writeZip(entries, (a, b) => onProgress?.(included.length, included.length + 1, `压缩 ${a} / ${b}`));
  let out: string;
  if (opts.outPath) { await p.writeBytes(opts.outPath, zip); out = opts.outPath; }
  else out = await writeUnique(opts.outDir ?? s.folder.packetsDir, safeName(opts.outName?.replace(/\.zip$/i, "").trim() || finalBase), "zip", zip);
  // 发送记录
  s.commit((d) => {
    d.sends.unshift({ id: crypto.randomUUID(), companyID: c.id, at: new Date().toISOString(), day: s.today, packetID: t.id, packetName: t.name, recipient,
      watermarkText: sample, files: kept.length, watermarked, flattened: !!wm?.settings.flatten, missing: misLines.length, path: out,
      watermark: wm ? structuredClone(wm) : undefined, stripMeta: strip });
    if (d.sends.length > 500) d.sends.length = 500;
  });
  return { path: out, files: kept.length, watermarked, missing: misLines.length, complete: done, missingTitles: missing.map((m) => packetItemTitle(m)), lostTitles, omittedTitles };
}

// MARK: 全部材料

export function exportPlan(c: Company, s: Store) {
  const items = s.archive(c);
  const old = s.data.documents.filter((d) => d.owner.kind === "company" && d.owner.id === c.id && d.supersededBy).length;
  return { included: items.filter((i) => i.document), excluded: items.filter((i) => !i.document), oldVersions: old };
}

export async function exportAll(c: Company, s: Store, includeOld: boolean, onProgress?: (a: number, b: number) => void): Promise<string> {
  const p = platform();
  const plan = exportPlan(c, s);
  const base = safeName(`${c.name}_全部材料_${stampOf(s)}`);
  const entries: { path: string; data: Uint8Array }[] = [];
  const rows: string[][] = [["序号", "条目", "状态", "签发日期", "到期日期", "文件名", "备注"]];
  const incLines: string[] = [];
  const nameOf = (i: ArchiveItem) => i.type?.name ?? "未知条目";
  const lostLines: string[] = [];
  const present: ArchiveItem[] = [];
  for (const item of plan.included) {
    if ((await p.stat(s.fileURL(item.document!))).exists) present.push(item);
    else lostLines.push(`${nameOf(item)}：文件不在数据文件夹里，可能还没同步过来`);
  }
  for (const [i, item] of present.entries()) {
    const d = item.document!;
    const num = two(i + 1);
    const src = s.fileURL(d);
    const name = safeName(`${num} ${nameOf(item)}${d.issueDate ? `_${d.issueDate}` : ""}`) + "." + (extname(src) || "pdf").toLowerCase();
    entries.push({ path: `${base}/${name}`, data: await p.readBytes(src) });
    const exp = expiryOf(d, item.type);
    const note = d.notes || item.note;
    rows.push([num, nameOf(item), archiveStateLabel(item.state), d.issueDate ?? "", expiryLabel(d, item.type), name, note]);
    let line = `${num}  ${nameOf(item)}`;
    if (d.issueDate) line += `，签发 ${d.issueDate}`;
    if (exp) line += `，到期 ${exp}`;
    if (stateNeedsAttention(item.state)) line += `〔${archiveStateLabel(item.state)}〕`;
    if (note) line += `（${note}）`;
    incLines.push(line);
  }
  if (includeOld) {
    const olds = s.data.documents.filter((d) => d.owner.kind === "company" && d.owner.id === c.id && d.supersededBy);
    for (const [i, d] of olds.entries()) {
      const src = s.fileURL(d);
      if (!(await p.stat(src)).exists) continue;
      const name = safeName(`${String(i + 1).padStart(4, "0")} ${s.docType(d.typeID)?.name ?? "文件"}${d.issueDate ? `_${d.issueDate}` : ""}_旧版`) + "." + (extname(src) || "pdf").toLowerCase();
      entries.push({ path: `${base}/旧版/${name}`, data: await p.readBytes(src) });
    }
  }
  const exLines: string[] = [], naLines: string[] = [];
  for (const item of plan.excluded) {
    // 5.3：按保管范围说明为什么没有附上
    const why = item.custody === "na" ? "不适用" : item.custody === "agent" ? "中介保管" : item.custody === "outOfScope" ? "不在我的范围" : archiveStateLabel(item.state);
    const line = `${nameOf(item)}：${why}${item.note ? `（${item.note}）` : ""}`;
    (item.custody === "na" || item.custody === "outOfScope" || isNotApplicable(item.state) ? naLines : exLines).push(line);
    rows.push(["", nameOf(item), why, "", "", "", item.note]);
  }
  const summary = s.companySummary(c);
  const sections: PDFSection[] = [{ heading: `已包含（${incLines.length} 份）`, lines: incLines, alert: false }];
  exLines.push(...lostLines);
  if (exLines.length) sections.push({ heading: `未包含（${exLines.length} 项）`, lines: exLines, alert: true });
  if (naLines.length) sections.push({ heading: `不适用（${naLines.length} 项）`, lines: naLines, alert: false });
  sections.push({ heading: "公司资料摘要", lines: summary.split("\n"), alert: false });
  const toc = await writePDF(c.name, `档案材料　${D.long(s.today)}　共 ${incLines.length} 份` + (exLines.length ? `，另有 ${exLines.length} 项未包含` : ""), sections,
    exLines.length ? "“未包含”的条目已在目录中注明原因（未取得、外部保管或尚未归档）。" : undefined);
  entries.unshift({ path: `${base}/00 目录.pdf`, data: toc }, { path: `${base}/00 目录.xlsx`, data: await writeXLSX("目录", rows) },
    { path: `${base}/00 公司资料摘要.txt`, data: new TextEncoder().encode(summary) });
  const zip = await writeZip(entries, onProgress);
  return await writeUnique(s.folder.packetsDir, base, "zip", zip);
}

// MARK: 交办文字

export const obligationMessage = (o: Obligation) => `${o.company.name} 的「${o.rule.name}」${D.long(o.due)}截止，麻烦跟进，办妥后把回执发我。`;

function listLines(list: Obligation[]) {
  return [...list].sort((a, b) => (a.due < b.due ? -1 : 1)).map((o, i) => `${i + 1}. ${o.company.name}：${o.rule.name}，${D.long(o.due)}截止`);
}

/** 交办文字（邮件格式，带称呼和主题行）。只复制，由用户自己粘贴发送。 */
export async function copyHandoff(party: Party, list: Obligation[], nudge = false) {
  const greeting = party.contactName ? `${party.contactName}，您好：` : "您好：";
  const intro = nudge
    ? list.length === 1 ? "想跟进之前交给您的事项，请问目前进展如何？" : "想跟进之前交给您的以下事项，请问目前进展如何？"
    : list.length === 1 ? "麻烦协助办理以下事项：" : `麻烦协助办理以下 ${list.length} 件事项：`;
  const subject = list.length === 1
    ? (nudge ? "跟进：" : "") + `${list[0].company.name}：${list[0].rule.name}（${D.short(list[0].due)}截止）`
    : (nudge ? "跟进：" : "") + `${list.length} 件合规事项交办（最早 ${D.short([...list].map((o) => o.due).sort()[0])} 截止）`;
  await platform().copyText(`主题：${subject}\n\n${greeting}\n\n${intro}\n${listLines(list).join("\n")}\n\n办妥后请把回执或新文件发给我，谢谢。`);
}

export async function copyMessage(list: Obligation[], nudge = false) {
  let text: string;
  if (list.length === 1) {
    const o = list[0];
    text = nudge ? `跟进：${o.company.name} 的「${o.rule.name}」${D.long(o.due)}截止，进展如何？办妥后把回执发我。` : obligationMessage(o);
  } else {
    text = (nudge ? "想跟进以下事项的进展：\n" : `麻烦协助办理以下 ${list.length} 件事项，办妥后把回执发我：\n`) + listLines(list).join("\n");
  }
  await platform().copyText(text);
}

// MARK: 提醒

export interface Reminder { id: string; at: number; title: string; body: string }

/** 所有即将到来的提醒（主设备在应用运行时按时发出）。 */
export function upcomingReminders(s: Store, now = Date.now()): Reminder[] {
  const hour = s.data.settings.notificationHour;
  const at = (d: D.Day) => { const [y, m, dd] = D.parts(d); return new Date(y, m - 1, dd, hour).getTime(); };
  const out: Reminder[] = [];
  if (s.complianceOn) for (const o of s.openObligations) {
    for (const d of reminderDays(o, s.data.settings)) {
      const fire = at(d);
      if (fire <= now) continue;
      const left = D.daysBetween(d, o.due);
      const draft = s.trust(o).kind === "confirmed" ? "" : "（规则待核对）";
      let body = o.company.name;
      const p = s.responsibleParty(o);
      if (p) {
        const st = obligationStatus(o);
        body += st === "pending" ? `。尚未交给${latinPadStart(p.name)}。` : st === "drafted" ? `。给${latinPad(p.name)}的消息尚未确认发出。` : `。${latinPadEnd(p.name)}正在办理。`;
      }
      out.push({ id: `charter.${o.key}|${d}`, at: fire, title: (left === 0 ? `今天截止：${o.rule.name}` : `${left} 天后截止：${o.rule.name}`) + draft, body });
    }
    const st = obligationStatus(o);
    const since = s.lastContact(o);
    if ((st === "handedOff" || st === "waiting") && since) {
      const days = s.party(o.record?.partyID)?.followUpDays ?? 14;
      const fire = at(D.addDays(since, days));
      if (fire > now) out.push({ id: `charter.follow|${o.key}`, at: fire, title: `需要催办：${o.rule.name}`, body: `${o.company.name}，交办 ${days} 天未回复。` });
    }
  }
  for (const doc of s.data.documents) {
    if (doc.supersededBy) continue;
    const exp = expiryOf(doc, s.docType(doc.typeID));
    if (!exp) continue;
    for (const before of s.data.settings.reminderDays) {
      const fire = at(D.addDays(exp, -before));
      if (fire <= now) continue;
      out.push({ id: `charter.doc|${doc.id}|${before}`, at: fire, title: `${before} 天后到期：${s.docType(doc.typeID)?.name ?? "文件"}`, body: s.nameOf(doc.owner) });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** 应用运行期间每分钟检查一次，到点就发系统通知；已发过的记在本机，不重复。 */
export function startReminderLoop(s: Store): () => void {
  const p = platform();
  const tick = async () => {
    if (!s.isPrimaryDevice || s.isLoading) return;
    const sent = new Set<string>(JSON.parse(p.prefGet("sentReminders") ?? "[]"));
    const now = Date.now();
    const due = upcomingReminders(s, Date.now() - 36 * 3600 * 1000).filter((r) => r.at <= now && r.at > now - 36 * 3600 * 1000 && !sent.has(r.id));
    for (const r of due) { await p.notify(r.title, r.body); sent.add(r.id); }
    if (due.length) p.prefSet("sentReminders", JSON.stringify([...sent].slice(-500)));
  };
  void tick();
  const timer = setInterval(() => void tick(), 60 * 1000);
  return () => clearInterval(timer);
}

// MARK: 日历

/** 把未完成事项写成 iCalendar 文件，放在数据文件夹里：Outlook、Apple 日历、Google 日历都能订阅或导入。 */
export function calendarPath(s: Store): string { return platform().join(s.folder.root, `${safeName(s.data.settings.calendarName || "Charter")}.ics`); }

/** 日历文件的完整内容；stamp 为空时用于比较是否需要重写（不含生成时间）。 */
export function calendarText(s: Store, stamp = ""): string {
  const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Charter//CN", `X-WR-CALNAME:${esc(s.data.settings.calendarName)}`, "CALSCALE:GREGORIAN"];
  const limit = D.addDays(s.today, 400);
  for (const o of s.openObligations) {
    if (o.due > limit) continue;
    const party = s.responsibleParty(o)?.name;
    const st = obligationStatus(o);
    const notes = [s.scheduleText(o.rule.schedule), party ? `中介：${party}` : null, st === "pending" ? null : `状态：${st}`].filter(Boolean).join("\n");
    const d = o.due.replace(/-/g, "");
    const next = D.addDays(o.due, 1).replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:${encodeURIComponent(o.key)}@charter`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${esc(`${o.company.name}：${o.rule.name}`)}`, `DESCRIPTION:${esc(notes)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export async function writeCalendarFile(s: Store): Promise<string> {
  const path = calendarPath(s);
  await platform().writeText(path, calendarText(s, new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")));
  return path;
}

/**
 * 5.5.5：数据变化后同步日历文件。按最终内容判断是否重写（公司改名、换中介、改日历名都会更新）；
 * 改名时删掉旧文件，关闭“同步到日历”时删掉文件。
 */
let calendarState: { key: string; path: string | null } = { key: "", path: null };
export async function syncCalendarFile(s: Store) {
  const p = platform();
  const on = s.data.settings.calendarEnabled && s.complianceOn;
  const path = calendarPath(s);
  if (!on) {
    if (calendarState.path === null && calendarState.key === "off") return;
    calendarState = { key: "off", path: null };
    try { if ((await p.stat(path)).exists) await p.removeFile(path); } catch { /* 忽略 */ }
    return;
  }
  const key = path + "\n" + calendarText(s);
  if (key === calendarState.key) return;
  const old = calendarState.path;
  calendarState = { key, path };
  await writeCalendarFile(s);
  if (old && old !== path) { try { if ((await p.stat(old)).exists) await p.removeFile(old); } catch { /* 忽略 */ } }
}
export function resetCalendarFileState() { calendarState = { key: "", path: null }; }
