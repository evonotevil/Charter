export type ReminderDayResult =
  | { ok: true; days: number[] }
  | { ok: false; message: string };

export function addReminderDayValue(days: number[], value: string): ReminderDayResult {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: "请输入 1–730 的整数。" };
  const day = Number(trimmed);
  if (day < 1 || day > 730) return { ok: false, message: "提前天数应在 1–730 天之间。" };
  if (days.includes(day)) return { ok: false, message: `${day} 天已经添加。` };
  return { ok: true, days: [...days, day].sort((a, b) => b - a) };
}
