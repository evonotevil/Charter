// 股权结构图（5.1）：分层布局 + 交叉最少的排序 + 父子居中对齐；共用的公司只画一次。
// 节点 220×60；连线从上级底边中点竖直向下，在下级上方的“汇线”转弯，进入下级顶边。

import { type Holding, type NodeRef, ref, refKey } from "./models";

export const NODE_W = 220, NODE_H = 60, GAP_X = 36, ROW_STEP = 150;
const PAD = 48;

export interface TreeNode { key: string; ref: NodeRef; layer: number; x: number; y: number; children: string[]; parents: string[]; hiddenBelow: number }
export interface TreeEdge { id: string; holding: Holding; from: string; to: string; path: string; label: { x: number; y: number }; points: { x: number; y: number }[] }
export interface TreeLayout { nodes: Map<string, TreeNode>; edges: TreeEdge[]; width: number; height: number; layers: string[][]; roots: string[] }

/** 只看 focus 的上下游（“以它为中心”）。 */
export function chainOf(focus: string, holdings: Holding[]): Set<string> {
  const out = new Set([focus]);
  const up = (k: string) => { for (const h of holdings) if ("company:" + h.companyID === k) { const p = refKey(h.holder); if (!out.has(p)) { out.add(p); up(p); } } };
  const down = (k: string) => { for (const h of holdings) if (refKey(h.holder) === k) { const c = "company:" + h.companyID; if (!out.has(c)) { out.add(c); down(c); } } };
  up(focus); down(focus);
  return out;
}

