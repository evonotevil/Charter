// 数据模型。字段名与 Swift 版的 Codable 输出完全一致，两个版本可以读写同一个数据文件夹。
// 规则：Swift 里的非可选字段必须始终写出（Swift 解码时缺键会失败）；可选字段为 undefined 时省略。

import type { Day, MonthDay, Timestamp } from "./day";

export const uuid = () => crypto.randomUUID().toUpperCase();

// MARK: 法域

export interface Jurisdiction {
  code: string;
  name: string;
  timeZone: string;
  entityForms: string[];
}

// MARK: 公司

export type CompanyStatus = "forming" | "active" | "dormant" | "dissolving" | "dissolved" | "redomiciled";
export const companyStatuses: CompanyStatus[] = ["forming", "active", "dormant", "dissolving", "dissolved", "redomiciled"];
export const companyStatusLabel: Record<CompanyStatus, string> = {
  forming: "设立中",
  active: "正常",
  dormant: "休眠",
  dissolving: "注销中",
  dissolved: "已注销",
  redomiciled: "已迁册",
};
export const generatesObligations = (s: CompanyStatus) => s === "active" || s === "dormant" || s === "dissolving";

export interface GraphPoint { x: number; y: number }

export interface Company {
  id: string;
  name: string;
  formerNames: string[];
  aliases: string[];
  jurisdiction: string;
  entityForm: string;
  registrationNumber: string;
  incorporationDate?: Day;
  fiscalYearEnd: MonthDay;
  status: CompanyStatus;
  group: string;
  registeredAddress: string;
  defaultPartyID?: string;
  rulePartyIDs: Record<string, string>;
  disabledRuleIDs: string[];
  trackingSince: Day;
  notes: string;
  position?: GraphPoint;
  ruleOverrides?: Record<string, CompanyRuleOverride>;
  archive?: CompanyArchive;
}

export function newCompany(name: string, jurisdiction: string, trackingSince: Day): Company {
  return {
    id: uuid(), name, formerNames: [], aliases: [], jurisdiction, entityForm: "", registrationNumber: "",
    fiscalYearEnd: "12-31", status: "active", group: "", registeredAddress: "", rulePartyIDs: {},
    disabledRuleIDs: [], trackingSince, notes: "",
  };
}

const companySearchText = (c: Company) =>
  [c.name, ...c.formerNames, ...c.aliases, c.registrationNumber].join(" ").toLowerCase();

// MARK: 人

export interface Person {
  id: string;
  name: string;
  aliases: string[];
  email: string;
  notes: string;
  position?: GraphPoint;
}
export const newPerson = (name: string): Person => ({ id: uuid(), name, aliases: [], email: "", notes: "" });

// MARK: 持股与任职

export type NodeKind = "company" | "person";
export interface NodeRef { kind: NodeKind; id: string }
export const ref = (kind: NodeKind, id: string): NodeRef => ({ kind, id });
export const sameRef = (a?: NodeRef | null, b?: NodeRef | null) => !!a && !!b && a.kind === b.kind && a.id === b.id;
export const refKey = (r: NodeRef) => `${r.kind}:${r.id}`;
const parseRefKey = (k: string): NodeRef => {
  const i = k.indexOf(":");
  return { kind: k.slice(0, i) as NodeKind, id: k.slice(i + 1) };
};

/** 一条治理事实的依据：档案里的某份文件、第几页、备注（4.4）。 */
export interface Evidence { documentID: string; page?: string; note?: string }

/**
 * 4.4 可信台账：股权、任职共用的出处字段。
 * - from：生效日期（法律上自哪天起），未知时为空
 * - asOf：资料截至日期（依据文件反映的是哪天的状态）
 * - recordedOn：录入日期（自动）
 * - verified：已核实（必须有 evidence）；false = 待核实
 */
export interface Provenance { asOf?: Day; recordedOn?: Day; verified?: boolean; evidence?: Evidence; migrated?: boolean }

export interface Holding extends Provenance {
  id: string;
  /** 所有者角色（法域角色表 id，如 jp.shain、llc.member）；空 = 普通股东。 */
  roleID?: string;
  holder: NodeRef;
  companyID: string;
  percent: number;
  shares: string;
  shareClass: string;
  isNominee: boolean;
  beneficialOwner?: NodeRef;
  from?: Day;
  to?: Day;
}

export const isActiveOn = (x: { from?: Day; to?: Day }, day: Day) =>
  !(x.from && x.from > day) && !(x.to && x.to <= day);

export interface Appointment extends Provenance {
  id: string;
  /** 法域角色表 id（如 common.director、jp.shokumu）；空 = 只有自定义职务 title。 */
  roleID?: string;
  personID: string;
  companyID: string;
  title: string;
  from?: Day;
  to?: Day;
}

