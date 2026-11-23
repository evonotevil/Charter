import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { type Obligation } from "../domain/engine";
import { addDays } from "../domain/day";
import { normLibrary, normSettings } from "../domain/normalize";
import { MemoryPlatform } from "../platform/memory";
import { type CalendarSyncInput, type CalendarSyncResult, setPlatform } from "../platform/platform";
import { calendarEvents, describeError, disableCalendarSync, runCalendarSync } from "../services/calendarSync";
import { calendarText, upcomingReminders } from "../services/packets";
import { installSampleData } from "../state/sample";
import { Store } from "../state/store";
import { validateReminderTime } from "../ui/ReminderTimeField";
import { tourSteps } from "../screens/Tour";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");

async function sample() {
  const p = new MemoryPlatform(templates);
  setPlatform(p);
  const s = new Store("/Charter");
  await s.load();
  await installSampleData(s);
  return { p, s };
}

describe("5.5.9 提醒时间包含分钟", () => {
  it("教程沿用设置中的提前天数和时间，不再写死另一组默认值", () => {
    setPlatform(new MemoryPlatform(templates));
    const reminder = tourSteps().find((step) => step.title.startsWith("申报日历"));
    expect(reminder?.body).toContain("按设置中的提前天数和时间提醒");
    expect(reminder?.body).not.toMatch(/60、30、7/);
  });

  it("直接输入区分格式、小时、分钟和五分钟步进", () => {
    expect(validateReminderTime("0825")).toEqual({ time: "08:25", message: null });
    expect(validateReminderTime("08:25")).toEqual({ time: "08:25", message: null });
    expect(validateReminderTime("abcd")).toEqual({ time: null, message: "请输入 4 位时间，例如 08:25。" });
    expect(validateReminderTime("24:00")).toEqual({ time: null, message: "小时须为 00–23。" });
    expect(validateReminderTime("09:65")).toEqual({ time: null, message: "分钟须为 00–59。" });
    expect(validateReminderTime("09:17")).toEqual({ time: null, message: "分钟须为 5 的倍数。" });
  });

  it("旧设置默认补 00 分，并约束损坏的时分", () => {
    expect(normSettings({ notificationHour: 14 }).notificationMinute).toBe(0);
    expect(normSettings({ notificationHour: 14, notificationMinute: 35 })).toMatchObject({ notificationHour: 14, notificationMinute: 35 });
    expect(normSettings({ notificationHour: 25, notificationMinute: 99 })).toMatchObject({ notificationHour: 9, notificationMinute: 0 });
  });

  it("运行中通知、Apple/Outlook 同步数据和订阅文件使用同一个 14:35", async () => {
    const { s } = await sample();
    s.saveSettings((x) => { x.notificationHour = 14; x.notificationMinute = 35; });
    const reminders = upcomingReminders(s, 0);
    expect(reminders.length).toBeGreaterThan(0);
    expect(new Date(reminders[0].at).getHours()).toBe(14);
    expect(new Date(reminders[0].at).getMinutes()).toBe(35);

    const events = calendarEvents(s);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.reminders?.every((at) => at.endsWith("T14:35")))).toBe(true);

    const ics = calendarText(s);
    expect(ics).toContain("BEGIN:VALARM\r\nACTION:DISPLAY");
    const filingAlerts = events.filter((event) => event.key.startsWith("ob:")).flatMap((event) => event.reminders ?? []);
    expect(filingAlerts.length).toBeGreaterThan(0);
    for (const localTime of new Set(filingAlerts)) {
      const utc = new Date(localTime).toISOString().replace(/[-:]/g, "").replace(/\.000Z$/, "Z");
      expect(ics).toContain(`TRIGGER;VALUE=DATE-TIME:${utc}\r\n`);
    }
  });
});

