// 跨多个集合的流程：变更记录、导入导出配置、待确认文件、未完成的导入。

import * as D from "../domain/day";
import type { Day } from "../domain/day";
import {
  type Appointment, type ChangeKind, type ChangeRecord, type Company, type CompanyStatus, type Document, type Holding, type Jurisdiction,
  type DocumentType, type NodeRef, type Person, type TemplateLibrary, changeKindLabel, companyStatusLabel, isActiveOn, ref, uuid,
} from "../domain/models";
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

export const newPlan = (companyID: string, kind: ChangeKind = "directorChange"): ChangePlan => ({
  companyID, kind, effectiveOn: D.today(), summary: "", endingAppointmentIDs: [], newAppointments: [], newPeople: [],
  endingHoldingIDs: [], newHoldings: [], evidenceTypeID: "common.resolution",
});

export type EffectKind = "record" | "appointment" | "holding" | "company" | "document" | "obligation" | "evidence";
export interface ChangeEffect { kind: EffectKind; text: string }

const personName = (s: Store, id: string, p: ChangePlan) => s.person(id)?.name ?? p.newPeople.find((x) => x.id === id)?.name ?? "未命名";
const holderName = (s: Store, r: NodeRef, p: ChangePlan) => (r.kind === "person" ? personName(s, r.id, p) : s.nameOf(r));

export function detailLines(s: Store, p: ChangePlan): string[] {
  const lines: string[] = [];
  for (const a of s.data.appointments) if (p.endingAppointmentIDs.includes(a.id)) lines.push(`${personName(s, a.personID, p)} 离任${a.title}`);
  for (const a of p.newAppointments) lines.push(`${personName(s, a.personID, p)} 就任${a.title}`);
  for (const h of s.data.holdings) if (p.endingHoldingIDs.includes(h.id)) lines.push(`${holderName(s, h.holder, p)} 不再持有 ${percentLabel(h.percent)}`);
  for (const h of p.newHoldings) lines.push(`${holderName(s, h.holder, p)} 持有 ${percentLabel(h.percent)}${h.isNominee ? "（代持）" : ""}`);
  const c = s.company(p.companyID);
  if (p.newAddress !== undefined && p.newAddress !== c?.registeredAddress) lines.push(`注册地址改为：${p.newAddress}`);
  if (p.newName !== undefined && p.newName !== c?.name) lines.push(`公司名称由 ${c?.name ?? ""} 改为 ${p.newName}`);
  if (p.newStatus !== undefined && p.newStatus !== c?.status) lines.push(`公司状态改为：${companyStatusLabel[p.newStatus]}`);
  return lines;
}

export function autoSummary(s: Store, p: ChangePlan) {
  const lines = detailLines(s, p);
  if (!lines.length) return changeKindLabel[p.kind];
  return lines.slice(0, 2).join("；") + (lines.length > 2 ? `等 ${lines.length} 项` : "");
}

export function changeEffects(s: Store, p: ChangePlan): ChangeEffect[] {
  const c = s.company(p.companyID);
  if (!c) return [];
  const eff = D.long(p.effectiveOn);
  const out: ChangeEffect[] = [{ kind: "record", text: `在变更记录里新增：${eff} ${p.summary || autoSummary(s, p)}` }];
  for (const a of s.data.appointments) if (p.endingAppointmentIDs.includes(a.id)) out.push({ kind: "appointment", text: `${personName(s, a.personID, p)} 的${a.title}任期结束于 ${eff}` });
  for (const a of p.newAppointments) out.push({ kind: "appointment", text: `${personName(s, a.personID, p)} 自 ${eff} 起任${a.title}` });
  for (const h of s.data.holdings) if (p.endingHoldingIDs.includes(h.id)) out.push({ kind: "holding", text: `${holderName(s, h.holder, p)} 的 ${percentLabel(h.percent)} 持股结束于 ${eff}` });
  for (const h of p.newHoldings) out.push({ kind: "holding", text: `${holderName(s, h.holder, p)} 自 ${eff} 起持有 ${percentLabel(h.percent)}` });
  if (p.newAddress !== undefined && p.newAddress !== c.registeredAddress) out.push({ kind: "company", text: `注册地址更新为“${p.newAddress}”` });
  if (p.newName !== undefined && p.newName !== c.name) out.push({ kind: "company", text: `公司名称更新为 ${p.newName}，${c.name} 记为曾用名` });
  if (p.newStatus !== undefined && p.newStatus !== c.status) out.push({ kind: "company", text: `公司状态改为“${companyStatusLabel[p.newStatus]}”` });
  for (const d of s.affectedDocuments(p.kind, c.id)) out.push({ kind: "document", text: `${s.docType(d.typeID)?.name ?? "文件"}（${d.issueDate ? `${D.long(d.issueDate)}签发` : "日期未知"}）标为“需要更新”` });
  if (s.complianceOn) for (const [r, due] of s.eventRules(p.kind, c, p.effectiveOn)) {
    const note = s.trustOf(r.id, c).kind === "confirmed" ? "" : "（规则待核对）";
    out.push({ kind: "obligation", text: `新增事项：${r.name}，${D.long(due)}前办妥${note}` });
  }
  if (p.evidencePath) out.push({ kind: "evidence", text: `${basename(p.evidencePath)} 归档为${s.docType(p.evidenceTypeID)?.name ?? "文件"}` });
  return out;
}

