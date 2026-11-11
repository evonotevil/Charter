// 5.5.5：外部评测（5.5.4）发现的问题。每条都检查最终写入的文件或数据；修复前应失败。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { PDFDocument, PDFName } from "pdf-lib";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { installSampleData } from "../state/sample";
import { PacketFailuresError, buildPacket, packetItemID, packetItems } from "../services/packets";
import { checkDataFile, exportBackup, readBackup, restoreBackup, safeEntryName } from "../services/backup";
import { trashDocuments } from "../state/lifecycle";
import { dayError, parseDay } from "../domain/day";
import { findDates } from "../domain/recognize";
import { buildSnapshot } from "../domain/graph";
import { checkForUpdate, compareVersions, parseRelease, releaseBullets } from "../services/update";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");
async function fresh(root = "/Charter") {
  const p = new MemoryPlatform(templates); setPlatform(p);
  const s = new Store(root); await s.load(); await installSampleData(s); await s.flushWrites();
  return { p, s };
}
const hk = (s: Store) => s.data.companies.find((x) => x.name === "远澜控股（香港）有限公司")!;
const bank = (s: Store) => s.data.library.packets.find((x) => x.name === "银行开户")!;
async function pdfWithXMP(secret: string) {
  const d = await PDFDocument.create(); d.addPage(); d.setAuthor("张三");
  const xmp = d.context.stream(`<x:xmpmeta>${secret}</x:xmpmeta>`, { Type: "Metadata", Subtype: "XML" });
  d.catalog.set(PDFName.of("Metadata"), d.context.register(xmp));
  return d.save({ useObjectStreams: false });
}
/** 把样例里除第一份以外的文件都换成合法 PDF，避免“处理失败”干扰。 */
async function realFiles(p: MemoryPlatform, s: Store) {
  const items = packetItems(bank(s), hk(s), s).filter((i) => i.included && i.document);
  for (const i of items) { const d = await PDFDocument.create(); d.addPage(); await p.writeBytes(s.fileURL(i.document!), await d.save()); }
  return items;
}

describe("#1 清除文件信息：XMP 隐藏元数据", () => {
  it("导出的 ZIP 里找不到原 XMP 内容", async () => {
    const { p, s } = await fresh();
    const items = await realFiles(p, s);
    await p.writeBytes(s.fileURL(items[0].document!), await pdfWithXMP("SECRET_XMP_9271"));
    const r = await buildPacket(packetItems(bank(s), hk(s), s), bank(s), hk(s), s, { stripMeta: true });
    const z = await JSZip.loadAsync(await p.readBytes(r.path));
    for (const f of Object.values(z.files)) if (!f.dir) expect(new TextDecoder("latin1").decode(await f.async("uint8array"))).not.toContain("SECRET_XMP_9271");
  });
});

