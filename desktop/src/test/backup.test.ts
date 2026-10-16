// 备份、恢复、导出、导入的端到端测试：都在内存文件系统上跑，检查写到磁盘上的结果，而不只是内存里的状态。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { installSampleData } from "../state/sample";
import { applyConfig, configImportDiff, exportConfig, readConfig } from "../state/actions";
import { buildPacket, exportAll, packetItems } from "../services/packets";
import { listSnapshots, needsDailySnapshot, snapshotKeep } from "../domain/folder";
import { ref } from "../domain/models";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);

async function fresh(sample = true) {
  const p = new MemoryPlatform(templates);
  setPlatform(p);
  const s = new Store("/Charter");
  await s.load();
  if (sample) await installSampleData(s);
  return { p, s };
}
const reopen = async () => { const s = new Store("/Charter"); await s.load(); return s; };
const company = (s: Store, name: string) => s.data.companies.find((c) => c.name === name)!;
const zipNames = async (p: MemoryPlatform, path: string) => Object.keys((await JSZip.loadAsync(await p.readBytes(path))).files).filter((n) => !n.endsWith("/")).sort();

describe("snapshots", () => {
  it("manual backup records counts and can be listed after reopening", async () => {
    const { s } = await fresh();
    await s.backUpNow();
    const s2 = await reopen();
    const snaps = await listSnapshots(s2.folder);
    const manual = snaps.find((x) => x.reason === "手动备份")!;
    expect(manual).toBeTruthy();
    expect(manual.companies).toBe(12);
    expect(manual.documents).toBe(s.data.documents.length);
  });

  it("restore brings back records, settings and templates, and keeps a pre-restore snapshot", async () => {
    const { s } = await fresh();
    const docs = s.data.documents.length;
    await s.backUpNow();
    const snap = s.snapshots.find((x) => x.reason === "手动备份")!;
    // 备份之后的各种改动
    s.commit((d) => {
      d.companies = d.companies.slice(0, 3);
      d.settings.notificationHour = 21;
      d.library.packets[0].name = "备份后改名";
    });
    await s.restoreFromSnapshot(snap);
    expect(s.errorMessage ?? null).toBeNull();
    expect(s.data.companies.length).toBe(12);
    expect(s.data.documents.length).toBe(docs);
    expect(s.data.settings.notificationHour).not.toBe(21);
    expect(s.data.library.packets[0].name).not.toBe("备份后改名");
    const s2 = await reopen();
    expect(s2.data.companies.length).toBe(12);
    expect(s2.data.library.packets[0].name).not.toBe("备份后改名");
    expect((await listSnapshots(s2.folder)).some((x) => x.reason.startsWith("恢复到"))).toBe(true);
  });

  it("restoring is itself undoable through the pre-restore snapshot", async () => {
    const { s } = await fresh();
    await s.backUpNow();
    const first = s.snapshots[0];
    s.commit((d) => { d.companies = d.companies.slice(0, 2); });
    await s.restoreFromSnapshot(first);
    const pre = s.snapshots.find((x) => x.reason.startsWith("恢复到"))!;
    await s.restoreFromSnapshot(pre);
    expect(s.data.companies.length).toBe(2);
  });

  it("keeps at most the configured number of snapshots", async () => {
    const { s } = await fresh();
    for (let i = 0; i < snapshotKeep + 3; i++) await s.backUpNow();
    expect((await listSnapshots(s.folder)).length).toBe(snapshotKeep);
  });

  it("ignores a half-written snapshot folder", async () => {
    const { p, s } = await fresh();
    await p.mkdirs(p.join(s.folder.snapshotsDir, "2026-01-01 000000", "data"));
    const list = await listSnapshots(s.folder);
    expect(list.every((x) => x.id !== "2026-01-01 000000")).toBe(true);
  });

  it("asks for a daily snapshot only once per day", async () => {
    const { s } = await fresh();
    await s.backUpNow();
    expect(await needsDailySnapshot(s.folder)).toBe(false);
  });

  it("clearing all data can be fully undone by restoring, archived files included", async () => {
    const { p, s } = await fresh();
    const doc = s.data.documents[0];
    const file = s.fileURL(doc);
    const bytes = await p.readBytes(file);
    await s.clearAllData();
    expect(s.data.companies.length).toBe(0);
    expect((await p.stat(file)).exists).toBe(false);
    const snap = s.snapshots.find((x) => x.reason === "清空所有数据前")!;
    expect(snap).toBeTruthy();
    await s.restoreFromSnapshot(snap);
    expect(s.data.companies.length).toBe(12);
    expect((await p.stat(file)).exists).toBe(true);
    expect(await p.readBytes(file)).toEqual(bytes);
  });
});