function validatePlan(s: Store, p: ChangePlan) {
  const people = new Set([...s.data.people.map((x) => x.id), ...p.newPeople.map((x) => x.id)]);
  const companies = new Set(s.data.companies.map((c) => c.id));
  const activeAppts = new Set(s.data.appointments.filter((a) => a.companyID === p.companyID && isActiveOn(a, p.effectiveOn)).map((a) => a.id));
  const activeHolds = new Set(s.data.holdings.filter((h) => h.companyID === p.companyID && isActiveOn(h, p.effectiveOn)).map((h) => h.id));
  const ok = p.newAppointments.every((a) => a.companyID === p.companyID && people.has(a.personID))
    && p.newHoldings.every((h) => h.companyID === p.companyID)
    && p.endingAppointmentIDs.every((id) => activeAppts.has(id))
    && p.endingHoldingIDs.every((id) => activeHolds.has(id));
  if (!ok) throw new Error("任职或持股的对象、比例或任期不匹配，请返回第一步检查。");
  if (p.newHoldings.length || p.endingHoldingIDs.length) {
    const cand = s.data.holdings.map((h) => (p.endingHoldingIDs.includes(h.id) ? { ...h, to: p.effectiveOn } : h))
      .concat(p.newHoldings.map((h) => ({ ...h, from: p.effectiveOn })));
    validateHoldings(cand, companies, people, new Set([p.companyID]));
  }
  if (p.evidencePath && s.docType(p.evidenceTypeID)?.owner !== "company") throw invalidTargetError();
}