// MARK: 中介

export type PartyKind = "agent" | "department" | "person";
export const partyKindLabel: Record<PartyKind, string> = { agent: "外部代理", department: "内部部门", person: "个人" };

export interface Party {
  id: string;
  name: string;
  kind: PartyKind;
  contactName: string;
  email: string;
  phone: string;
  followUpDays: number;
  notes: string;
  /** Charter 4：一家中介可有多位对接人。第一位视为主对接人。旧数据只有 contactName/email。 */
  contacts?: Contact[];
}
export interface Contact { id: string; name: string; role: string; email: string; phone: string }
export const newContact = (name = ""): Contact => ({ id: uuid(), name, role: "", email: "", phone: "" });
/** 对接人列表：没有 contacts 时用旧的单一联系人补出一位。 */
export function contactsOf(p: Party): Contact[] {
  if (p.contacts?.length) return p.contacts;
  return p.contactName || p.email ? [{ id: p.id + "-c", name: p.contactName || p.email, role: "", email: p.email, phone: p.phone }] : [];
}
export const newParty = (name: string): Party => ({
  id: uuid(), name, kind: "agent", contactName: "", email: "", phone: "", followUpDays: 14, notes: "",
});

// MARK: 文件

export interface Document {
  id: string;
  typeID: string;
  owner: NodeRef;
  issueDate?: Day;
  expiryDate?: Day;
  form: string;
  filePath: string;
  originalFileName: string;
  supersededBy?: string;
  needsUpdate: boolean;
  addedOn: Day;
  notes: string;
}


// MARK: 合规事项记录

export type ObligationStatus = "pending" | "drafted" | "handedOff" | "waiting" | "done";
export const obligationStatusLabel: Record<ObligationStatus, string> = {
  pending: "待交办", drafted: "待发送", handedOff: "已交办", waiting: "已交办", done: "已完成",
};
export const isHandedOff = (s: ObligationStatus) => s === "handedOff" || s === "waiting";
export const normalizedStatus = (s: ObligationStatus): ObligationStatus => (s === "waiting" ? "handedOff" : s);

export type HandoffAction = "drafted" | "copied" | "sent" | "nudged" | "completed" | "reverted" | "rescheduled";
export const handoffActionLabel: Record<HandoffAction, string> = {
  drafted: "起草了邮件", copied: "复制了消息", sent: "确认已发送", nudged: "催办",
  completed: "标记完成", reverted: "退回待交办", rescheduled: "改期",
};

export interface HandoffEntry {
  action: HandoffAction;
  at: Timestamp;
  partyID?: string;
  channel?: string;
  message?: string;
}

export interface ObligationRecord {
  key: string;
  ruleID: string;
  companyID: string;
  dueDate: Day;
  overrideDue?: Day;
  status: ObligationStatus;
  partyID?: string;
  handedOffOn?: Day;
  completedOn?: Day;
  receiptDocumentID?: string;
  note: string;
  changeID?: string;
  draftedOn?: Day;
  log?: HandoffEntry[];
  /** Charter 4：你确认过这一条的日期。 */
  dateConfirmed?: boolean;
}
export const obligationKey = (ruleID: string, companyID: string, due: Day) => `${ruleID}|${companyID}|${due}`;

// MARK: 变更记录

export type ChangeKind = "directorChange" | "shareholderChange" | "addressChange" | "nameChange" | "statusChange" | "other";
export const changeKinds: ChangeKind[] = ["directorChange", "shareholderChange", "addressChange", "nameChange", "statusChange", "other"];
export const changeKindLabel: Record<ChangeKind, string> = {
  directorChange: "董事或高管变更",
  shareholderChange: "股东或持股变更",
  addressChange: "注册地址变更",
  nameChange: "公司更名",
  statusChange: "公司状态变更",
  other: "其他",
};

export interface ChangeRecord {
  id: string;
  companyID?: string;
  kind: ChangeKind;
  effectiveOn: Day;
  recordedOn: Day;
  summary: string;
  details?: string[];
  evidenceDocumentID?: string;
  /** 4.4：补录已有事实（不生成任何变更类提醒）。 */
  backfill?: boolean;
  /** 4.4：生效日期未知时为 true，effectiveOn 退回资料截至日期或录入日期，只用于排序。 */
  effectiveUnknown?: boolean;
  asOf?: Day;
}

// MARK: 共享设置

export interface SharedSettings {
  reminderDays: number[];
  primaryDeviceID?: string;
  primaryDeviceName?: string;
  calendarEnabled: boolean;
  calendarName: string;
  notificationHour: number;
  complianceEnabled?: boolean;
}
export const defaultSettings = (): SharedSettings => ({
  reminderDays: [30, 7, 1], calendarEnabled: true, calendarName: "Charter", notificationHour: 9,
});

