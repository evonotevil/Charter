// 跨多个集合的流程：变更记录、导入导出配置、待确认文件、未完成的导入。

import * as D from "../domain/day";
import type { Day } from "../domain/day";
import {
  type Appointment, type ChangeKind, type ChangeRecord, type Company, type CompanyStatus, type Document, type Holding, type Jurisdiction,
  type DocumentType, type NodeRef, type Person, type TemplateLibrary, changeKindLabel, companyStatusLabel, isActiveOn, ref, uuid, latinPadStart } from "../domain/models";
import { percentLabel, validateHoldings } from "../domain/engine";
import { normLibrary } from "../domain/normalize";
import type { Recognition, RecognitionContext } from "../domain/recognize";
import { recognizeFile } from "../services/extract";
import { basename, platform } from "../platform/platform";
import { type ArchiveRequest, Store, unavailableError, invalidTargetError } from "./store";

// MARK: - 变更

export interface ChangePlan {
  companyID: string;
  kind: ChangeKind;
  effectiveOn: Day;
  summary: string;
  endingAppointmentIDs: string[];
  newAppointments: Appointment[];
  newPeople: Person[];
  endingHoldingIDs: string[];
  newHoldings: Holding[];
  newAddress?: string;
  newName?: string;
  newStatus?: CompanyStatus;
  evidencePath?: string;
  evidenceTypeID: string;
}

const newPlan = (companyID: string, kind: ChangeKind = "directorChange"): ChangePlan => ({
  companyID, kind, effectiveOn: D.today(), summary: "", endingAppointmentIDs: [], newAppointments: [], newPeople: [],
  endingHoldingIDs: [], newHoldings: [], evidenceTypeID: "common.resolution",
});

export type EffectKind = "record" | "appointment" | "holding" | "company" | "document" | "obligation" | "evidence";
interface ChangeEffect { kind: EffectKind; text: string }







// MARK: - 配置

export interface ConfigBundle {
  version: number;
  exportedAt: string;
  settings: { reminderDays: number[]; notificationHour: number; calendarEnabled: boolean; calendarName: string; complianceEnabled?: boolean };
  library: TemplateLibrary;
}
export const configVersion = 1;

export function configBundle(s: Store): ConfigBundle {
  const st = s.data.settings;
  return {
    version: configVersion, exportedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    settings: { reminderDays: st.reminderDays, notificationHour: st.notificationHour, calendarEnabled: st.calendarEnabled, calendarName: st.calendarName, complianceEnabled: st.complianceEnabled },
    library: s.data.library,
  };
}

export async function exportConfig(s: Store, path: string) {
  const { toJSON } = await import("../domain/json");
  try {
    await platform().writeText(path, toJSON(configBundle(s)));
    s.showToast(`配置已导出：${basename(path)}`);
  } catch (e) {
    s.setError(`导出配置失败：${(e as Error).message}。请换一个可写入的位置再试。`);
  }
}

export async function readConfig(path: string): Promise<ConfigBundle> {
  let raw: any;
  try { raw = JSON.parse(await platform().readText(path)); }
  catch (e) { throw new Error(`这个文件不是 Charter 导出的配置，或者已经损坏。请选择用“导出配置…”生成的 JSON 文件。（${(e as Error).message}）`); }
  if (!raw || typeof raw.version !== "number" || !raw.library || !raw.settings) throw new Error("这个文件不是 Charter 导出的配置，或者已经损坏。请选择用“导出配置…”生成的 JSON 文件。");
  if (raw.version > configVersion) throw new Error(`这份配置来自更新版本的 Charter（格式版本 ${raw.version}）。请先把这台电脑上的 Charter 升级到最新版本再导入。`);
  const b: ConfigBundle = { ...raw, library: normLibrary(raw.library) };
  if (!b.library.jurisdictions.length || !b.library.documentTypes.length) throw new Error("这份配置里没有法域和文件类型，导入后会让档案无法显示。请重新导出一份完整的配置。");
  return b;
}

function keptOnReplace(s: Store, b: ConfigBundle) {
  const usedCodes = new Set(s.data.companies.map((c) => c.jurisdiction));
  const usedTypes = new Set(s.data.documents.map((d) => d.typeID));
  const inCodes = new Set(b.library.jurisdictions.map((j) => j.code));
  const inTypes = new Set(b.library.documentTypes.map((t) => t.id));
  const js = s.data.library.jurisdictions.filter((j) => usedCodes.has(j.code) && !inCodes.has(j.code));
  const ts = s.data.library.documentTypes.filter((t) => usedTypes.has(t.id) && !inTypes.has(t.id));
  return { js, ts };
}

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

export interface ConfigDiff { lines: string[]; changes: number }

