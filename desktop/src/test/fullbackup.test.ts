import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { installSampleData } from "../state/sample";
import { exportBackup, readBackup, restoreBackup } from "../services/backup";
import { listSnapshots } from "../domain/folder";
import { joinPlatformPath } from "../platform/platform";
import { electronFileURL } from "../platform/electron";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");
async function fresh(root = "/Charter") {
  const p = new MemoryPlatform(templates); setPlatform(p);
  const s = new Store(root); await s.load(); await installSampleData(s);
  return { p, s };
}

class MacMemoryPlatform extends MemoryPlatform {
  readonly os = "mac" as const;
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

  it("restores a Mac backup containing a literal backslash in an archived filename", async () => {
    const p = new MacMemoryPlatform(templates); setPlatform(p);
    const s = new Store("/Charter"); await s.load(); await installSampleData(s);
    const documents = s.data.documents.filter((x) => !!x.filePath).slice(0, 3);
    const unusual = [
      "files/Example Pte. Ltd./原始材料/ACRA/\\leading.pdf",
      "files/Example Pte. Ltd./原始材料/ACRA/middle\\name.pdf",
      "files/Example Pte. Ltd./原始材料/ACRA/trailing.pdf\\",
    ];
    const ordinary = unusual.map((path) => path.replace(/\\/g, ""));
    const backupBytes = unusual.map((_, index) => new TextEncoder().encode(`BACKUP-${index}`));
    const currentBytes = unusual.map((_, index) => new TextEncoder().encode(`CURRENT-${index}`));
    const ordinaryBytes = unusual.map((_, index) => new TextEncoder().encode(`ORDINARY-${index}`));
    for (let index = 0; index < documents.length; index++) {
      await p.writeBytes(s.folder.abs(unusual[index]), backupBytes[index]);
      await p.removeFile(s.folder.abs(documents[index].filePath));
    }
    s.commit((data) => {
      for (let index = 0; index < documents.length; index++) data.documents.find((x) => x.id === documents[index].id)!.filePath = unusual[index];
    });
    await exportBackup(s, "/out/mac-backup.zip");
    const opened = await readBackup("/out/mac-backup.zip");
    const documentsJSON = await opened.zip.file("data/documents.json")!.async("string");
    for (const path of unusual) {
      expect(opened.zip.file(path)).not.toBeNull();
      expect(documentsJSON).toContain(path.replace(/\\/g, "\\\\"));
    }

    for (let index = 0; index < unusual.length; index++) {
      await p.writeBytes(s.folder.abs(unusual[index]), currentBytes[index]);
      await p.writeBytes(s.folder.abs(ordinary[index]), ordinaryBytes[index]);
    }
    await restoreBackup(s, opened);

    expect(s.errorMessage ?? null).toBeNull();
    for (let index = 0; index < unusual.length; index++) {
      expect(s.data.documents.find((x) => x.id === documents[index].id)?.filePath).toBe(unusual[index]);
      expect(await p.readBytes(s.folder.abs(unusual[index]))).toEqual(backupBytes[index]);
      expect(await p.readBytes(s.folder.abs(ordinary[index]))).toEqual(ordinaryBytes[index]);
    }

    const beforeRestore = (await listSnapshots(s.folder)).find((x) => x.reason === "恢复备份前")!;
    await s.restoreFromSnapshot(beforeRestore);
    for (let index = 0; index < unusual.length; index++) {
      expect(await p.readBytes(s.folder.abs(unusual[index]))).toEqual(currentBytes[index]);
      expect(await p.readBytes(s.folder.abs(ordinary[index]))).toEqual(ordinaryBytes[index]);
    }
  });

  it("keeps literal backslashes at every position in POSIX path components and preview URLs", () => {
    expect(joinPlatformPath("mac", "/Data", "\\leading.pdf")).toBe("/Data/\\leading.pdf");
    expect(joinPlatformPath("mac", "/Data", "middle\\name.pdf")).toBe("/Data/middle\\name.pdf");
    expect(joinPlatformPath("mac", "/Data", "trailing.pdf\\")).toBe("/Data/trailing.pdf\\");
    expect(joinPlatformPath("windows", "C:\\Data", "\\leading.pdf")).toBe("C:\\Data\\leading.pdf");
    const posix = "/Data/middle\\name.pdf";
    const raw = decodeURIComponent(new URL(electronFileURL("mac", posix)).pathname.replace(/^\/+/, ""));
    expect("/" + raw.replace(/^\/+/, "")).toBe(posix);
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
