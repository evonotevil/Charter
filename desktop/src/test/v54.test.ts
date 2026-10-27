import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryPlatform } from "../platform/memory";
import { platform, setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { installSampleData } from "../state/sample";
import { calendarEvents } from "../services/calendarSync";
import { ref } from "../domain/models";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");
async function sample() {
  setPlatform(new MemoryPlatform(templates));
  const s = new Store("/Charter"); await s.load(); await installSampleData(s);
  // 示例数据的文件在内存文件系统里不一定存在：给每份现行文件写一个占位文件
  for (const d of s.data.documents) await platform().writeBytes(s.fileURL(d), new Uint8Array([37, 80, 68, 70]));
  await s.checkFiles(true);
  return s;
}

describe("5.4 源文件不可用", () => {
  it("文件被删后：状态、需处理、完整度三处一致", async () => {
    const s = await sample();
    const d = s.data.documents.find((x) => !x.supersededBy && x.owner.kind === "company")!;
    expect(s.freshness(d).kind).not.toBe("fileMissing");
    await platform().removeFile(s.fileURL(d));
    await s.checkFiles(true);
    expect(s.freshness(d).kind).toBe("fileMissing");
    expect(s.documentsNeedingAttention.map((x) => x.id)).toContain(d.id);
    const item = s.archive(s.company(d.owner.id)!).find((i) => i.typeID === d.typeID)!;
    if (item.document?.id === d.id) expect(item.state.kind).toBe("fileMissing");
  });

  it("重新定位：复制回数据文件夹后恢复正常", async () => {
    const s = await sample();
    const d = s.data.documents.find((x) => !x.supersededBy)!;
    await platform().removeFile(s.fileURL(d));
    await s.checkFiles(true);
    await platform().writeBytes("/elsewhere/found.pdf", new Uint8Array([37, 80, 68, 70]));
    (platform() as MemoryPlatform & { pickFiles: unknown }).pickFiles = async () => ["/elsewhere/found.pdf"];
    expect(await s.relocateDocument(d)).toBe(true);
    expect(s.freshness(d).kind).not.toBe("fileMissing");
    expect((await platform().stat("/elsewhere/found.pdf")).exists).toBe(true); // 原件不动
  });

  it("打开缺失文件给出可见错误，不静默", async () => {
    const s = await sample();
    const d = s.data.documents.find((x) => !x.supersededBy)!;
    await platform().removeFile(s.fileURL(d));
    await s.checkFiles(true);
    let err = "";
    s.setError = (m: string) => { err = m; };
    await s.openDocument(d);
    expect(err).toContain("重新定位");
  });
});

describe("5.4 日历同步内容", () => {
  it("事项和到期文件各一条，键稳定，完成后消失", async () => {
    const s = await sample();
    const ev = calendarEvents(s);
    expect(ev.length).toBeGreaterThan(0);
    expect(new Set(ev.map((e) => e.key)).size).toBe(ev.length);
    expect(ev.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date))).toBe(true);
    expect(JSON.stringify(calendarEvents(s))).toBe(JSON.stringify(ev));
    const ob = ev.find((e) => e.key.startsWith("ob:"))!;
    const o = s.openObligations.find((x) => `ob:${x.key}` === ob.key)!;
    s.complete(o);
    expect(calendarEvents(s).some((e) => e.key === ob.key)).toBe(false);
    void ref;
  });
});
