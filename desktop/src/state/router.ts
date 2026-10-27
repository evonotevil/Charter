// 页面跳转与弹窗。移植自 Swift 版 Router。

import * as D from "../domain/day";
import type { Day } from "../domain/day";
import type { ChangeKind, NodeKind, NodeRef, ObligationStatus } from "../domain/models";
import { platform } from "../platform/platform";
import { ungrouped } from "./store";

export type Section = "structure" | "due" | "agents" | "overview" | "companies" | "files" | "people" | "parties" | "verify" | "sync" | "settings";
/** 侧栏：五个工作页面（⌘1–⌘5），下面是工作区（设备与同步、设置）。 */
export const sections: { id: Section; title: string; symbol: string }[] = [
  { id: "companies", title: "公司总览", symbol: "building.2" },
  { id: "due", title: "申报日历", symbol: "calendar.badge.clock" },
  { id: "structure", title: "股权结构", symbol: "point.3.connected.trianglepath.dotted" },
  { id: "files", title: "文件", symbol: "doc.on.doc" },
  { id: "people", title: "人员与中介", symbol: "person.2" },
];
export const workspaceSections: { id: Section; title: string; symbol: string }[] = [
  { id: "sync", title: "设备与同步", symbol: "icloud" },
  { id: "settings", title: "设置", symbol: "gearshape" },
];
export const sectionShortcuts: Section[] = ["companies", "due", "structure", "files", "people"];

export type CompaniesMode = "list" | "matrix" | "structure";

export type Sheet =
  | { kind: "newCompany" } | { kind: "newCompanyInGroup"; group: string } | { kind: "newGroup" } | { kind: "editGroup"; group: string }
  | { kind: "groupMembers"; group: string } | { kind: "addRelation"; companyID: string; upward: boolean } | { kind: "companyItems"; companyID: string } | { kind: "scope"; ownerKind: "company" | "person"; owners?: string[] } | { kind: "trashDocs"; ids: string[] }
  | { kind: "quickSearch" } | { kind: "exportAll"; companyID: string } | { kind: "chainQuery"; from?: NodeRef; to?: string }
  | { kind: "editCompany"; companyID: string } | { kind: "importFiles"; paths: string[] } | { kind: "resumeImport" }
  | { kind: "packet"; companyID?: string } | { kind: "packetFor"; companyID: string; purposeID: string } | { kind: "change"; companyID: string }
  | { kind: "changeFrom"; companyID: string; changeKind: ChangeKind; appointmentID?: string; holdingID?: string }
  | { kind: "obligation"; key: string } | { kind: "document"; id: string } | { kind: "confirmRule"; ruleID: string; companyID?: string };

export type CalendarRange = { kind: "all" } | { kind: "thisMonth" } | { kind: "nextMonth" } | { kind: "next3Months" } | { kind: "custom"; from: Day; to: Day };
const calendarRangeLabel = (r: CalendarRange) =>
  ({ all: "未来 12 个月", thisMonth: "本月", nextMonth: "下月", next3Months: "未来 3 个月", custom: "自定义" })[r.kind];
export interface CalendarPreset { partyID?: string; range: CalendarRange; status?: ObligationStatus }

export type ImportContext = { kind: "company"; id: string } | { kind: "group"; id: string };

export type SettingsPane = "sync" | "reminders" | "groups" | "archiveItems" | "scope" | "purposes" | "rules" | "backup" | "privacy";
export const settingsPanes: SettingsPane[] = ["reminders", "groups", "archiveItems", "scope", "purposes", "rules", "backup", "privacy"];
export const settingsPaneTitle: Record<SettingsPane, string> = { sync: "数据与同步", reminders: "提醒", groups: "集团", archiveItems: "档案清单", purposes: "文件包用途", rules: "合规规则", backup: "备份与恢复", scope: "材料范围", privacy: "隐私与本地处理" };
export const settingsPaneSymbol: Record<SettingsPane, string> = { sync: "icloud", reminders: "bell", groups: "square.stack.3d.up", archiveItems: "list.bullet.rectangle", purposes: "shippingbox", rules: "calendar.badge.clock", backup: "clock.arrow.circlepath", scope: "checklist", privacy: "lock.circle" };
export const settingsGroups = (): { title: string; panes: SettingsPane[] }[] => [
  { title: "常规", panes: ["reminders"] },
  { title: "公司资料", panes: ["groups", "archiveItems", "scope", "purposes"] },
  { title: "到期规则", panes: ["rules"] },
  { title: "高级", panes: ["backup", "privacy"] },
];

export class Router {
  section: Section = "companies";
  /** 公司总览里是否打开了某家公司的页面。 */
  companyOpen = false;
  settingsPane: SettingsPane = "reminders";
  selectedObligationKey: string | null = null;
  selectedAgentID: string | null = null;
  newPersonRequest = 0;
  newPartyRequest = 0;
  calendarPreset: CalendarPreset | null = null;
  private _selectedCompanyID: string | null = null;
  recentCompanyIDs: string[] = [];
  selectedPersonID: string | null = null;
  groupFilter: string | null = null;
  companyTab = 0;
  filesFilter = 0;
  filesOwnerKind: NodeKind | null = null;
  filesHorizon = 30;
  /** 文件页的分页：文件 / 待整理 / 废纸篓。 */
  filesPane: "files" | "inbox" | "trash" = "files";
  /** 等待加入待整理的路径（由文件页消费）。 */
  inboxPaths: string[] = [];
  companiesMode: CompaniesMode = "list";
  structureCheck = false;
  structureUpward: string | null = null;
  showCalendar = false;
  sheet: Sheet | null = null;
  importContext: ImportContext | null = null;
  settings: SettingsPane | null = null;
  settingsGroupID: string | null = null;
  archiveScope: string | null = null;
  version = 0;
  private listeners = new Set<() => void>();

