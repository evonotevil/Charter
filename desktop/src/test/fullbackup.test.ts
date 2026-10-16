import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { installSampleData } from "../state/sample";
import { exportBackup, readBackup, restoreBackup } from "../services/backup";
import { listSnapshots } from "../domain/folder";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");
async function fresh(root = "/Charter") {
  const p = new MemoryPlatform(templates); setPlatform(p);
  const s = new Store(root); await s.load(); await installSampleData(s);
  return { p, s };
}

describe("full backup", () => {
  it("edited sample → export → clear → restore brings the edits back, files included", async () => {
    const { p, s } = await fresh();
    s.commit((d) => {
      d.groups[0].name = "改过的集团名";
      d.companies = d.companies.filter((c) => c.name !== "立方咨询有限公司");
      d.companies[0].name = "手动改名公司";
    });
    s.saveSettings((x) => { x.notificationHour = 7; });
    const snapshot = JSON.stringify({ c: s.data.companies, g: s.data.groups, d: s.data.documents, st: s.data.settings.notificationHour });
    const file = s.fileURL(s.data.documents[0]);
    const bytes = await p.readBytes(file);
    const info = await exportBackup(s, "/out/backup.zip");
    expect(info.companies).toBe(16);
    expect(info.files).toBeGreaterThan(0);

    await s.clearAllData();
    expect(s.data.companies.length).toBe(0);
    expect((await p.stat(file)).exists).toBe(false);

    await restoreBackup(s, await readBackup("/out/backup.zip"));
    expect(s.errorMessage ?? null).toBeNull();
    const now = JSON.parse(JSON.stringify({ c: s.data.companies, g: s.data.groups, d: s.data.documents, st: s.data.settings.notificationHour }));
    const was = JSON.parse(snapshot);
    for (const k of ["c", "g", "d", "st"]) expect([k, now[k]]).toEqual([k, was[k]]);
    expect(await p.readBytes(file)).toEqual(bytes);
    expect((await listSnapshots(s.folder)).some((x) => x.reason === "恢复备份前")).toBe(true);
    const again = new Store("/Charter"); await again.load();
    expect(again.data.groups[0].name).toBe("改过的集团名");
  });

  it("restores into a different, empty data folder", async () => {
    const { p, s } = await fresh();
    await exportBackup(s, "/out/b.zip");
    const other = new Store("/Elsewhere"); await other.load();
    await restoreBackup(other, await readBackup("/out/b.zip"));
    expect(other.data.companies.length).toBe(17);
    expect((await p.stat(other.fileURL(other.data.documents[0]))).exists).toBe(true);
  });

  it("rejects a config file or a random zip", async () => {
    const { p, s } = await fresh();
    await p.writeText("/out/cfg.json", "{}");
    await expect(readBackup("/out/cfg.json")).rejects.toThrow(/不是 Charter 备份/);
    void s;
  });
});

describe("backups include edits made a moment ago", () => {
  it("manual snapshot right after an edit contains it", async () => {
    const { s } = await fresh();
    s.saveSettings((x) => { x.notificationHour = 6; });
    await s.backUpNow();
    s.saveSettings((x) => { x.notificationHour = 10; });
    await s.restoreFromSnapshot(s.snapshots.find((x) => x.reason === "手动备份")!);
    expect(s.data.settings.notificationHour).toBe(6);
  });
});
