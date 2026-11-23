import { describe, expect, it } from "vitest";
import { addReminderDayValue } from "../screens/reminderDays";

describe("提前天数编辑", () => {
  it("加入有效天数并按倒序排列", () => {
    expect(addReminderDayValue([30, 7], "60")).toEqual({ ok: true, days: [60, 30, 7] });
  });

  it("保留重复、越界和空输入的具体原因", () => {
    expect(addReminderDayValue([30, 7], "30")).toEqual({ ok: false, message: "30 天已经添加。" });
    expect(addReminderDayValue([30, 7], "0")).toEqual({ ok: false, message: "提前天数应在 1–730 天之间。" });
    expect(addReminderDayValue([30, 7], "731")).toEqual({ ok: false, message: "提前天数应在 1–730 天之间。" });
    expect(addReminderDayValue([30, 7], "")).toEqual({ ok: false, message: "请输入 1–730 的整数。" });
  });
});
