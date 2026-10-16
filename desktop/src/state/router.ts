// 页面跳转与弹窗。移植自 Swift 版 Router。

import * as D from "../domain/day";
import type { Day } from "../domain/day";
import type { ChangeKind, NodeKind, NodeRef, ObligationStatus } from "../domain/models";
import { platform } from "../platform/platform";
import { ungrouped } from "./store";

export type Section = "overview" | "companies" | "files" | "people" | "parties";
export const sections: { id: Section; title: string; symbol: string }[] = [
  { id: "overview", title: "总览", symbol: "square.grid.3x3" },
  { id: "companies", title: "公司", symbol: "building.2" },
  { id: "files", title: "文件", symbol: "doc.on.doc" },
  { id: "people", title: "人员", symbol: "person.crop.rectangle.stack" },
  { id: "parties", title: "负责方", symbol: "person.2" },
];

export type CompaniesMode = "list" | "matrix" | "structure";

export type Sheet =
  | { kind: "newCompany" } | { kind: "newCompanyInGroup"; group: string } | { kind: "newGroup" } | { kind: "editGroup"; group: string }
  | { kind: "groupMembers"; group: string } | { kind: "addRelation"; companyID: string; upward: boolean } | { kind: "companyItems"; companyID: string }
  | { kind: "quickSearch" } | { kind: "exportAll"; companyID: string } | { kind: "chainQuery"; from?: NodeRef; to?: string }
  | { kind: "editCompany"; companyID: string } | { kind: "importFiles"; paths: string[] } | { kind: "resumeImport" }
  | { kind: "packet"; companyID?: string } | { kind: "packetFor"; companyID: string; purposeID: string } | { kind: "change"; companyID: string }
  | { kind: "changeFrom"; companyID: string; changeKind: ChangeKind; appointmentID?: string; holdingID?: string }
  | { kind: "obligation"; key: string } | { kind: "document"; id: string } | { kind: "confirmRule"; ruleID: string; companyID?: string };

export type CalendarRange = { kind: "all" } | { kind: "thisMonth" } | { kind: "nextMonth" } | { kind: "next3Months" } | { kind: "custom"; from: Day; to: Day };
export const calendarRangeLabel = (r: CalendarRange) =>
  ({ all: "未来 12 个月", thisMonth: "本月", nextMonth: "下月", next3Months: "未来 3 个月", custom: "自定义" })[r.kind];
export function calendarBounds(r: CalendarRange, today: Day): { from?: Day; to: Day } {
  const first = D.makeDay(D.year(today), D.month(today), 1);
  switch (r.kind) {
    case "all": return { to: D.addDays(today, 366) };
    case "thisMonth": return { to: D.addDays(D.addMonths(first, 1), -1) };
    case "nextMonth": return { from: D.addMonths(first, 1), to: D.addDays(D.addMonths(first, 2), -1) };
    case "next3Months": return { from: today, to: D.addMonths(today, 3) };
    case "custom": return { from: r.from, to: r.to };
  }
}
export interface CalendarPreset { partyID?: string; range: CalendarRange; status?: ObligationStatus }

export type ImportContext = { kind: "company"; id: string } | { kind: "group"; id: string };

export type SettingsPane = "sync" | "reminders" | "archiveItems" | "purposes" | "rules" | "backup" | "modules";
export const settingsPanes: SettingsPane[] = ["sync", "reminders", "archiveItems", "purposes", "rules", "backup", "modules"];
export const settingsPaneTitle: Record<SettingsPane, string> = { sync: "数据与同步", reminders: "提醒", archiveItems: "档案清单", purposes: "文件包用途", rules: "合规规则", backup: "备份与配置", modules: "功能模块" };
export const settingsPaneSymbol: Record<SettingsPane, string> = { sync: "icloud", reminders: "bell", archiveItems: "list.bullet.rectangle", purposes: "shippingbox", rules: "calendar.badge.clock", backup: "clock.arrow.circlepath", modules: "square.grid.2x2" };
export const settingsGroups = (complianceOn: boolean): { title?: string; panes: SettingsPane[] }[] => [
  { title: "常规", panes: ["sync", "reminders"] },
  { title: "模板库", panes: complianceOn ? ["archiveItems", "purposes", "rules"] : ["archiveItems", "purposes"] },
  { title: "高级", panes: ["backup", "modules"] },
];

export class Router {
  section: Section = "overview";
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
  companiesMode: CompaniesMode = "list";
  structureCheck = false;
  structureUpward: string | null = null;
  showCalendar = false;
  sheet: Sheet | null = null;
  importContext: ImportContext | null = null;
  settings: SettingsPane | null = null;
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
  close() { this.sheet = null; this.emit(); }

  startImport(paths: string[], context: ImportContext | null) {
    if (!paths.length) return;
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
    if (this.section === "companies" && this.companiesMode === "list" && !this.showCalendar && this.selectedCompanyID) return { kind: "company", id: this.selectedCompanyID };
    if (this.groupFilter && this.groupFilter !== ungrouped && groupExists(this.groupFilter)) return { kind: "group", id: this.groupFilter };
    return null;
  }

  resetSelection() {
    this.sheet = null; this.calendarPreset = null; this._selectedCompanyID = null; this.selectedPersonID = null; this.groupFilter = null;
    this.filesOwnerKind = null; this.filesFilter = 0; this.companyTab = 0; this.companiesMode = "list"; this.showCalendar = false; this.section = "overview";
    this.emit();
  }

  go(s: Section) { this.showCalendar = false; this.section = s; this.emit(); }
  openCalendar(preset: CalendarPreset = { range: { kind: "all" } }) { this.calendarPreset = preset; this.showCalendar = true; this.emit(); }
  openStructure(opts: { group?: string | null; check?: boolean; upwardFrom?: string | null } = {}) {
    if (opts.group) this.groupFilter = opts.group;
    this.structureUpward = opts.upwardFrom ?? null;
    if (opts.check) this.structureCheck = true;
    this.companiesMode = "structure"; this.showCalendar = false; this.section = "companies";
    this.emit();
  }
  openPerson(id: string) { this.selectedPersonID = id; this.showCalendar = false; this.section = "people"; this.emit(); }
  openCompany(id: string) { this.selectedCompanyID = id; this.companiesMode = "list"; this.showCalendar = false; this.section = "companies"; this.emit(); }
  openSettings(pane: SettingsPane = "sync") { this.settings = pane; this.emit(); }
}