describe("config export and import", () => {
  it("round trip into a different data folder carries templates and settings", async () => {
    const { p, s } = await fresh();
    s.commit((d) => { d.settings.reminderDays = [90, 14]; d.library.packets.push({ ...d.library.packets[0], id: "custom.p", name: "自定义用途" }); });
    await exportConfig(s, "/out/cfg.json");
    const other = new Store("/Other"); await other.load();
    const b = await readConfig("/out/cfg.json");
    expect(configImportDiff(other, b, "merge").changes).toBeGreaterThan(0);
    await applyConfig(other, b, "merge");
    const again = new Store("/Other"); await again.load();
    expect(again.data.settings.reminderDays).toEqual([90, 14]);
    expect(again.data.library.packets.some((x) => x.id === "custom.p")).toBe(true);
    void p;
  });

  it("replace keeps document types that existing files still use", async () => {
    const { s } = await fresh();
    await exportConfig(s, "/out/full.json");
    const b = await readConfig("/out/full.json");
    const used = s.data.documents[0].typeID;
    b.library.documentTypes = b.library.documentTypes.filter((t) => t.id !== used);
    await applyConfig(s, b, "replace");
    expect(s.data.library.documentTypes.some((t) => t.id === used)).toBe(true);
  });

  it("compliance switch survives a round trip whether on or off", async () => {
    for (const on of [true, false]) {
      const { s } = await fresh(false);
      s.commit((d) => { d.settings.complianceEnabled = on; });
      await exportConfig(s, "/out/c.json");
      s.commit((d) => { d.settings.complianceEnabled = !on; });
      await applyConfig(s, await readConfig("/out/c.json"), "merge");
      expect(!!s.data.settings.complianceEnabled).toBe(on);
    }
  });

  it("rejects broken, foreign and newer files with a clear message", async () => {
    const { p } = await fresh(false);
    await p.writeText("/out/bad.json", "{not json");
    await p.writeText("/out/foreign.json", JSON.stringify({ hello: 1 }));
    await p.writeText("/out/newer.json", JSON.stringify({ version: 99, settings: {}, library: {} }));
    await expect(readConfig("/out/bad.json")).rejects.toThrow(/不是 Charter 导出的配置/);
    await expect(readConfig("/out/foreign.json")).rejects.toThrow(/不是 Charter 导出的配置/);
    await expect(readConfig("/out/newer.json")).rejects.toThrow(/更新版本/);
  });

  it("does not touch companies or documents", async () => {
    const { s } = await fresh();
    const before = JSON.stringify([s.data.companies, s.data.documents]);
    await exportConfig(s, "/out/x.json");
    s.commit((d) => { d.settings.notificationHour = 6; });
    await applyConfig(s, await readConfig("/out/x.json"), "replace");
    expect(JSON.stringify([s.data.companies, s.data.documents])).toBe(before);
  });
});

describe("exports", () => {
  it("document packet contains a table of contents and each chosen file", async () => {
    const { p, s } = await fresh();
    const c = company(s, "远澜控股（香港）有限公司");
    const t = s.data.library.packets.find((x) => x.name === "银行开户")!;
    const items = packetItems(t, c, s);
    const zip = await buildPacket(items, t, c, s);
    const names = await zipNames(p, zip);
    expect(names[0]).toMatch(/00 目录\.pdf$/);
    expect(names.length).toBe(1 + items.filter((i) => i.included && i.document).length);
    expect(zip).not.toMatch(/_部分_/);
  });

  it("partial packet is marked partial", async () => {
    const { p, s } = await fresh();
    const c = company(s, "Yuanlan Group Ltd.");
    const t = s.data.library.packets.find((x) => x.name === "银行开户")!;
    const zip = await buildPacket(packetItems(t, c, s), t, c, s);
    expect(zip).toMatch(/_部分_/);
    expect((await zipNames(p, zip)).length).toBeGreaterThan(1);
  });

  it("packet still builds when one archived file is missing from the folder", async () => {
    const { p, s } = await fresh();
    const c = company(s, "远澜控股（香港）有限公司");
    const t = s.data.library.packets.find((x) => x.name === "银行开户")!;
    const items = packetItems(t, c, s);
    const victim = items.find((i) => i.included && i.document)!.document!;
    await p.removeFile(s.fileURL(victim));
    const fresh2 = packetItems(t, c, s);
    const zip = await buildPacket(fresh2, t, c, s);
    const names = await zipNames(p, zip);
    expect(names.length).toBe(fresh2.filter((i) => i.included && i.document).length); // 少了缺失的那份，但有目录
    expect(zip).toMatch(/_部分_/);
  });

  it("export all includes catalogue, spreadsheet, summary and old versions on request", async () => {
    const { p, s } = await fresh();
    const c = company(s, "Yuanlan Group Ltd.");
    const zip = await exportAll(c, s, true);
    const names = await zipNames(p, zip);
    expect(names.some((n) => n.endsWith("00 目录.pdf"))).toBe(true);
    expect(names.some((n) => n.endsWith("00 目录.xlsx"))).toBe(true);
    expect(names.some((n) => n.endsWith("00 公司资料摘要.txt"))).toBe(true);
    expect(names.filter((n) => !n.includes("/00 ")).length).toBe(s.archive(c).filter((i) => i.document).length);
  });

  it("two exports on the same day do not overwrite each other", async () => {
    const { s } = await fresh();
    const c = company(s, "Yuanlan Group Ltd.");
    const a = await exportAll(c, s, false);
    const b = await exportAll(c, s, false);
    expect(a).not.toBe(b);
  });
});

