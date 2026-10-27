// 5.4：自动同步到系统日历。
// 只在“由这台电脑发通知”的电脑上、并且在这台电脑上打开了开关时运行（多台电脑共用数据文件夹时避免重复事件）。
// 内容：未完成的申报事项（400 天内）+ 现行文件的到期日（400 天内）。完成或删除的事项会从日历里删掉。

import * as D from "../domain/day";
import { expiryOf, obligationStatus } from "../domain/engine";
import { type CalendarEvent, type CalendarSyncResult, platform } from "../platform/platform";
import type { Store } from "../state/store";

export const autoSyncPref = "calendarAutoSync";
const statusPref = "calendarAutoSyncStatus";
const idPref = "calendarAutoSyncId";

export interface AutoSyncStatus { at: number; ok: boolean; message: string }
export const autoSyncOn = () => platform().prefGet(autoSyncPref) === "1";
export const autoSyncStatus = (): AutoSyncStatus | null => { try { return JSON.parse(platform().prefGet(statusPref) ?? "null"); } catch { return null; } };
export const autoSyncSupported = () => !!platform().calendarSync && (platform().os === "mac" || platform().os === "windows");

export function calendarEvents(s: Store): CalendarEvent[] {
  const limit = D.addDays(s.today, 400);
  const out: CalendarEvent[] = [];
  for (const o of s.openObligations) {
    if (o.due > limit) continue;
    const party = s.responsibleParty(o)?.name, st = obligationStatus(o);
    out.push({ key: `ob:${o.key}`, title: `${o.company.name}：${o.rule.name}`, date: o.due,
      notes: [s.scheduleText(o.rule.schedule), party ? `中介：${party}` : "", st === "pending" ? "" : `状态：${st}`, "由 Charter 同步，请在 Charter 里修改。"].filter(Boolean).join("\n") });
  }
  for (const d of s.data.documents) {
    if (d.supersededBy) continue;
    const t = s.docType(d.typeID), e = expiryOf(d, t);
    if (!e || e < s.today || e > limit) continue;
    out.push({ key: `doc:${d.id}`, title: `${s.nameOf(d.owner)}：${t?.name ?? "文件"}到期`, date: e, notes: "证件或文件到期。由 Charter 同步，请在 Charter 里修改。" });
  }
  return out;
}

export const describeError = (r: CalendarSyncResult) => "error" in r && r.error ? ({
  denied: "没有日历权限。请在“系统设置 → 隐私与安全性 → 日历”里允许 Charter，然后再试。",
  writeOnly: "Charter 只有“仅添加”日历权限，无法更新或删除已同步的事件。请在“系统设置 → 隐私与安全性 → 日历”里改为“完全访问”。",
  noOutlook: "这台电脑没有桌面版 Outlook。新版 Outlook 和 Windows 自带日历不支持其他程序写入，请改用 .ics 订阅文件。",
  unsupported: "这个系统不支持自动同步。",
  noSource: "找不到可以新建日历的账户（iCloud 或“在我的 Mac 上”）。",
  createCalendar: `新建日历失败${r.message ? "：" + r.message : ""}。`,
  commit: `写入日历失败${r.message ? "：" + r.message : ""}。`,
  outlook: `Outlook 返回错误${r.message ? "：" + r.message : ""}。`,
  failed: "同步脚本没有完成，详见日志。",
} as Record<string, string>)[r.error] ?? "同步失败。" : "";

let running: Promise<void> | null = null, again = false;
/** 同步一次（同时只跑一次；运行中又有变化，则结束后再跑一次）。checkOnly 只申请权限。 */
export async function runCalendarSync(s: Store, opts: { checkOnly?: boolean; manual?: boolean } = {}): Promise<CalendarSyncResult | null> {
  const p = platform();
  if (!p.calendarSync) return null;
  if (running && !opts.checkOnly) { again = true; return null; }
  let result: CalendarSyncResult | null = null;
  running = (async () => {
    result = await p.calendarSync!({ name: s.data.settings.calendarName || "Charter", calendarId: p.prefGet(idPref) ?? undefined, checkOnly: opts.checkOnly, events: opts.checkOnly ? [] : calendarEvents(s) });
    const r = result!;
    if ("ok" in r && r.ok && r.calendarId) p.prefSet(idPref, r.calendarId);
    if (!opts.checkOnly) {
      const msg = "ok" in r && r.ok ? `新增 ${r.added ?? 0}、更新 ${r.updated ?? 0}、删除 ${r.removed ?? 0}` : describeError(r);
      p.prefSet(statusPref, JSON.stringify({ at: Date.now(), ok: !!("ok" in r && r.ok), message: msg }));
      if (!("ok" in r && r.ok) && opts.manual) s.setError(`同步到系统日历失败：${msg}`);
      s.emit();
    }
  })();
  try { await running; } finally { running = null; }
  if (again) { again = false; void runCalendarSync(s); }
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
  timer = setTimeout(() => void runCalendarSync(s), 3000);
}
