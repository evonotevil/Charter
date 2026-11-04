import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { installSampleData } from "../state/sample";
import { checkTitle, holderStatusLabel } from "../screens/Structure";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");
async function sample() {
  setPlatform(new MemoryPlatform(templates));
  const s = new Store("/Charter"); await s.load(); await installSampleData(s);
  return s;
}

describe("5.4.2 股东核对", () => {
  it("合计满 100% 但缺生效日期：状态直接写原因，计数口径一致", async () => {
    const s = await sample();
    const c = s.data.companies.find((x) => s.shareholderCheckApplies(x) && s.shareholderStatus(x.id).kind === "complete")!;
    expect(c).toBeTruthy();
    const before = s.incompleteShareholderCount(null);
    s.commit((d) => { for (const h of d.holdings) if (h.companyID === c.id) h.from = undefined; });
    const st = s.shareholderStatus(c.id);
    expect(st.kind).toBe("pending");
    expect(holderStatusLabel(st)).toBe("缺生效日期");
    expect(s.incompleteShareholderCount(null)).toBe(before + 1);
  });
  it("标题按问题拆开", () => {
    expect(checkTitle([])).toBe("股东都已录入完整");
    expect(checkTitle([{ kind: "missing" }, { kind: "partial", total: 50 }, { kind: "pending", reasons: ["x"], short: ["缺生效日期"] }])).toBe("缺股东 2 家 · 股东信息待补 1 家");
    expect(checkTitle([{ kind: "pending", reasons: ["x"], short: ["a", "b"] }])).toBe("股东信息待补 1 家");
    expect(holderStatusLabel({ kind: "pending", reasons: ["x", "y"], short: ["代持未填受益人", "缺生效日期"] })).toBe("代持未填受益人 等 2 项");
  });
});
