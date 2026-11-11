// 5.5.5：“设置 → 实际结果”。每条都检查最终写入的文件或数据。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildAsIs } from "./packetHelper";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { installSampleData } from "../state/sample";
import { buildPacket, calendarPath, packetItems, resetCalendarFileState, syncCalendarFile } from "../services/packets";
import { defaultWatermark } from "../services/watermark";
import { restoreTrash, trashDocuments } from "../state/lifecycle";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");
async function fresh() {
  const p = new MemoryPlatform(templates); setPlatform(p);
  const s = new Store("/Charter"); await s.load(); await installSampleData(s); await s.flushWrites();
  resetCalendarFileState();
  return { p, s };
}
const hk = (s: Store) => s.data.companies.find((x) => x.name === "远澜控股（香港）有限公司")!;
const bank = (s: Store) => s.data.library.packets.find((x) => x.name === "银行开户")!;

describe("发送记录保存完整设置", () => {
  it("不加水印 + 清除文件信息：记录里水印为空、清除为是", async () => {
    const { s } = await fresh();
    await buildAsIs(packetItems(bank(s), hk(s), s), bank(s), hk(s), s, { stripMeta: true });
    expect(s.data.sends[0].watermark).toBeUndefined();
    expect(s.data.sends[0].stripMeta).toBe(true);
  });
  it("加水印时记录水印设置，且不改用途模板", async () => {
    const { s } = await fresh();
    const before = JSON.stringify(bank(s).watermark ?? null);
    await buildAsIs(packetItems(bank(s), hk(s), s), bank(s), hk(s), s, { watermark: { wm: { enabled: true, settings: defaultWatermark(), skip: [], stripMeta: false }, recipient: "HSBC" } });
    expect(s.data.sends[0].watermark?.enabled).toBe(true);
    expect(s.data.sends[0].stripMeta).toBe(false);
    expect(JSON.stringify(bank(s).watermark ?? null)).toBe(before);
  });
});

describe("日历文件", () => {
  it("公司改名会重写；改日历名会删旧文件；关闭同步会删文件", async () => {
    const { p, s } = await fresh();
    s.saveSettings((x) => { x.complianceEnabled = true; x.calendarEnabled = true; });
    await s.flushWrites();
    await syncCalendarFile(s);
    const first = calendarPath(s);
    expect((await p.stat(first)).exists).toBe(true);
    if (s.openObligations.length) {
      const c = s.openObligations[0].company;
      s.commit((d) => { d.companies.find((x) => x.id === c.id)!.name = "改名测试公司"; });
      await syncCalendarFile(s);
      expect(await p.readText(first)).toContain("改名测试公司");
    }
    s.saveSettings((x) => { x.calendarName = "合规/日历"; });
    await syncCalendarFile(s);
    const second = calendarPath(s);
    expect(second).not.toBe(first);
    expect((await p.stat(second)).exists).toBe(true);
    expect((await p.stat(first)).exists).toBe(false);
    s.saveSettings((x) => { x.calendarEnabled = false; });
    await syncCalendarFile(s);
    expect((await p.stat(second)).exists).toBe(false);
  });
});

describe("同步：其他设备改了模板文件", () => {
  it("本机重新载入后能看到新用途", async () => {
    const { p, s } = await fresh();
    const lib = JSON.parse(await p.readText(s.folder.templatesFile));
    lib.packets.push({ ...lib.packets[0], id: "remote.test", name: "另一台设备新建的用途" });
    await p.writeText(s.folder.templatesFile, JSON.stringify(lib));
    await s.reloadIfChangedElsewhere();
    expect(s.data.library.packets.some((x) => x.name === "另一台设备新建的用途")).toBe(true);
  });
  it("本机刚保存的修改不会被重新载入覆盖", async () => {
    const { s } = await fresh();
    const c = hk(s);
    s.commit((d) => { d.companies.find((x) => x.id === c.id)!.name = "刚改的名字"; });
    await s.reloadIfChangedElsewhere();       // 不先等写完时，这里可能读回旧名字
    expect(s.company(c.id)?.name).toBe("刚改的名字");
  });
});

describe("清空与删除", () => {
  it("清空所有数据会清掉发送记录", async () => {
    const { s } = await fresh();
    await buildPacket(packetItems(bank(s), hk(s), s), bank(s), hk(s), s, {});
    expect(s.clearSummaryLines.some((l) => l.startsWith("材料包发送记录"))).toBe(true);
    await s.clearAllData();
    expect(s.data.sends).toHaveLength(0);
  });
  it("删除公司会清掉它的发送记录，撤销时恢复", async () => {
    const { s } = await fresh();
    await buildPacket(packetItems(bank(s), hk(s), s), bank(s), hk(s), s, {});
    s.deleteCompany(hk(s));
    expect(s.data.sends).toHaveLength(0);
    s.undo();
    expect(s.data.sends).toHaveLength(1);
  });
});

describe("废纸篓恢复“已核实”", () => {
  it("核实依据移到废纸篓再恢复，持股回到已核实", async () => {
    const { s } = await fresh();
    const doc = s.data.documents[0];
    const h = s.data.holdings[0];
    s.commit((d) => { const x = d.holdings.find((y) => y.id === h.id)!; x.evidence = { documentID: doc.id }; x.verified = true; });
    const [e] = await trashDocuments(s, [doc]);
    expect(s.data.holdings.find((x) => x.id === h.id)!.verified).toBe(false);
    await restoreTrash(s, [e.id]);
    const back = s.data.holdings.find((x) => x.id === h.id)!;
    expect(back.verified).toBe(true);
    expect(back.evidence?.documentID).toBe(doc.id);
  });
});
