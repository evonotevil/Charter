// 文件包、全部材料导出、交办邮件与提醒。移植自 Packager / ArchiveExporter / Mailer / Notifier / CalendarSync。

import * as D from "../domain/day";
import { type ArchiveItem, type Company, type Document, type PacketTemplate, type Party, archiveStateLabel, isNotApplicable, ref, stateNeedsAttention } from "../domain/models";
import { type Obligation, expiryLabel, expiryOf, obligationStatus, reminderDays } from "../domain/engine";
import { safeName } from "../domain/folder";
import { extname, platform } from "../platform/platform";
import type { Store } from "../state/store";
import { writePDF, writeUnique, writeXLSX, writeZip, type PDFSection } from "./files";

// MARK: 文件包

export interface PacketItem {
  category: string;
  ownerName: string;
  isPersonal: boolean;
  document?: Document;
  problem?: string;
  included: boolean;
  maxAgeMonths?: number;
}
export const packetItemID = (i: PacketItem) => i.category + "|" + i.ownerName;
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
    for (const p of s.directors(c.id)) {
      const doc = s.ownedDocuments(ref("person", p.id)).find((d) => s.docType(d.typeID)?.category === "护照");
      const problem = check(doc);
      out.push({ category: "护照", ownerName: p.name, isPersonal: true, document: doc, problem, included: !!doc && !problem, maxAgeMonths: maxAgeOf(doc) });
    }
  }
  return out;
}

const stampOf = (s: Store) => s.today.replace(/-/g, "");
const two = (n: number) => String(n).padStart(2, "0");

export async function buildPacket(items: PacketItem[], t: PacketTemplate, c: Company, s: Store, onProgress?: (a: number, b: number) => void): Promise<string> {
  const p = platform();
  // 记录在、但文件不在数据文件夹里（比如另一台电脑还没同步过来）：不让整包失败，算作缺件并注明原因。
  const lost = new Set<string>();
  for (const i of packetIncluded(items)) if (!(await p.stat(s.fileURL(i.document!))).exists) lost.add(packetItemID(i));
  items = items.map((i) => (lost.has(packetItemID(i)) ? { ...i, included: false, problem: "文件不在数据文件夹里，可能还没同步过来" } : i));
  const included = packetIncluded(items), missing = packetMissing(items);
  const complete = missing.length === 0;
  const base = safeName(`${c.name}_${t.name}${complete ? "" : "_部分"}_${stampOf(s)}`);
  const entries: { path: string; data: Uint8Array }[] = [];
  const incLines: string[] = [];
  for (const [i, item] of included.entries()) {
    const doc = item.document!;
    const title = packetItemTitle(item, s.docType(doc.typeID)?.name);
    const src = s.fileURL(doc);
    const name = safeName(`${two(i + 1)} ${title}`) + "." + (extname(src) || "pdf");
    entries.push({ path: `${base}/${name}`, data: await p.readBytes(src) });
    incLines.push(`${two(i + 1)}  ${title}：${recencyText(item)}`);
  }
  const misLines = missing.map((m) => `—  ${packetItemTitle(m)}：${packetReason(m)}`);
  const sections: PDFSection[] = [{ heading: `已包含（${incLines.length} 份）`, lines: incLines, alert: false }];
  if (misLines.length) sections.push({ heading: `尚缺（${misLines.length} 项）`, lines: misLines, alert: true });
  const toc = await writePDF(c.name,
    complete ? `${t.name}文件包　${D.long(s.today)}` : `${t.name}文件包（部分材料，缺 ${misLines.length} 项）　${D.long(s.today)}`,
    sections, complete ? undefined : "这是部分材料包。缺少的文件补齐后会另行发送。");
  entries.unshift({ path: `${base}/00 目录.pdf`, data: toc });
  const zip = await writeZip(entries, onProgress);
  return await writeUnique(s.folder.packetsDir, base, "zip", zip);
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
    const line = `${nameOf(item)}：${archiveStateLabel(item.state)}${item.note ? `（${item.note}）` : ""}`;
    (isNotApplicable(item.state) ? naLines : exLines).push(line);
    rows.push(["", nameOf(item), archiveStateLabel(item.state), "", "", "", item.note]);
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
        body += st === "pending" ? `。尚未交给${p.name}。` : st === "drafted" ? `。给${p.name}的消息尚未确认发出。` : `。${p.name}正在办理。`;
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
export async function writeCalendarFile(s: Store): Promise<string> {
  const p = platform();
  const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Charter//CN", `X-WR-CALNAME:${esc(s.data.settings.calendarName)}`, "CALSCALE:GREGORIAN"];
  const limit = D.addDays(s.today, 400);
  for (const o of s.openObligations) {
    if (o.due > limit) continue;
    const party = s.responsibleParty(o)?.name;
    const st = obligationStatus(o);
    const notes = [s.scheduleText(o.rule.schedule), party ? `负责方：${party}` : null, st === "pending" ? null : `状态：${st}`].filter(Boolean).join("\n");
    const d = o.due.replace(/-/g, "");
    const next = D.addDays(o.due, 1).replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:${encodeURIComponent(o.key)}@charter`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${esc(`${o.company.name}：${o.rule.name}`)}`, `DESCRIPTION:${esc(notes)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const path = p.join(s.folder.root, `${safeName(s.data.settings.calendarName)}.ics`);
  await p.writeText(path, lines.join("\r\n"));
  return path;
}
