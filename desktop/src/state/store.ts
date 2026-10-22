// 应用状态与全部业务操作。移植自 Swift 版 AppStore 及其扩展。
// 数据是不可变快照（immer），每次修改比较集合引用，只写回改动过的集合；撤销直接保存前后两份快照。

import { produce, type Draft } from "immer";
import * as D from "../domain/day";
import type { Day } from "../domain/day";
import {
  type Appointment, type ArchiveItem, type ArchiveState, type ChangeKind, type ChangeRecord, type Company, type CorporateGroup,
  type Document, type DocumentRequest, type DocumentType, type GroupRow, type HandoffAction, type Holding, type ItemMark,
  type Jurisdiction, type NodeRef, type ObligationRecord, type Party, type Person, type RuleTemplate, type RuleTrust,
  type RuleVerification, type Schedule, type Evidence, type Provenance, type SharedSettings, type TemplateLibrary,
  archiveCounts, changeKindLabel, companyStatusLabel, emptyArchive, hasFile, isActiveOn, isHandedOff, isNotApplicable, itemMarkLabel,
  latinPad, newPerson, normalizedStatus, pendingTypeIDs, ref, refKey, sameRef, typeAppliesTo, uuid, latinPadStart, brandPalette } from "../domain/models";
import {
  type Chain, type Freshness, type Obligation, type OwnershipBreakdown, adjustDay, breakdown, chainPaths, computeObligations,
  explainObligation, freshnessNeedsAttention, freshnessOf, freshnessRank, obligationStatus, openObligations as openOf,
  percentLabel, portfolio, ruleTrust, scheduleSummary, validateHoldings,
} from "../domain/engine";
import { type GroupMembership, excludedSet, groupRows, isMember, legacyGroups, membershipOf } from "../domain/groups";
import {
  type DataSnapshot, CollectionSaveError, FolderStore, listSnapshots, makeSnapshot, needsDailySnapshot, restoreSnapshot, snapshotTitle,
} from "../domain/folder";
import {
  normAppointment, normChange, normCompany, normDocument, normGroup, normHolding, normParty, normPerson, normRecord, normRequest, normSettings,
} from "../domain/normalize";
import { platform } from "../platform/platform";
import { roleByID } from "../domain/roles";

// MARK: - 数据

export interface Data {
  companies: Company[];
  people: Person[];
  holdings: Holding[];
  appointments: Appointment[];
  parties: Party[];
  documents: Document[];
  records: ObligationRecord[];
  changes: ChangeRecord[];
  groups: CorporateGroup[];
  settings: SharedSettings;
  library: TemplateLibrary;
  requests: DocumentRequest[];
}
export type Part = keyof Data;
const parts: Part[] = ["companies", "people", "holdings", "appointments", "parties", "documents", "records", "changes", "groups", "settings", "library", "requests"];
const fileOf: Record<Exclude<Part, "library">, string> = {
  companies: "companies", people: "people", holdings: "holdings", appointments: "appointments", parties: "parties",
  documents: "documents", records: "obligations", changes: "changes", groups: "groups", settings: "settings", requests: "requests",
};

const emptyData = (): Data => ({
  companies: [], people: [], holdings: [], appointments: [], parties: [], documents: [], records: [], changes: [], groups: [],
  settings: { reminderDays: [30, 7, 1], calendarEnabled: true, calendarName: "Charter", notificationHour: 9 },
  library: { version: 1, jurisdictions: [], documentTypes: [], rules: [], packets: [] }, requests: [],
});

export interface Toast { id: string; text: string; action?: () => void; kind: "success" | "failure"; actionTitle: string; leaving?: boolean }
export interface UndoEntry { id: string; label: string; before: Data; after: Data; parts: Part[]; createdFiles: string[] }

export const ungrouped = "__ungrouped__";
export const nonArchiveTypeIDs = new Set(["common.receipt", "common.confirmation"]);
export const defaultFollowUpDays = 7;

export class ArchiveError extends Error {}
export const unavailableError = () => new ArchiveError("数据正在读取、归档或处于保护状态，请完成或修复后再试。");
export const invalidTargetError = () => new ArchiveError("材料类别与归属不匹配，请重新选择公司或人员及材料类别。");

export interface ArchiveRequest {
  path: string; typeID: string; owner: NodeRef; issued?: Day; expiry?: Day; form?: string; note?: string; keepBoth?: boolean;
}

/** 导入列表的一行。 */
export interface ImportItem {
  id: string; path: string; folderHint?: string; recognized: boolean; usedModel?: boolean;
  typeID?: string; owner?: NodeRef; newCompanyKey?: string; issueDate?: Day; expiryDate?: Day; include: boolean;
  evidence: string[]; confidence: number; needsReview: boolean; typeUncertain: boolean; ownerUncertain: boolean; confirmed: boolean;
  companyNameGuess?: string; jurisdiction?: string; registrationNumber?: string; incorporationDate?: Day; missing?: boolean; keepBoth?: boolean;
}
export interface CompanyDraft { key: string; name: string; jurisdiction: string; incorporationDate?: Day; registrationNumber: string; create: boolean }
export interface PendingImport {
  deviceID: string; savedAt: number; context: { kind: "company" | "group"; id: string } | null; rows: ImportItem[]; drafts: CompanyDraft[];
}
export const pendingRemaining = (p: PendingImport) => p.rows.filter((r) => r.include).length;

export type ShareholderStatus =
  | { kind: "missing" } | { kind: "partial"; total: number } | { kind: "pending"; reasons: string[] } | { kind: "complete" };

// MARK: - Store