  constructor() {
    try { this.recentCompanyIDs = JSON.parse(platform().prefGet("recentCompanies") ?? "[]"); } catch { this.recentCompanyIDs = []; }
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  emit() { this.version++; for (const l of this.listeners) l(); }
  set<K extends keyof this>(k: K, v: this[K]) { this[k] = v; this.emit(); }
  update(fn: (r: this) => void) { fn(this); this.emit(); }

  get selectedCompanyID() { return this._selectedCompanyID; }
  set selectedCompanyID(id: string | null) {
    if (id && id !== this._selectedCompanyID) this.noteRecent(id);
    this._selectedCompanyID = id;
  }

  noteRecent(id: string) {
    this.recentCompanyIDs = [id, ...this.recentCompanyIDs.filter((x) => x !== id)].slice(0, 5);
    platform().prefSet("recentCompanies", JSON.stringify(this.recentCompanyIDs));
  }

  open(sheet: Sheet) { this.sheet = sheet; this.emit(); }
  /** 关闭弹窗：先淡出（fast），再卸载。 */
  close() {
    const sheet = this.sheet;
    if (!sheet) return;
    const root = typeof document !== "undefined" ? document.documentElement : null;
    if (!root) { this.sheet = null; this.emit(); return; }
    root.classList.add("closing-sheet");
    setTimeout(() => { if (this.sheet === sheet) { this.sheet = null; this.emit(); } setTimeout(() => root.classList.remove("closing-sheet"), 60); }, 120);
  }

  startImport(paths: string[], context: ImportContext | null) {
    if (!paths.length) return;
    // 5.3：没有明确目标的导入先进“待整理”，不直接进正式档案
    if (!context) { this.inboxPaths = [...this.inboxPaths, ...paths]; this.sheet = null; this.section = "files"; this.filesPane = "inbox"; this.emit(); return; }
    this.importContext = context;
    this.sheet = { kind: "importFiles", paths };
    this.emit();
  }
  get isImportOpen() { return this.sheet?.kind === "importFiles" || this.sheet?.kind === "resumeImport"; }

  async chooseFiles(context: ImportContext | null) {
    const paths = await platform().pickFiles({ multiple: true, extensions: ["pdf", "png", "jpg", "jpeg", "heic", "tif", "tiff"], title: "选择要上传的材料" });
    if (paths.length) this.startImport(paths, context);
  }

  currentImportContext(groupExists: (id: string) => boolean = () => true): ImportContext | null {
    if (this.section === "companies" && this.companyOpen && this.selectedCompanyID) return { kind: "company", id: this.selectedCompanyID };
    if (this.groupFilter && this.groupFilter !== ungrouped && groupExists(this.groupFilter)) return { kind: "group", id: this.groupFilter };
    return null;
  }

  resetSelection() {
    this.sheet = null; this.calendarPreset = null; this._selectedCompanyID = null; this.selectedPersonID = null; this.groupFilter = null;
    this.filesOwnerKind = null; this.filesFilter = 0; this.companyTab = 0; this.companiesMode = "list"; this.showCalendar = false; this.section = "companies"; this.companyOpen = false;
    this.emit();
  }

  go(s: Section) { this.showCalendar = false; if (s === "companies") this.companyOpen = false; this.section = s; this.emit(); }
  openCalendar(preset: CalendarPreset = { range: { kind: "all" } }) { this.calendarPreset = preset; this.showCalendar = true; this.emit(); }
  openStructure(opts: { group?: string | null; check?: boolean; upwardFrom?: string | null } = {}) {
    if (opts.group) this.groupFilter = opts.group;
    this.structureUpward = opts.upwardFrom ?? null;
    if (opts.check) this.structureCheck = true;
    this.showCalendar = false; this.section = "structure";
    this.emit();
  }
  openPerson(id: string) { this.selectedPersonID = id; this.showCalendar = false; this.section = "people"; this.emit(); }
  openCompany(id: string) { this.selectedCompanyID = id; this.companyOpen = true; this.companiesMode = "list"; this.showCalendar = false; this.section = "companies"; this.emit(); }
  openDue(key?: string) { if (key) this.selectedObligationKey = key; this.showCalendar = false; this.section = "due"; this.emit(); }
  openAgent(id: string) { this.selectedAgentID = id; this.showCalendar = false; this.section = "agents"; this.emit(); }
  openSettings(pane: SettingsPane = "reminders", groupID?: string | null) {
    if (pane === "sync") this.section = "sync";
    else { this.section = "settings"; this.settingsPane = pane; }
    if (groupID !== undefined) this.settingsGroupID = groupID;
    this.emit();
  }
}