describe("file import", () => {
  it("archives a new version, keeps the old one as history, and survives reopening", async () => {
    const { p, s } = await fresh();
    const c = company(s, "Yuanlan Group Ltd.");
    const old = s.data.documents.find((d) => d.owner.kind === "company" && d.owner.id === c.id && d.typeID === "ky.cogs" && !d.supersededBy)!;
    await p.writeBytes("/in/cogs.pdf", pdf("new cogs"));
    const [n] = await s.archiveBatch([{ path: "/in/cogs.pdf", typeID: "ky.cogs", owner: ref("company", c.id), issued: s.today }]);
    expect((await p.stat(s.fileURL(n))).exists).toBe(true);
    expect((await p.stat("/in/cogs.pdf")).exists).toBe(true); // 原文件不动
    const s2 = await reopen();
    expect(s2.data.documents.find((d) => d.id === old.id)!.supersededBy).toBe(n.id);
    expect(s2.data.documents.some((d) => d.id === n.id)).toBe(true);
  });

  it("keep-both leaves the old version current too", async () => {
    const { p, s } = await fresh();
    const c = company(s, "Yuanlan Group Ltd.");
    await p.writeBytes("/in/a.pdf", pdf("a"));
    const before = s.data.documents.filter((d) => d.typeID === "ky.coi" && d.owner.id === c.id && !d.supersededBy).length;
    await s.archiveBatch([{ path: "/in/a.pdf", typeID: "ky.coi", owner: ref("company", c.id), keepBoth: true }]);
    expect(s.data.documents.filter((d) => d.typeID === "ky.coi" && d.owner.id === c.id && !d.supersededBy).length).toBe(before + 1);
  });

  it("two files with the same name and date do not overwrite each other", async () => {
    const { p, s } = await fresh();
    const c = company(s, "立方咨询有限公司");
    await p.writeBytes("/in/x.pdf", pdf("one"));
    await p.writeBytes("/in/y.pdf", pdf("two"));
    const docs = await s.archiveBatch([
      { path: "/in/x.pdf", typeID: "hk.coi", owner: ref("company", c.id), issued: "2020-01-01", keepBoth: true },
      { path: "/in/y.pdf", typeID: "hk.coi", owner: ref("company", c.id), issued: "2020-01-01", keepBoth: true },
    ]);
    expect(docs[0].filePath).not.toBe(docs[1].filePath);
    expect(new TextDecoder().decode(await p.readBytes(s.fileURL(docs[1])))).toContain("two");
  });

  it("a failed batch leaves no copied files and no records", async () => {
    const { p, s } = await fresh();
    const c = company(s, "立方咨询有限公司");
    await p.writeBytes("/in/ok.pdf", pdf("ok"));
    const count = s.data.documents.length;
    const filesBefore = [...p.files.keys()].filter((k) => k.startsWith("/Charter/files/")).length;
    await expect(s.archiveBatch([
      { path: "/in/ok.pdf", typeID: "hk.coi", owner: ref("company", c.id) },
      { path: "/in/missing.pdf", typeID: "hk.coi", owner: ref("company", c.id) },
    ])).rejects.toThrow();
    expect(s.data.documents.length).toBe(count);
    expect([...p.files.keys()].filter((k) => k.startsWith("/Charter/files/")).length).toBe(filesBefore);
    expect(s.isImporting).toBe(false);
  });

  it("an import draft saved for later survives reopening the app", async () => {
    const { s } = await fresh();
    s.savePendingImport({ rows: [{ id: "r1", path: "/in/a.pdf", recognized: true, include: true }], companies: [] } as any);
    const s2 = await reopen(); await s2.loadPendingImport();
    expect(s2.pendingImport?.rows?.length ?? 0).toBe(1);
  });
});