export class Store {
  data: Data = emptyData();
  folder: FolderStore;
  today: Day = D.today();
  errorMessage: string | null = null;
  toast: Toast | null = null;
  loadFailed = false;
  isLoading = false;
  isImporting = false;
  undoStack: UndoEntry[] = [];
  redoStack: UndoEntry[] = [];
  snapshots: DataSnapshot[] = [];
  deviceName = "这台电脑";
  /** 每次变化递增，界面据此重新渲染。 */
  version = 0;
  private listeners = new Set<() => void>();
  private lastLoaded: Record<string, number | null> = {};
  private writeQueue: Promise<void> = Promise.resolve();
  private loadGeneration = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  /** 派生数据缓存，按数据引用失效。 */
  private memo = new Map<string, { deps: unknown[]; value: unknown }>();
  sideEffects: ((s: Store) => void) | null = null;
  /** 每次写入成功后调用（刷新同步状态）。 */
  onSaved: (() => void) | null = null;
  private sideEffectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: string) {
    this.folder = new FolderStore(root);
  }

  // MARK: 订阅

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  emit() { this.version++; for (const l of this.listeners) l(); }

  private cached<T>(key: string, deps: unknown[], compute: () => T): T {
    const hit = this.memo.get(key);
    if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) return hit.value as T;
    const value = compute();
    this.memo.set(key, { deps, value });
    return value;
  }

  // MARK: 设备

  get deviceID(): string {
    const p = platform();
    let id = p.prefGet("deviceID");
    if (!id) { id = uuid(); p.prefSet("deviceID", id); }
    return id;
  }
  get isPrimaryDevice() { return !this.data.settings.primaryDeviceID || this.data.settings.primaryDeviceID === this.deviceID; }
  /** Charter 4：到期永远开着。 */
  get complianceOn() { return true; }

  // MARK: 读写

  async changeDataRoot(root: string) {
    if (this.isImporting) { this.setError("文件正在归档，请完成后再切换数据文件夹。"); return; }
    platform().prefSet("dataRoot", root);
    this.folder = new FolderStore(root);
    await this.load();
  }

  async load() {
    const gen = ++this.loadGeneration;
    this.isLoading = true;
    this.loadFailed = true;
    this.emit();
    try {
      this.deviceName = await platform().deviceName();
      const f = this.folder;
      await f.checkFormat();
      await f.prepare();
      const library = await f.loadTemplates();
      const load = async <T>(name: string, norm: (r: any) => T): Promise<T[]> => ((await f.load<any[]>(name)) ?? []).map(norm);
      const companies = await load("companies", normCompany);
      const holdings = await load("holdings", normHolding);
      const rawGroups = await f.load<any[]>("groups");
      const next: Data = {
        library, companies, holdings,
        people: await load("people", normPerson),
        appointments: await load("appointments", normAppointment),
        parties: await load("parties", normParty),
        documents: await load("documents", normDocument),
        records: await load("obligations", normRecord),
        changes: await load("changes", normChange),
        requests: await load("requests", normRequest),
        settings: normSettings(await f.load<any>("settings")),
        groups: rawGroups ? rawGroups.map(normGroup) : legacyGroups(companies, holdings, this.today, uuid),
      };
      const modified = await f.modificationDates();
      if (gen !== this.loadGeneration) return;
      this.data = next;
      this.lastLoaded = modified;
      this.undoStack = []; this.redoStack = [];
      this.loadFailed = false;
      this.isLoading = false;
      this.errorMessage = null;
      if (!next.settings.primaryDeviceID) {
        this.data = { ...this.data, settings: { ...next.settings, primaryDeviceID: this.deviceID, primaryDeviceName: this.deviceName } };
        await this.persist(["settings"]);
      }
      if (!rawGroups && next.groups.length) await this.persist(["groups"]);
      this.afterChange();
      void this.afterLoad();
    } catch (e) {
      if (gen !== this.loadGeneration) return;
      this.isLoading = false;
      this.setError(`读取数据失败，现有档案已保留并暂停保存。请检查数据文件夹是否可访问，修复后重新载入：${(e instanceof Error ? e.message : String(e))}`);
    }
  }

  private async afterLoad() {
    try {
      await this.loadPendingImport();
      await this.pruneUndoArea();
      if (await needsDailySnapshot(this.folder)) { try { await makeSnapshot(this.folder, "每日自动备份"); } catch { /* 忽略 */ } }
      this.snapshots = await listSnapshots(this.folder);
      this.emit();
    } catch { /* 忽略 */ }
  }

  /** 回到前台或文件夹有变化时：另一台设备改过数据就重新载入。 */
  async reloadIfChangedElsewhere() {
    if (this.isLoading || this.isImporting) return;
    this.today = D.today();
    const now = await this.folder.modificationDates();
    const changed = Object.keys(now).some((k) => now[k] !== this.lastLoaded[k]);
    if (changed) await this.load(); else this.afterChange();
  }

  /** 把这些集合写回文件夹（按顺序排队，不会交错写入）。 */
  persist(ps: Part[]): Promise<void> {
    if (this.loadFailed) {
      this.setError("数据读取曾失败，已暂停保存以免覆盖原文件。请检查数据文件夹后重新载入。");
      return Promise.resolve();
    }
    const snapshot = this.data;
    const job = async () => {
      for (const p of ps) {
        try {
          if (p === "library") await this.folder.saveTemplates(snapshot.library);
          else {
            const name = fileOf[p];
            await this.folder.save(snapshot[p], name);
            this.lastLoaded[name] = await this.folder.modificationDate(name);
          }
        } catch (e) {
          this.setError(`保存失败：${(e instanceof Error ? e.message : String(e))}`);
        }
      }
      this.onSaved?.();
    };
    this.writeQueue = this.writeQueue.then(job, job);
    return this.writeQueue;
  }

  /** 等排队中的保存全部写完。备份、快照读的是磁盘上的文件，先调用它，免得漏掉刚做的修改。 */
  async flushWrites() { try { await this.writeQueue; } catch { /* 错误已在保存时报告 */ } }

  /** 多个集合作为一次事务写入：失败时回滚已写的集合，并保持内存里的旧数据。 */
  async persistCollections(next: Partial<Data>) {
    if (this.loadFailed || this.isLoading) throw unavailableError();
    const writes: [string, unknown][] = [];
    for (const [k, v] of Object.entries(next) as [Part, unknown][]) if (k !== "library") writes.push([fileOf[k as Exclude<Part, "library">], v]);
    await (this.writeQueue = this.writeQueue.then(() => undefined, () => undefined));
    try { await this.folder.saveCollections(writes); }
    catch (e) {
      if (e instanceof CollectionSaveError && e.rollbackFailures.length) this.loadFailed = true;
      throw e;
    }
    for (const [name] of writes) this.lastLoaded[name] = await this.folder.modificationDate(name);
    if (next.library) await this.folder.saveTemplates(next.library);
    this.onSaved?.();
  }

  /** 修改数据。返回改动过的集合。label 不为空时登记一步撤销。 */
  commit(fn: (d: Draft<Data>) => void, opts: { label?: string; toast?: string; createdFiles?: string[] } = {}): { parts: Part[]; undoID?: string } {
    const before = this.data;
    const after = produce(before, fn);
    const changed = parts.filter((p) => before[p] !== after[p]);
    if (!changed.length) return { parts: [] };
    this.data = after;
    void this.persist(changed);
    let undoID: string | undefined;
    if (opts.label) undoID = this.pushUndo(opts.label, before, changed, opts.createdFiles ?? []);
    this.afterChange();
    if (opts.toast) this.showToast(opts.toast, undoID ? () => this.undoID(undoID!) : undefined);
    return { parts: changed, undoID };
  }

  /** 数据已经写好（事务式保存）后直接替换内存。 */
  replace(next: Partial<Data>, undo?: { label: string; before: Data; createdFiles?: string[] }): string | undefined {
    this.data = { ...this.data, ...next };
    let id: string | undefined;
    if (undo) {
      const changed = parts.filter((p) => undo.before[p] !== this.data[p]);
      if (changed.length || undo.createdFiles?.length) id = this.pushUndo(undo.label, undo.before, changed, undo.createdFiles ?? []);
    }
    this.afterChange();
    return id;
  }

  afterChange() {
    this.emit();
    if (this.sideEffectTimer) clearTimeout(this.sideEffectTimer);
    this.sideEffectTimer = setTimeout(() => { if (this.isPrimaryDevice) this.sideEffects?.(this); }, 1500);
  }

  // MARK: 撤销

  static undoLimit = 20;

  private pushUndo(label: string, before: Data, changed: Part[], createdFiles: string[]): string {
    const entry: UndoEntry = { id: uuid(), label, before, after: this.data, parts: changed, createdFiles };
    this.undoStack.push(entry);
    if (this.undoStack.length > Store.undoLimit) this.undoStack.splice(0, this.undoStack.length - Store.undoLimit);
    this.redoStack = [];
    return entry.id;
  }

  /** 以 before 为起点登记一步撤销（数据已经写好）。 */
  recordUndo(label: string, before: Data, createdFiles: string[] = []): string | undefined {
    return this.replace({}, { label, before, createdFiles });
  }

  // MARK: 未完成的导入（按设备保存在数据文件夹里）

  pendingImport: PendingImport | null = null;
  /** 导入草稿只存在本机（不同步），按数据文件夹区分。 */
  private get pendingImportKey() { return "pendingImport:" + this.folder.root; }

  async loadPendingImport() {
    try {
      const text = platform().prefGet(this.pendingImportKey);
      const raw = text ? (JSON.parse(text) as PendingImport) : null;
      this.pendingImport = raw?.rows?.length ? raw : null;
    } catch { this.pendingImport = null; }
    this.emit();
  }

  /** 保存草稿；没有识别完的行时删除草稿。 */
  savePendingImport(draft: PendingImport | null) {
    if (!draft || !draft.rows.some((r) => r.recognized)) {
      this.pendingImport = null;
      platform().prefSet(this.pendingImportKey, null);
    } else {
      this.pendingImport = draft;
      try { platform().prefSet(this.pendingImportKey, JSON.stringify(draft)); } catch { /* 本机存储写不进去时只留在内存里 */ }
    }
    this.emit();
  }

  discardPendingImport() {
    const draft = this.pendingImport;
    if (!draft) return;
    this.savePendingImport(null);
    this.showToast("已放弃上次的导入，原文件没有改动。", () => this.savePendingImport(draft));
  }

  /** 把多次 commit 合成一步撤销。返回撤销编号。 */
  undoable(label: string, fn: () => void): string | undefined {
    const before = this.data;
    const depth = this.undoStack.length;
    fn();
    // fn 里登记过的撤销步骤合并掉
    if (this.undoStack.length > depth) this.undoStack.splice(depth);
    const changed = parts.filter((p) => before[p] !== this.data[p]);
    return changed.length ? this.pushUndo(label, before, changed, []) : undefined;
  }

  /** 执行一段修改并登记撤销，带“撤销”提示条。 */
  performUndoable(label: string, toast: string, fn: (d: Draft<Data>) => void) {
    this.commit(fn, { label, toast });
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  private applyState(state: Data, ps: Part[]) {
    const next = { ...this.data };
    for (const p of ps) (next as any)[p] = state[p];
    this.data = next;
    void this.persist(ps);
    this.afterChange();
  }

  undo() {
    if (this.isImporting || this.isLoading) return;
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.applyState(entry.before, entry.parts);
    void this.moveCreatedFiles(entry, true);
    this.redoStack.push(entry);
    this.showToast(`已撤销${entry.label}。`, () => this.redo(), "重做");
  }

  redo() {
    if (this.isImporting || this.isLoading) return;
    const entry = this.redoStack.pop();
    if (!entry) return;
    void this.moveCreatedFiles(entry, false);
    this.applyState(entry.after, entry.parts);
    this.undoStack.push(entry);
    this.showToast(`已重做${entry.label}。`);
  }

  /** 提示条上的“撤销”：只撤销那一步；之后有改动碰过同样的数据时，请用户逐步撤销。 */
  undoID(id: string) {
    const index = this.undoStack.findIndex((e) => e.id === id);
    if (index < 0) { this.showToast("这一步已经无法撤销。", undefined, "撤销", "failure"); return; }
    if (index === this.undoStack.length - 1) { this.undo(); return; }
    const entry = this.undoStack[index];
    const later = this.undoStack.slice(index + 1);
    if (!later.every((e) => e.parts.every((p) => !entry.parts.includes(p)))) {
      this.showToast("之后还有相关改动，请用 Ctrl/⌘+Z 逐步撤销。", undefined, "撤销", "failure");
      return;
    }
    if (this.isImporting || this.isLoading) return;
    this.undoStack.splice(index, 1);
    this.applyState(entry.before, entry.parts);
    void this.moveCreatedFiles(entry, true);
    this.showToast(`已撤销${entry.label}。`);
  }

  private async moveCreatedFiles(entry: UndoEntry, toTrash: boolean) {
    if (!entry.createdFiles.length) return;
    const p = platform();
    let failed = 0;
    for (const rel of entry.createdFiles) {
      const live = this.folder.abs(rel);
      const parked = p.join(this.folder.undoDir, entry.id, ...rel.split("/"));
      const [from, to] = toTrash ? [live, parked] : [parked, live];
      try {
        if (!(await p.stat(from)).exists || (await p.stat(to)).exists) continue;
        await p.mkdirs(to.slice(0, Math.max(to.lastIndexOf("/"), to.lastIndexOf("\\"))));
        await p.moveFile(from, to);
      } catch { failed++; }
    }
    if (failed) this.setError(`有 ${failed} 个文件没能移动，档案记录已${toTrash ? "撤销" : "恢复"}。可以在文件夹中检查数据文件夹。`);
  }

  private async pruneUndoArea() {
    const p = platform();
    const dir = this.folder.undoDir;
    if (!(await p.stat(dir)).exists) return;
    const cutoff = Date.now() - 30 * 86400000;
    for (const e of await p.listDir(dir)) if ((e.mtime ?? 0) < cutoff) { try { await p.removeDir(p.join(dir, e.name)); } catch { /* 忽略 */ } }
  }

  // MARK: 提示

  setError(msg: string | null) { this.errorMessage = msg; this.emit(); }

  showToast(text: string, action?: () => void, actionTitle = "撤销", kind: "success" | "failure" = "success") {
    const t: Toast = { id: uuid(), text, action, kind, actionTitle };
    this.toast = t;
    this.toastRemaining = action ? 6000 : 4000;
    this.startToastTimer();
    this.emit();
  }
  private toastRemaining = 0;
  private toastStarted = 0;
  private startToastTimer() {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    const id = this.toast?.id;
    this.toastStarted = Date.now();
    this.toastTimer = setTimeout(() => { if (this.toast?.id === id) this.dismissToast(); }, this.toastRemaining);
  }
  /** 鼠标停在提示条上时暂停计时。 */
  pauseToast() { if (this.toastTimer) { clearTimeout(this.toastTimer); this.toastTimer = null; this.toastRemaining = Math.max(1200, this.toastRemaining - (Date.now() - this.toastStarted)); } }
  resumeToast() { if (this.toast && !this.toastTimer && !this.toast.leaving) this.startToastTimer(); }
  /** 提示条退场：下沉淡出（fast），再移除。 */
  dismissToast() {
    const t = this.toast;
    if (!t || t.leaving) return;
    this.toast = { ...t, leaving: true };
    this.emit();
    setTimeout(() => { if (this.toast?.id === t.id) { this.toast = null; this.emit(); } }, 120);
  }

  // MARK: 查询

  company = (id?: string | null) => (id ? this.data.companies.find((c) => c.id === id) : undefined);
  person = (id?: string | null) => (id ? this.data.people.find((p) => p.id === id) : undefined);
  party = (id?: string | null) => (id ? this.data.parties.find((p) => p.id === id) : undefined);
  docType = (id?: string | null): DocumentType | undefined => (id ? this.typeIndex().get(id) : undefined);
  jurisdiction = (code: string): Jurisdiction | undefined => this.data.library.jurisdictions.find((j) => j.code === code);
  jurisdictionName = (code: string) => this.jurisdiction(code)?.name ?? code;
  group = (id?: string | null) => (id ? this.data.groups.find((g) => g.id === id) : undefined);

  private typeIndex() {
    return this.cached("types", [this.data.library.documentTypes], () => new Map(this.data.library.documentTypes.map((t) => [t.id, t])));
  }

  nameOf = (r: NodeRef): string =>
    r.kind === "company" ? this.company(r.id)?.name ?? "未知公司" : this.person(r.id)?.name ?? "未知";

  freshness = (d: Document): Freshness => freshnessOf(d, this.docType(d.typeID), this.today);

  get allObligations(): Obligation[] {
    const d = this.data;
    return this.cached("obligations", [d.companies, d.library.rules, d.documents, d.records, d.changes, this.today], () =>
      computeObligations({ companies: d.companies, rules: d.library.rules, documents: d.documents, records: d.records, changes: d.changes, today: this.today }));
  }
  get openObligations(): Obligation[] {
    return this.cached("open", [this.allObligations], () => openOf(this.allObligations));
  }
  obligationsFor = (companyID: string) => this.allObligations.filter((o) => o.company.id === companyID);

  responsibleParty = (o: Obligation) =>
    this.party(o.record?.partyID ?? o.company.rulePartyIDs[o.rule.id] ?? o.company.defaultPartyID);

  ownedDocuments(owner: NodeRef, includeSuperseded = false) {
    return this.data.documents.filter((d) => sameRef(d.owner, owner) && (includeSuperseded || !d.supersededBy))
      .sort((a, b) => {
        const fa = freshnessRank(this.freshness(a)), fb = freshnessRank(this.freshness(b));
        return fa !== fb ? fa - fb : a.addedOn < b.addedOn ? -1 : a.addedOn > b.addedOn ? 1 : 0;
      });
  }

  get documentsNeedingAttention(): Document[] {
    return this.cached("attention", [this.data.documents, this.data.library.documentTypes, this.today], () =>
      this.data.documents.filter((d) => !d.supersededBy && freshnessNeedsAttention(this.freshness(d)))
        .sort((a, b) => freshnessRank(this.freshness(a)) - freshnessRank(this.freshness(b))));
  }

  directors(companyID: string) {
    return this.data.appointments.filter((a) => a.companyID === companyID && isActiveOn(a, this.today) && a.title.includes("董事"))
      .map((a) => this.person(a.personID)).filter((p): p is Person => !!p);
  }

  // MARK: 规则

  trust = (o: Obligation): RuleTrust => ruleTrust(o.rule, o.company, this.today);
  trustOf(ruleID: string, company: Company): RuleTrust {
    const r = this.data.library.rules.find((x) => x.id === ruleID);
    return r ? ruleTrust(r, company, this.today) : { kind: "draft" };
  }
  verification(ruleID: string, company?: Company): RuleVerification | undefined {
    const v = company?.ruleOverrides?.[ruleID]?.verification;
    if (v && v.status === "confirmed") return v;
    return this.data.library.rules.find((r) => r.id === ruleID)?.verification;
  }
  explain = (o: Obligation) => explainObligation(o, (id) => this.docType(id)?.name ?? "文件");
  scheduleText = (s: Schedule) => scheduleSummary(s, (k) => changeKindLabel[k as ChangeKind]);

  confirmRule(ruleID: string, companyID: string | null, v: RuleVerification, schedule?: Schedule) {
    const word = v.status === "confirmed" ? "确认" : "改回待核对";
    this.commit((d) => {
      const ri = d.library.rules.findIndex((r) => r.id === ruleID);
      if (companyID) {
        const c = d.companies.find((x) => x.id === companyID);
        if (!c) return;
        c.ruleOverrides = { ...(c.ruleOverrides ?? {}), [ruleID]: { schedule, verification: v } };
        if (ri >= 0) this.appendRevision(d, ri, `${c.name} 单独${word}${schedule ? `，算法改为“${this.scheduleText(schedule)}”` : ""}（${v.confirmedBy}）`);
      } else if (ri >= 0) {
        d.library.rules[ri].verification = v;
        d.library.rules[ri].needsReview = v.status !== "confirmed";
        this.appendRevision(d, ri, `通用规则${word}（${v.confirmedBy}，${v.sourceKind}）`);
      }
    });
    this.showToast(v.status === "confirmed" ? "已记录核对信息。" : "已改回待核对。");
  }

  updateRule(next: RuleTemplate) {
    this.commit((d) => {
      const i = d.library.rules.findIndex((r) => r.id === next.id);
      if (i < 0) return;
      const old = d.library.rules[i];
      const changed = JSON.stringify(old.schedule) !== JSON.stringify(next.schedule) || old.adjust !== next.adjust;
      const oldText = this.scheduleText(old.schedule);
      d.library.rules[i] = next as any;
      if (changed) {
        this.appendRevision(d, i, `算法由“${oldText}”改为“${this.scheduleText(next.schedule)}”`);
        const v = d.library.rules[i].verification;
        if (v?.status === "confirmed") { v.status = "draft"; d.library.rules[i].needsReview = true; }
      }
    });
  }

  private appendRevision(d: Draft<Data>, i: number, summary: string) {
    const revs = d.library.rules[i].revisions ?? [];
    const last = revs[revs.length - 1];
    if (last && last.on === this.today && last.summary.startsWith("算法由") && summary.startsWith("算法由")) revs[revs.length - 1] = { on: this.today, summary };
    else revs.push({ on: this.today, summary });
    d.library.rules[i].revisions = revs;
  }

  // MARK: 事项

  private upsertRecord(d: Draft<Data>, o: Obligation, change: (r: ObligationRecord) => void) {
    let r = d.records.find((x) => x.key === o.key) as ObligationRecord | undefined;
    if (!r) {
      const base: ObligationRecord = o.record ? structuredClone(o.record) : { key: o.key, ruleID: o.rule.id, companyID: o.company.id, dueDate: o.originalDue, status: "pending", note: "" };
      d.records.push(base);
      r = d.records[d.records.length - 1] as ObligationRecord;
    }
    change(r);
  }

  private log(r: ObligationRecord, action: HandoffAction, partyID?: string, channel?: string) {
    r.log = [...(r.log ?? []), { action, at: D.nowStamp(), partyID: partyID ?? r.partyID, channel }];
  }

  private restoreRecord(o: Obligation, rec?: ObligationRecord) {
    this.commit((d) => {
      d.records = d.records.filter((r) => r.key !== o.key);
      if (rec) d.records.push(rec);
    });
  }

  complete(o: Obligation, receipt?: Document) {
    const before = o.record;
    this.commit((d) => this.upsertRecord(d, o, (r) => {
      r.status = "done"; r.completedOn = this.today;
      if (receipt) r.receiptDocumentID = receipt.id;
      this.log(r, "completed");
    }));
    const next = this.openObligations.find((x) => x.rule.id === o.rule.id && x.company.id === o.company.id);
    const tail = next ? `下一次截止日 ${D.display(next.due, this.today)} 已排好。` : "";
    this.showToast((receipt ? "已完成，回执已存档。" : "已完成。") + tail, () => this.restoreRecord(o, before));
  }

  attachReceipt(doc: Document, o: Obligation) {
    this.commit((d) => this.upsertRecord(d, o, (r) => { r.receiptDocumentID = doc.id; }));
    this.showToast("回执已存档。");
  }

  draft(os: Obligation[], party: Party, channel: string) {
    const befores = os.map((o) => [o, o.record] as const);
    this.commit((d) => {
      for (const o of os) this.upsertRecord(d, o, (r) => {
        r.status = "drafted"; r.partyID = party.id; r.draftedOn = this.today;
        this.log(r, channel === "邮件" ? "drafted" : "copied", party.id, channel);
      });
    });
    const what = "交办文字已复制";
    this.showToast(`${what}，粘贴发给${latinPad(party.name)}后点“确认已发送”${os.length > 1 ? ` ${os.length} 件` : ""}。`, () => { for (const [o, r] of befores) this.restoreRecord(o, r); });
  }

  confirmSent(os: Obligation[], party?: Party, channel?: string) {
    const befores = os.map((o) => [o, o.record] as const);
    this.commit((d) => {
      for (const o of os) this.upsertRecord(d, o, (r) => {
        if (party) r.partyID = party.id;
        r.status = "handedOff"; r.handedOffOn = this.today;
        this.log(r, "sent", undefined, channel);
      });
    });
    const p = party ?? this.party(os[0]?.record?.partyID);
    const who = p ? `交给${latinPad(p.name)}` : "交办";
    this.showToast(os.length > 1 ? `已确认${who} ${os.length} 件，开始等回件。` : `已确认${who}，开始等回件。`,
      () => { for (const [o, r] of befores) this.restoreRecord(o, r); });
  }

  nudge(o: Obligation, channel: string) {
    this.commit((d) => this.upsertRecord(d, o, (r) => this.log(r, "nudged", undefined, channel)));
    this.showToast("催办文字已复制，粘贴发给中介即可。");
  }

  revertToPending(o: Obligation) {
    const before = o.record;
    this.commit((d) => this.upsertRecord(d, o, (r) => {
      r.status = "pending"; r.completedOn = undefined; r.handedOffOn = undefined; r.draftedOn = undefined;
      this.log(r, "reverted");
    }));
    this.showToast("已退回待交办。", () => this.restoreRecord(o, before));
  }

  lastContact(o: Obligation): Day | undefined {
    const nudges = (o.record?.log ?? []).filter((e) => e.action === "nudged");
    const nudged = nudges.length ? D.dayOfStamp(nudges[nudges.length - 1].at) : undefined;
    const xs = [o.record?.handedOffOn, nudged].filter((x): x is Day => !!x).sort();
    return xs[xs.length - 1];
  }

  receipt = (o: Obligation) => (o.record?.receiptDocumentID ? this.data.documents.find((d) => d.id === o.record!.receiptDocumentID) : undefined);

  needsMe(o: Obligation) {
    const s = normalizedStatus(obligationStatus(o));
    if (s === "pending" || s === "drafted") return true;
    if (s === "handedOff") return this.waitingTooLong(o);
    return false;
  }

  setObligationParty(o: Obligation, partyID: string) { this.commit((d) => this.upsertRecord(d, o, (r) => { r.partyID = partyID; })); }
  /** 改回公司默认中介（去掉单独指定），可撤销。 */
  resetObligationParty(o: Obligation) { this.commit((d) => this.upsertRecord(d, o, (r) => { delete (r as any).partyID; }), { label: "改回默认中介", toast: "已改回公司默认中介。" }); }
  reschedule(o: Obligation, day?: Day) { this.commit((d) => this.upsertRecord(d, o, (r) => { r.overrideDue = day; })); }
  setObligationNote(o: Obligation, note: string) { this.commit((d) => this.upsertRecord(d, o, (r) => { r.note = note; })); }

  waitingTooLong(o: Obligation) {
    if (!isHandedOff(obligationStatus(o))) return false;
    const since = this.lastContact(o);
    if (!since) return false;
    return D.daysBetween(since, this.today) >= (this.party(o.record?.partyID)?.followUpDays ?? 14);
  }

  // MARK: 公司、人、关系

  upsertCompany(c: Company) {
    this.commit((d) => {
      const i = d.companies.findIndex((x) => x.id === c.id);
      if (i >= 0) d.companies[i] = c as any; else d.companies.push(c as any);
    });
  }

  deleteCompany(c: Company) {
    this.performUndoable("删除公司", `已删除“${c.name}”。`, (d) => {
      d.companies = d.companies.filter((x) => x.id !== c.id);
      d.holdings = d.holdings.filter((h) => h.companyID !== c.id && !sameRef(h.holder, ref("company", c.id)));
      d.appointments = d.appointments.filter((a) => a.companyID !== c.id);
    });
  }

  upsertPerson(p: Person) {
    this.commit((d) => { const i = d.people.findIndex((x) => x.id === p.id); if (i >= 0) d.people[i] = p as any; else d.people.push(p as any); });
  }
  upsertAppointment(a: Appointment) {
    this.commit((d) => { const i = d.appointments.findIndex((x) => x.id === a.id); if (i >= 0) d.appointments[i] = a as any; else d.appointments.push(a as any); });
  }
  upsertParty(p: Party) {
    this.commit((d) => { const i = d.parties.findIndex((x) => x.id === p.id); if (i >= 0) d.parties[i] = p as any; else d.parties.push(p as any); });
  }

  /** 记录一次变更，并把受影响的文件标为需要更新。 */
  recordChange(change: ChangeRecord) {
    this.commit((d) => {
      d.changes.push(change as any);
      if (change.companyID) {
        const affected = this.affectedCategories(change.kind);
        for (const doc of d.documents) {
          if (sameRef(doc.owner, ref("company", change.companyID)) && !doc.supersededBy) {
            const t = this.docType(doc.typeID);
            if (t && affected.includes(t.category)) doc.needsUpdate = true;
          }
        }
      }
    });
  }

  fileURL = (d: Document) => this.folder.abs(d.filePath);
  revealDocument = (d: Document) => platform().reveal(this.fileURL(d));
  openDocument = (d: Document) => platform().openPath(this.fileURL(d));

  deleteDocument(doc: Document) {
    this.performUndoable("移除文件记录", "已移除这份文件的记录，文件夹里的文件仍保留。", (d) => {
      d.documents = d.documents.filter((x) => x.id !== doc.id);
      for (const x of d.documents) if (x.supersededBy === doc.id) x.supersededBy = undefined;
    });
  }

  // MARK: 档案清单

  templateItems(jurisdiction: string): string[] {
    const custom = this.data.library.archiveItems?.[jurisdiction];
    if (custom) return custom.filter((id) => this.docType(id));
    return this.data.library.documentTypes
      .filter((t) => t.builtIn && t.owner === "company" && t.jurisdictions.length === 1 && t.jurisdictions[0] === jurisdiction)
      .map((t) => t.id);
  }

  setTemplateItems(ids: string[], jurisdiction: string) {
    this.commit((d) => { d.library.archiveItems = { ...(d.library.archiveItems ?? {}), [jurisdiction]: ids }; });
  }

  createItem(args: { name: string; category: string; jurisdiction?: string; validity: DocumentType["validity"]; months?: number; scope?: string; owner?: "company" | "person" }): DocumentType {
    const j = args.scope ?? args.jurisdiction;
    const t: DocumentType = {
      id: `custom.${uuid().slice(0, 8).toLowerCase()}`, name: args.name, category: args.category || args.name, localNames: [],
      jurisdictions: j ? [j] : [], owner: args.owner ?? "company", validity: args.validity, validityMonths: args.months, hints: [], builtIn: false,
    };
    this.commit((d) => {
      d.library.documentTypes.push(t as any);
      if (args.jurisdiction) {
        const ids = [...this.templateItems(args.jurisdiction), t.id];
        d.library.archiveItems = { ...(d.library.archiveItems ?? {}), [args.jurisdiction]: ids };
      }
    });
    return t;
  }

  itemApplies(t: DocumentType, c: Company): boolean {
    if (!t.entityForms?.length || !c.entityForm) return true;
    const local = new Set([...(this.jurisdiction(c.jurisdiction)?.entityForms ?? []), c.entityForm]);
    const relevant = t.entityForms.filter((f) => local.has(f));
    return !relevant.length || relevant.includes(c.entityForm);
  }

  itemIDs(c: Company): string[] {
    const a = c.archive ?? emptyArchive();
    const ids = this.templateItems(c.jurisdiction).filter((id) => {
      if (a.removed.includes(id)) return false;
      const t = this.docType(id);
      return t ? this.itemApplies(t, c) : true;
    });
    for (const id of a.added) if (!ids.includes(id) && this.docType(id)) ids.push(id);
    return ids;
  }

  hiddenByEntityForm(c: Company): DocumentType[] {
    return this.templateItems(c.jurisdiction).map((id) => this.docType(id)).filter((t): t is DocumentType => !!t && !this.itemApplies(t, c));
  }

  archive(c: Company): ArchiveItem[] {
    const d = this.data;
    return this.cached(`archive:${c.id}`, [c, d.documents, d.library, this.today], () => this.computeArchive(c));
  }

  private computeArchive(c: Company): ArchiveItem[] {
    const r = ref("company", c.id);
    const mine = this.data.documents.filter((d) => sameRef(d.owner, r));
    const a = c.archive ?? emptyArchive();
    const templ = new Set(this.templateItems(c.jurisdiction));
    const ids = this.itemIDs(c);
    for (const d of mine) if (!d.supersededBy && !ids.includes(d.typeID) && !nonArchiveTypeIDs.has(d.typeID)) ids.push(d.typeID);
    return ids.map((id) => {
      const versions = mine.filter((d) => d.typeID === id);
      const currents = versions.filter((d) => !d.supersededBy);
      const current = currents.reduce<Document | undefined>((m, d) => (!m || (d.issueDate ?? d.addedOn) > (m.issueDate ?? m.addedOn) ? d : m), undefined);
      let state: ArchiveState;
      if (current) {
        const f = this.freshness(current);
        state = f.kind === "valid" ? { kind: "valid" } : f.kind === "expiring" ? { kind: "expiring", days: f.days }
          : f.kind === "expired" ? { kind: "expired", days: f.days } : f.kind === "needsUpdate" ? { kind: "needsUpdate" } : { kind: "noDate" };
      } else if (a.marks[id]) state = { kind: "marked", mark: a.marks[id] };
      else state = { kind: "missing" };
      const others = currents.filter((d) => d !== current);
      return { typeID: id, type: this.docType(id), document: current, olderVersions: versions.filter((d) => !!d.supersededBy).length, copies: others.length, others,
        state, note: a.notes[id] ?? "", isExtra: !templ.has(id) };
    });
  }

  /** 个人档案：护照或身份证件、住址证明必备；在任董事另需董事同意书。其余类型有就列出，没有算“可选”。 */
  personArchive(personID: string): (ArchiveItem & { required: boolean })[] {
    const d = this.data;
    return this.cached(`parchive:${personID}`, [d.documents, d.library, d.appointments, this.today], () => {
      const r = ref("person", personID);
      const mine = d.documents.filter((x) => sameRef(x.owner, r));
      const types = d.library.documentTypes.filter((t) => t.owner === "person");
      const director = d.appointments.some((a) => a.personID === personID && isActiveOn(a, this.today) && a.title.includes("董事"));
      const ids = types.map((t) => t.id);
      for (const x of mine) if (!ids.includes(x.typeID)) ids.push(x.typeID);
      const hasID = mine.some((x) => !x.supersededBy && (x.typeID === "common.passport" || x.typeID === "person.idcard"));
      const required = (id: string) => id === "common.address" || (director && id === "person.consent")
        || (id === "common.passport" && (!hasID || mine.some((x) => x.typeID === id))) || (id === "person.idcard" && mine.some((x) => x.typeID === id));
      return ids.map((id) => {
        const versions = mine.filter((x) => x.typeID === id);
        const currents = versions.filter((x) => !x.supersededBy);
        const current = currents.reduce<Document | undefined>((m, x) => (!m || (x.issueDate ?? x.addedOn) > (m.issueDate ?? m.addedOn) ? x : m), undefined);
        let state: ArchiveState = { kind: "missing" };
        if (current) {
          const f = this.freshness(current);
          state = f.kind === "valid" ? { kind: "valid" } : f.kind === "expiring" ? { kind: "expiring", days: f.days }
            : f.kind === "expired" ? { kind: "expired", days: f.days } : f.kind === "needsUpdate" ? { kind: "needsUpdate" } : { kind: "noDate" };
        }
        const others = currents.filter((x) => x !== current);
        return { typeID: id, type: this.docType(id), document: current, olderVersions: versions.filter((x) => !!x.supersededBy).length, copies: others.length, others,
          state, note: "", isExtra: false, required: required(id) };
      });
    });
  }

  /** 关联到某家公司的个人文件（现行版本）。 */
  relatedPersonDocuments(companyID: string): Document[] {
    return this.data.documents.filter((x) => x.relatedCompanyID === companyID && x.owner.kind === "person" && !x.supersededBy);
  }

  setDocumentCompany(docID: string, companyID: string | undefined) {
    this.commit((d) => { const x = d.documents.find((y) => y.id === docID); if (x) { if (companyID) x.relatedCompanyID = companyID; else delete x.relatedCompanyID; } }, { label: "关联公司" });
  }

  archiveProgress(c: Company): { have: number; total: number } {
    if (c.status === "forming") return { have: 0, total: 0 };
    const items = this.archive(c).filter((i) => !isNotApplicable(i.state));
    return { have: items.filter((i) => hasFile(i.state)).length, total: items.length };
  }

  private editArchive(d: Draft<Data>, companyID: string, change: (a: Draft<NonNullable<Company["archive"]>>) => void) {
    const c = d.companies.find((x) => x.id === companyID);
    if (!c) return;
    if (!c.archive) c.archive = emptyArchive();
    change(c.archive);
  }

  setMark(mark: ItemMark | null, item: string, company: string) {
    const name = this.docType(item)?.name ?? "条目";
    this.performUndoable(mark ? "标记原因" : "清除标记", mark ? `已把“${name}”标记为${itemMarkLabel[mark]}` : `已清除“${name}”的标记`,
      (d) => this.editArchive(d, company, (a) => { if (mark) a.marks[item] = mark; else delete a.marks[item]; }));
  }

  setItemNote(note: string, item: string, company: string) {
    this.commit((d) => this.editArchive(d, company, (a) => { if (note) a.notes[item] = note; else delete a.notes[item]; }));
  }

  addItem(typeID: string, company: string) {
    this.commit((d) => this.editArchive(d, company, (a) => {
      a.removed = a.removed.filter((x) => x !== typeID);
      if (!a.added.includes(typeID)) a.added.push(typeID);
    }));
  }

  removeItem(typeID: string, company: string) {
    this.commit((d) => this.editArchive(d, company, (a) => {
      a.added = a.added.filter((x) => x !== typeID);
      if (!a.removed.includes(typeID)) a.removed.push(typeID);
    }));
  }

  dropItem(typeID: string, company: string) {
    const name = this.docType(typeID)?.name ?? "条目";
    this.performUndoable("移除条目", `已从这家公司的清单移除“${name}”`, (d) => this.editArchive(d, company, (a) => {
      a.added = a.added.filter((x) => x !== typeID);
      if (!a.removed.includes(typeID)) a.removed.push(typeID);
    }));
  }

  overviewCategories(list: Company[]): string[] {
    const count = new Map<string, number>(), first = new Map<string, number>();
    let n = 0;
    for (const c of list) for (const id of this.itemIDs(c)) {
      const cat = this.docType(id)?.category ?? "其他";
      count.set(cat, (count.get(cat) ?? 0) + 1);
      if (!first.has(cat)) first.set(cat, n++);
    }
    return [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || first.get(a)! - first.get(b)!);
  }

  // MARK: 集团

  rowsOf(g: CorporateGroup, day?: Day): GroupRow[] {
    const dd = day ?? this.today;
    return this.cached(`rows:${g.id}:${dd}`, [g, this.data.holdings, this.data.companies], () => groupRows(g, this.data.holdings, this.data.companies, dd));
  }
  companyIDsIn = (g: CorporateGroup, day?: Day) => new Set(this.rowsOf(g, day).map((r) => r.companyID));
  groupsContaining = (companyID: string) => this.data.groups.filter((g) => this.companyIDsIn(g).has(companyID));
  get ungroupedCompanies(): Company[] {
    return this.cached("ungrouped", [this.data.groups, this.data.companies, this.data.holdings, this.today], () => {
      const inAny = new Set<string>();
      for (const g of this.data.groups) for (const id of this.companyIDsIn(g)) inAny.add(id);
      return this.data.companies.filter((c) => !inAny.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
    });
  }
  companyIDsForFilter(filter: string | null, day?: Day): Set<string> | null {
    if (!filter) return null;
    if (filter === ungrouped) return new Set(this.ungroupedCompanies.map((c) => c.id));
    const g = this.group(filter);
    return g ? this.companyIDsIn(g, day) : null;
  }
  attentionCompanyDocuments(filter: string | null) {
    const scope = this.companyIDsForFilter(filter);
    return this.documentsNeedingAttention.filter((d) => d.owner.kind === "company" && (!scope || scope.has(d.owner.id)));
  }
  attentionCount = (filter: string | null) => this.attentionCompanyDocuments(filter).length;
  /** 缺件统计（与公司页“档案 x/y”同一口径）：范围内缺件的公司数和条目数。 */
  missingSummary(filter: string | null) {
    const scope = this.companyIDsForFilter(filter);
    let companies = 0, items = 0;
    for (const c of this.data.companies) {
      if (scope && !scope.has(c.id)) continue;
      if (c.status === "dissolved" || c.status === "redomiciled" || c.status === "forming") continue;
      const m = archiveCounts(this.archive(c)).missing;
      if (m) { companies++; items += m; }
    }
    return { companies, items };
  }
  /** 有文件需要处理的公司数（侧栏“公司”的角标）。 */
  attentionCompanyCount = (filter: string | null) => new Set(this.attentionCompanyDocuments(filter).map((d) => d.owner.id)).size;
  get attentionPersonalCount() { return this.documentsNeedingAttention.filter((d) => d.owner.kind === "person").length; }
  filterName(filter: string | null) {
    if (!filter) return "全部公司";
    if (filter === ungrouped) return "未归入集团";
    return this.group(filter)?.name ?? "全部公司";
  }
  topLabel = (g: CorporateGroup) => g.tops.map((t) => this.nameOf(t)).join("、");

  createGroup(name: string, top: NodeRef): CorporateGroup {
    const g: CorporateGroup = { id: uuid(), name, tops: [top], extraCompanyIDs: [], notes: "" };
    this.commit((d) => { d.groups.push(g as any); });
    return g;
  }
  updateGroup(g: CorporateGroup) {
    this.commit((d) => { const i = d.groups.findIndex((x) => x.id === g.id); if (i >= 0) d.groups[i] = g as any; else d.groups.push(g as any); });
  }
  deleteGroup(g: CorporateGroup) { this.commit((d) => { d.groups = d.groups.filter((x) => x.id !== g.id); }); }

  addToGroup(companyID: string, groupID: string) {
    this.commit((d) => {
      const g = d.groups.find((x) => x.id === groupID);
      if (!g) return;
      if (g.excludedCompanyIDs) g.excludedCompanyIDs = g.excludedCompanyIDs.filter((x) => x !== companyID);
      const reach = groupRows(g as CorporateGroup, this.data.holdings, this.data.companies, this.today).map((r) => r.companyID);
      if (!reach.includes(companyID)) g.extraCompanyIDs.push(companyID);
    });
  }

  membership(companyID: string, g: CorporateGroup): GroupMembership { return membershipOf(companyID, g, this.rowsOf(g)); }

  /** 移出集团：手动加入的直接去掉；股权推导出来的记为“已排除”。返回结果说明。 */
  moveOut(companyID: string, groupID: string): string {
    const g0 = this.group(groupID);
    if (!g0) return "";
    const m = this.membership(companyID, g0);
    this.commit((d) => {
      const g = d.groups.find((x) => x.id === groupID)!;
      g.extraCompanyIDs = g.extraCompanyIDs.filter((x) => x !== companyID);
      if (m.kind === "top") g.tops = g.tops.filter((t) => !sameRef(t, ref("company", companyID)));
      const reach = groupRows({ ...(g as CorporateGroup), extraCompanyIDs: [] }, this.data.holdings, this.data.companies, this.today).map((r) => r.companyID);
      if (reach.includes(companyID) || m.kind === "excluded") g.excludedCompanyIDs = [...new Set([...(g.excludedCompanyIDs ?? []), companyID])].sort();
    });
    const rest = this.groupsContaining(companyID).map((x) => x.name);
    const base = `已从${latinPad(g0.name)}移出`;
    return rest.length ? base + "，仍属于" + rest.join("、") : base + "，现在不属于任何集团";
  }

  restoreToGroup(companyID: string, groupID: string) {
    this.commit((d) => {
      const g = d.groups.find((x) => x.id === groupID);
      if (g?.excludedCompanyIDs) g.excludedCompanyIDs = g.excludedCompanyIDs.filter((x) => x !== companyID);
    });
  }

  membershipExplanation(companyID: string, g: CorporateGroup): string {
    const m = this.membership(companyID, g);
    switch (m.kind) {
      case "top": return `你把它设为${latinPad(g.name)}的顶层`;
      case "manual": return "你手动加入，还没连上集团里的持股关系";
      case "excluded": return `股权能推导到，但你把它排除在${latinPad(g.name)}之外`;
      case "none": return `不在${latinPadStart(g.name)}`;
      case "derived":
        return m.path.slice(0, -1).map((n, k) => `${this.nameOf(n)} 持有 ${percentLabel(m.percents[k])}`).join(" → ") + " → 这家公司";
    }
  }

  tidyGroups(d: Draft<Data>) {
    for (const g of d.groups) {
      const reach = new Set(groupRows({ ...(g as CorporateGroup), extraCompanyIDs: [] }, d.holdings as Holding[], d.companies as Company[], this.today).map((r) => r.companyID));
      const next = g.extraCompanyIDs.filter((id) => !reach.has(id) && d.companies.some((c) => c.id === id));
      if (next.length !== g.extraCompanyIDs.length) g.extraCompanyIDs = next;
    }
  }

  /** 新公司的默认资料（不保存）。实体类型取该法域的第一种。 */
  newCompanyDraft(name: string, jurisdiction: string): Company {
    return {
      id: uuid(), name, formerNames: [], aliases: [], jurisdiction, entityForm: this.jurisdiction(jurisdiction)?.entityForms?.[0] ?? "", registrationNumber: "", fiscalYearEnd: "12-31",
      status: "active", group: "", registeredAddress: "", rulePartyIDs: {}, disabledRuleIDs: [], trackingSince: this.today, notes: "",
    };
  }

  createCompany(name: string, jurisdiction: string): Company {
    const c: Company = { ...this.newCompanyDraft(name, jurisdiction), entityForm: "" };
    this.commit((d) => { d.companies.push(c as any); });
    return c;
  }

  // MARK: Charter 4

  /** 公司所属品牌（第一个包含它的集团）；共用公司返回 undefined。 */
  brandOf = (companyID: string): CorporateGroup | undefined => this.groupsContaining(companyID)[0];
  brandColor = (g?: CorporateGroup | null): string => {
    if (!g) return "#9A9AA3";
    if (g.color) return g.color;
    const i = [...this.data.groups].sort((a, b) => a.name.localeCompare(b.name)).findIndex((x) => x.id === g.id);
    return brandPalette[(i < 0 ? 0 : i) % brandPalette.length];
  };

  /** 一张表新建公司：股东（已有或新建）、董事（已有的人自动关联）、品牌、默认中介，一次提交、一次撤销。 */
  createCompanyFull(args: {
    name: string; jurisdiction: string; groupID?: string; partyID?: string; percent: number;
    holder: { kind: "existing"; ref: NodeRef } | { kind: "newCompany"; name: string; jurisdiction: string; entityForm?: string } | { kind: "newPerson"; name: string } | null;
    directors: string[]; incorporationDate?: Day; registrationNumber?: string; entityForm?: string;
  }): Company {
    const draft = this.newCompanyDraft(args.name.trim(), args.jurisdiction);
    const c: Company = { ...draft, entityForm: args.entityForm ?? draft.entityForm, defaultPartyID: args.partyID,
      incorporationDate: args.incorporationDate, registrationNumber: args.registrationNumber ?? "" };
    this.commit((d) => {
      d.companies.push(c as any);
      let holder: NodeRef | null = null;
      const h = args.holder;
      if (h?.kind === "existing") holder = h.ref;
      else if (h?.kind === "newCompany") {
        const pc: Company = { ...this.newCompanyDraft(h.name.trim(), h.jurisdiction), ...(h.entityForm !== undefined ? { entityForm: h.entityForm } : {}) };
        d.companies.push(pc as any); holder = ref("company", pc.id);
      } else if (h?.kind === "newPerson") {
        const pp = newPerson(h.name.trim()); d.people.push(pp as any); holder = ref("person", pp.id);
      }
      if (holder) d.holdings.push({ id: uuid(), holder, companyID: c.id, percent: args.percent, shares: "", shareClass: "", isNominee: false, from: args.incorporationDate, recordedOn: this.today, verified: false } as any);
      for (const raw of args.directors) {
        const name = raw.trim(); if (!name) continue;
        let p = d.people.find((x) => x.name === name || x.aliases.includes(name));
        if (!p) { const np = newPerson(name); d.people.push(np as any); p = d.people[d.people.length - 1]; }
        d.appointments.push({ id: uuid(), personID: p.id, companyID: c.id, title: "董事", roleID: "common.director", from: args.incorporationDate, recordedOn: this.today, verified: false } as any);
      }
      if (args.groupID) {
        const g = d.groups.find((x) => x.id === args.groupID);
        if (g) {
          const reach = groupRows(g as CorporateGroup, d.holdings as Holding[], d.companies as Company[], this.today).map((r) => r.companyID);
          if (!reach.includes(c.id)) g.extraCompanyIDs.push(c.id);
        }
      }
      d.changes.push({ id: uuid(), companyID: c.id, kind: "other", effectiveOn: args.incorporationDate ?? this.today, recordedOn: this.today, summary: "在 Charter 中建立" } as any);
    }, { label: `新建 ${c.name}` });
    return c;
  }

  // MARK: Charter 4 就地编辑：直接改，自动记入变更历史（事件型申报会按变更自动出现在到期里）

  private editWithHistory(label: string, companyID: string, kind: ChangeKind, summary: string, fn: (d: Draft<Data>) => void, opts: EntryNature = {}) {
    const effectiveOn = opts.effectiveOn ?? (opts.effectiveUnknown ? (opts.asOf ?? this.today) : this.today);
    const change: ChangeRecord = { id: uuid(), companyID, kind, effectiveOn, recordedOn: this.today, summary,
      ...(opts.backfill ? { backfill: true } : {}), ...(opts.effectiveUnknown ? { effectiveUnknown: true } : {}), ...(opts.asOf ? { asOf: opts.asOf } : {}),
      ...(opts.evidence ? { evidenceDocumentID: opts.evidence.documentID } : {}) };
    const { undoID } = this.commit((d) => {
      fn(d);
      d.changes.push(change as any);
      const affected = opts.backfill ? [] : this.affectedCategories(kind);
      for (const doc of d.documents) {
        if (sameRef(doc.owner, ref("company", companyID)) && !doc.supersededBy) {
          const t = this.docType(doc.typeID);
          if (t && affected.includes(t.category)) doc.needsUpdate = true;
        }
      }
    }, { label });
    const events = this.company(companyID) && !opts.backfill && !opts.effectiveUnknown ? this.eventRules(kind, this.company(companyID)!, effectiveOn) : [];
    const tail = opts.backfill ? "，按补录处理，不生成提醒" : events.length ? `，并加入到期：${events.map(([r]) => r.name).join("、")}` : "";
    this.showToast(`${summary}。已记入变更历史${tail}。`, undoID ? () => this.undoID(undoID) : undefined);
    return change.id;
  }

  /** 改基本信息。只有名称、地址、编号、状态等有法律意义的字段记入历史。 */
  editCompanyField<K extends keyof Company>(c: Company, key: K, value: Company[K], label: string) {
    const old = c[key];
    if (old === value) return;
    const kind: ChangeKind = key === "registeredAddress" ? "addressChange" : key === "name" ? "nameChange" : key === "status" ? "statusChange" : "other";
    const show = (v: unknown) => (v === undefined || v === "" ? "空" : key === "status" ? companyStatusLabel[v as keyof typeof companyStatusLabel] : String(v));
    this.editWithHistory(`修改${label}`, c.id, kind, (old === undefined || old === "" ? `${label}填写为“${show(value)}”` : `${label}由“${show(old)}”改为“${show(value)}”`), (d) => {
      const x = d.companies.find((y) => y.id === c.id);
      if (!x) return;
      if (key === "name" && old) x.formerNames = [...x.formerNames, old as string];
      (x as any)[key] = value;
    });
  }

  addShareholderInline(companyID: string, holder: { kind: "existing"; ref: NodeRef } | { kind: "newPerson"; name: string } | { kind: "newCompany"; name: string; jurisdiction: string }, percent: number) {
    let r: NodeRef | null = holder.kind === "existing" ? holder.ref : null;
    const created: { person?: Person; company?: Company } = {};
    if (holder.kind === "newPerson") { created.person = newPerson(holder.name.trim()); r = ref("person", created.person.id); }
    if (holder.kind === "newCompany") { created.company = this.newCompanyDraft(holder.name.trim(), holder.jurisdiction); r = ref("company", created.company.id); }
    const h: Holding = { id: uuid(), holder: r!, companyID, percent, shares: "", shareClass: "", isNominee: false, from: this.today };
    try {
      validateHoldings([...this.data.holdings, h], new Set([...this.data.companies.map((c) => c.id), ...(created.company ? [created.company.id] : [])]),
        new Set([...this.data.people.map((p) => p.id), ...(created.person ? [created.person.id] : [])]), new Set([companyID]));
    } catch (e) { this.setError(`无法添加股东：${(e instanceof Error ? e.message : String(e))}`); return; }
    const name = created.person?.name ?? created.company?.name ?? this.nameOf(r!);
    this.editWithHistory("添加股东", companyID, "shareholderChange", `新增股东 ${name} ${percentLabel(percent)}`, (d) => {
      if (created.person) d.people.push(created.person as any);
      if (created.company) d.companies.push(created.company as any);
      d.holdings.push(h as any);
      this.tidyGroups(d);
    });
  }

  endHolding(h: Holding) {
    this.editWithHistory("移除股东", h.companyID, "shareholderChange", `${this.nameOf(h.holder)} 不再持股（原 ${percentLabel(h.percent)}）`, (d) => {
      const x = d.holdings.find((y) => y.id === h.id);
      if (!x) return;
      if (x.from && x.from >= this.today) d.holdings = d.holdings.filter((y) => y.id !== h.id); else x.to = this.today;
      this.tidyGroups(d);
    });
  }

  setHoldingPercent(h: Holding, percent: number) {
    if (percent === h.percent || !(percent > 0 && percent <= 100)) return;
    this.editWithHistory("修改持股比例", h.companyID, "shareholderChange", `${this.nameOf(h.holder)} 持股由 ${percentLabel(h.percent)} 改为 ${percentLabel(percent)}`, (d) => {
      const x = d.holdings.find((y) => y.id === h.id);
      if (x) x.percent = percent;
    });
  }

  addOfficer(companyID: string, name: string, title: string) {
    const n = name.trim();
    if (!n) return;
    const existing = this.data.people.find((p) => p.name === n || p.aliases.includes(n));
    const person = existing ?? newPerson(n);
    this.editWithHistory("添加董事或高管", companyID, "directorChange", `${n} 就任${title}`, (d) => {
      if (!existing) d.people.push(person as any);
      d.appointments.push({ id: uuid(), personID: person.id, companyID, title, from: this.today } as any);
    });
  }

  endAppointment(a: Appointment) {
    this.editWithHistory("移除董事或高管", a.companyID, "directorChange", `${this.person(a.personID)?.name ?? ""} 卸任${a.title}`, (d) => {
      const x = d.appointments.find((y) => y.id === a.id);
      if (!x) return;
      if (x.from && x.from >= this.today) d.appointments = d.appointments.filter((y) => y.id !== a.id); else x.to = this.today;
    });
  }

  /** 补生效日期：变更记录与对应的持股、任职一起改。 */
  setChangeDate(changeID: string, day: Day) {
    const c = this.data.changes.find((x) => x.id === changeID);
    if (!c || c.effectiveOn === day) return;
    const old = c.effectiveOn;
    this.commit((d) => {
      const x = d.changes.find((y) => y.id === changeID);
      if (x) x.effectiveOn = day;
      if (!c.companyID) return;
      for (const h of d.holdings) if (h.companyID === c.companyID) { if (h.from === old && c.recordedOn === old) h.from = day; if (h.to === old && c.recordedOn === old) h.to = day; }
      for (const a of d.appointments) if (a.companyID === c.companyID) { if (a.from === old && c.recordedOn === old) a.from = day; if (a.to === old && c.recordedOn === old) a.to = day; }
    }, { label: "修改生效日期" });
  }

  // MARK: 4.4 可信台账：带出处的录入、核实、依据

  /** 默认的录入性质：生效日期早于 30 天或未知 → 补录。 */
  defaultBackfill = (effectiveOn?: Day) => !effectiveOn || D.daysBetween(effectiveOn, this.today) > 30;

  /** 新建公司（内联或表单）：法域必须明确给出；可指定实体类型和集团（空 = 不分组）。 */
  private draftCompany(n: NewEntity): Company {
    const c = this.newCompanyDraft(n.name.trim(), n.jurisdiction);
    if (n.entityForm !== undefined) c.entityForm = n.entityForm;
    return c;
  }
  private placeInGroup(d: Draft<Data>, companyID: string, groupID?: string) {
    if (!groupID) return;
    const g = d.groups.find((x) => x.id === groupID);
    if (g && !g.extraCompanyIDs.includes(companyID)) g.extraCompanyIDs.push(companyID);
  }

  /** 录入一条股权（新发生的变更或补录）。返回是否成功。 */
  recordHolding(a: HoldingEntry): boolean {
    let r: NodeRef | null = a.holder.kind === "existing" ? a.holder.ref : null;
    const created: { person?: Person; company?: Company } = {};
    if (a.holder.kind === "newPerson") { created.person = newPerson(a.holder.name.trim()); r = ref("person", created.person.id); }
    if (a.holder.kind === "newCompany") { created.company = this.draftCompany(a.holder.entity); r = ref("company", created.company.id); }
    const verified = !!a.evidence && a.verified;
    const h: Holding = { id: uuid(), holder: r!, companyID: a.companyID, percent: a.percent, shares: "", shareClass: "", isNominee: !!a.isNominee,
      from: a.effectiveOn, asOf: a.asOf, recordedOn: this.today, verified, ...(a.evidence ? { evidence: a.evidence } : {}), ...(a.roleID ? { roleID: a.roleID } : {}) };
    try {
      validateHoldings([...this.data.holdings, h], new Set([...this.data.companies.map((c) => c.id), ...(created.company ? [created.company.id] : [])]),
        new Set([...this.data.people.map((p) => p.id), ...(created.person ? [created.person.id] : [])]), new Set([a.companyID]));
    } catch (e) { this.setError(`无法添加股东：${(e instanceof Error ? e.message : String(e))}`); return false; }
    const name = created.person?.name ?? created.company?.name ?? this.nameOf(r!);
    const role = roleByID(a.roleID);
    this.editWithHistory("添加股东", a.companyID, "shareholderChange", `${a.backfill ? "补录" : "新增"}${role ? role.name : "股东"} ${name} ${percentLabel(a.percent)}`, (d) => {
      if (created.person) d.people.push(created.person as any);
      if (created.company) { d.companies.push(created.company as any); if (a.holder.kind === "newCompany") this.placeInGroup(d, created.company.id, a.holder.entity.groupID); }
      d.holdings.push(h as any);
      this.tidyGroups(d);
    }, { backfill: a.backfill, effectiveOn: a.effectiveOn, effectiveUnknown: !a.effectiveOn, asOf: a.asOf, evidence: a.evidence });
    return true;
  }

  /** 录入一条任职（新发生的变更或补录）。 */
  recordAppointment(a: AppointmentEntry): boolean {
    const n = a.personName.trim();
    if (!n) return false;
    const existing = a.personID ? this.person(a.personID) : this.data.people.find((p) => p.name === n || p.aliases.includes(n));
    const person = existing ?? newPerson(n);
    const role = roleByID(a.roleID);
    const title = a.title.trim() || role?.name || "董事";
    const appt: Appointment = { id: uuid(), personID: person.id, companyID: a.companyID, title, from: a.effectiveOn, asOf: a.asOf, recordedOn: this.today,
      verified: !!a.evidence && a.verified, ...(a.evidence ? { evidence: a.evidence } : {}), ...(a.roleID ? { roleID: a.roleID } : {}) };
    this.editWithHistory("添加董事或高管", a.companyID, "directorChange", `${a.backfill ? "补录" : ""}${person.name} ${a.backfill ? "任" : "就任"}${title}`, (d) => {
      if (!existing) d.people.push(person as any);
      d.appointments.push(appt as any);
    }, { backfill: a.backfill, effectiveOn: a.effectiveOn, effectiveUnknown: !a.effectiveOn, asOf: a.asOf, evidence: a.evidence });
    return true;
  }

  /** 改一条股权或任职的出处：核实状态、依据、资料截至日期、生效日期、角色。可撤销，不进变更历史。 */
  setProvenance(kind: "holding" | "appointment", id: string, patch: Partial<Provenance> & { from?: Day | null; roleID?: string | null }, label = "修改依据") {
    const list = kind === "holding" ? this.data.holdings : this.data.appointments;
    const cur = list.find((x) => x.id === id);
    if (!cur) return;
    if (patch.verified && !(patch.evidence ?? cur.evidence)) { this.showToast("先关联依据文件，才能标为已核实。", undefined, "", "failure"); return; }
    this.commit((d) => {
      const x = (kind === "holding" ? d.holdings : d.appointments).find((y) => y.id === id) as any;
      if (!x) return;
      for (const [k, v] of Object.entries(patch)) { if (v === null) delete x[k]; else if (v !== undefined) x[k] = v; }
      if (patch.evidence === null) x.verified = false;
      if (patch.verified !== undefined || patch.evidence !== undefined) delete x.migrated;
    }, { label, toast: patch.verified ? "已标为已核实。" : patch.verified === false ? "已标为待核实。" : `${label}。` });
  }

  /** 改职务的角色（法域角色表）。职务名跟着变，可撤销。 */
  setAppointmentRole(a: Appointment, roleID: string) {
    const r = roleByID(roleID);
    if (!r || a.roleID === roleID) return;
    this.commit((d) => { const x = d.appointments.find((y) => y.id === a.id); if (x) { x.roleID = roleID; x.title = r.name; } }, { label: "修改职务", toast: `职务改为${r.name}。` });
  }

  /** 待核实的股权和任职（当前有效的）。 */
  get unverified(): { kind: "holding" | "appointment"; item: Holding | Appointment }[] {
    return this.cached("unverified", [this.data.holdings, this.data.appointments, this.today], () => [
      ...this.data.holdings.filter((h) => !h.verified && isActiveOn(h, this.today)).map((item) => ({ kind: "holding" as const, item })),
      ...this.data.appointments.filter((a) => !a.verified && isActiveOn(a, this.today)).map((item) => ({ kind: "appointment" as const, item })),
    ]);
  }

  /** 公司所属集团的增减（点标签就地改）。 */
  toggleCompanyGroup(companyID: string, groupID: string | null) {
    const name = this.company(companyID)?.name ?? "";
    if (groupID === null) {
      const gs = this.groupsContaining(companyID);
      if (!gs.length) return;
      const u = this.undoable("移出所有集团", () => { for (const g of gs) this.moveOut(companyID, g.id); });
      this.showToast(`${name} 现在不属于任何集团。`, u ? () => this.undoID(u) : undefined);
      return;
    }
    const g = this.group(groupID);
    if (!g) return;
    const inside = this.companyIDsIn(g).has(companyID);
    let msg = "";
    const u = this.undoable(inside ? "移出集团" : "加入集团", () => { if (inside) msg = this.moveOut(companyID, groupID); else { this.addToGroup(companyID, groupID); msg = `已加入${latinPad(g.name)}`; } });
    this.showToast(msg + "。", u ? () => this.undoID(u) : undefined);
  }

  /** 按名称后缀建议法域（只做建议，不自动填）。 */
  suggestJurisdiction(name: string): { code: string; why: string } | null {
    const n = name.trim();
    const rules: [RegExp, string, string][] = [
      [/(株式会社|合同会社|有限会社)/, "JP", "名称含“株式会社/合同会社”"],
      [/(股份有限公司|有限公司)$/, "", ""],
      [/Pte\.? ?Ltd\.?$/i, "SG", "名称以“Pte. Ltd.”结尾"],
      [/\(USVI\)|USVI/i, "VI", "名称含“USVI”"],
      [/\(BVI\)|BVI/i, "VG", "名称含“BVI”"],
      [/(유한회사|주식회사)|Korea/i, "KR", "名称含韩国公司形式"],
      [/(香港)/, "HK", "名称含“香港”"],
      [/(台灣|台湾)/, "TW", "名称含“台湾”"],
    ];
    for (const [re, code, why] of rules) {
      if (!re.test(n)) continue;
      if (code) return { code, why };
      if (/香港/.test(n)) return { code: "HK", why: "名称含“香港”和“有限公司”" };
      if (/(台灣|台湾|股份有限公司)/.test(n)) return { code: "TW", why: "名称是台湾公司形式" };
      return { code: "HK", why: "名称以“有限公司”结尾，常见于香港" };
    }
    return null;
  }

  /** 这家中介经手的未完成事项（到期详情“这家中介手上还有”）。 */
  openForParty = (partyID?: string) => (partyID ? this.openObligations.filter((o) => this.responsibleParty(o)?.id === partyID) : []);

  // MARK: Charter 4 到期：确认或修改日期

  confirmDue(o: Obligation, day?: Day) {
    const before = o.record;
    this.commit((d) => this.upsertRecord(d, o, (r) => { if (day && day !== o.originalDue) r.overrideDue = day; else if (day === o.originalDue) r.overrideDue = undefined; r.dateConfirmed = true; }));
    this.showToast(day && day !== o.due ? `已改为 ${D.long(day)}，并标为已确认。` : "日期已确认。", () => this.restoreRecord(o, before));
  }

  createPerson(name: string): Person {
    const p = newPerson(name);
    this.commit((d) => { d.people.push(p as any); });
    return p;
  }

  addHolding(args: { holder: NodeRef; companyID: string; percent: number; nominee: boolean; beneficialOwner?: NodeRef; from?: Day }): boolean {
    const h: Holding = {
      id: uuid(), holder: args.holder, companyID: args.companyID, percent: args.percent, shares: "", shareClass: "",
      isNominee: args.nominee, beneficialOwner: args.nominee ? args.beneficialOwner : undefined, from: args.from,
    };
    try {
      validateHoldings([...this.data.holdings, h], new Set(this.data.companies.map((c) => c.id)), new Set(this.data.people.map((p) => p.id)), new Set([args.companyID]));
    } catch (e) {
      this.setError(`无法添加持股：${(e instanceof Error ? e.message : String(e))}`);
      return false;
    }
    this.commit((d) => { d.holdings.push(h as any); this.tidyGroups(d); });
    return true;
  }

  // MARK: 股东核对

  shareholderCheckApplies = (c: Company) => !(c.status === "dissolved" || c.status === "redomiciled" || c.status === "forming");

  shareholderStatus(companyID: string, day?: Day): ShareholderStatus {
    const dd = day ?? this.today;
    const hs = this.data.holdings.filter((h) => h.companyID === companyID && isActiveOn(h, dd));
    if (!hs.length) return { kind: "missing" };
    const total = hs.reduce((a, h) => a + h.percent, 0);
    if (total < 99.5) return { kind: "partial", total };
    const reasons: string[] = [];
    if (total > 100.5) reasons.push(`股东合计 ${percentLabel(total)}，超过 100%`);
    const nominees = hs.filter((h) => h.isNominee && !h.beneficialOwner);
    if (nominees.length) reasons.push(nominees.map((h) => `${this.nameOf(h.holder)} 代持未填实际受益人`).join("；"));
    const undated = hs.filter((h) => !h.from);
    if (undated.length) reasons.push(`${undated.length} 条持股缺起始日期`);
    return reasons.length ? { kind: "pending", reasons } : { kind: "complete" };
  }

  incompleteShareholderCount(scope: Set<string> | null) {
    return this.data.companies.filter((c) => {
      if (scope && !scope.has(c.id)) return false;
      if (!this.shareholderCheckApplies(c)) return false;
      const s = this.shareholderStatus(c.id);
      return s.kind === "missing" || s.kind === "partial";
    }).length;
  }

  upwardScope(companyID: string, day?: Day): Set<string> {
    const dd = day ?? this.today;
    const active = this.data.holdings.filter((h) => isActiveOn(h, dd));
    const seen = new Set([companyID]);
    const queue = [companyID];
    while (queue.length) {
      const id = queue.pop()!;
      for (const h of active) {
        if (h.companyID !== id) continue;
        for (const n of [h.holder, ...(h.isNominee && h.beneficialOwner ? [h.beneficialOwner] : [])]) {
          if (n.kind === "company" && !seen.has(n.id)) { seen.add(n.id); queue.push(n.id); }
        }
      }
    }
    return seen;
  }

  /** 品牌视图的范围：品牌内的公司，加上它们上面的共用控股公司。 */
  brandScope(groupID: string | null, day?: Day): Set<string> | null {
    const base = this.companyIDsForFilter(groupID, day);
    if (!base || !groupID || !this.group(groupID)) return base;
    const out = new Set(base);
    for (const id of base) for (const up of this.upwardScope(id, day)) out.add(up);
    return out;
  }

  // MARK: 人员

  static nameKey(s: string): string {
    const words = s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (words.length > 1 && words.every((w) => /^[\x00-\x7f]+$/.test(w))) return [...words].sort().join("");
    return words.join("");
  }
  personLabel = (p: Person) => (p.aliases.length ? `${p.name}（又名 ${p.aliases.slice(0, 2).join("、")}）` : p.name);
  personLabelOf = (id: string) => { const p = this.person(id); return p ? this.personLabel(p) : "未知"; };
  possibleDuplicates(name: string, excluding?: string): Person[] {
    const key = Store.nameKey(name);
    if ([...key].length < 2) return [];
    return this.data.people.filter((p) => p.id !== excluding && [p.name, ...p.aliases].some((n) => Store.nameKey(n) === key));
  }

  referenceCount(id: string) {
    const r = ref("person", id);
    const d = this.data;
    return d.appointments.filter((a) => a.personID === id).length
      + d.holdings.filter((h) => sameRef(h.holder, r) || sameRef(h.beneficialOwner, r)).length
      + d.documents.filter((x) => sameRef(x.owner, r)).length
      + d.groups.filter((g) => g.tops.some((t) => sameRef(t, r))).length;
  }

  deletionBlockers(id: string): string[] {
    const r = ref("person", id);
    const d = this.data;
    const out: string[] = [];
    for (const g of d.groups) if (g.tops.some((t) => sameRef(t, r))) out.push(`是“${g.name}”的顶层`);
    const mine = d.appointments.filter((a) => a.personID === id);
    const cur = new Set(mine.filter((a) => isActiveOn(a, this.today)).map((a) => a.companyID));
    const past = new Set(mine.map((a) => a.companyID).filter((c) => !cur.has(c)));
    if (cur.size) out.push(`任职 ${cur.size} 家公司`);
    if (past.size) out.push(`曾在 ${past.size} 家公司任职`);
    const held = new Set(d.holdings.filter((h) => sameRef(h.holder, r)).map((h) => h.companyID));
    if (held.size) out.push(`直接持有 ${held.size} 家公司`);
    const bo = d.holdings.filter((h) => sameRef(h.beneficialOwner, r) && !sameRef(h.holder, r)).length;
    if (bo) out.push(`是 ${bo} 笔代持的实际受益人`);
    const docs = d.documents.filter((x) => sameRef(x.owner, r)).length;
    if (docs) out.push(`是 ${docs} 份文件的归属人`);
    return out;
  }

  mergeEffects(id: string): string[] {
    const r = ref("person", id);
    const d = this.data;
    const out: string[] = [];
    const roles = d.appointments.filter((a) => a.personID === id).length;
    if (roles) out.push(`${roles} 条任职记录`);
    const held = d.holdings.filter((h) => sameRef(h.holder, r)).length;
    if (held) out.push(`${held} 条持股记录`);
    const bo = d.holdings.filter((h) => sameRef(h.beneficialOwner, r) && !sameRef(h.holder, r)).length;
    if (bo) out.push(`${bo} 笔代持的实际受益人`);
    const docs = d.documents.filter((x) => sameRef(x.owner, r)).length;
    if (docs) out.push(`${docs} 份文件`);
    for (const g of d.groups) if (g.tops.some((t) => sameRef(t, r))) out.push(`“${g.name}”的顶层`);
    return out;
  }

  anchorCompanyName(id: string): string | undefined {
    const r = ref("person", id);
    const roles = this.data.appointments.filter((a) => a.personID === id && isActiveOn(a, this.today)).map((a) => this.nameOf(ref("company", a.companyID))).sort();
    if (roles.length) return roles[0];
    return this.data.holdings.filter((h) => sameRef(h.holder, r) && isActiveOn(h, this.today)).map((h) => this.nameOf(ref("company", h.companyID))).sort()[0];
  }

  personHint(id: string): string {
    const r = ref("person", id);
    const roles = new Set(this.data.appointments.filter((a) => a.personID === id && isActiveOn(a, this.today)).map((a) => a.companyID)).size;
    const held = new Set(this.data.holdings.filter((h) => sameRef(h.holder, r) && isActiveOn(h, this.today)).map((h) => h.companyID)).size;
    const parts = [roles ? `任职 ${roles} 家` : null, held ? `持股 ${held} 家` : null].filter(Boolean);
    return parts.length ? parts.join("，") : "未关联";
  }

  deletePerson(id: string) {
    if (this.referenceCount(id) !== 0) return;
    const name = this.person(id)?.name ?? "";
    this.performUndoable("删除人员", name ? `已删除“${name}”。` : "已删除。", (d) => { d.people = d.people.filter((p) => p.id !== id); });
  }

  mergePerson(from: string, into: string) {
    const src = this.person(from);
    if (from === into || !src || !this.person(into)) return;
    const a = ref("person", from), b = ref("person", into);
    this.commit((d) => {
      for (const x of d.appointments) if (x.personID === from) x.personID = into;
      for (const h of d.holdings) {
        if (sameRef(h.holder, a)) h.holder = b;
        if (sameRef(h.beneficialOwner, a)) h.beneficialOwner = b;
      }
      for (const x of d.documents) if (sameRef(x.owner, a)) x.owner = b;
      for (const g of d.groups) {
        const tops: NodeRef[] = [];
        for (const t of g.tops.map((t) => (sameRef(t, a) ? b : t))) if (!tops.some((x) => sameRef(x, t))) tops.push(t);
        g.tops = tops;
      }
      const target = d.people.find((p) => p.id === into)!;
      for (const n of [src.name, ...src.aliases]) if (n !== target.name && !target.aliases.includes(n)) target.aliases.push(n);
      d.people = d.people.filter((p) => p.id !== from);
    }, { label: "合并人员" });
    this.showToast(`已合并到 ${this.person(into)?.name ?? ""}。`);
  }

  // MARK: 实体类型与角色

  static roleSuggestions(entityForm: string): string[] {
    const f = entityForm.toLowerCase();
    if (f.includes("llc") || f.includes("limited liability company") || f.includes("有限责任公司（美")) return ["经理", "管理成员", "成员", "授权签字人"];
    if (f.includes("partnership") || f.includes("合伙") || f.includes(" lp") || f.endsWith("lp")) return ["普通合伙人", "有限合伙人", "授权签字人"];
    if (f.includes("株式会社") || f.includes("kabushiki") || f.includes("k.k")) return ["代表取締役", "取締役", "監査役"];
    if (f.includes("合同会社") || f.includes("godo")) return ["代表社員", "業務執行社員", "社員"];
    if (f.includes("foundation") || f.includes("基金会")) return ["理事", "监事", "受益人代表"];
    if (f.includes("trust") || f.includes("信托")) return ["受托人", "保护人"];
    if (f.includes("有限公司") && !f.includes("股份") && (f.includes("中国") || f.includes("内地"))) return ["执行董事", "董事", "经理", "监事", "法定代表人"];
    return ["董事", "公司秘书", "授权签字人"];
  }
  roleSuggestions = (companyID: string) => Store.roleSuggestions(this.company(companyID)?.entityForm ?? "");
  officerNoun(companyID: string) {
    switch (this.roleSuggestions(companyID)[0]) {
      case "经理": return "经理或成员";
      case "普通合伙人": return "合伙人";
      case "代表取締役": return "取締役";
      default: return "董事";
    }
  }

  // MARK: 摘要

  officers(companyID: string, day?: Day) {
    const dd = day ?? this.today;
    return this.data.appointments.filter((a) => a.companyID === companyID && isActiveOn(a, dd))
      .sort((a, b) => a.title.localeCompare(b.title) || this.nameOf(ref("person", a.personID)).localeCompare(this.nameOf(ref("person", b.personID))));
  }
  directShareholders(companyID: string, day?: Day) {
    const dd = day ?? this.today;
    return this.data.holdings.filter((h) => h.companyID === companyID && isActiveOn(h, dd)).sort((a, b) => b.percent - a.percent);
  }
  breakdownOf = (companyID: string, day?: Day): OwnershipBreakdown => breakdown(companyID, this.data.holdings, day ?? this.today);

  chainsFromTops(companyID: string, day?: Day): { group: CorporateGroup; chain: Chain }[] {
    const out: { group: CorporateGroup; chain: Chain }[] = [];
    for (const g of this.groupsContaining(companyID)) for (const t of g.tops) {
      if (sameRef(t, ref("company", companyID))) continue;
      for (const c of chainPaths(t, companyID, this.data.holdings, day ?? this.today)) out.push({ group: g, chain: c });
    }
    return out;
  }

  holdingText(h: Holding) {
    let t = this.nameOf(h.holder);
    if (h.isNominee) t += `（代${h.beneficialOwner ? this.nameOf(h.beneficialOwner) : "他人"}持有）`;
    return `${t} ${percentLabel(h.percent)}`;
  }

  chainText(c: Chain) {
    const parts = [this.nameOf(c.from)];
    for (const s of c.steps) {
      const target = this.nameOf(ref("company", s.holding.companyID));
      parts.push(s.asBeneficial ? `${target}（经${this.nameOf(s.holding.holder)}代持 ${percentLabel(s.holding.percent)}）` : `${target}（${percentLabel(s.holding.percent)}）`);
    }
    return parts.join(" → ") + (c.steps.length > 1 ? ` ＝ ${percentLabel(c.percent)}` : "");
  }

  breakdownLines(b: OwnershipBreakdown): string[] {
    const lines = b.owners.map((o) => {
      let t = `${this.nameOf(o.owner)} ${percentLabel(o.percent)}`;
      if (o.viaNominee) t += "（含代持）";
      if (o.isTopCompany) t += "（其上层股东未录入）";
      return t;
    });
    if (b.unknown > 0.005) {
      const where = [
        ...b.gaps.map((g) => `${this.nameOf(ref("company", g.companyID))} 有 ${percentLabel(g.missing)} 股东未录入`),
        ...b.unresolvedNominees.map((h) => `${this.nameOf(h.holder)} 代持的实际受益人尚未确认`),
        ...b.cyclicCompanyIDs.map((id) => `${this.nameOf(ref("company", id))} 存在循环持股，需单独核算`),
      ];
      lines.push(`未识别 ${percentLabel(b.unknown)}：${where.join("；")}`);
    }
    return lines;
  }

  companySummary(c: Company, day?: Day): string {
    const dd = day ?? this.today;
    const lines: string[] = [];
    lines.push(`公司名称：${c.name}` + (c.formerNames.length ? `（曾用名：${c.formerNames.join("、")}）` : ""));
    lines.push(`注册地：${this.jurisdictionName(c.jurisdiction)}` + (c.entityForm ? `，${c.entityForm}` : ""));
    lines.push(`注册编号：${c.registrationNumber || "未填写"}`);
    lines.push(`成立日期：${c.incorporationDate ?? "未填写"}`);
    lines.push(`注册地址：${c.registeredAddress || "未填写"}`);
    if (c.status !== "active") lines.push(`状态：${companyStatusLabel[c.status]}`);
    const off = this.officers(c.id, dd);
    lines.push("任职人员：" + (off.length ? off.map((a) => `${this.nameOf(ref("person", a.personID))}（${a.title}）`).join("、") : "未录入"));
    const sh = this.directShareholders(c.id, dd);
    lines.push("直接股东：" + (sh.length ? sh.map((h) => this.holdingText(h)).join("；") : "未录入"));
    const b = this.breakdownOf(c.id, dd);
    if (b.owners.length || b.unknown > 0.005) lines.push("最终受益（穿透）：" + this.breakdownLines(b).join("；"));
    const gs = this.groupsContaining(c.id);
    if (gs.length) lines.push(`所属集团：${gs.map((g) => g.name).join("、")}`);
    for (const item of this.chainsFromTops(c.id, dd).slice(0, 4)) lines.push(`持股链条（${item.group.name}）：${this.chainText(item.chain)}`);
    lines.push(`（以上信息截至 ${D.long(dd)}，摘自 Charter 档案）`);
    return lines.join("\n");
  }

  personSummary(p: Person): string {
    const r = ref("person", p.id);
    const cn = (id: string) => this.nameOf(ref("company", id));
    const range = (f?: Day, t?: Day) => (f && t ? `${f} 至 ${t}` : f ? `${f} 起` : t ? `至 ${t}` : null);
    const d = this.data;
    const sections: [string, string[]][] = [];
    const roles = d.appointments.filter((a) => a.personID === p.id && isActiveOn(a, this.today));
    const byCompany = new Map<string, Appointment[]>();
    for (const a of roles) byCompany.set(a.companyID, [...(byCompany.get(a.companyID) ?? []), a]);
    sections.push(["现任职务", [...byCompany.keys()].sort((a, b) => cn(a).localeCompare(cn(b))).map((cid) => {
      const rs = byCompany.get(cid)!;
      const titles: string[] = [];
      for (const x of rs) if (!titles.includes(x.title)) titles.push(x.title);
      const froms = rs.map((x) => x.from).filter((x): x is Day => !!x).sort();
      return `${cn(cid)} — ${titles.join("、")}${froms.length ? `（${froms[0]} 起）` : ""}`;
    })]);
    const direct = d.holdings.filter((h) => sameRef(h.holder, r) && isActiveOn(h, this.today)).sort((a, b) => b.percent - a.percent);
    sections.push(["直接持股", direct.map((h) => `${cn(h.companyID)} ${percentLabel(h.percent)}` + (h.isNominee ? `（名义股东，代${h.beneficialOwner ? this.nameOf(h.beneficialOwner) : "他人"}持有）` : ""))]);
    const held = d.holdings.filter((h) => h.isNominee && sameRef(h.beneficialOwner, r) && isActiveOn(h, this.today));
    sections.push(["穿透后持有", portfolio(r, d.companies, d.holdings, this.today).map((item) => {
      let t = `${item.company.name} ${percentLabel(item.percent)}`;
      if (item.viaNominee) {
        const here = held.filter((h) => h.companyID === item.company.id);
        t += here.length ? "（含" + here.map((h) => `${this.nameOf(h.holder)}代持 ${percentLabel(h.percent)}`).join("、") + "）" : "（含代持）";
      }
      return t;
    })]);
    sections.push(["由他人代持", held.map((h) => `${cn(h.companyID)} ${percentLabel(h.percent)}（由${this.nameOf(h.holder)}代持）`)]);
    const past = d.appointments.filter((a) => a.personID === p.id && !isActiveOn(a, this.today))
      .sort((a, b) => ((b.to ?? b.from ?? this.today) > (a.to ?? a.from ?? this.today) ? 1 : -1));
    sections.push(["曾任职务", past.map((a) => { const pr = range(a.from, a.to); return `${cn(a.companyID)} — ${a.title}${pr ? `（${pr}）` : ""}`; })]);
    const lines = [p.name];
    for (const [title, items] of sections) if (items.length) { lines.push("", `【${title}】`, ...items.map((x) => `· ${x}`)); }
    return lines.join("\n");
  }

  // MARK: 变更

  affectedCategories(kind: ChangeKind): string[] {
    switch (kind) {
      case "directorChange": return ["在职证明", "董事名册"];
      case "shareholderChange": return ["股东名册", "受益所有人登记"];
      case "addressChange": case "nameChange": return ["存续证明", "在职证明", "商业登记"];
      default: return [];
    }
  }
  affectedDocuments(kind: ChangeKind, companyID: string) {
    const cats = this.affectedCategories(kind);
    return this.ownedDocuments(ref("company", companyID)).filter((d) => { const t = this.docType(d.typeID); return !!t && cats.includes(t.category); });
  }
  eventRules(kind: ChangeKind, company: Company, effective: Day): [RuleTemplate, Day][] {
    return this.data.library.rules
      .filter((r) => r.enabled && r.jurisdictions.includes(company.jurisdiction) && (r.entityForms.length === 0 || r.entityForms.includes(company.entityForm)) && !company.disabledRuleIDs.includes(r.id))
      .map((r) => { const s = company.ruleOverrides?.[r.id]?.schedule; return s ? { ...r, schedule: s } : r; })
      .filter((r) => r.schedule.kind === "event" && r.schedule.event === kind)
      .map((r) => [r, adjustDay(D.addDays(effective, r.schedule.days ?? 0), r.adjust)]);
  }
  unsyncedChanges(companyID: string) {
    const d = this.data;
    return d.changes.filter((ch) => {
      if (ch.companyID !== companyID) return false;
      if (ch.kind === "directorChange") return !d.appointments.some((a) => a.companyID === companyID && (a.from === ch.effectiveOn || a.to === ch.effectiveOn));
      if (ch.kind === "shareholderChange") return !d.holdings.some((h) => h.companyID === companyID && (h.from === ch.effectiveOn || h.to === ch.effectiveOn));
      return false;
    });
  }

  // MARK: 补发请求

  get openRequests(): DocumentRequest[] {
    return this.data.requests.filter((r) => r.status === "open").sort((a, b) => (a.followUpOn < b.followUpOn ? -1 : a.followUpOn > b.followUpOn ? 1 : 0));
  }
  openRequestsFor = (owner: NodeRef) => this.openRequests.filter((r) => sameRef(r.owner, owner));
  openRequestsForParty = (partyID: string) => this.openRequests.filter((r) => r.partyID === partyID);
  openRequest = (owner: NodeRef, typeID: string) => this.openRequests.find((r) => sameRef(r.owner, owner) && pendingTypeIDs(r).includes(typeID));
  followUpDays(partyID?: string) { const d = this.party(partyID)?.followUpDays ?? defaultFollowUpDays; return d > 0 ? d : defaultFollowUpDays; }
  defaultRequestParty(owner: NodeRef): Party | undefined {
    if (owner.kind === "company") return this.party(this.company(owner.id)?.defaultPartyID);
    const cid = this.data.appointments.find((a) => a.personID === owner.id && !a.to)?.companyID;
    return this.party(this.company(cid)?.defaultPartyID);
  }
  daysWaiting = (r: DocumentRequest) => Math.max(0, D.daysBetween(D.dayOfStamp(r.createdAt), this.today));
  isFollowUpDue = (r: DocumentRequest) => r.status === "open" && r.followUpOn <= this.today;
  typeNames = (ids: string[]) => ids.map((id) => this.docType(id)?.name ?? "文件").join("、");

  ownerPhrase(owner: NodeRef) {
    const n = this.nameOf(owner);
    const last = n[n.length - 1];
    return last && /[A-Za-z0-9.)]/.test(last) ? n + " " : n;
  }
  private greeting(partyID?: string) {
    const c = this.party(partyID)?.contactName.trim() ?? "";
    return c ? `${c}，您好：` : "您好：";
  }
  gapDescription(owner: NodeRef, typeID: string): { issued?: Day; state: string; hasFile: boolean } {
    const cur = this.data.documents.filter((d) => sameRef(d.owner, owner) && d.typeID === typeID && !d.supersededBy)
      .reduce<Document | undefined>((m, d) => (!m || (d.issueDate ?? d.addedOn) > (m.issueDate ?? m.addedOn) ? d : m), undefined);
    if (!cur) return { state: "目前没有存档", hasFile: false };
    const f = this.freshness(cur);
    const state = f.kind === "expired" ? "已过期" : f.kind === "expiring" ? `将在 ${f.days} 天后到期` : "需要更新";
    return { issued: cur.issueDate, state, hasFile: true };
  }
  reissueText(owner: NodeRef, typeIDs: string[], partyID?: string): string {
    const o = this.ownerPhrase(owner);
    const hello = this.greeting(partyID);
    if (typeIDs.length === 1) {
      const name = this.typeNames(typeIDs);
      const gap = this.gapDescription(owner, typeIDs[0]);
      if (!gap.hasFile) return `${hello}\n\n${o}的${name}目前没有存档，麻烦提供一份，谢谢。`;
      return `${hello}\n\n${o}的${name}${gap.issued ? `（${D.long(gap.issued)}签发）` : ""}${gap.state}，麻烦补发一份新的，谢谢。`;
    }
    const lines = typeIDs.map((id, i) => {
      const gap = this.gapDescription(owner, id);
      return `${i + 1}. ${this.typeNames([id])}：${gap.issued ? `${D.long(gap.issued)}签发，` : ""}${gap.state}`;
    });
    return `${hello}\n\n${o}的以下文件需要补发，麻烦各提供一份新的：\n${lines.join("\n")}\n\n谢谢。`;
  }
  followUpText(r: DocumentRequest): string {
    const sent = D.dayOfStamp(r.createdAt);
    return `${this.greeting(r.partyID)}\n\n${D.display(sent, this.today)}请您补发的${this.ownerPhrase(r.owner)}的${this.typeNames(pendingTypeIDs(r))}还没有收到，想跟您确认一下进度，方便的话请告知预计什么时候可以提供，谢谢。`;
  }

  recordRequest(owner: NodeRef, typeIDs: string[], partyID: string | undefined, message: string, days: number): DocumentRequest | undefined {
    if (!typeIDs.length) return;
    const r: DocumentRequest = {
      id: uuid(), owner, typeIDs, partyID, createdAt: D.nowStamp(), followUpOn: D.addDays(this.today, Math.max(1, days)),
      status: "open", receivedDocumentIDs: [], note: message,
    };
    const covered = new Set(typeIDs);
    this.performUndoable("记录补发请求", `已记录请求，将在 ${D.short(r.followUpOn)}提醒跟进`, (d) => {
      for (const x of d.requests) {
        if (x.status === "open" && sameRef(x.owner, owner) && pendingTypeIDs(x as DocumentRequest).every((t) => covered.has(t))) x.status = "cancelled";
      }
      d.requests.push(r as any);
    });
    return r;
  }
  markNudged(id: string) {
    const r = this.data.requests.find((x) => x.id === id);
    if (!r) return;
    const next = D.addDays(this.today, this.followUpDays(r.partyID));
    this.performUndoable("催办", `已复制催办文字，将在 ${D.short(next)}再次提醒`, (d) => {
      const x = d.requests.find((y) => y.id === id)!;
      x.followUpOn = next; x.nudgedCount = (x.nudgedCount ?? 0) + 1;
    });
  }
  cancelRequest(id: string) {
    this.performUndoable("取消等回件", "已不再等这份补发", (d) => { const x = d.requests.find((y) => y.id === id); if (x) x.status = "cancelled"; });
  }
  reassignRequest(id: string, partyID?: string) {
    this.performUndoable("改中介", `已改由${latinPad(this.party(partyID)?.name ?? "未指定中介")}补发`, (d) => { const x = d.requests.find((y) => y.id === id); if (x) x.partyID = partyID; });
  }
  /** 归档之后：把正在等这些文件的请求标为已收到。在同一个修改里调用。 */
  closeRequests(d: Draft<Data>, archived: Document[]): string {
    if (!archived.length || !d.requests.some((r) => r.status === "open")) return "";
    const phrases: string[] = [];
    for (const doc of archived) {
      const candidates = d.requests.filter((r) => r.status === "open" && sameRef(r.owner, doc.owner) && pendingTypeIDs(r as DocumentRequest).includes(doc.typeID));
      if (!candidates.length) continue;
      const r = candidates.reduce((m, x) => (x.createdAt < m.createdAt ? x : m));
      r.receivedTypeIDs = [...(r.receivedTypeIDs ?? []), doc.typeID];
      r.receivedDocumentIDs.push(doc.id);
      if (!pendingTypeIDs(r as DocumentRequest).length) r.status = "received";
      phrases.push(`${this.party(r.partyID)?.name ?? "中介"} 补发的${latinPadStart(this.docType(doc.typeID)?.name ?? "文件")}`);
    }
    if (!phrases.length) return "";
    if (phrases.length > 2) return `，已收到 ${phrases.length} 份补发的文件`;
    return "，已收到" + phrases.join("和");
  }

  // MARK: 文件归档

  static insertingVersion(doc: Document, docs: Document[], keepBoth = false): Document[] {
    const result = docs.map((d) => ({ ...d }));
    const n = { ...doc };
    if (keepBoth) return [...result, n];
    const current = result.filter((d) => sameRef(d.owner, n.owner) && d.typeID === n.typeID && !d.supersededBy);
    const newer = n.issueDate ? current.filter((d) => d.issueDate && d.issueDate > n.issueDate!) : [];
    if (newer.length) {
      n.supersededBy = newer.reduce((m, d) => ((d.issueDate ?? d.addedOn) > (m.issueDate ?? m.addedOn) ? d : m)).id;
    } else {
      for (const d of result) if (sameRef(d.owner, n.owner) && d.typeID === n.typeID && !d.supersededBy) d.supersededBy = n.id;
    }
    return [...result, n];
  }

  /** 把一批文件复制进数据文件夹并一次写入记录；失败时删除这次复制的文件。 */
  async archiveBatch(reqs: ArchiveRequest[], newCompanies: Company[] = []): Promise<Document[]> {
    if (this.loadFailed || this.isLoading || this.isImporting) throw unavailableError();
    if (!reqs.length) return [];
    this.isImporting = true; this.emit();
    const p = platform();
    try {
      const proposed = [...this.data.companies, ...newCompanies.filter((n) => !this.data.companies.some((c) => c.id === n.id))];
      const cName = new Map(proposed.map((c) => [c.id, c.name]));
      const pName = new Map(this.data.people.map((x) => [x.id, x.name]));
      for (const r of reqs) {
        const t = this.docType(r.typeID);
        const owner = r.owner.kind === "company" ? cName.get(r.owner.id) : pName.get(r.owner.id);
        if (!t || t.owner !== r.owner.kind || !owner) throw invalidTargetError();
      }
      const copies: Document[] = [];
      const keepBoth = new Set<string>();
      try {
        for (const r of reqs) {
          const ownerName = (r.owner.kind === "company" ? cName.get(r.owner.id) : pName.get(r.owner.id))!;
          const path = await this.folder.archive(r.path, ownerName, r.owner, this.docType(r.typeID)!.name, r.issued);
          const doc: Document = {
            id: uuid(), typeID: r.typeID, owner: r.owner, issueDate: r.issued, expiryDate: r.expiry, form: r.form ?? "扫描件",
            filePath: path, originalFileName: r.path.split(/[\\/]/).pop() ?? "", needsUpdate: false, addedOn: this.today, notes: r.note ?? "",
          };
          if (r.keepBoth) keepBoth.add(doc.id);
          copies.push(doc);
        }
      } catch (e) {
        for (const d of copies) { try { await p.removeFile(this.folder.abs(d.filePath)); } catch { /* 忽略 */ } }
        throw e;
      }
      const next = copies.reduce((acc, d) => Store.insertingVersion(d, acc, keepBoth.has(d.id)), this.data.documents);
      try {
        await this.persistCollections(newCompanies.length ? { documents: next, companies: proposed } : { documents: next });
      } catch (e) {
        if (!(e instanceof CollectionSaveError && e.rollbackFailures.length)) {
          for (const d of copies) { try { await p.removeFile(this.folder.abs(d.filePath)); } catch { /* 忽略 */ } }
        }
        throw e;
      }
      this.data = { ...this.data, documents: next, companies: proposed };
      this.afterChange();
      return copies.map((c) => next.find((d) => d.id === c.id)!).filter(Boolean);
    } finally {
      this.isImporting = false; this.emit();
    }
  }

  /** 保存文件详情前校验类型与归属。 */
  async updateDocument(edited: Document) {
    const idx = this.data.documents.findIndex((d) => d.id === edited.id);
    if (idx < 0) throw new Error("这份文件记录已经不存在，请关闭窗口后重新打开。");
    const type = this.docType(edited.typeID);
    if (!type) throw new Error("所选文件类型已经不存在，请选择其他类型。");
    if (edited.owner.kind === "company") {
      const c = this.company(edited.owner.id);
      if (!c) throw new Error("所选归属对象已经不存在，请选择其他公司或人员。");
      if (type.owner !== "company") throw new Error("这个文件类型与归属对象不匹配。公司文件只能归属公司，人员文件只能归属人员。");
      if (!typeAppliesTo(type, c.jurisdiction)) throw new Error("这个文件类型不适用于所选公司的法域，请选择适用的类型。");
    } else {
      if (!this.person(edited.owner.id)) throw new Error("所选归属对象已经不存在，请选择其他公司或人员。");
      if (type.owner !== "person") throw new Error("这个文件类型与归属对象不匹配。公司文件只能归属公司，人员文件只能归属人员。");
    }
    if (!edited.supersededBy && this.data.documents.some((d) => d.id !== edited.id && !d.supersededBy && sameRef(d.owner, edited.owner) && d.typeID === edited.typeID)) {
      throw new Error("该归属对象已经有一份同类型的现行文件。请打开现有文件并使用“归档新版”。");
    }
    const before = this.data;
    const next = this.data.documents.map((d, i) => (i === idx ? edited : d));
    await this.persistCollections({ documents: next });
    return this.replace({ documents: next }, { label: "修改文件信息", before });
  }

  reissueParty(d: Document) { return this.defaultRequestParty(d.owner); }

  removeDocuments(ids: Set<string>) {
    if (!ids.size) return;
    const before = this.data.documents.length;
    const { undoID } = this.commit((d) => {
      d.documents = d.documents.filter((x) => !ids.has(x.id));
      for (const x of d.documents) if (x.supersededBy && ids.has(x.supersededBy)) x.supersededBy = undefined;
    }, { label: `移除 ${ids.size} 份文件记录` });
    const removed = before - this.data.documents.length;
    this.showToast(`已从 Charter 移除 ${removed} 份文件的记录，文件夹里的文件仍保留。`, undoID ? () => this.undoID(undoID) : undefined);
  }

  // MARK: 中介

  partyReferences(id: string) {
    const d = this.data;
    const defaultCompanies = d.companies.filter((c) => c.defaultPartyID === id).length;
    const ruleAssignments = d.companies.reduce((a, c) => a + Object.values(c.rulePartyIDs).filter((x) => x === id).length, 0);
    const records = d.records.filter((r) => r.partyID === id).length;
    const lines: string[] = [];
    if (defaultCompanies) lines.push(`${defaultCompanies} 家公司的默认中介将改为未指定`);
    if (ruleAssignments) lines.push(`${ruleAssignments} 条按规则指定的中介将改为跟随公司默认`);
    if (records) lines.push(`${records} 条事项记录将改为未指定中介，交办历史保留`);
    return { isEmpty: !defaultCompanies && !ruleAssignments && !records, lines };
  }

  deleteParty(p: Party) {
    const { undoID } = this.commit((d) => {
      d.parties = d.parties.filter((x) => x.id !== p.id);
      for (const c of d.companies) {
        if (c.defaultPartyID === p.id) c.defaultPartyID = undefined;
        for (const k of Object.keys(c.rulePartyIDs)) if (c.rulePartyIDs[k] === p.id) delete c.rulePartyIDs[k];
      }
      for (const r of d.records) if (r.partyID === p.id) r.partyID = undefined;
      for (const r of d.requests) if (r.partyID === p.id) r.partyID = undefined;
    }, { label: "删除中介" });
    this.showToast(`已删除中介“${p.name}”。`, undoID ? () => this.undoID(undoID) : undefined);
  }

  // MARK: 备份

  async snapshotBeforeChange(reason: string): Promise<DataSnapshot | null> {
    if (this.loadFailed || this.isLoading) return null;
    try {
      await this.flushWrites();
      const snap = await makeSnapshot(this.folder, reason);
      this.snapshots = await listSnapshots(this.folder);
      return snap;
    } catch (e) {
      this.setError(`自动备份没有写成：${(e instanceof Error ? e.message : String(e))}。操作仍会继续；可以在设置的“备份与配置”里手动备份。`);
      return null;
    }
  }

  async refreshSnapshots() { this.snapshots = await listSnapshots(this.folder); this.emit(); }

  async backUpNow() {
    if (this.loadFailed || this.isLoading) { this.setError("数据还没有正常载入，暂不能备份。"); return; }
    try {
      await this.flushWrites();
      await makeSnapshot(this.folder, "手动备份");
      await this.refreshSnapshots();
      this.showToast("已备份当前数据。");
    } catch (e) {
      this.showToast(`备份没有写成：${(e instanceof Error ? e.message : String(e))}`, () => void this.backUpNow(), "重试", "failure");
    }
  }

  async restoreFromSnapshot(s: DataSnapshot) {
    if (this.isImporting) { this.setError("文件正在归档，请完成后再恢复。"); return; }
    if (this.isLoading) return;
    try {
      await this.flushWrites();
      if (!this.loadFailed) await makeSnapshot(this.folder, `恢复到 ${snapshotTitle(s.date)} 之前`);
      await restoreSnapshot(s, this.folder);
    } catch (e) {
      this.setError(`恢复失败：${(e instanceof Error ? e.message : String(e))}。当前数据没有被覆盖，或已在“备份与配置”里留有恢复前的快照。`);
      await this.refreshSnapshots();
      return;
    }
    await this.refreshSnapshots();
    await this.load();
    this.onDataCleared?.();
    this.showToast(`已恢复到 ${snapshotTitle(s.date)} 的状态。`);
  }

  revealSnapshots = async () => {
    const p = platform();
    await p.mkdirs(this.folder.snapshotsDir);
    await p.reveal(this.snapshots[0]?.folder ?? this.folder.snapshotsDir);
  };

  onDataCleared: (() => void) | null = null;

  get clearSummaryLines(): string[] {
    const d = this.data;
    return [["公司", d.companies.length, "家"], ["集团", d.groups.length, "个"], ["人员", d.people.length, "人"], ["任职记录", d.appointments.length, "条"],
      ["持股记录", d.holdings.length, "条"], ["文件（记录和已归档的文件本身）", d.documents.length, "份"], ["中介", d.parties.length, "个"],
      ["合规事项和交办记录", d.records.length, "条"], ["变更记录", d.changes.length, "条"]].map(([a, b, c]) => `${a}：${b} ${c}`);
  }

  async clearAllData() {
    if (this.isImporting) { this.setError("文件正在归档，请完成后再清空数据。"); return; }
    if (this.loadFailed || this.isLoading) { this.setError("数据还没有正常载入，暂不能清空。请检查数据文件夹后重新载入。"); return; }
    // 清空前的快照连同归档文件一起保存，恢复这份快照就能完整找回。快照写不成就不清空。
    let snap: DataSnapshot;
    try { await this.flushWrites(); snap = await makeSnapshot(this.folder, "清空所有数据前"); }
    catch (e) { this.setError(`清空前的备份没有写成，数据没有改动：${(e instanceof Error ? e.message : String(e))}。请确认数据文件夹可写入后重试。`); return; }
    this.undoStack = []; this.redoStack = [];
    const files = this.data.documents.map((d) => this.fileURL(d));
    const rels = this.data.documents.map((d) => d.filePath);
    const empty = { companies: [], people: [], holdings: [], appointments: [], parties: [], documents: [], records: [], changes: [], groups: [], requests: [] };
    try { await this.persistCollections(empty); }
    catch (e) { this.setError(`清空失败，数据没有改动：${(e instanceof Error ? e.message : String(e))}。请确认数据文件夹可写入后重试。`); return; }
    this.data = { ...this.data, ...empty };
    this.afterChange();
    const p = platform();
    let failed = 0;
    const folders = new Set<string>();
    for (const [i, f] of files.entries()) {
      folders.add(f.slice(0, Math.max(f.lastIndexOf("/"), f.lastIndexOf("\\"))));
      try {
        if (!(await p.stat(f)).exists) continue;
        const kept = p.join(snap.folder, ...rels[i].split("/"));
        await p.mkdirs(kept.slice(0, Math.max(kept.lastIndexOf("/"), kept.lastIndexOf("\\"))));
        await p.moveFile(f, kept);
      } catch { failed++; }
    }
    this.snapshots = await listSnapshots(this.folder);
    const filesRoot = this.folder.filesDir;
    for (const folder of [...folders].sort((a, b) => b.length - a.length)) {
      let dir = folder;
      while (dir.startsWith(filesRoot) && dir.length > filesRoot.length) {
        try {
          const items = await p.listDir(dir);
          if (!items.every((e) => e.name === ".DS_Store" || e.name === "Thumbs.db" || e.name === "desktop.ini")) break;
          await p.removeDir(dir);
        } catch { break; }
        dir = dir.slice(0, Math.max(dir.lastIndexOf("/"), dir.lastIndexOf("\\")));
      }
    }
    this.onDataCleared?.();
    if (failed) this.setError(`数据已清空，但有 ${failed} 个归档文件没能删除。可以打开数据文件夹的“文件”目录手动删除。`);
    else this.showToast("已清空所有数据。设置和模板库已保留；需要时可在“备份与配置”里恢复清空前的快照，归档文件也会一起找回。");
  }

  saveSettings(change: (s: Draft<SharedSettings>) => void) { this.commit((d) => change(d.settings)); }
  saveLibrary(change: (l: Draft<TemplateLibrary>) => void) { this.commit((d) => change(d.library)); }
}

export { snapshotTitle, refKey, hasFile, isMember, excludedSet, percentLabel };


/** 4.4 录入性质与出处。 */
export interface EntryNature { backfill?: boolean; effectiveOn?: Day; effectiveUnknown?: boolean; asOf?: Day; evidence?: Evidence }
export interface NewEntity { name: string; jurisdiction: string; entityForm?: string; groupID?: string }
export interface HoldingEntry {
  companyID: string; percent: number; isNominee?: boolean; roleID?: string;
  holder: { kind: "existing"; ref: NodeRef } | { kind: "newPerson"; name: string } | { kind: "newCompany"; entity: NewEntity };
  backfill: boolean; effectiveOn?: Day; asOf?: Day; evidence?: Evidence; verified: boolean;
}
export interface AppointmentEntry {
  companyID: string; personID?: string; personName: string; title: string; roleID?: string;
  backfill: boolean; effectiveOn?: Day; asOf?: Day; evidence?: Evidence; verified: boolean;
}
