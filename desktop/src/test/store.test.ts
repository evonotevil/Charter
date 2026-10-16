import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { installSampleData } from "../state/sample";
import { toJSON } from "../domain/json";
import * as D from "../domain/day";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");

async function fresh() {
  const p = new MemoryPlatform(templates);
  setPlatform(p);
  const s = new Store("/Charter");
  await s.load();
  return { p, s };
}

describe("day", () => {
  it("adds months keeping month end", () => {
    expect(D.addMonths("2026-03-31", 2)).toBe("2026-05-31");
    expect(D.addMonths("2026-01-30", 1)).toBe("2026-02-28");
    expect(D.addMonths("2026-01-15", -13)).toBe("2024-12-15");
    expect(D.daysBetween("2026-01-01", "2026-03-01")).toBe(59);
    expect(D.weekday("2026-10-11")).toBe(1); // Sunday
  });
});

describe("json", () => {
  it("writes standard JSON and drops undefined fields", () => {
    expect(toJSON({ b: 1, a: [], c: { y: "a/b", x: 1.5 }, d: undefined })).toBe(
      '{\n  "b": 1,\n  "a": [],\n  "c": {\n    "y": "a/b",\n    "x": 1.5\n  }\n}\n');
    expect(() => toJSON({ n: NaN })).toThrow();
  });
  it("stamps are ISO strings", () => {
    const t = D.nowStamp();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(D.dayOfStamp("2026-10-16T08:00:00.000Z")).toMatch(/^2026-10-1[67]$/);
  });
});

describe("store", () => {
  it("loads templates and sample data", async () => {
    const { p, s } = await fresh();
    expect(s.data.library.jurisdictions.length).toBe(8);
    await installSampleData(s);
    expect(s.data.companies.length).toBe(12);
    expect(s.data.documents.length).toBe(33);
    expect(s.data.groups.map((g) => g.name).sort()).toEqual(["Harbor Crest", "独立公司", "远澜集团"]);
    const yl = s.data.groups.find((g) => g.name === "远澜集团")!;
    expect(s.companyIDsIn(yl).size).toBe(8);
    // 档案文件已写入
    const docs = JSON.parse(await p.readText("/Charter/data/documents.json"));
    expect(docs.length).toBe(33);
    expect(docs[0].filePath.startsWith("files/")).toBe(true);
    // 重新载入一致
    const s2 = new Store("/Charter");
    await s2.load();
    expect(s2.data.companies.length).toBe(12);
    expect(s2.data.holdings).toEqual(s.data.holdings);
    // 穿透：日本公司 张三 100%（含代持）
    const jp = s.data.companies.find((c) => c.jurisdiction === "JP")!;
    const b = s.breakdownOf(jp.id);
    expect(b.owners[0].percent).toBeCloseTo(100);
    expect(b.owners[0].viaNominee).toBe(true);
    // 档案清单
    const ky = s.data.companies.find((c) => c.jurisdiction === "KY" && c.name.startsWith("Yuanlan"))!;
    expect(s.archive(ky).filter((i) => i.document).length).toBe(7);
  });

  it("creates the folder layout with a format marker", async () => {
    const { p, s } = await fresh();
    for (const d of ["data", "files", "packets"]) expect((await p.stat(`/Charter/${d}`)).isDir).toBe(true);
    expect((await p.stat("/Charter/templates.json")).exists).toBe(true);
    expect(JSON.parse(await p.readText("/Charter/charter.json")).format).toBe(1);
    await p.writeText("/Charter/charter.json", JSON.stringify({ app: "Charter", format: 99 }));
    const s2 = new Store("/Charter");
    await s2.load();
    expect(s2.loadFailed).toBe(true);
    void s;
  });

  it("stores request and log timestamps as ISO strings", async () => {
    const { p, s } = await fresh();
    await installSampleData(s);
    const c = s.data.companies[0];
    const r = s.recordRequest({ kind: "company", id: c.id }, [s.archive(c)[0].typeID], undefined, "请补发", 7)!;
    expect(r.createdAt).toMatch(/T/);
    await new Promise((ok) => setTimeout(ok, 20));
    const saved = JSON.parse(await p.readText("/Charter/data/requests.json"));
    expect(saved.some((x: { createdAt: string }) => x.createdAt === r.createdAt)).toBe(true);
  });

  it("undo restores and moves out of groups", async () => {
    const { s } = await fresh();
    await installSampleData(s);
    const yl = s.data.groups.find((g) => g.name === "远澜集团")!;
    const hk = s.data.companies.find((c) => c.name.startsWith("远澜贸易"))!;
    expect(s.membership(hk.id, yl).kind).toBe("derived");
    const text = s.moveOut(hk.id, yl.id);
    expect(text).toContain("现在不属于任何集团");
    expect(s.membership(hk.id, s.group(yl.id)!).kind).toBe("excluded");
    s.deleteCompany(hk);
    expect(s.company(hk.id)).toBeUndefined();
    s.undo();
    expect(s.company(hk.id)).toBeDefined();
  });

  it("computes obligations when compliance is on", async () => {
    const { s } = await fresh();
    await installSampleData(s);
    expect(s.allObligations.length).toBeGreaterThan(0);
    expect(s.openObligations.length).toBeLessThanOrEqual(s.allObligations.length);
  });
});
