// 5.4：自动同步到系统日历。
// 只在“由这台电脑发通知”的电脑上、并且在这台电脑上打开了开关时运行（多台电脑共用数据文件夹时避免重复事件）。
// 内容：未完成的申报事项（400 天内）+ 现行文件的到期日（400 天内）。完成或删除的事项会从日历里删掉。

import * as D from "../domain/day";
import { type Obligation, expiryOf, obligationStatus, reminderDays, reminderLocalDateTime } from "../domain/engine";
import { obligationStatusLabel } from "../domain/models";
import { type CalendarEvent, type CalendarSyncResult, platform } from "../platform/platform";
import type { Store } from "../state/store";

export const autoSyncPref = "calendarAutoSync";
export const remindersEnabledPref = "remindersEnabled";
const statusPref = "calendarAutoSyncStatus";
const idPref = "calendarAutoSyncId";

export interface AutoSyncStatus { at: number; ok: boolean; message: string; error?: Extract<CalendarSyncResult, { error: string }>["error"]; clearing?: boolean }
export const autoSyncOn = () => platform().prefGet(autoSyncPref) === "1";
/** 旧版本没有总开关，兼容为已开启，直到用户明确关闭。 */
export const remindersEnabled = () => platform().prefGet(remindersEnabledPref) !== "0";
export const setRemindersEnabled = (enabled: boolean) => platform().prefSet(remindersEnabledPref, enabled ? "1" : "0");
export const autoSyncStatus = (): AutoSyncStatus | null => { try { return JSON.parse(platform().prefGet(statusPref) ?? "null"); } catch { return null; } };
export const autoSyncSupported = () => !!platform().calendarSync && (platform().os === "mac" || platform().os === "windows");
/** 系统日历已成功接管提醒时，不再同时发 Charter 运行中通知。 */
export const systemCalendarOwnsReminders = () => autoSyncOn() && autoSyncSupported() && autoSyncStatus()?.ok === true;

function calendarReminders(s: Store, days: D.Day[]): string[] {
  return [...new Set(days)].sort().map((day) => reminderLocalDateTime(day, s.data.settings));
}

function reminderSummary(reminders: string[], due: D.Day): string {
  if (!reminders.length) return "提醒：未设置";
  const dates = reminders.map((stamp) => {
    const day = stamp.slice(0, 10);
    const daysBefore = D.daysBetween(day, due);
    return `${D.display(day, due)}（${daysBefore === 0 ? "当天" : `提前 ${daysBefore} 天`}）`;
  });
  return `提醒（本地时间 ${reminders[0].slice(11)}）：${dates.join("、")}`;
}

function calendarTitle(name: string, suffix: string, owner: string): string {
  return `${name.endsWith(suffix) ? name : name + suffix} · ${owner}`;
}

export function filingCalendarEvent(s: Store, o: Obligation): CalendarEvent {
  const reminders = calendarReminders(s, reminderDays(o, s.data.settings));
  const party = s.responsibleParty(o);
  const status = obligationStatus(o);
  const notes = [
    `截止日期：${D.long(o.due)}`,
    reminderSummary(reminders, o.due),
    `公司：${o.company.name}`,
    party && `办理中介：${party.name}`,
    status !== "pending" && obligationStatusLabel[status] && `办理状态：${obligationStatusLabel[status]}`,
    o.record?.overrideDue ? "截止日期已在 Charter 中调整。" : `日期规则：${s.scheduleText(o.rule.schedule)}`,
    "可在 Charter 的「申报日历」中更新此事项。",
  ].filter(Boolean).join("\n");
  return { key: `ob:${o.key}`, title: calendarTitle(o.rule.name, "截止", o.company.name), date: o.due, notes, reminders };
}

export function calendarEvents(s: Store): CalendarEvent[] {
  const limit = D.addDays(s.today, 400);
  const out = s.openObligations.filter((o) => o.due <= limit).map((o) => filingCalendarEvent(s, o));
  for (const d of s.data.documents) {
    if (d.supersededBy) continue;
    const t = s.docType(d.typeID), e = expiryOf(d, t);
    if (!e || e < s.today || e > limit) continue;
    const owner = s.nameOf(d.owner);
    const reminders = calendarReminders(s, s.data.settings.reminderDays.map((before) => D.addDays(e, -before)));
    const notes = [`到期日期：${D.long(e)}`, reminderSummary(reminders, e), `归属：${owner}`,
      "可在 Charter 的「文件」中更新到期日期。"].join("\n");
    out.push({ key: `doc:${d.id}`, title: calendarTitle(t?.name ?? "文件", "到期", owner), date: e, notes, reminders });
  }
  return out;
}

/**
 * 5.4.1：Mac 日历查询窗口。EventKit 单次查询最多 4 年，超出会被静默截断；
 * 窗口覆盖本次最早到最晚的事项（至少过去 800 天到未来 450 天，以便找到要删除的旧事件），按每段 ≤ 3 年切分。
 * 返回相对今天的天数区间。
 */
export function queryChunks(events: CalendarEvent[], today: string, maxDays = 1095): [number, number][] {
  let lo = -800, hi = 450;
  for (const e of events) { const off = D.daysBetween(today, e.date); lo = Math.min(lo, off - 2); hi = Math.max(hi, off + 2); }
  const out: [number, number][] = [];
  for (let from = lo; from < hi; from += maxDays) out.push([from, Math.min(hi, from + maxDays)]);
  return out;
}