describe("日历授权和同步", () => {
  it("申报订阅保留逾期与第 400 天的事项，排除第 401 天", async () => {
    const { s } = await sample();
    const base = s.openObligations[0];
    const items = [-5, 0, 400, 401].map(days => ({
      ...base, key: `sample-${days}`, due: addDays(s.today, days),
    }));
    vi.spyOn(s, "openObligations", "get").mockReturnValue(items);
    const uids = calendarText(s).split("\r\n").filter(line => line.startsWith("UID:"));
    expect(uids).toEqual(["UID:sample--5@charter", "UID:sample-0@charter", "UID:sample-400@charter"]);
  });

  it("11 月 23 日 09:00 提醒，11 月 30 日只建立一条全天截止事项；订阅与系统日历文案一致", async () => {
    const { s } = await sample();
    s.saveSettings(x => { x.notificationHour = 9; x.notificationMinute = 0; });
    const base = s.openObligations[0];
    const due = "2026-11-30";
    const importedRule = normLibrary({ ...s.data.library, rules: [
      { ...base.rule, name: "法人税申告", reminders: [0, 7, 7] },
    ] }).rules[0];
    expect(importedRule.reminders).toEqual([0, 7, 7]);
    const o: Obligation = { ...base, key: "rule|example|2026-11-30", due, originalDue: due,
      company: { ...base.company, name: "示例合同会社" }, rule: importedRule,
      record: { key: "rule|example|2026-11-30", companyID: base.company.id, ruleID: base.rule.id, dueDate: due, status: "handedOff", note: "" } };
    s.today = "2026-11-20";
    vi.spyOn(s, "openObligations", "get").mockReturnValue([o]);
    const filings = calendarEvents(s).filter(e => e.key.startsWith("ob:"));
    expect(filings).toHaveLength(1);
    const [event] = filings;
    expect(event).toMatchObject({ key: `ob:${o.key}`, title: "法人税申告截止 · 示例合同会社", date: due, reminders: ["2026-11-23T09:00", "2026-11-30T09:00"] });
    expect(event.notes).toContain("截止日期：2026年11月30日");
    expect(event.notes).toContain("提醒（本地时间 09:00）：11月23日（提前 7 天）、11月30日（当天）");
    expect(event.notes).toContain("办理状态：已交办");
    expect(event.notes).not.toContain("handedOff");
    const local = upcomingReminders(s, 0).filter((reminder) => reminder.id.startsWith(`charter.${o.key}|`));
    expect(local.map((reminder) => reminder.id)).toEqual([
      `charter.${o.key}|2026-11-23`,
      `charter.${o.key}|2026-11-30`,
    ]);
    const raw = calendarText(s);
    expect(raw.split("\r\n").every(line => Buffer.byteLength(line) <= 75)).toBe(true);
    const ics = raw.replace(/\r\n /g, "");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain(`UID:${encodeURIComponent(o.key)}@charter\r\n`);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261130\r\nDTEND;VALUE=DATE:20261201");
    expect(ics).toContain(`SUMMARY:${event.title}\r\nDESCRIPTION:${event.notes.replace(/\n/g, "\\n")}`);
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
  });

  it("文件到期事项写明归属和实际安排的提醒", async () => {
    const { s } = await sample();
    s.saveSettings(x => { x.reminderDays = [7]; x.notificationHour = 8; x.notificationMinute = 35; });
    const events = calendarEvents(s);
    const passport = events.find(event => event.key.startsWith("doc:") && event.title.startsWith("护照到期 · "))!;
    expect(passport.notes).toContain("到期日期");
    expect(passport.notes).toContain("提前 7 天");
    expect(passport.notes).toContain("08:35");
    expect(passport.notes).toContain(`归属：${passport.title.split(" · ")[1]}`);
    expect(passport.reminders).toHaveLength(1);
    expect(passport.notes).not.toContain("（当天）");
  });

  it("连续确认只发一次授权请求，待系统回复后可只读复查", async () => {
    const { p, s } = await sample();
    const calls: CalendarSyncInput[] = [];
    let reply!: (value: CalendarSyncResult) => void;
    const pending = new Promise<CalendarSyncResult>((resolve) => { reply = resolve; });
    Object.assign(p, { calendarSync: (value: CalendarSyncInput) => {
      calls.push(value);
      return value.requestAccess === false ? Promise.resolve({ ok: true }) : pending;
    } });
    const a = runCalendarSync(s, { checkOnly: true, requestAccess: true });
    const b = runCalendarSync(s, { checkOnly: true, requestAccess: true });
    expect(calls).toHaveLength(1);
    reply({ error: "permissionPending" });
    const [first, second] = await Promise.all([a, b]);
    expect(second).toEqual(first);
    expect(describeError(first!)).toContain("检查权限");
    expect(describeError(first!)).not.toEqual(describeError({ error: "denied" }));
    expect(await runCalendarSync(s, { checkOnly: true, requestAccess: false })).toEqual({ ok: true });
    expect(calls.map((value) => [value.checkOnly, value.requestAccess, value.events.length])).toEqual([[true, true, 0], [true, false, 0]]);
    expect(p.prefGet("calendarAutoSync")).not.toBe("1");
  });
});

