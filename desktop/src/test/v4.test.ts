import * as D from "../domain/day";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { installSampleData } from "../state/sample";
import { contactsOf } from "../domain/models";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");
async function fresh() {
  const p = new MemoryPlatform(templates); setPlatform(p);
  const s = new Store("/Charter"); await s.load(); await installSampleData(s); return s;
}

describe("Charter 4", () => {
  it("draws the shared holding company above both brands", async () => {
    const s = await fresh();
    const top = s.data.companies.find((c) => c.name.startsWith("Northstar"))!;
    expect(s.brandOf(top.id)).toBeUndefined();
    const ming = s.data.groups.find((g) => g.name === "明岸")!;
    const scope = s.brandScope(ming.id)!;
    const names = [...scope].map((id) => s.company(id)!.name);
    expect(names).toContain("Northstar Holdings Ltd.");
    expect(names).toContain("株式会社明岸ジャパン");
    expect(names).not.toContain("Yuanlan Group Ltd.");
  });
  it("creates a company in one step with a new holder and directors, and undoes it in one step", async () => {
    const s = await fresh();
    const before = { c: s.data.companies.length, p: s.data.people.length, h: s.data.holdings.length };
    const ming = s.data.groups.find((g) => g.name === "明岸")!;
    const c = s.createCompanyFull({ name: "Mingan Vietnam Co., Ltd.", jurisdiction: "SG", groupID: ming.id, percent: 100,
      holder: { kind: "newCompany", name: "Mingan SEA Holdings", jurisdiction: "VG" }, directors: ["张三", "Nguyen An"] });
    expect(s.data.companies.length).toBe(before.c + 2);
    expect(s.data.people.length).toBe(before.p + 1);
    expect(s.officers(c.id).length).toBe(2);
    expect(s.obligationsFor(c.id).length).toBeGreaterThan(0);
    expect(s.groupsContaining(c.id).map((g) => g.name)).toContain("明岸");
    s.undo();
    expect(s.data.companies.length).toBe(before.c);
    expect(s.data.holdings.length).toBe(before.h);
  });
  it("keeps several contacts per agent and a per-matter agent", async () => {
    const s = await fresh();
    const lion = s.data.parties.find((p) => p.name.startsWith("Lion"))!;
    expect(contactsOf(lion).map((c) => c.name)).toEqual(["Rachel Tan", "Jason Lim"]);
    const mas = s.data.companies.find((c) => c.name.startsWith("Mingan Singapore"))!;
    const tax = s.obligationsFor(mas.id).find((o) => o.rule.id === "sg.form-c");
    if (tax) expect(s.responsibleParty(tax)?.name).toBe("Kreston Tax Advisory");
  });
  it("completing a matter schedules the next one", async () => {
    const s = await fresh();
    const o = s.openObligations.find((x) => x.rule.schedule.kind !== "event" && x.rule.schedule.kind !== "documentExpiry")!;
    s.complete(o);
    expect(s.openObligations.some((x) => x.key === o.key)).toBe(false);
    const next = s.openObligations.find((x) => x.rule.id === o.rule.id && x.company.id === o.company.id);
    // 下一件只有落在 400 天排期范围内才会出现；测试不能依赖今天是哪天
    if (D.daysBetween(s.today, D.addMonths(o.due, 12)) <= 400) expect(next && next.due > o.due).toBe(true);
  });
});

describe("Charter 4.1 inline edits", () => {
  it("records changes and can undo them", async () => {
    const s = await fresh();
    const c = s.data.companies.find((x) => x.name.startsWith("Mingan Singapore"))!;
    const n0 = s.data.changes.length;
    s.editCompanyField(c, "registeredAddress", "1 Raffles Place", "注册地址");
    expect(s.company(c.id)!.registeredAddress).toBe("1 Raffles Place");
    expect(s.data.changes.length).toBe(n0 + 1);
    expect(s.data.changes[s.data.changes.length - 1].kind).toBe("addressChange");
    s.undo();
    expect(s.company(c.id)!.registeredAddress).toBe("");
    expect(s.data.changes.length).toBe(n0);
  });
  it("adds and ends officers with history, and date can be backfilled", async () => {
    const s = await fresh();
    const c = s.data.companies.find((x) => x.name.startsWith("Mingan Singapore"))!;
    const before = s.officers(c.id).length;
    s.addOfficer(c.id, "Nguyen An", "董事");
    expect(s.officers(c.id).length).toBe(before + 1);
    const a = s.officers(c.id).find((x) => s.person(x.personID)?.name === "Nguyen An")!;
    const ch = s.data.changes[s.data.changes.length - 1];
    expect(ch.kind).toBe("directorChange");
    s.setChangeDate(ch.id, "2026-09-01");
    expect(s.data.appointments.find((x) => x.id === a.id)!.from).toBe("2026-09-01");
    s.endAppointment(s.data.appointments.find((x) => x.id === a.id)!);
    expect(s.officers(c.id).length).toBe(before);
  });
  it("confirms or moves a due date", async () => {
    const s = await fresh();
    const o = s.openObligations[0];
    s.confirmDue(o, "2027-01-15");
    const o2 = s.allObligations.find((x) => x.key === o.key)!;
    expect(o2.due).toBe("2027-01-15");
    expect(o2.record?.dateConfirmed).toBe(true);
  });
  it("turns old internal departments into agents", async () => {
    const s = await fresh();
    expect(s.data.parties.every((p) => p.kind === "agent")).toBe(true);
  });
});
