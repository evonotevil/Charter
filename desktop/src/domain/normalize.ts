// 读取时补齐缺省字段：旧版本或手工编辑过的 JSON 也能正常载入，之后写回时字段完整，
// Swift 版读取不会因缺键失败。

import type {
  Appointment, ChangeRecord, Company, CorporateGroup, Document, DocumentLink, DocumentRequest, Holding, ObligationRecord, Party,
  Person, SharedSettings, TemplateLibrary,
} from "./models";
import { defaultSettings } from "./models";

type Raw = Record<string, any>;
const arr = (v: any) => (Array.isArray(v) ? v : []);
const str = (v: any, d = "") => (typeof v === "string" ? v : d);
const obj = (v: any) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

export function normCompany(r: Raw): Company {
  return {
    ...r,
    id: str(r.id), name: str(r.name), formerNames: arr(r.formerNames), aliases: arr(r.aliases),
    jurisdiction: str(r.jurisdiction), entityForm: str(r.entityForm), registrationNumber: str(r.registrationNumber),
    fiscalYearEnd: str(r.fiscalYearEnd, "12-31"), status: r.status ?? "active", group: str(r.group),
    registeredAddress: str(r.registeredAddress), rulePartyIDs: obj(r.rulePartyIDs), disabledRuleIDs: arr(r.disabledRuleIDs),
    trackingSince: str(r.trackingSince), notes: str(r.notes),
  } as Company;
}

export const normPerson = (r: Raw): Person =>
  ({ ...r, id: str(r.id), name: str(r.name), aliases: arr(r.aliases), email: str(r.email), notes: str(r.notes) }) as Person;

/**
 * 4.4 迁移：4.3 及以前的股权和任职没有 verified 字段。一律标为“待核实”，
 * 原来的日期当作“资料截至日期”，生效日期留空（不猜）。幂等：迁移后 verified 为 false，不会再迁移。
 */
function migrateProvenance<T extends Raw>(r: T): T {
  if (r.verified !== undefined) return r;
  return { ...r, verified: false, migrated: true, asOf: r.asOf ?? r.from, from: undefined };
}

export const normHolding = (r: Raw): Holding =>
  migrateProvenance({ ...r, shares: str(r.shares), shareClass: str(r.shareClass), isNominee: !!r.isNominee, percent: Number(r.percent) || 0 }) as Holding;

export const normAppointment = (r: Raw): Appointment => migrateProvenance({ ...r, title: str(r.title) }) as Appointment;

export const normParty = (r: Raw): Party =>
  ({
    ...r, kind: "agent", contactName: str(r.contactName), email: str(r.email), phone: str(r.phone),
    followUpDays: typeof r.followUpDays === "number" ? r.followUpDays : 14, notes: str(r.notes),
  }) as Party;

export const normDocument = (r: Raw): Document =>
  ({
    ...r, form: str(r.form, "扫描件"), originalFileName: str(r.originalFileName), needsUpdate: !!r.needsUpdate,
    ...(r.noExpiry !== undefined ? { noExpiry: !!r.noExpiry } : {}),
    ...(r.sourcePath !== undefined ? { sourcePath: str(r.sourcePath) } : {}),
    ...(r.sha256 !== undefined ? { sha256: str(r.sha256) } : {}),
    ...(r.links !== undefined ? {
      links: arr(r.links).filter((x) => x && ["company", "person", "appointment", "holding"].includes(x.target) && typeof x.id === "string")
        .map((x) => ({ target: x.target, id: x.id, kind: ["identity", "address", "appointment", "shareholding", "kyc", "board", "other"].includes(x.kind) ? x.kind : "other", ...(x.page ? { page: String(x.page) } : {}) })) as DocumentLink[],
    } : {}),
    notes: str(r.notes),
  }) as Document;

export const normRecord = (r: Raw): ObligationRecord => ({ ...r, status: r.status ?? "pending", note: str(r.note) }) as ObligationRecord;
export const normChange = (r: Raw): ChangeRecord => ({ ...r, summary: str(r.summary) }) as ChangeRecord;
export const normGroup = (r: Raw): CorporateGroup =>
  ({ ...r, tops: arr(r.tops), extraCompanyIDs: arr(r.extraCompanyIDs), notes: str(r.notes) }) as CorporateGroup;
export const normRequest = (r: Raw): DocumentRequest =>
  ({ ...r, typeIDs: arr(r.typeIDs), status: r.status ?? "open", receivedDocumentIDs: arr(r.receivedDocumentIDs), note: str(r.note) }) as DocumentRequest;

export function normSettings(r: Raw | null): SharedSettings {
  const d = defaultSettings();
  if (!r) return d;
  return {
    ...r,
    reminderDays: Array.isArray(r.reminderDays) ? r.reminderDays : d.reminderDays,
    calendarEnabled: typeof r.calendarEnabled === "boolean" ? r.calendarEnabled : d.calendarEnabled,
    calendarName: str(r.calendarName, d.calendarName),
    notificationHour: typeof r.notificationHour === "number" ? r.notificationHour : d.notificationHour,
  } as SharedSettings;
}

export function normLibrary(r: Raw): TemplateLibrary {
  return {
    ...r,
    version: typeof r.version === "number" ? r.version : 1,
    jurisdictions: arr(r.jurisdictions).map((j: Raw) => ({ ...j, entityForms: arr(j.entityForms) })),
    documentTypes: arr(r.documentTypes).map((t: Raw) => ({
      ...t, localNames: arr(t.localNames), jurisdictions: arr(t.jurisdictions), hints: arr(t.hints), builtIn: !!t.builtIn,
    })),
    rules: arr(r.rules).map((x: Raw) => ({
      ...x, localName: str(x.localName), jurisdictions: arr(x.jurisdictions), entityForms: arr(x.entityForms),
      adjust: x.adjust ?? "none", requiredDocTypeIDs: arr(x.requiredDocTypeIDs), responsibleHint: str(x.responsibleHint),
      penalty: str(x.penalty), notes: str(x.notes), needsReview: !!x.needsReview, enabled: x.enabled !== false, builtIn: !!x.builtIn,
    })),
    packets: arr(r.packets).map((p: Raw) => ({ ...p, categories: arr(p.categories), includeDirectorsPassports: !!p.includeDirectorsPassports })),
  } as TemplateLibrary;
}