export const describeError = (r: CalendarSyncResult) => "error" in r && r.error ? ({
  denied: "macOS 已拒绝日历访问。请在“系统设置 → 隐私与安全性 → 日历”中为 Charter 开启“完全访问”，然后重试。",
  restricted: "这台 Mac 的管理策略限制了日历访问。请联系设备管理员。",
  writeOnly: "Charter 只有“仅添加”日历权限，无法更新或删除已同步的事件。请在“系统设置 → 隐私与安全性 → 日历”里改为“完全访问”。",
  notDetermined: "macOS 尚未收到你的授权选择。点“允许完全访问”可发起请求。",
  permissionPending: "macOS 尚未返回授权结果。如果屏幕上有日历权限提示，请先完成选择，再点“检查权限”。",
  permissionFailed: "无法向 macOS 确认日历访问权限，请重试。",
  noOutlook: "这台电脑没有桌面版 Outlook。新版 Outlook 和 Windows 自带日历不支持其他程序写入，请改用 .ics 订阅文件。",
  unsupported: "这个系统不支持自动同步。",
  noSource: "找不到可以新建日历的账户（iCloud 或“在我的 Mac 上”）。",
  createCalendar: `新建日历失败${r.message ? "：" + r.message : ""}。`,
  commit: `写入日历失败${r.message ? "：" + r.message : ""}。`,
  outlook: `Outlook 返回错误${r.message ? "：" + r.message : ""}。`,
  failed: "系统日历同步未完成，请重试。",
} as Record<string, string>)[r.error] ?? "同步失败。" : "";

let running: Promise<CalendarSyncResult | null> | null = null, again = false;
let runningCheck: "request" | "inspect" | null = null;
/** 同步串行执行。用户发起的操作等待结果，自动同步的多次数据变动合并处理。 */
export async function runCalendarSync(s: Store, opts: { checkOnly?: boolean; requestAccess?: boolean; manual?: boolean; clear?: boolean } = {}): Promise<CalendarSyncResult | null> {
  const p = platform();
  if (!p.calendarSync) return null;
  const check = opts.checkOnly ? (opts.requestAccess === false ? "inspect" : "request") : null;
  if (running) {
    if (check && runningCheck === check) return running;
    if (check || opts.clear || opts.manual) { await running; return runCalendarSync(s, opts); }
    again = true;
    return null;
  }
  runningCheck = check;
  running = (async () => {
    let result: CalendarSyncResult;
    try {
      const events = opts.checkOnly || opts.clear ? [] : calendarEvents(s);
      const calendarName = s.data.settings.calendarName;
      result = await p.calendarSync!({ name: calendarName || "Charter", calendarId: p.prefGet(idPref) ?? undefined,
        checkOnly: opts.checkOnly, requestAccess: opts.requestAccess, clearOnly: opts.clear, events, chunks: queryChunks(events, s.today) });
      if (result.ok && !opts.checkOnly && !opts.clear && !autoSyncOn()) lastKey = JSON.stringify(events) + calendarName;
    } catch (e) {
      result = { error: "failed", message: e instanceof Error ? e.message : String(e) };
    }
    const r = result;
    if ("ok" in r && r.ok && r.calendarId) p.prefSet(idPref, r.calendarId);
    if (!opts.checkOnly) {
      const msg = "ok" in r && r.ok ? `新增 ${r.added ?? 0}、更新 ${r.updated ?? 0}、删除 ${r.removed ?? 0}` : describeError(r);
      p.prefSet(statusPref, JSON.stringify({ at: Date.now(), ok: !!r.ok, message: msg, error: r.ok ? undefined : r.error, clearing: opts.clear }));
      s.emit();
    }
    return result;
  })();
  let result: CalendarSyncResult | null;
  try { result = await running; } finally { running = null; runningCheck = null; }
  if (again) {
    again = false;
    if (!opts.clear && autoSyncOn()) void runCalendarSync(s);
  }
  return result;
}

/** 关闭前清除 Charter 写入系统日历的事项，再关闭本机偏好。 */
export async function disableCalendarSync(s: Store): Promise<CalendarSyncResult | null> {
  clearTimeout(timer);
  timer = undefined;
  again = false;
  const knownCalendar = platform().prefGet(idPref);
  const result = autoSyncOn() && autoSyncSupported() && knownCalendar ? await runCalendarSync(s, { clear: true, manual: true }) : null;
  if (!result || ("ok" in result && result.ok)) {
    platform().prefSet(autoSyncPref, "0");
    setRemindersEnabled(false);
    lastKey = "";
  }
  return result;
}

/** 数据变化时调用：内容有变化才同步，3 秒去抖。 */
let lastKey = "", timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleCalendarSync(s: Store) {
  if (!autoSyncOn() || !autoSyncSupported() || !s.isPrimaryDevice || s.isLoading || s.loadFailed) return;
  const key = JSON.stringify(calendarEvents(s)) + s.data.settings.calendarName;
  if (key === lastKey) return;
  lastKey = key;
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    if (autoSyncOn() && autoSyncSupported() && s.isPrimaryDevice && !s.isLoading && !s.loadFailed) void runCalendarSync(s);
  }, 3000);
}
