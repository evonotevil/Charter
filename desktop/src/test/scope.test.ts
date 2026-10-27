import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { installSampleData } from "../state/sample";
import { archiveCounts, brandPalette, completeness, custodyFromMark, isStatusLike, ref } from "../domain/models";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");
async function sample() {
  setPlatform(new MemoryPlatform(templates));
  const s = new Store("/Charter"); await s.load(); await installSampleData(s);
  return s;
}

describe("5.3 材料范围", () => {
  it("只按“我负责”计算；未配置时不给百分比", () => {
    const items = [
      { state: { kind: "valid" as const }, custody: "mine" as const },
      { state: { kind: "missing" as const }, custody: "mine" as const },
      { state: { kind: "missing" as const }, custody: "agent" as const },
      { state: { kind: "missing" as const }, custody: "outOfScope" as const },
    ];
    const n = archiveCounts(items, true);
    expect([n.held, n.total, n.agent, n.notApplicable]).toEqual([1, 2, 1, 1]);
    expect(completeness(n)).toBe(0.5);
    expect(completeness(archiveCounts(items, false))).toBeNull();
    expect(completeness(archiveCounts([], true))).toBeNull(); // 0/0 不是 100%
    // 份与类分开计：一类两份
    const two = archiveCounts([{ state: { kind: "valid" }, custody: "mine", others: [{}] }], true);
    expect([two.files, two.docs]).toEqual([1, 2]);
  });

  it("旧标记映射到保管范围", () => {
    expect(custodyFromMark("notApplicable")).toBe("na");
    expect(custodyFromMark("external")).toBe("agent");
  });

  it("设置范围后公司变为已配置，可撤销", async () => {
    const s = await sample();
    const c = s.data.companies[0];
    expect(s.companyCounts(c).configured).toBe(false);
    const first = s.archive(c)[0].typeID;
    s.setCustody([ref("company", c.id)], [first], "agent");
    expect(s.companyCounts(s.company(c.id)!).configured).toBe(true);
    expect(s.archive(s.company(c.id)!).find((i) => i.typeID === first)!.custody).toBe("agent");
  });

  it("同类现行文件全部保留（两家公司的董事同意书）", async () => {
    const s = await sample();
    const p = s.data.people[0];
    const base = s.data.documents[0];
    s.commit((d) => {
      for (const [i, id] of ["c-a", "c-b"].entries())
        d.documents.push({ ...base, id, typeID: "person.consent", owner: ref("person", p.id), issueDate: `2026-0${i + 1}-01`, supersededBy: undefined } as typeof base);
    });
    const it = s.personArchive(p.id).find((x) => x.typeID === "person.consent")!;
    expect([it.document?.id, ...it.others.map((d) => d.id)].sort()).toEqual(["c-a", "c-b"]);
  });
});

describe("5.3 集团颜色", () => {
  it("色板里没有状态色；红橙黄绿识别为状态色", () => {
    for (const c of brandPalette) expect(isStatusLike(c)).toBe(false);
    for (const c of ["#DC1E1E", "#D64F6E", "#2BA889", "#5E9E3A", "#E07A2E", "#C99A1E"]) expect(isStatusLike(c)).toBe(true);
  });

  it("集团颜色按原值显示，不再映射", async () => {
    const s = await sample();
    const g = s.data.groups[0];
    s.commit((d) => { d.groups[0].color = "#DC1E1E"; });
    expect(s.brandColor(s.group(g.id))).toBe("#DC1E1E");
  });
});

describe("5.3.2 长期有效", () => {
  it("证件写明长期有效时不算需处理；留空仍算未填日期", async () => {
    const { freshnessOf, expiryLabel } = await import("../domain/engine");
    const t = { id: "x", validity: "expiryOnDocument" } as never;
    const base = { id: "d", typeID: "x", issueDate: "2020-09-11" } as never as import("../domain/models").Document;
    expect(freshnessOf(base, t, "2026-10-23").kind).toBe("unknown");
    expect(freshnessOf({ ...base, noExpiry: true }, t, "2026-10-23").kind).toBe("valid");
    expect(expiryLabel({ ...base, noExpiry: true }, t)).toBe("长期");
    expect(freshnessOf({ ...base, noExpiry: true, expiryDate: "2026-01-01" }, t, "2026-10-23").kind).toBe("expired");
  });
});

describe("5.3.3 文件索引", () => {
  it("8100 份文件时逐行查同类和旧版仍很快", async () => {
    const s = await sample();
    const base = s.data.documents[0];
    s.commit((d) => {
      for (let i = 0; i < 8100; i++) d.documents.push({ ...base, id: `bulk-${i}`, typeID: `t${i % 40}`, owner: { kind: "company", id: d.companies[i % d.companies.length].id }, supersededBy: i % 10 === 0 ? `bulk-${i + 1}` : undefined } as typeof base);
    });
    const t0 = performance.now();
    let n = 0;
    for (const d of s.data.documents) { n += s.siblingsOf(d).length + s.olderCountOf(d); }
    const ms = performance.now() - t0;
    expect(n).toBeGreaterThan(0);
    expect(ms).toBeLessThan(150);
    expect(s.olderCountOf(s.data.documents.find((d) => d.id === "bulk-1")!)).toBe(1);
  });
});