export function layoutTree(args: { nodes: NodeRef[]; holdings: Holding[]; collapsed: Set<string>; names: Map<string, string>; only?: Set<string> | null }): TreeLayout {
  const { collapsed, names } = args;
  const all = args.nodes.filter((n) => !args.only || args.only.has(refKey(n)));
  const keys = new Set(all.map(refKey));
  const hs = args.holdings.filter((h) => keys.has(refKey(h.holder)) && keys.has("company:" + h.companyID) && refKey(h.holder) !== "company:" + h.companyID);
  const kids = new Map<string, string[]>(), pars = new Map<string, string[]>();
  for (const k of keys) { kids.set(k, []); pars.set(k, []); }
  for (const h of hs) {
    const p = refKey(h.holder), c = "company:" + h.companyID;
    if (!kids.get(p)!.includes(c)) kids.get(p)!.push(c);
    if (!pars.get(c)!.includes(p)) pars.get(c)!.push(p);
  }
  const byName = (a: string, b: string) => (names.get(a) ?? "").localeCompare(names.get(b) ?? "", "zh");

  // 1. 可见节点：从顶层往下走，折叠的节点不展开。没有被走到的（循环持股）也显示。
  let roots = [...keys].filter((k) => !pars.get(k)!.length).sort(byName);
  if (!roots.length && keys.size) roots = [[...keys].sort(byName)[0]];
  const visible = new Set<string>();
  const order: string[] = [];
  const walk = (k: string) => {
    if (visible.has(k)) return;
    visible.add(k); order.push(k);
    if (collapsed.has(k)) return;
    for (const c of [...kids.get(k)!].sort(byName)) walk(c);
  };
  roots.forEach(walk);
  for (const k of [...keys].sort(byName)) if (!visible.has(k) && pars.get(k)!.every((p) => !visible.has(p) || !collapsed.has(p))) {
    // 循环中的节点：只有当它的上级都没有被折叠时才补上
    if (pars.get(k)!.some((p) => visible.has(p) && !collapsed.has(p)) || !pars.get(k)!.some((p) => visible.has(p))) walk(k);
  }
  const vKids = (k: string) => (collapsed.has(k) ? [] : kids.get(k)!.filter((c) => visible.has(c)));
  const vPars = (k: string) => pars.get(k)!.filter((p) => visible.has(p) && !collapsed.has(p));

  // 2. 分层：最长路径；顶层的人和公司往下贴近自己的下级。
  const layer = new Map<string, number>();
  for (const k of visible) layer.set(k, 0);
  for (let i = 0; i <= visible.size; i++) {
    let changed = false;
    for (const k of visible) for (const c of vKids(k)) {
      const want = layer.get(k)! + 1;
      if (layer.get(c)! < want && want <= visible.size) { layer.set(c, want); changed = true; }
    }
    if (!changed) break;
  }
  for (const k of order) if (!vPars(k).length) {
    const cs = vKids(k);
    if (cs.length) layer.set(k, Math.max(0, Math.min(...cs.map((c) => layer.get(c)!)) - 1));
  }
  const maxLayer = Math.max(0, ...layer.values());
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const k of order) layers[layer.get(k)!].push(k);

  // 3. 排序：重心法上下各扫几遍，减少交叉。
  const pos = new Map<string, number>();
  const index = () => layers.forEach((row) => row.forEach((k, i) => pos.set(k, i)));
  index();
  const bary = (k: string, nb: string[]) => (nb.length ? nb.reduce((s, x) => s + pos.get(x)!, 0) / nb.length : pos.get(k)!);
  for (let it = 0; it < 6; it++) {
    const down = it % 2 === 0;
    const seq = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const row of seq) {
      const b = new Map(row.map((k) => [k, bary(k, down ? vPars(k) : vKids(k))]));
      row.sort((a, c) => b.get(a)! - b.get(c)! || pos.get(a)! - pos.get(c)!);
      row.forEach((k, i) => pos.set(k, i));
    }
  }

  // 4. 横坐标：先等距，再让上级居中于下级、下级靠近上级；同层按顺序保持最小间距（块合并）。
  const step = NODE_W + GAP_X;
  const X = new Map<string, number>();
  layers.forEach((row) => row.forEach((k, i) => X.set(k, i * step)));
  const place = (row: string[], want: Map<string, number>) => {
    // 块合并：相邻重叠的节点合成一块，块的位置取各自期望的平均
    type Block = { start: number; keys: string[]; sum: number };
    const blocks: Block[] = [];
    for (const k of row) {
      let b: Block = { start: want.get(k)!, keys: [k], sum: want.get(k)! };
      blocks.push(b);
      while (blocks.length > 1) {
        const prev = blocks[blocks.length - 2];
        if (prev.start + prev.keys.length * step <= b.start) break;
        blocks.pop();
        prev.keys.push(...b.keys); prev.sum += b.sum - b.keys.length * 0;
        // 块内第 i 个节点的期望起点 = want - i*step；块起点取平均
        let s = 0; prev.keys.forEach((kk, i) => { s += want.get(kk)! - i * step; });
        prev.start = s / prev.keys.length;
        b = prev;
      }
    }
    for (const b of blocks) b.keys.forEach((k, i) => X.set(k, b.start + i * step));
  };
  for (let it = 0; it < 8; it++) {
    const down = it % 2 === 0;
    const seq = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const row of seq) {
      const want = new Map<string, number>();
      for (const k of row) {
        const nb = down ? vPars(k) : vKids(k);
        want.set(k, nb.length ? nb.reduce((s, x) => s + X.get(x)!, 0) / nb.length : X.get(k)!);
      }
      place(row, want);
    }
  }
  const minX = Math.min(0, ...X.values());
  let maxX = 0;
  const nodes = new Map<string, TreeNode>();
  for (const k of order) {
    const x = X.get(k)! - minX + PAD + NODE_W / 2, y = PAD + layer.get(k)! * ROW_STEP + NODE_H / 2;
    maxX = Math.max(maxX, x + NODE_W / 2);
    const hidden = collapsed.has(k) ? countBelow(k, kids) : 0;
    const [kind, id] = k.split(":") as ["company" | "person", string];
    nodes.set(k, { key: k, ref: ref(kind, id), layer: layer.get(k)!, x, y, children: vKids(k), parents: vPars(k), hiddenBelow: hidden });
  }

  // 5. 连线
  const edges: TreeEdge[] = [];
  const incoming = new Map<string, Holding[]>();
  for (const h of hs) {
    const p = refKey(h.holder), c = "company:" + h.companyID;
    if (!nodes.has(p) || !nodes.has(c) || collapsed.has(p)) continue;
    incoming.set(c, [...(incoming.get(c) ?? []), h]);
  }
  for (const [c, list] of incoming) {
    const cn = nodes.get(c)!;
    list.sort((a, b) => nodes.get(refKey(a.holder))!.x - nodes.get(refKey(b.holder))!.x);
    const spread = Math.min(84, (NODE_W - 24) / Math.max(1, list.length - 1));
    list.forEach((h, i) => {
      const pn = nodes.get(refKey(h.holder))!;
      const ex = cn.x + (list.length > 1 ? (i - (list.length - 1) / 2) * spread : 0);
      const top = cn.y - NODE_H / 2, bottom = pn.y + NODE_H / 2;
      const adjacent = cn.layer === pn.layer + 1;
      const bus = adjacent ? bottom + (top - bottom) / 2 : top - 34;
      const pts = Math.abs(pn.x - ex) < 1 ? [{ x: pn.x, y: bottom }, { x: ex, y: top }]
        : [{ x: pn.x, y: bottom }, { x: pn.x, y: bus }, { x: ex, y: bus }, { x: ex, y: top }];
      edges.push({ id: h.id, holding: h, from: refKey(h.holder), to: c, path: roundedPath(pts, 10), label: { x: ex, y: top - 15 }, points: pts });
    });
  }
  const height = PAD * 2 + maxLayer * ROW_STEP + NODE_H + 30;
  return { nodes, edges, width: Math.max(maxX + PAD, 400), height, layers, roots: roots.filter((r) => nodes.has(r)) };
}

function countBelow(k: string, kids: Map<string, string[]>): number {
  const seen = new Set<string>();
  const go = (x: string) => { for (const c of kids.get(x) ?? []) if (!seen.has(c)) { seen.add(c); go(c); } };
  go(k);
  return seen.size;
}

export function roundedPath(pts: { x: number; y: number }[], radius: number): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const r = Math.min(radius, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    if (r < 1) { d += ` L${c.x},${c.y}`; continue; }
    const ix = c.x - Math.sign(c.x - p.x) * r, iy = c.y - Math.sign(c.y - p.y) * r;
    const ox = c.x + Math.sign(n.x - c.x) * r, oy = c.y + Math.sign(n.y - c.y) * r;
    d += ` L${ix},${iy} Q${c.x},${c.y} ${ox},${oy}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l.x},${l.y}`;
}

export const pathLength = (pts: { x: number; y: number }[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
