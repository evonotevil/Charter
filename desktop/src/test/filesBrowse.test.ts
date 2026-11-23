import { describe, expect, it } from "vitest";
import { chooseFilesScope, initialFilesBrowseView, setFilesGroupsOpen } from "../state/filesBrowse";

describe("文件归属浏览", () => {
  it("具体归属的收起操作不会改写原来展开的两家公司", () => {
    let view = chooseFilesScope(initialFilesBrowseView(), "company");
    view = setFilesGroupsOpen(view, ["company:a", "company:b"], "expanded", true);
    view = chooseFilesScope(view, "company:a");
    view = setFilesGroupsOpen(view, ["company:a"], "collapsedMatches", false);
    const restored = chooseFilesScope(view, view.broadScope);
    expect(restored.scope).toBe("company");
    expect([...restored.expanded]).toEqual(["company:a", "company:b"]);
    expect(restored.collapsedMatches.size).toBe(0);
  });

  it("搜索中展开或收起同名的公司和人员，不会覆盖需处理视图的分组", () => {
    let view = setFilesGroupsOpen(initialFilesBrowseView(), ["company:1"], "collapsedMatches", false);
    view = setFilesGroupsOpen(view, ["person:1"], "collapsedSearch", false);
    expect([...view.collapsedSearch]).toEqual(["person:1"]);
    expect([...view.collapsedMatches]).toEqual(["company:1"]);
    expect(view.expanded.size).toBe(0);
  });

  it("部分展开时可展开其余归属，批量折叠只影响当前结果", () => {
    const keys = ["company:1", "company:2"];
    const original = setFilesGroupsOpen(initialFilesBrowseView(), ["company:1", "person:1"], "expanded", true);
    const opened = setFilesGroupsOpen(original, keys, "expanded", true);
    expect([...opened.expanded].sort()).toEqual(["company:1", "company:2", "person:1"]);
    expect([...setFilesGroupsOpen(opened, keys, "expanded", false).expanded]).toEqual(["person:1"]);
    expect([...original.expanded]).toEqual(["company:1", "person:1"]);
  });

  it.each(["collapsedMatches", "collapsedSearch"] as const)("筛选分组 %s 批量操作保持原浏览状态", (field) => {
    const browse = setFilesGroupsOpen(initialFilesBrowseView(), ["company:a"], "expanded", true);
    const folded = setFilesGroupsOpen(browse, ["company:a", "person:a"], field, false);
    expect(folded[field].size).toBe(2);
    const restored = setFilesGroupsOpen(folded, ["company:a", "person:a"], field, true);
    expect(restored[field].size).toBe(0);
    expect(restored.expanded).toEqual(browse.expanded);
  });
});