/** 一次写入整个变更；失败时恢复原状。 */
export async function applyChange(s: Store, p: ChangePlan) {
  if (s.loadFailed || s.isLoading || s.isImporting) throw unavailableError();
  const c0 = s.company(p.companyID);
  if (!c0) throw invalidTargetError();
  validatePlan(s, p);
  const before = s.data;
  s.isImporting = true; s.emit();
  let copied: string | undefined;
  try {
    let documents = before.documents;
    let evidenceID: string | undefined;
    if (p.evidencePath) {
      const owner = ref("company", c0.id);
      const path = await s.folder.archive(p.evidencePath, c0.name, owner, s.docType(p.evidenceTypeID)?.name ?? "证明文件", p.effectiveOn);
      copied = s.folder.abs(path);
      const ev: Document = { id: uuid(), typeID: p.evidenceTypeID, owner, issueDate: p.effectiveOn, form: "扫描件", filePath: path,
        originalFileName: basename(p.evidencePath), needsUpdate: false, addedOn: s.today, notes: "" };
      documents = Store.insertingVersion(ev, documents);
      evidenceID = ev.id;
    }
    const referenced = new Set([...p.newAppointments.map((a) => a.personID), ...p.newHoldings.map((h) => h.holder.id), ...p.newHoldings.flatMap((h) => (h.beneficialOwner ? [h.beneficialOwner.id] : []))]);
    const people = [...before.people, ...p.newPeople.filter((np) => referenced.has(np.id) && !before.people.some((x) => x.id === np.id))];
    const appointments = before.appointments.map((a) => (p.endingAppointmentIDs.includes(a.id) ? { ...a, to: p.effectiveOn } : a))
      .concat(p.newAppointments.map((a) => ({ ...a, from: p.effectiveOn })));
    const holdings = before.holdings.map((h) => (p.endingHoldingIDs.includes(h.id) ? { ...h, to: p.effectiveOn } : h))
      .concat(p.newHoldings.map((h) => ({ ...h, from: p.effectiveOn })));
    const c: Company = { ...c0, formerNames: [...c0.formerNames] };
    if (p.newAddress !== undefined) c.registeredAddress = p.newAddress;
    if (p.newName !== undefined && p.newName !== c.name) { if (!c.formerNames.includes(c.name)) c.formerNames.push(c.name); c.name = p.newName; }
    if (p.newStatus !== undefined) c.status = p.newStatus;
    const companies = before.companies.map((x) => (x.id === c.id ? c : x));
    const affected = new Set(s.affectedDocuments(p.kind, c.id).map((d) => d.id));
    documents = documents.map((d) => (affected.has(d.id) ? { ...d, needsUpdate: true } : d));
    const record: ChangeRecord = {
      id: uuid(), companyID: c.id, kind: p.kind, effectiveOn: p.effectiveOn, recordedOn: s.today,
      summary: p.summary || autoSummary(s, p), details: detailLines(s, p), evidenceDocumentID: evidenceID,
    };
    const changes = [...before.changes, record];
    await s.persistCollections({ companies, people, holdings, appointments, documents, changes });
    const undoID = s.replace({ companies, people, holdings, appointments, documents, changes }, { label: "记录变更", before, createdFiles: copied ? [documents.find((d) => d.id === evidenceID)!.filePath] : [] });
    const n = s.complianceOn ? s.eventRules(p.kind, c, p.effectiveOn).length : 0;
    s.showToast("已记录变更" + (n ? `，新增 ${n} 件申报事项。` : "。"), undoID ? () => s.undoID(undoID) : undefined);
  } catch (e) {
    if (copied) { try { await platform().removeFile(copied); } catch { /* 忽略 */ } }
    throw e;
  } finally {
    s.isImporting = false; s.emit();
  }
}

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

export function configImportSummary(s: Store, b: ConfigBundle, mode: "merge" | "replace"): string[] {
  const describe = <T,>(name: string, incoming: T[], current: T[], key: (x: T) => string) => {
    const have = new Set(current.map(key));
    const overlap = incoming.filter((x) => have.has(key(x))).length;
    return mode === "merge" ? `${name}：新增 ${incoming.length - overlap} 个，覆盖同名 ${overlap} 个` : `${name}：替换为 ${incoming.length} 个（现有 ${current.length} 个）`;
  };
  const L = s.data.library;
  const lines = [
    describe("法域", b.library.jurisdictions, L.jurisdictions, (x: Jurisdiction) => x.code),
    describe("文件类型", b.library.documentTypes, L.documentTypes, (x: DocumentType) => x.id),
    describe("规则", b.library.rules, L.rules, (x) => x.id),
    describe("用途", b.library.packets, L.packets, (x) => x.id),
    `档案条目：${Object.keys(b.library.archiveItems ?? {}).length} 个法域的条目清单`,
    `设置：到期前 ${[...b.settings.reminderDays].sort((a, c) => c - a).join("、")} 天提醒，每天 ${b.settings.notificationHour}:00`,
  ];
  if (mode === "replace") {
    const k = keptOnReplace(s, b);
    if (k.js.length + k.ts.length) lines.push(`仍被公司或文件使用的 ${k.js.length} 个法域、${k.ts.length} 个文件类型会保留`);
  }
  return lines;
}

function merged<T>(cur: T[], inc: T[], key: (x: T) => string): T[] {
  const out = [...cur];
  const idx = new Map(out.map((x, i) => [key(x), i]));
  for (const x of inc) { const i = idx.get(key(x)); if (i !== undefined) out[i] = x; else { idx.set(key(x), out.length); out.push(x); } }
  return out;
}

export async function applyConfig(s: Store, b: ConfigBundle, mode: "merge" | "replace") {
  if (s.loadFailed || s.isLoading) { s.setError("数据还没有正常载入，暂不能导入配置。请检查数据文件夹后重新载入。"); return; }
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
  if (!s.errorMessage) s.showToast(mode === "merge" ? "配置已合并导入。" : "配置已全部替换。");
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
  s.showToast(`已归档${s.docType(doc.typeID)?.name ?? "文件"}${received}。`, undoID ? () => s.undoID(undoID) : undefined);
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