describe("#3 处理失败的文件不能悄悄原样放入", () => {
  it("默认停下列出；选“不放入”后按缺件处理；选“原样”后注明", async () => {
    const { p, s } = await fresh();
    const items = await realFiles(p, s);
    await p.writeBytes(s.fileURL(items[0].document!), new TextEncoder().encode("not a pdf"));
    const all = packetItems(bank(s), hk(s), s);
    let err: unknown;
    try { await buildPacket(all, bank(s), hk(s), s, { stripMeta: true }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(PacketFailuresError);
    expect(s.data.sends).toHaveLength(0);
    const id = (err as PacketFailuresError).failures[0].id;
    const omit = await buildPacket(all, bank(s), hk(s), s, { stripMeta: true, failed: { [id]: "omit" } });
    expect(omit.files).toBe(items.length - 1);
    expect(omit.complete).toBe(false);
    expect(omit.omittedTitles).toHaveLength(1);
    const asis = await buildPacket(all, bank(s), hk(s), s, { stripMeta: true, failed: { [id]: "asis" } });
    expect(asis.files).toBe(items.length);
  });
});

describe("#4 完成页用实际结果", () => {
  it("生成前源文件消失：结果为部分材料包、少一份", async () => {
    const { p, s } = await fresh();
    const items = await realFiles(p, s);
    const all = packetItems(bank(s), hk(s), s);
    await p.removeFile(s.fileURL(items[1].document!));
    const r = await buildPacket(all, bank(s), hk(s), s, {});
    expect(r.files).toBe(items.length - 1);
    expect(r.complete).toBe(false);
    expect(r.lostTitles).toHaveLength(1);
    expect(s.data.sends[0].files).toBe(r.files);
  });
});

describe("#15 同一董事多条任职", () => {
  it("护照只列一次，项目标识按人员 ID", async () => {
    const { s } = await fresh();
    const c = hk(s);
    const a = s.data.appointments.find((x) => x.companyID === c.id && x.title.includes("董事"))!;
    s.commit((d) => { d.appointments.push({ ...structuredClone(a), id: "dup" } as any); });
    const t = { ...bank(s), includeDirectorsPassports: true };
    const ids = packetItems(t, c, s).map(packetItemID);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((x) => x.includes("person:"))).toBe(true);
  });
});

describe("#5 #6 保存与切换数据文件夹", () => {
  it("切换文件夹前先写完旧文件夹；旧修改不会写进新文件夹", async () => {
    const { p, s } = await fresh("/A");
    const b = new Store("/B"); await b.load(); await installSampleData(b); await b.flushWrites();
    const before = await p.readText("/B/data/companies.json");
    s.commit((d) => { d.companies[0].name = "只属于 A 的改名"; });
    await s.changeDataRoot("/B");
    expect(await p.readText("/B/data/companies.json")).toBe(before);
    expect(await p.readText("/A/data/companies.json")).toContain("只属于 A 的改名");
  });
  it("有保存失败的修改时，不导出备份", async () => {
    const { p, s } = await fresh();
    const orig = p.writeBytes.bind(p);
    let fail = true;
    p.writeBytes = async (path: string, data: Uint8Array) => { if (fail && path.includes("/data/companies")) throw new Error("磁盘已满"); return orig(path, data); };
    s.commit((d) => { d.companies[0].name = "没保存成功的名字"; });
    await s.flushWrites();
    await expect(exportBackup(s, "/out/x.zip")).rejects.toThrow(/还没保存/);
    fail = false;
    await exportBackup(s, "/out/x.zip");          // 重试保存成功后可以导出
    const z = await JSZip.loadAsync(await p.readBytes("/out/x.zip"));
    expect(await z.file("data/companies.json")!.async("string")).toContain("没保存成功的名字");
  });
});

describe("#7 #8 #9 #14 备份与恢复", () => {
  it("恢复前快照能找回被覆盖的归档文件", async () => {
    const { p, s } = await fresh();
    const doc = s.data.documents[0]; const path = s.fileURL(doc);
    await p.writeText(path, "BACKUP_CONTENT"); await exportBackup(s, "/out/b.zip");
    await p.writeText(path, "CURRENT_CONTENT");
    await restoreBackup(s, await readBackup("/out/b.zip"));
    expect(await p.readText(path)).toBe("BACKUP_CONTENT");
    await s.refreshSnapshots();
    const snap = s.snapshots.find((x) => x.reason === "恢复备份前")!;
    await s.restoreFromSnapshot(snap);
    expect(await p.readText(path)).toBe("CURRENT_CONTENT");
  });
  it("结构错误的备份被拒绝，当前数据不变", async () => {
    const { p, s } = await fresh();
    await exportBackup(s, "/out/b.zip");
    const z = await JSZip.loadAsync(await p.readBytes("/out/b.zip"));
    z.file("data/companies.json", "{}");
    await p.writeBytes("/out/bad.zip", await z.generateAsync({ type: "uint8array" }));
    const n = s.data.companies.length;
    await restoreBackup(s, await readBackup("/out/bad.zip"));
    expect(s.data.companies.length).toBe(n);
    expect(JSON.parse(await p.readText("/Charter/data/companies.json"))).toHaveLength(n);
    expect(checkDataFile("companies.json", {})).not.toBeNull();
  });
  it("废纸篓的文件随备份恢复", async () => {
    const { p, s } = await fresh();
    const [e] = await trashDocuments(s, [s.data.documents[0]]);
    await exportBackup(s, "/out/b.zip");
    const t = new Store("/Other"); setPlatform(p); await t.load();
    await restoreBackup(t, await readBackup("/out/b.zip"));
    expect(t.data.trash.find((x) => x.id === e.id)).toBeTruthy();
    expect((await p.stat(t.folder.abs(e.path))).exists).toBe(true);
  });
  it("拒绝不安全的路径", async () => {
    expect(safeEntryName("files/..\\\\..\\\\outside.txt")).toBe(false);
    expect(safeEntryName("files/../../x")).toBe(false);
    expect(safeEntryName("/etc/passwd")).toBe(false);
    expect(safeEntryName("C:/x")).toBe(false);
    expect(safeEntryName("files/公司/营业执照.pdf")).toBe(true);
    const { p, s } = await fresh();
    await exportBackup(s, "/out/b.zip");
    const z = await JSZip.loadAsync(await p.readBytes("/out/b.zip"));
    z.file("files/..\\..\\outside.txt", "x");
    await p.writeBytes("/out/evil.zip", await z.generateAsync({ type: "uint8array" }));
    await restoreBackup(s, await readBackup("/out/evil.zip"));
    expect([...p.files.keys()].some((k) => k.includes("outside"))).toBe(false);
  });
});

describe("#11 日期严格校验", () => {
  it("不存在的日期不保存，给出原因", () => {
    expect(parseDay("2026-02-31")).toBeNull();
    expect(parseDay("2024-02-29")).toBe("2024-02-29");
    expect(dayError("2026-02-31")).toContain("2 月只有 28 天");
    expect(findDates("签发日期 2026年2月31日").length).toBe(0);
  });
});

describe("#12 #13 持股历史", () => {
  it("股权变更保留历史；更正直接改原记录", async () => {
    const { s } = await fresh();
    const h = s.data.holdings.find((x) => x.percent < 90 && !x.to)!;
    const was = h.percent, from = h.from ?? "2020-01-01";
    s.commit((d) => { d.holdings.find((x) => x.id === h.id)!.from = from; });
    expect(s.applyHoldingChanges(h.companyID, [{ h: s.data.holdings.find((x) => x.id === h.id)!, percent: was + 5 }], "change", "2026-06-01")).toBe(true);
    const before = s.data.holdings.filter((x) => x.holder.id === h.holder.id && x.companyID === h.companyID);
    expect(before.find((x) => x.id === h.id)!.percent).toBe(was);
    expect(before.find((x) => x.id !== h.id)!.percent).toBe(was + 5);
    const cur = before.find((x) => x.id !== h.id)!;
    s.applyHoldingChanges(h.companyID, [{ h: cur, percent: was + 1 }], "correct");
    expect(s.data.holdings.find((x) => x.id === cur.id)!.percent).toBe(was + 1);
  });
  it("后来注销的公司，在注销前的历史结构里仍然存在", () => {
    const c = { id: "c1", name: "X", status: "dissolved", jurisdiction: "HK" } as any;
    const args = { companies: [c], holdings: [], scope: null, names: new Map(), savedPositions: new Map(), dissolvedOn: new Map([["c1", "2026-01-01"]]), today: "2026-11-11" };
    expect(buildSnapshot({ ...args, asOf: "2025-06-01" }).companies).toHaveLength(1);
    expect(buildSnapshot({ ...args, asOf: "2026-06-01" }).companies).toHaveLength(0);
  });
});

describe("检查更新", () => {
  it("版本比较、发布说明要点、发现新版本", async () => {
    setPlatform(new MemoryPlatform(templates));
    expect(compareVersions("5.6.0", "5.5.5")).toBeGreaterThan(0);
    expect(compareVersions("v5.5.5", "5.5.5")).toBe(0);
    expect(releaseBullets("## 5.6.0\n- **新增**：多接收方\n* 修正 [同步](http://x)\n正文")).toEqual(["新增：多接收方", "修正 同步"]);
    expect(parseRelease({ tag_name: "v5.6.0", body: "- a", html_url: "https://h" }).version).toBe("5.6.0");
    const st = await checkForUpdate({ fetcher: (async () => new Response(JSON.stringify({ tag_name: "v99.0.0", body: "- 新功能", html_url: "https://h", published_at: "2026-12-01T00:00:00Z" }))) as typeof fetch });
    expect(st.kind).toBe("available");
  });
});