// MARK: 模板

export type ValidityKind = "permanent" | "monthsAfterIssue" | "expiryOnDocument" | "untilChanged";
export const validityKinds: ValidityKind[] = ["permanent", "monthsAfterIssue", "expiryOnDocument", "untilChanged"];
export const validityLabel: Record<ValidityKind, string> = {
  permanent: "长期有效",
  monthsAfterIssue: "签发后若干个月",
  expiryOnDocument: "以文件上的到期日为准",
  untilChanged: "信息变更后需重开",
};

export interface DocumentType {
  id: string;
  name: string;
  category: string;
  localNames: string[];
  jurisdictions: string[];
  owner: NodeKind;
  validity: ValidityKind;
  validityMonths?: number;
  hints: string[];
  builtIn: boolean;
  entityForms?: string[];
}
export const typeAppliesTo = (t: DocumentType, jurisdiction: string) =>
  t.jurisdictions.length === 0 || t.jurisdictions.includes(jurisdiction);

export type ScheduleKind = "annualFixed" | "afterAnniversary" | "afterFiscalYearEnd" | "incorporationHalf" | "documentExpiry" | "event";
export const scheduleKinds: ScheduleKind[] = ["annualFixed", "afterAnniversary", "afterFiscalYearEnd", "incorporationHalf", "documentExpiry", "event"];
export const scheduleKindLabel: Record<ScheduleKind, string> = {
  annualFixed: "每年固定日期",
  afterAnniversary: "成立周年日之后",
  afterFiscalYearEnd: "财年结束之后",
  incorporationHalf: "按成立月份分上下半年",
  documentExpiry: "某类文件到期时",
  event: "发生变更之后",
};

export type DateAdjust = "none" | "previousBusinessDay" | "nextBusinessDay";
export const dateAdjustLabel: Record<DateAdjust, string> = {
  none: "不调整",
  previousBusinessDay: "遇周末提前到周五",
  nextBusinessDay: "遇周末顺延到周一",
};

export interface Schedule {
  kind: ScheduleKind;
  date?: MonthDay;
  months?: number;
  days?: number;
  firstHalf?: MonthDay;
  secondHalf?: MonthDay;
  documentTypeID?: string;
  event?: ChangeKind;
}

export type VerificationStatus = "draft" | "confirmed";
export interface RuleVerification {
  status: VerificationStatus;
  sourceKind: string;
  source: string;
  evidenceDocumentID?: string;
  conditions: string;
  confirmedBy: string;
  confirmedOn?: Day;
}
export const newVerification = (): RuleVerification => ({
  status: "draft", sourceKind: "代理书面确认", source: "", conditions: "", confirmedBy: "",
});
export const sourceKinds = ["法规原文", "注册处或税局页面", "代理书面确认", "其他"];

export interface RuleRevision { on: Day; summary: string }
export interface CompanyRuleOverride { schedule?: Schedule; verification?: RuleVerification }

export type RuleTrust =
  | { kind: "draft" }
  | { kind: "confirmed"; scope: string; on?: Day }
  | { kind: "needsReview"; on?: Day };

export interface RuleTemplate {
  id: string;
  name: string;
  localName: string;
  jurisdictions: string[];
  entityForms: string[];
  schedule: Schedule;
  adjust: DateAdjust;
  reminders?: number[];
  requiredDocTypeIDs: string[];
  responsibleHint: string;
  penalty: string;
  notes: string;
  needsReview: boolean;
  enabled: boolean;
  builtIn: boolean;
  verification?: RuleVerification;
  revisions?: RuleRevision[];
}

export function effectiveRule(r: RuleTemplate, c: Company): RuleTemplate {
  const s = c.ruleOverrides?.[r.id]?.schedule;
  return s ? { ...r, schedule: s } : r;
}

export function ruleApplies(r: RuleTemplate, c: Company): boolean {
  return r.enabled && r.jurisdictions.includes(c.jurisdiction)
    && (r.entityForms.length === 0 || r.entityForms.includes(c.entityForm))
    && !c.disabledRuleIDs.includes(r.id);
}

export interface PacketTemplate {
  id: string;
  name: string;
  categories: string[];
  includeDirectorsPassports: boolean;
  maxAgeMonths?: number;
}

export interface TemplateLibrary {
  version: number;
  jurisdictions: Jurisdiction[];
  documentTypes: DocumentType[];
  rules: RuleTemplate[];
  packets: PacketTemplate[];
  archiveItems?: Record<string, string[]>;
}

// MARK: 档案