describe("关闭自动系统日历", () => {
  it("没有已知日历 ID 时只关偏好，不会新建空日历", async () => {
    const { p, s } = await sample();
    let calls = 0;
    Object.defineProperty(p, "os", { value: "mac" });
    (p as MemoryPlatform & { calendarSync: (input: CalendarSyncInput) => Promise<{ ok: true }> }).calendarSync = async () => { calls++; return { ok: true }; };
    p.prefSet("calendarAutoSync", "1");
    expect(await disableCalendarSync(s)).toBeNull();
    expect(calls).toBe(0);
    expect(p.prefGet("calendarAutoSync")).toBe("0");
    expect(p.prefGet("remindersEnabled")).toBe("0");
  });

  it("已有日历 ID 时先用空事件清除 Charter 事项", async () => {
    const { p, s } = await sample();
    let input: CalendarSyncInput | null = null;
    Object.defineProperty(p, "os", { value: "mac" });
    (p as MemoryPlatform & { calendarSync: (value: CalendarSyncInput) => Promise<{ ok: true; calendarId: string }> }).calendarSync = async (value) => { input = value; return { ok: true, calendarId: "known" }; };
    p.prefSet("calendarAutoSync", "1");
    p.prefSet("calendarAutoSyncId", "known");
    await disableCalendarSync(s);
    expect(input).toMatchObject({ calendarId: "known", clearOnly: true, events: [] });
    expect(p.prefGet("calendarAutoSync")).toBe("0");
  });

  it("忙时关闭会等待旧同步，并保证清空是最后一次写入", async () => {
    const { p, s } = await sample();
    const calls: CalendarSyncInput[] = [];
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const firstStarted = new Promise<void>((resolve) => { started = resolve; });
    Object.defineProperty(p, "os", { value: "mac" });
    (p as MemoryPlatform & { calendarSync: (value: CalendarSyncInput) => Promise<{ ok: true; calendarId: string }> }).calendarSync = async (value) => {
      calls.push(value);
      if (calls.length === 1) { started(); await gate; }
      return { ok: true, calendarId: "known" };
    };
    p.prefSet("calendarAutoSync", "1");
    p.prefSet("calendarAutoSyncId", "known");
    const syncing = runCalendarSync(s);
    await firstStarted;
    const stopping = disableCalendarSync(s);
    release();
    await Promise.all([syncing, stopping]);
    expect(calls).toHaveLength(2);
    expect(calls[0].events.length).toBeGreaterThan(0);
    expect(calls[1]).toMatchObject({ clearOnly: true, events: [] });
    expect(p.prefGet("calendarAutoSync")).toBe("0");
    expect(p.prefGet("remindersEnabled")).toBe("0");
  });

  it("清理失败时保持开启，允许用户重试", async () => {
    const { p, s } = await sample();
    Object.defineProperty(p, "os", { value: "mac" });
    (p as MemoryPlatform & { calendarSync: () => Promise<{ error: "failed" }> }).calendarSync = async () => ({ error: "failed" });
    p.prefSet("calendarAutoSync", "1");
    p.prefSet("calendarAutoSyncId", "known");
    const result = await disableCalendarSync(s);
    expect(result).toMatchObject({ error: "failed" });
    expect(p.prefGet("calendarAutoSync")).toBe("1");
    expect(p.prefGet("remindersEnabled")).not.toBe("0");
  });
});
