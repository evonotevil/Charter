// 不带时区的日历日期，存为 "yyyy-MM-dd" 字符串，与 Swift 版的 Day 编码一致。
// 字符串可以直接比较大小（字典序 = 时间顺序）。

export type Day = string;
/** 每年的某月某日，存为 "MM-dd"。 */
export type MonthDay = string;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function makeDay(y: number, m: number, d: number): Day {
  const dd = Math.min(Math.max(d, 1), daysIn(y, m));
  return `${pad(y, 4)}-${pad(m)}-${pad(dd)}`;
}

export function parts(d: Day): [number, number, number] {
  const [y, m, dd] = d.split("-").map(Number);
  return [y, m, dd];
}

export const year = (d: Day) => parts(d)[0];
export const month = (d: Day) => parts(d)[1];
export const dayOfMonth = (d: Day) => parts(d)[2];
export const dayOf = (d: Day) => parts(d)[2];

/** 解析用户输入，接受 2026-1-8、2026/01/08、2026.1.8。 */
export function parseDay(s: string): Day | null {
  const p = s.trim().replace(/[/.]/g, "-").split("-");
  if (p.length !== 3) return null;
  const [y, m, d] = p.map((x) => Number(x));
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return makeDay(y, m, d);
}

export function today(): Day {
  const n = new Date();
  return makeDay(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

/** 某个 IANA 时区里的今天。 */
export function todayIn(timeZone: string): Day {
  try {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    return f.format(new Date());
  } catch {
    return today();
  }
}

const utc = (d: Day) => {
  const [y, m, dd] = parts(d);
  return Date.UTC(y, m - 1, dd);
};

export function fromUTC(ms: number): Day {
  const x = new Date(ms);
  return makeDay(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}

export function addDays(d: Day, n: number): Day {
  return fromUTC(utc(d) + n * 86400000);
}

export const isLastDayOfMonth = (d: Day) => {
  const [y, m, dd] = parts(d);
  return dd === daysIn(y, m);
};

/** 加月份；原日期是月末时，结果也取月末。 */
export function addMonths(d: Day, n: number): Day {
  const [y, m, dd] = parts(d);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (((total % 12) + 12) % 12) + 1;
  if (dd === daysIn(y, m)) return makeDay(ny, nm, daysIn(ny, nm));
  return makeDay(ny, nm, dd);
}

/** 从 a 到 b 的天数（b 晚于 a 为正）。 */
export function daysBetween(a: Day, b: Day): number {
  return Math.round((utc(b) - utc(a)) / 86400000);
}

/** 1 = 星期日 … 7 = 星期六（与 Swift Calendar 一致）。 */
export function weekday(d: Day): number {
  return new Date(utc(d)).getUTCDay() + 1;
}

export const isWeekend = (d: Day) => {
  const w = weekday(d);
  return w === 1 || w === 7;
};

export const short = (d: Day) => `${month(d)} 月 ${dayOf(d)} 日`;
export const long = (d: Day) => `${year(d)} 年 ${month(d)} 月 ${dayOf(d)} 日`;
export const weekdayName = (d: Day) => ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][weekday(d) - 1];

export function display(d: Day, relativeTo: Day): string {
  return year(d) === year(relativeTo) ? short(d) : long(d);
}

export function ago(d: Day, from: Day): string {
  const n = daysBetween(d, from);
  if (n < 0) return `${-n} 天后`;
  if (n === 0) return "今天";
  if (n === 1) return "昨天";
  return `${n} 天前`;
}

export const maxDay = (a: Day, b: Day) => (a > b ? a : b);
export const minDay = (a: Day, b: Day) => (a < b ? a : b);

// MonthDay

export function md(month: number, day: number): MonthDay {
  return `${pad(month)}-${pad(day)}`;
}
export function mdParts(m: MonthDay): [number, number] {
  const [a, b] = m.split("-").map(Number);
  return [a, b];
}
export const mdLabel = (m: MonthDay) => {
  const [a, b] = mdParts(m);
  return `${a} 月 ${b} 日`;
};
export function inYear(m: MonthDay, y: number): Day {
  const [a, b] = mdParts(m);
  return makeDay(y, a, b);
}

// 时间戳：ISO 8601 字符串（UTC），例如 "2026-10-16T08:30:00.000Z"

export type Timestamp = string;
export const nowStamp = (): Timestamp => new Date().toISOString();
export const fromStamp = (s: Timestamp) => new Date(s);
export function dayOfStamp(s: Timestamp): Day {
  const x = fromStamp(s);
  return makeDay(x.getFullYear(), x.getMonth() + 1, x.getDate());
}