export type ItemMark = "notObtained" | "external" | "restricted" | "unverified" | "notApplicable";
export const itemMarks: ItemMark[] = ["notObtained", "external", "restricted", "unverified", "notApplicable"];
export const itemMarkLabel: Record<ItemMark, string> = {
  notObtained: "未取得", external: "外部保管", restricted: "权限受限", unverified: "待核对", notApplicable: "不适用",
};
const itemMarkExplanation: Record<ItemMark, string> = {
  notObtained: "尚未取得材料，可在备注中记录跟进情况。",
  external: "材料由代理、同事或其他机构保管，本地没有副本。",
  restricted: "材料可能存在，但目前没有权限取得或查看。",
  unverified: "尚未确认材料是否存在或是否需要管理。",
  notApplicable: "此公司不适用该条目；不纳入本公司的归档比例。",
};

export interface CompanyArchive {
  added: string[];
  removed: string[];
  marks: Record<string, ItemMark>;
  notes: Record<string, string>;
}
export const emptyArchive = (): CompanyArchive => ({ added: [], removed: [], marks: {}, notes: {} });

export type ArchiveState =
  | { kind: "valid" }
  | { kind: "expiring"; days: number }
  | { kind: "expired"; days: number }
  | { kind: "needsUpdate" }
  | { kind: "noDate" }
  | { kind: "marked"; mark: ItemMark }
  | { kind: "missing" };

export function archiveStateLabel(s: ArchiveState): string {
  switch (s.kind) {
    case "valid": return "有效";
    case "expiring": return `${s.days} 天后到期`;
    case "expired": return `已过期 ${s.days} 天`;
    case "needsUpdate": return "需要更新";
    case "noDate": return "日期待核对";
    case "marked": return itemMarkLabel[s.mark];
    case "missing": return "未归档";
  }
}
export const hasFile = (s: ArchiveState) =>
  s.kind === "valid" || s.kind === "expiring" || s.kind === "expired" || s.kind === "needsUpdate" || s.kind === "noDate";
export const stateNeedsAttention = (s: ArchiveState) =>
  s.kind === "expiring" || s.kind === "expired" || s.kind === "needsUpdate" || s.kind === "noDate";
export const isNotApplicable = (s: ArchiveState) => s.kind === "marked" && s.mark === "notApplicable";

export interface ArchiveItem {
  typeID: string;
  type?: DocumentType;
  document?: Document;
  olderVersions: number;
  state: ArchiveState;
  note: string;
  isExtra: boolean;
}
export const archiveItemName = (i: ArchiveItem) => i.type?.name ?? "未知条目";

// MARK: 补发请求

export type DocumentRequestStatus = "open" | "received" | "cancelled";
export interface DocumentRequest {
  id: string;
  owner: NodeRef;
  typeIDs: string[];
  partyID?: string;
  createdAt: Timestamp;
  followUpOn: Day;
  status: DocumentRequestStatus;
  receivedDocumentIDs: string[];
  receivedTypeIDs?: string[];
  note: string;
  nudgedCount?: number;
}
export const pendingTypeIDs = (r: DocumentRequest) => {
  const got = new Set(r.receivedTypeIDs ?? []);
  return r.typeIDs.filter((t) => !got.has(t));
};

// MARK: 集团

export interface CorporateGroup {
  id: string;
  name: string;
  tops: NodeRef[];
  extraCompanyIDs: string[];
  excludedCompanyIDs?: string[];
  notes: string;
  iconFileName?: string;
  /** Charter 4：品牌色标。 */
  color?: string;
}
/** 集团颜色：前 6 个保持原顺序（未设颜色的老集团按此推算），其后按色相补齐，共 18 个。 */
export const brandPalette = [
  "#4F7CF7", "#2BA889", "#E07A2E", "#B05CD6", "#D64F6E", "#3AA0C9",
  "#2F4FB5", "#5E9E3A", "#C99A1E", "#7A5AF0", "#E0559C", "#178F8F",
  "#B5452B", "#8A6D4E", "#5C6B80", "#9C8F2A", "#C2417A", "#4B4B57",
];
export const isHexColor = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);

export interface GroupRow {
  companyID: string;
  depth: number;
  parent?: NodeRef;
  percent?: number;
  viaNominee: boolean;
  unconnected: boolean;
}

/** 中文句子里夹英文名称时，在两侧补空格。 */
export function latinPad(s: string): string {
  if (!s) return s;
  const isLatin = (ch: string) => /[A-Za-z0-9.]/.test(ch);
  return (isLatin(s[0]) ? " " : "") + s + (isLatin(s[s.length - 1]) ? " " : "");
}

/** 只在一侧补空格：名称前面紧挨着中文、后面是标点或句末时用 latinPadStart，反之用 latinPadEnd。 */
export function latinPadStart(s: string): string { return s && /[A-Za-z0-9.]/.test(s[0]) ? " " + s : s; }
export function latinPadEnd(s: string): string { return s && /[A-Za-z0-9.]/.test(s[s.length - 1]) ? s + " " : s; }