/** 按内容比较：只把真正不同的条目算作变化，内容相同的同名条目不算。 */
export function configImportDiff(s: Store, b: ConfigBundle, mode: "merge" | "replace"): ConfigDiff {
  const lines: string[] = [];
  let changes = 0;
  const part = <T,>(name: string, incoming: T[], current: T[], key: (x: T) => string) => {
    const cur = new Map(current.map((x) => [key(x), x]));
    const inKeys = new Set(incoming.map(key));
    const added = incoming.filter((x) => !cur.has(key(x))).length;
    const changed = incoming.filter((x) => cur.has(key(x)) && !same(cur.get(key(x)), x)).length;
    const removed = mode === "replace" ? current.filter((x) => !inKeys.has(key(x))).length : 0;
    const bits = [added && `新增 ${added} 个`, changed && `更新 ${changed} 个`, removed && `移除 ${removed} 个`].filter(Boolean);
    if (bits.length) { lines.push(`${name}：${bits.join("，")}`); changes += added + changed + removed; }
  };
  const L = s.data.library;
  part("法域", b.library.jurisdictions, L.jurisdictions, (x: Jurisdiction) => x.code);
  part("文件类型", b.library.documentTypes, L.documentTypes, (x: DocumentType) => x.id);
  part("规则", b.library.rules, L.rules, (x) => x.id);
  part("用途", b.library.packets, L.packets, (x) => x.id);
  const ai = b.library.archiveItems ?? {}, cai = L.archiveItems ?? {};
  const aiChanged = Object.keys(ai).filter((k) => !same(ai[k], cai[k])).length
    + (mode === "replace" ? Object.keys(cai).filter((k) => !(k in ai)).length : 0);
  if (aiChanged) { lines.push(`档案清单：${aiChanged} 个法域的条目有变化`); changes += aiChanged; }
  const st = s.data.settings, bs = b.settings;
  const days = (x: number[]) => [...x].sort((m, n) => n - m).join("、");
  if (bs.reminderDays.length && days(bs.reminderDays) !== days(st.reminderDays)) { lines.push(`到期提醒：${days(st.reminderDays)} 天 → ${days(bs.reminderDays)} 天`); changes++; }
  if (bs.notificationHour !== st.notificationHour) { lines.push(`提醒时间：${st.notificationHour}:00 → ${bs.notificationHour}:00`); changes++; }
  if (!!bs.complianceEnabled !== !!st.complianceEnabled) { lines.push(`合规模块：${bs.complianceEnabled ? "打开" : "关闭"}`); changes++; }
  if (bs.calendarName !== st.calendarName || bs.calendarEnabled !== st.calendarEnabled) { lines.push("日历设置有变化"); changes++; }
  if (mode === "replace") {
    const k = keptOnReplace(s, b);
    if (k.js.length + k.ts.length) lines.push(`仍被公司或文件使用的 ${k.js.length} 个法域、${k.ts.length} 个文件类型会保留`);
  }
  return { lines, changes };
}

function merged<T>(cur: T[], inc: T[], key: (x: T) => string): T[] {
  const out = [...cur];
  const idx = new Map(out.map((x, i) => [key(x), i]));
  for (const x of inc) { const i = idx.get(key(x)); if (i !== undefined) out[i] = x; else { idx.set(key(x), out.length); out.push(x); } }
  return out;
}

export async function applyConfig(s: Store, b: ConfigBundle, mode: "merge" | "replace") {
  if (s.loadFailed || s.isLoading) { s.setError("数据还没有正常载入，暂不能导入配置。请检查数据文件夹后重新载入。"); return; }
  const { changes } = configImportDiff(s, b, mode);
  if (!changes) { s.showToast("这份配置和当前的完全一样，没有需要导入的内容。配置只含设置和模板库，公司和文件请用“从备份恢复”。"); return; }
  s.errorMessage = null;
  await s.snapshotBeforeChange("导入配置前");
  s.undoStack = []; s.redoStack = [];
  const L = s.data.library;
  let lib: TemplateLibrary;
  if (mode === "replace") {
    const k = keptOnReplace(s, b);
    lib = { ...L, jurisdictions: [...b.library.jurisdictions, ...k.js], documentTypes: [...b.library.documentTypes, ...k.ts],
      rules: b.library.rules, packets: b.library.packets, archiveItems: b.library.archiveItems };
  } else {
    lib = { ...L, jurisdictions: merged(L.jurisdictions, b.library.jurisdictions, (x) => x.code),
      documentTypes: merged(L.documentTypes, b.library.documentTypes, (x) => x.id), rules: merged(L.rules, b.library.rules, (x) => x.id),
      packets: merged(L.packets, b.library.packets, (x) => x.id),
      archiveItems: b.library.archiveItems ? { ...(L.archiveItems ?? {}), ...b.library.archiveItems } : L.archiveItems };
  }
  lib.version = Math.max(L.version, b.library.version);
  s.commit((d) => {
    d.library = lib as any;
    d.settings.reminderDays = b.settings.reminderDays.length ? b.settings.reminderDays : d.settings.reminderDays;
    d.settings.notificationHour = b.settings.notificationHour;
    d.settings.calendarEnabled = b.settings.calendarEnabled;
    d.settings.calendarName = b.settings.calendarName;
    d.settings.complianceEnabled = b.settings.complianceEnabled;
  });
  if (!s.errorMessage) s.showToast(`配置已导入，${changes} 项有变化。`);
}

// MARK: - 待确认文件

