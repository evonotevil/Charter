import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { getOcrStatus, ocrMany, subscribeOcrStatus } from "../services/extract";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");

describe("5.5.6 文字识别", () => {
  it("多页一次交给批量识别，逐页报告进度，结束后清空状态", async () => {
    const p = new MemoryPlatform(templates);
    let calls = 0;
    p.ocrBatch = async (images, onPage) => { calls++; images.forEach((_, i) => onPage?.(i + 1, images.length)); return images.map((_, i) => `第${i + 1}页`); };
    setPlatform(p);
    const seen: (string | null)[] = [];
    const off = subscribeOcrStatus(() => seen.push(getOcrStatus()));
    const out = await ocrMany([new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])]);
    off();
    expect(calls).toBe(1);
    expect(out).toEqual(["第1页", "第2页", "第3页"]);
    expect(seen[0]).toBe("正在识别第 1/3 页");
    expect(seen).toContain("正在识别第 3/3 页");
    expect(getOcrStatus()).toBeNull();
  });

  it("批量识别失败时逐张识别；单张失败记为空文字", async () => {
    const p = new MemoryPlatform(templates);
    p.ocrBatch = async () => { throw new Error("脚本没有运行成功"); };
    let n = 0;
    p.ocr = async () => { n++; if (n === 2) throw new Error("坏图"); return "文字"; };
    setPlatform(p);
    expect(await ocrMany([new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])])).toEqual(["文字", "", "文字"]);
    expect(getOcrStatus()).toBeNull();
  });

  it("单张图片只显示“正在识别”", async () => {
    const p = new MemoryPlatform(templates);
    setPlatform(p);
    const seen: (string | null)[] = [];
    const off = subscribeOcrStatus(() => seen.push(getOcrStatus()));
    await ocrMany([new Uint8Array([1])]);
    off();
    expect(seen[0]).toBe("正在识别");
  });
});

import { Store, localCalendarName } from "../state/store";
import { installSampleData } from "../state/sample";

async function sharedSample() {
  const p = new MemoryPlatform(templates);
  setPlatform(p);
  const s = new Store("/Cloud/Charter"); await s.load(); await installSampleData(s); await s.flushWrites();
  return { p, s };
}

describe("5.5.6 多台电脑共用", () => {
  it("开关按数据文件夹位置推算", async () => {
    const { s } = await sharedSample();
    expect(s.shared).toBe(true);
    setPlatform(new MemoryPlatform(templates));
    const l = new Store("/Local/Charter"); await l.load();
    expect(l.shared).toBe(false);
    expect(l.isPrimaryDevice).toBe(true);
  });

  it("关闭共用：复制到本机并改用副本，原文件夹保留；提醒交给其他电脑，本机改用“Charter（本机）”日历", async () => {
    const { p, s } = await sharedSample();
    const n = s.data.companies.length;
    expect(s.data.settings.primaryDeviceID).toBe(s.deviceID);
    const ticks: number[] = [];
    await s.leaveShared("/Local/Charter", (d) => ticks.push(d));
    expect(ticks.length).toBeGreaterThan(0);
    expect(s.folder.root).toBe("/Local/Charter");
    expect(s.shared).toBe(false);
    expect(s.data.companies.length).toBe(n);
    expect(s.data.settings.calendarName).toBe(localCalendarName);
    // 同步盘那份还在，且不再记着这台电脑发提醒
    const cloudSettings = JSON.parse(await p.readText("/Cloud/Charter/data/settings.json"));
    expect(cloudSettings.primaryDeviceID).toBeUndefined();
    expect(JSON.parse(await p.readText("/Cloud/Charter/data/companies.json")).length).toBe(n);
  });

  it("关闭共用时目标在同步盘里：拒绝，档案不变", async () => {
    const { s } = await sharedSample();
    await expect(s.leaveShared("/Cloud/Other")).rejects.toThrow(/同步盘/);
    expect(s.folder.root).toBe("/Cloud/Charter");
    expect(s.data.settings.primaryDeviceID).toBe(s.deviceID);
  });

  it("关闭共用时复制失败：提醒仍由这台电脑负责，文件夹不变", async () => {
    const { p, s } = await sharedSample();
    p.copyTree = async () => { throw new Error("磁盘空间不足"); };
    await expect(s.leaveShared("/Local/Charter")).rejects.toThrow(/磁盘空间不足/);
    expect(s.folder.root).toBe("/Cloud/Charter");
    expect(s.data.settings.primaryDeviceID).toBe(s.deviceID);
  });

  it("开启共用：复制到同步盘；改用已有档案时要求是 Charter 文件夹", async () => {
    const { s } = await sharedSample();
    await s.leaveShared("/Local/Charter");
    await expect(s.joinShared("copy", "/Local/Elsewhere")).rejects.toThrow(/不在 iCloud/);
    await expect(s.joinShared("existing", "/Cloud/Empty")).rejects.toThrow(/没有 Charter 档案/);
    await s.joinShared("copy", "/Cloud/Charter 2");
    expect(s.shared).toBe(true);
    expect(s.data.settings.calendarName).toBe("Charter");
    await s.joinShared("existing", "/Cloud/Charter");
    expect(s.folder.root).toBe("/Cloud/Charter");
  });
});

