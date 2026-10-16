import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { applyConfig, configImportDiff, exportConfig, readConfig } from "../state/actions";

const tick = () => new Promise((r) => setTimeout(r, 20));
const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");

async function fresh() {
  const p = new MemoryPlatform(templates);
  setPlatform(p);
  const s = new Store("/Charter");
  await s.load();
  return { p, s };
}

for (const mode of ["merge", "replace"] as const) {
  describe(`config round trip (${mode})`, () => {
    it("restores exported settings and templates", async () => {
      const { p, s } = await fresh();
      // 导出时的状态
      s.commit((d) => { d.settings.reminderDays = [45, 10]; d.settings.notificationHour = 8; d.library.packets[0].name = "开户（导出时）"; });
      await tick();
      await exportConfig(s, "/out/config.json");
      // 导出后改动
      s.commit((d) => { d.settings.reminderDays = [1]; d.settings.notificationHour = 20; d.library.packets[0].name = "改过的名字"; });
      await tick();
      // 导入
      await applyConfig(s, await readConfig("/out/config.json"), mode);
      await tick();
      expect(s.errorMessage ?? null).toBeNull();
      expect(s.data.settings.reminderDays).toEqual([45, 10]);
      expect(s.data.settings.notificationHour).toBe(8);
      expect(s.data.library.packets[0].name).toBe("开户（导出时）");
      // 重新打开数据文件夹，确认写到了磁盘上
      const s2 = new Store("/Charter"); await s2.load();
      expect(s2.data.settings.reminderDays).toEqual([45, 10]);
      expect(s2.data.settings.notificationHour).toBe(8);
      expect(s2.data.library.packets[0].name).toBe("开户（导出时）");
      void p;
    });
  });
}

describe("config import of an identical file", () => {
  it("reports no changes instead of a fake success", async () => {
    const { s } = await fresh();
    await exportConfig(s, "/out/same.json");
    const b = await readConfig("/out/same.json");
    expect(configImportDiff(s, b, "merge").changes).toBe(0);
    expect(configImportDiff(s, b, "replace").changes).toBe(0);
    await applyConfig(s, b, "merge");
    expect(s.toast?.text ?? "").toContain("完全一样");
  });
  it("counts only real differences", async () => {
    const { s } = await fresh();
    await exportConfig(s, "/out/c.json");
    s.commit((d) => { d.library.packets[0].name = "改"; d.settings.notificationHour = 21; });
    const d = configImportDiff(s, await readConfig("/out/c.json"), "merge");
    expect(d.changes).toBe(2);
    expect(d.lines.join("|")).toContain("用途：更新 1 个");
  });
});
