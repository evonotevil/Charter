import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { installSampleData } from "../state/sample";
import { normHolding, normAppointment } from "../domain/normalize";
import { rolesFor, guessRole } from "../domain/roles";
import * as D from "../domain/day";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");
async function fresh() {
  const p = new MemoryPlatform(templates);
  setPlatform(p);
  const s = new Store("/Charter");
  await s.load();
  await installSampleData(s);
  return s;
}

describe("4.4 可信台账", () => {
  it("migrates pre-4.4 holdings to 待核实 with the old date as 资料截至", () => {
    const h = normHolding({ id: "h", holder: { kind: "person", id: "p" }, companyID: "c", percent: 100, from: "2020-01-01" });
    expect(h.verified).toBe(false);
    expect(h.asOf).toBe("2020-01-01");
    expect(h.from).toBeUndefined();
    expect(normHolding(h as any)).toEqual(h);
    const a = normAppointment({ id: "a", personID: "p", companyID: "c", title: "董事", from: "2021-02-02" });
    expect(a.asOf).toBe("2021-02-02");
  });

  it("backfill never creates change-triggered obligations", async () => {
    const s = await fresh();
    const c = s.createCompany("测试香港有限公司", "HK");
    const before = s.openObligations.filter((o) => o.company.id === c.id).length;
    s.recordHolding({ companyID: c.id, percent: 10, holder: { kind: "newPerson", name: "测试股东" }, backfill: true, asOf: "2024-06-30", verified: false });
    expect(s.openObligations.filter((o) => o.company.id === c.id).length).toBe(before);
    const ch = s.data.changes[s.data.changes.length - 1];
    expect(ch.backfill).toBe(true);
    expect(ch.effectiveUnknown).toBe(true);
  });

  it("verified needs evidence", async () => {
    const s = await fresh();
    const h = s.data.holdings[0];
    s.setProvenance("holding", h.id, { verified: true });
    expect(s.data.holdings[0].verified).toBe(false);
    s.setProvenance("holding", h.id, { evidence: { documentID: "doc", page: "3" }, verified: true });
    expect(s.data.holdings.find((x) => x.id === h.id)!.verified).toBe(true);
  });

  it("new companies must carry the jurisdiction they were given", async () => {
    const s = await fresh();
    const c = s.createCompany("测试母公司", "KY");
    s.recordHolding({ companyID: c.id, percent: 5, holder: { kind: "newCompany", entity: { name: "远澜测试（香港）有限公司", jurisdiction: "HK" } }, backfill: false, effectiveOn: s.today, verified: false });
    expect(s.data.companies.find((x) => x.name === "远澜测试（香港）有限公司")!.jurisdiction).toBe("HK");
    expect(s.suggestJurisdiction("远澜测试（香港）有限公司")?.code).toBe("HK");
    expect(s.suggestJurisdiction("Foo Pte. Ltd.")?.code).toBe("SG");
    expect(s.suggestJurisdiction("Foo Holdings")).toBeNull();
  });

  it("role table by jurisdiction and entity form", () => {
    expect(rolesFor("JP", "合同会社").map((r) => r.name)).toContain("職務執行者");
    expect(rolesFor("JP", "株式会社").map((r) => r.name)).not.toContain("社員");
    expect(guessRole("Company Secretary", "SG")?.id).toBe("common.secretary");
    expect(D.daysBetween("2026-01-01", "2026-01-31")).toBe(30);
  });
});