import { DemoPlatform, shouldStartTour } from "../state/demo";

describe("5.5.6 入门教程", () => {
  const desk = () => { const m = new MemoryPlatform(templates); (m as { os: string }).os = "mac"; return m; };
  it("数据文件夹是空的、没看过时进入；有档案或看过时不进入；“重新看教程”只生效一次", async () => {
    const real = desk();
    expect(await shouldStartTour(real, "/Charter")).toBe(true);
    await real.writeText("/Charter/charter.json", "{}");
    expect(await shouldStartTour(real, "/Charter")).toBe(false);
    real.prefSet("tourRequested", "1");
    expect(await shouldStartTour(real, "/Charter")).toBe(true);
    expect(await shouldStartTour(real, "/Charter")).toBe(false);
    const fresh = desk(); fresh.prefSet("tourSeen", "1");
    expect(await shouldStartTour(fresh, "/Empty")).toBe(false);
  });

  it("演示平台不写真实文件：选择文件、保存位置、复制数据文件夹都不可用", async () => {
    const real = desk();
    const d = new DemoPlatform(real, templates);
    expect(d.os).toBe("mac");
    expect(await d.pickFiles()).toEqual([]);
    expect(await d.pickFolder()).toBeNull();
    expect(await d.saveDialog()).toBeNull();
    expect(d.copyTree).toBeUndefined();
    await d.writeText("/Charter/x.json", "{}");
    expect((await real.stat("/Charter/x.json")).exists).toBe(false);
  });
});

describe("5.5.6 内置配置", () => {
  const lib = JSON.parse(templates);
  it("8 个法域、稳定编号、规则默认开启（开曼经济实质报告除外），版本号不变", () => {
    expect(lib.version).toBe(4);
    expect(lib.jurisdictions.map((j: { code: string }) => j.code).sort()).toEqual(["HK", "JP", "KR", "KY", "SG", "TW", "VG", "VI"]);
    expect(lib.documentTypes.some((t: { id: string }) => t.id.startsWith("custom."))).toBe(false);
    expect(lib.documentTypes.every((t: { builtIn: boolean }) => t.builtIn)).toBe(true);
    expect(lib.documentTypes.some((t: { id: string }) => t.id === "tw.registration")).toBe(true);
    for (const r of lib.rules) expect(r.enabled, r.id).toBe(r.id !== "ky.es-return");
    const ids = new Set(lib.documentTypes.map((t: { id: string }) => t.id));
    for (const [, list] of Object.entries(lib.archiveItems as Record<string, string[]>)) for (const id of list) expect(ids.has(id), id).toBe(true);
  });
});
