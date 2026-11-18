import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");

async function fresh() {
  const platform = new MemoryPlatform(templates);
  setPlatform(platform);
  const store = new Store("/Charter");
  await store.load();
  await store.flushWrites();
  return { platform, store };
}

describe("5.5.7 设置规则自动保存", () => {
  it("模板库写入失败后保持内存草稿，并可从同一规则重试", async () => {
    const { platform, store } = await fresh();
    const originalWrite = platform.writeBytes.bind(platform);
    let fail = true;
    platform.writeBytes = async (path, data) => {
      if (fail && path.endsWith("/templates.json")) throw new Error("磁盘已满");
      return originalWrite(path, data);
    };
    const original = store.data.library.rules[0];
    const changed = { ...structuredClone(original), name: `${original.name}（已编辑）` };

    expect(await store.saveRuleAndWait(changed)).toBe(false);
    expect(store.data.library.rules[0].name).toBe(changed.name);
    expect(store.unsaved.has("library")).toBe(true);
    expect(store.ruleSaveFailed(changed.id)).toBe(true);
    expect(store.errorMessage).toBeNull();

    fail = false;
    expect(await store.saveRuleAndWait(changed, true)).toBe(true);
    expect(store.unsaved.has("library")).toBe(false);
    expect(store.ruleSaveFailed(changed.id)).toBe(false);
    expect(await platform.readText("/Charter/templates.json")).toContain(changed.name);

    fail = true;
    store.saveLibrary((library) => { library.jurisdictions[0].name += "（测试）"; });
    await store.flushWrites();
    expect(store.errorMessage).toContain("保存失败");
  });

  it("连续切换编辑目标时，各规则分别写入且不会串值", async () => {
    const { store } = await fresh();
    const first = { ...structuredClone(store.data.library.rules[0]), name: "规则甲" };
    const second = { ...structuredClone(store.data.library.rules[1]), name: "规则乙" };

    await Promise.all([store.saveRuleAndWait(first), store.saveRuleAndWait(second)]);
    expect(store.data.library.rules.find((r) => r.id === first.id)?.name).toBe("规则甲");
    expect(store.data.library.rules.find((r) => r.id === second.id)?.name).toBe("规则乙");
  });

  it("编辑普通字段不会用旧表单对象覆盖核实状态和修订记录", async () => {
    const { store } = await fresh();
    const original = store.data.library.rules[0];
    store.confirmRule(original.id, null, { status: "confirmed", confirmedOn: store.today, confirmedBy: "测试", sourceKind: "法规原文", source: "测试来源", conditions: "测试条件" });
    const afterConfirm = structuredClone(store.data.library.rules[0]);
    const draft = { ...structuredClone(original), name: `${original.name}（改名）` };

    expect(await store.saveRuleAndWait(draft)).toBe(true);
    const saved = store.data.library.rules[0];
    expect(saved.name).toBe(draft.name);
    expect(saved.verification).toEqual(afterConfirm.verification);
    expect(saved.revisions).toEqual(afterConfirm.revisions);
  });
});