export interface StagedFile {
  id: string;
  path: string;
  originalName: string;
  recognition: Recognition;
  typeID?: string;
  owner?: NodeRef;
  replaces?: Document;
  form: string;
  onArchived?: (d: Document) => void;
}

export function recognitionContext(s: Store): RecognitionContext {
  return {
    types: s.data.library.documentTypes.map((t) => ({ id: t.id, name: t.name, localNames: t.localNames, hints: t.hints, jurisdictions: t.jurisdictions })),
    companies: s.data.companies.map((c) => ({ id: c.id, names: [c.name, ...c.formerNames, ...c.aliases], jurisdiction: c.jurisdiction })),
    jurisdictionCodes: s.data.library.jurisdictions.map((j) => j.code),
    today: s.today,
  };
}

export const staged = new Map<string, StagedFile>();

/** 复制到临时区并识别；不触碰档案目录。 */
export async function stage(s: Store, path: string, opts: { typeID?: string; owner?: NodeRef; replaces?: Document; form?: string; onArchived?: (d: Document) => void } = {}): Promise<StagedFile> {
  const p = platform();
  const id = uuid();
  const dir = p.join(await p.tempDir(), "CharterStaging", id);
  await p.mkdirs(dir);
  const copy = p.join(dir, basename(path));
  try { await p.copyFile(path, copy); } catch (e) { try { await p.removeDir(dir); } catch { /* 忽略 */ } throw e; }
  const r = await recognizeFile(copy, recognitionContext(s));
  const f: StagedFile = { id, path: copy, originalName: basename(path), recognition: r, typeID: opts.typeID ?? r.typeID, owner: opts.owner,
    replaces: opts.replaces, form: opts.form ?? "扫描件", onArchived: opts.onArchived };
  staged.set(id, f);
  return f;
}

export async function commitStaged(s: Store, id: string, a: { typeID: string; owner: NodeRef; issued?: Day; expiry?: Day; form: string; note?: string; keepBoth?: boolean }): Promise<Document> {
  const f = staged.get(id);
  if (!f) throw new Error("待确认的文件已经不存在，请重新上传。");
  const before = s.data;
  const req: ArchiveRequest = { path: f.path, typeID: a.typeID, owner: a.owner, issued: a.issued, expiry: a.expiry, form: a.form, note: a.note, keepBoth: a.keepBoth };
  const [doc] = await s.archiveBatch([req]);
  await discardStaged(id);
  let received = "";
  s.commit((d) => { received = s.closeRequests(d, [doc]); });
  const undoID = s.replace({}, { label: "归档文件", before, createdFiles: [doc.filePath] });
  s.showToast(`已归档${latinPadStart(s.docType(doc.typeID)?.name ?? "文件")}${received}。`, undoID ? () => s.undoID(undoID) : undefined);
  f.onArchived?.(doc);
  return doc;
}

export async function discardStaged(id: string) {
  const f = staged.get(id);
  if (!f) return;
  staged.delete(id);
  const p = platform();
  try { await p.removeDir(f.path.slice(0, Math.max(f.path.lastIndexOf("/"), f.path.lastIndexOf("\\")))); } catch { /* 忽略 */ }
}

/**
 * Charter 4：把文件拖到一家公司上。认得出类型、且没有归属冲突的直接归档（可撤销）；
 * 其余的交回给调用方走确认流程。返回没能直接归档的文件路径。
 */
export async function quickArchive(s: Store, paths: string[], companyID: string): Promise<string[]> {
  const c = s.company(companyID);
  if (!c) return paths;
  const left: string[] = [];
  const done: string[] = [];
  for (const path of paths) {
    let f: StagedFile;
    try { f = await stage(s, path, { owner: { kind: "company", id: companyID } }); } catch { left.push(path); continue; }
    const r = f.recognition;
    const t = f.typeID ? s.docType(f.typeID) : undefined;
    const fits = !!t && t.owner === "company" && (!t.jurisdictions.length || t.jurisdictions.includes(c.jurisdiction));
    const conflict = (r.companyID && r.companyID !== companyID) || (r.jurisdiction && r.jurisdiction !== c.jurisdiction);
    if (!fits || conflict) { await discardStaged(f.id); left.push(path); continue; }
    try {
      const doc = await commitStaged(s, f.id, { typeID: f.typeID!, owner: { kind: "company", id: companyID }, issued: r.issueDate, expiry: r.expiryDate, form: f.form });
      const name = s.docType(doc.typeID)?.name ?? "文件";
      const touches = s.openObligations.some((o) => o.company.id === companyID && o.rule.schedule.kind === "documentExpiry" && o.rule.schedule.documentTypeID === doc.typeID);
      done.push(name + (doc.expiryDate ? `（${D.long(doc.expiryDate)}到期${touches ? "，到期已更新" : ""}）` : doc.issueDate ? `（${D.long(doc.issueDate)}签发）` : ""));
    } catch { left.push(path); }
  }
  if (done.length > 1) s.showToast(`已归档 ${done.length} 份：${done.join("、")}。`);
  else if (done.length === 1) s.showToast(`已归档${latinPadStart(done[0])}。可在档案清单里修改。`, () => s.undo());
  return left;
}
