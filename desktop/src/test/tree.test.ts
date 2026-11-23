import { describe, expect, it } from "vitest";
import { layoutTree, NODE_W } from "../domain/tree";
import { ref, type Holding } from "../domain/models";

const h = (id: string, holder: [ "company" | "person", string ], company: string, percent = 100): Holding =>
  ({ id, holder: ref(holder[0], holder[1]), companyID: company, percent, isNominee: false, verified: true } as unknown as Holding);

describe("结构图布局", () => {
  const holdings = [
    h("1", ["person", "p"], "A"), h("2", ["company", "A"], "B", 60), h("3", ["company", "A"], "C"),
    h("4", ["company", "B"], "D", 50), h("5", ["company", "C"], "D", 50), h("6", ["company", "C"], "E"),
  ];
  const nodes = [ref("person", "p"), ...["A", "B", "C", "D", "E"].map((x) => ref("company", x))];
  const names = new Map(nodes.map((n) => [`${n.kind}:${n.id}`, n.id]));

  it("共用公司只画一次，同层不重叠，上级在下级之上", () => {
    const t = layoutTree({ nodes, holdings, collapsed: new Set(), names });
    expect(t.nodes.size).toBe(6);
    expect(t.edges.length).toBe(6);
    for (const row of t.layers) {
      const xs = row.map((k) => t.nodes.get(k)!.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(NODE_W);
    }
    for (const e of t.edges) expect(t.nodes.get(e.from)!.y).toBeLessThan(t.nodes.get(e.to)!.y);
    expect(t.nodes.get("company:D")!.layer).toBe(3);
  });

  it("折叠后隐藏下级并记下数量", () => {
    const t = layoutTree({ nodes, holdings, collapsed: new Set(["company:C"]), names });
    expect(t.nodes.has("company:E")).toBe(false);
    expect(t.nodes.has("company:D")).toBe(true); // 仍经 B 可达
    expect(t.nodes.get("company:C")!.hiddenBelow).toBe(1);
    expect(t.edges.map((e) => e.id)).not.toContain("5");
  });

  it("顶层收起会隐藏后代；重新展开时保留下级原有的折叠", () => {
    const nested = layoutTree({ nodes, holdings, collapsed: new Set(["company:A", "company:C"]), names });
    expect([...nested.nodes.keys()].sort()).toEqual(["company:A", "person:p"]);
    expect(nested.nodes.get("company:A")!.hiddenBelow).toBe(3); // C 已收起，E 仍不显示
    const restored = layoutTree({ nodes, holdings, collapsed: new Set(["company:C"]), names });
    expect(restored.nodes.size - nested.nodes.size).toBe(3);
  });

  it("共有子公司始终可从开放的上级抵达，只收起连线也允许展开", () => {
    const one = layoutTree({ nodes, holdings, collapsed: new Set(["company:B"]), names });
    expect(one.nodes.get("company:B")).toMatchObject({ folded: true, hiddenBelow: 0 });
    expect(one.nodes.get("company:D")!.parents).toEqual(["company:C"]);
    const both = layoutTree({ nodes, holdings, collapsed: new Set(["company:B", "company:C"]), names });
    expect(both.nodes.has("company:D")).toBe(false);
    expect(both.nodes.get("company:B")!.hiddenBelow).toBe(1);
  });

  it("正常链与独立环共存时，环的下属不会被当成新的入口", () => {
    const cycle = [h("1", ["company", "B"], "C"), h("2", ["company", "C"], "B"), h("3", ["company", "C"], "A")];
    const t = layoutTree({ nodes, holdings: cycle, collapsed: new Set(["company:B"]), names });
    expect(t.roots).toContain("company:B");
    expect(t.nodes.has("company:C")).toBe(false);
    expect(t.nodes.has("company:A")).toBe(false);
    expect(t.nodes.get("company:B")!.hiddenBelow).toBe(2);
  });

  it("以某公司为中心只保留上下游", () => {
    const only = new Set(["person:p", "company:A", "company:B", "company:D"]);
    const t = layoutTree({ nodes, holdings, collapsed: new Set(), names, only });
    expect([...t.nodes.keys()].sort()).toEqual([...only].sort());
  });
});
