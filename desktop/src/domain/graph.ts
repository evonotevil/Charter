// 股权结构图：分层布局、正交连线、链路高亮。移植自 StructureSnapshot / EdgeRouter / GraphInteraction。

import * as D from "./day";
import type { Day } from "./day";
import { type Company, type GraphPoint, type Holding, type NodeRef, isActiveOn, ref, refKey, sameRef } from "./models";

export interface Pt { x: number; y: number }
export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; w: number; h: number }
const minX = (r: Rect) => r.x, maxX = (r: Rect) => r.x + r.w, minY = (r: Rect) => r.y, maxY = (r: Rect) => r.y + r.h;
const midX = (r: Rect) => r.x + r.w / 2;

export const companySize: Size = { width: 280, height: 70 };
export const personSize: Size = { width: 170, height: 56 };
export const sizeOf = (n: NodeRef) => (n.kind === "company" ? companySize : personSize);

export interface StructureSnapshot {
  asOf: Day;
  companies: Company[];
  activeHoldings: Holding[];
  nodes: NodeRef[];
  positions: Map<string, Pt>;
  canvas: Size;
  totalsByCompany: Map<string, number>;
}

export function timelineStops(holdings: Holding[], companyIDs: Set<string>, today: Day): Day[] {
  const scoped = holdings.filter((h) => companyIDs.has(h.companyID));
  const years = new Set<number>();
  for (const h of scoped) {
    if (h.from) years.add(D.year(h.from));
    if (h.to) years.add(D.year(h.to));
  }
  return [...years].filter((y) => y < D.year(today)).sort((a, b) => a - b).map((y) => D.makeDay(y, 12, 31)).concat([today]);
}

export function layers(nodes: NodeRef[], holdings: Holding[]): Map<string, number> {
  const level = new Map<string, number>();
  for (const n of nodes) level.set(refKey(n), 0);
  for (let i = 0; i < Math.max(nodes.length, 1); i++) {
    let changed = false;
    for (const h of holdings) {
      const p = level.get(refKey(h.holder));
      const ck = refKey(ref("company", h.companyID));
      const c = level.get(ck);
      if (p === undefined || c === undefined) continue;
      if (c < p + 1 && p + 1 < nodes.length + 1) { level.set(ck, p + 1); changed = true; }
    }
    if (!changed) break;
  }
  return level;
}

export function buildSnapshot(args: {
  companies: Company[]; holdings: Holding[]; scope: Set<string> | null; asOf: Day;
  names: Map<string, string>; savedPositions: Map<string, GraphPoint>;
}): StructureSnapshot {
  const { asOf, names, savedPositions } = args;
  const companies = args.companies.filter((c) =>
    (!args.scope || args.scope.has(c.id)) && (!c.incorporationDate || c.incorporationDate <= asOf) && c.status !== "dissolved");
  const ids = new Set(companies.map((c) => c.id));
  const active = args.holdings.filter((h) => isActiveOn(h, asOf) && ids.has(h.companyID));

  const nodes: NodeRef[] = [];
  const seen = new Set<string>();
  for (const h of active) if (!seen.has(refKey(h.holder))) { seen.add(refKey(h.holder)); nodes.push(h.holder); }
  for (const c of companies) { const r = ref("company", c.id); if (!seen.has(refKey(r))) { seen.add(refKey(r)); nodes.push(r); } }

  const incoming = new Map<string, Holding[]>();
  for (const h of active) incoming.set(h.companyID, [...(incoming.get(h.companyID) ?? []), h]);
  const totals = new Map<string, number>();
  for (const [k, hs] of incoming) totals.set(k, hs.reduce((a, h) => a + h.percent, 0));
  const lv = layers(nodes, active);
  const maxLevel = Math.max(0, ...lv.values());
  const rows: NodeRef[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const n of nodes) rows[lv.get(refKey(n)) ?? 0].push(n);

  const positions = new Map<string, Pt>();
  const stepX = 320, stepY = 170, top = 70;
  const widest = Math.max(1, ...rows.map((r) => r.length));
  const width = Math.max(widest * stepX + 80, 600);
  const BIG = Number.MAX_VALUE / 2;
  rows.forEach((row, rowIndex) => {
    const bary = new Map<string, number>();
    for (const n of row) {
      if (n.kind !== "company") { bary.set(refKey(n), BIG); continue; }
      const xs = (incoming.get(n.id) ?? []).map((h) => positions.get(refKey(h.holder))?.x).filter((x): x is number => x !== undefined);
      bary.set(refKey(n), xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : BIG);
    }
    const ordered = [...row].sort((l, r) => {
      const a = bary.get(refKey(l)) ?? BIG, b = bary.get(refKey(r)) ?? BIG;
      if (a === b) return (names.get(refKey(l)) ?? "").localeCompare(names.get(refKey(r)) ?? "");
      return a - b;
    });
    const rowWidth = ordered.length * stepX;
    ordered.forEach((n, col) => positions.set(refKey(n), { x: (width - rowWidth) / 2 + stepX * (col + 0.5), y: top + stepY * rowIndex }));
  });

  let mx = width, my = top + stepY * maxLevel + 80;
  for (const n of nodes) {
    const saved = savedPositions.get(refKey(n));
    if (saved) positions.set(refKey(n), { x: saved.x, y: saved.y });
    const p = positions.get(refKey(n));
    if (p) {
      const s = sizeOf(n);
      mx = Math.max(mx, p.x + s.width / 2 + 40);
      my = Math.max(my, p.y + s.height / 2 + 40);
    }
  }
  return { asOf, companies, activeHoldings: active, nodes, positions, canvas: { width: mx, height: my }, totalsByCompany: totals };
}

// MARK: - 连线

export interface Route { points: Pt[]; label: Pt; curved: boolean }
const laneGap = 9, entryLength = 34, endGap = 24;
interface Segment { source: string; vertical: boolean; at: number; lo: number; hi: number }

function groupBy<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) { const k = key(x); m.set(k, [...(m.get(k) ?? []), x]); }
  return m;
}

export function routeEdges(holdings: Holding[], positions: Map<string, Pt>): Map<string, Route> {
  const rects = new Map<string, Rect>();
  for (const [k, p] of positions) {
    const s = k.startsWith("company:") ? companySize : personSize;
    rects.set(k, { x: p.x - s.width / 2, y: p.y - s.height / 2, w: s.width, h: s.height });
  }
  const tk = (h: Holding) => refKey(ref("company", h.companyID));
  const hk = (h: Holding) => refKey(h.holder);
  const valid = holdings.filter((h) => rects.has(hk(h)) && rects.has(tk(h))).sort((a, b) => (a.id < b.id ? -1 : 1));
  const R = (k: string) => rects.get(k)!;

  const entryX = new Map<string, number>();
  for (const hs of groupBy(valid, (h) => h.companyID).values()) {
    const b = R(tk(hs[0]));
    const sorted = [...hs].sort((x, y) => {
      const a1 = midX(R(hk(x))), b1 = midX(R(hk(y)));
      return a1 === b1 ? (x.id < y.id ? -1 : 1) : a1 - b1;
    });
    const n = sorted.length;
    const spacing = n > 1 ? Math.min(64, (b.w - 60) / (n - 1)) : 0;
    sorted.forEach((h, k) => entryX.set(h.id, midX(b) + (k - (n - 1) / 2) * spacing));
  }

  const trackY = new Map<string, number>();
  const bands = groupBy(valid, (h) => Math.round(minY(R(tk(h))) / 24));
  for (const key of [...bands.keys()].sort((a, b) => a - b)) {
    const hs = bands.get(key)!;
    const bandTop = Math.min(...hs.map((h) => minY(R(tk(h)))));
    const bySource = groupBy(hs, hk);
    const intervals = [...bySource.entries()].map(([source, edges]) => {
      const xs = [...edges.map((e) => entryX.get(e.id)!), midX(R(source))];
      return { source, lo: Math.min(...xs) - 44, hi: Math.max(...xs) + 44 };
    }).sort((a, b) => (a.lo === b.lo ? (a.source < b.source ? -1 : 1) : a.lo - b.lo));
    const ends: number[] = [];
    const trackOf = new Map<string, number>();
    for (const iv of intervals) {
      const t = ends.findIndex((e) => e + laneGap < iv.lo);
      if (t >= 0) { trackOf.set(iv.source, t); ends[t] = iv.hi; }
      else { trackOf.set(iv.source, ends.length); ends.push(iv.hi); }
    }
    for (const h of hs) {
      const y = bandTop - entryLength - (trackOf.get(hk(h)) ?? 0) * laneGap;
      trackY.set(h.id, Math.max(y, maxY(R(hk(h))) + 12));
    }
  }

  const segments: Segment[] = valid.map((h) => {
    const y2 = minY(R(tk(h)));
    return { source: hk(h), vertical: true, at: entryX.get(h.id)!, lo: trackY.get(h.id) ?? y2 - entryLength, hi: y2 };
  });
  const obstacles = (a: string, b: string): Rect[] =>
    [...rects.entries()].filter(([k]) => k !== a && k !== b).map(([, r]) => ({ x: r.x - 10, y: r.y - 8, w: r.w + 20, h: r.h + 16 }));
  const vFree = (x: number, ya: number, yb: number, source: string, obs: Rect[]) => {
    const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
    if (obs.some((r) => minX(r) < x && x < maxX(r) && minY(r) < hi && lo < maxY(r))) return false;
    return !segments.some((s) => s.vertical && s.source !== source && Math.abs(s.at - x) < laneGap - 1 && s.lo < hi + endGap && lo - endGap < s.hi);
  };
  const hFree = (y: number, xa: number, xb: number, source: string, obs: Rect[]) => {
    const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
    if (obs.some((r) => minY(r) < y && y < maxY(r) && minX(r) < hi && lo < maxX(r))) return false;
    return !segments.some((s) => !s.vertical && s.source !== source && Math.abs(s.at - y) < laneGap - 1 && s.lo < hi + endGap && lo - endGap < s.hi);
  };
  const register = (pts: Pt[], source: string) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (Math.abs(a.x - b.x) < 0.5) segments.push({ source, vertical: true, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
      else if (Math.abs(a.y - b.y) < 0.5) segments.push({ source, vertical: false, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    }
  };

  const out = new Map<string, Route>();
  const sources = [...groupBy(valid, hk).entries()].sort(([ka], [kb]) => {
    const a = R(ka), b = R(kb);
    if (minY(a) !== minY(b)) return minY(a) - minY(b);
    if (midX(a) !== midX(b)) return midX(a) - midX(b);
    return ka < kb ? -1 : 1;
  });
  for (const [source, edges] of sources) {
    const a = R(source);
    const y1 = maxY(a);
    const ordered = [...edges].sort((x, y) => {
      const tx = trackY.get(x.id) ?? 0, ty = trackY.get(y.id) ?? 0;
      return tx !== ty ? tx - ty : (entryX.get(x.id) ?? 0) - (entryX.get(y.id) ?? 0);
    });
    const tys = ordered.map((h) => trackY.get(h.id)).filter((x): x is number => x !== undefined);
    const deepest = tys.length ? Math.max(...tys) : y1 + 20;
    const dropObs = obstacles(source, source);
    const dropX = [0, 1, -1, 2, -2, 3, -3].map((k) => midX(a) + k * laneGap * 1.5)
      .find((x) => vFree(x, y1, deepest, source, dropObs)) ?? midX(a);
    for (const h of ordered) {
      const bKey = tk(h);
      const b = R(bKey);
      const ex = entryX.get(h.id)!, y2 = minY(b);
      const label = { x: ex, y: y2 - 15 };
      const yT = trackY.get(h.id);
      if (yT === undefined || !(y2 - y1 > entryLength + 10)) {
        out.set(h.id, { points: [{ x: midX(a), y: y1 }, { x: ex, y: y2 }], label, curved: true });
        continue;
      }
      const obs = obstacles(source, bKey);
      let pts: Pt[];
      if (vFree(dropX, y1, yT, source, obs) && hFree(yT, dropX, ex, source, obs)) {
        pts = [{ x: dropX, y: y1 }, { x: dropX, y: yT }, { x: ex, y: yT }, { x: ex, y: y2 }];
      } else {
        const yA = y1 + 16;
        const cands: number[] = [];
        for (const r of obs) for (let k = 0; k < 4; k++) { cands.push(minX(r) - 4 - k * laneGap); cands.push(maxX(r) + 4 + k * laneGap); }
        const ok = cands.filter((gx) => hFree(yA, dropX, gx, source, obs) && vFree(gx, yA, yT, source, obs) && hFree(yT, gx, ex, source, obs));
        const best = ok.length ? ok.reduce((m, g) => (Math.abs(g - dropX) + Math.abs(g - ex) < Math.abs(m - dropX) + Math.abs(m - ex) ? g : m)) : undefined;
        pts = best !== undefined
          ? [{ x: dropX, y: y1 }, { x: dropX, y: yA }, { x: best, y: yA }, { x: best, y: yT }, { x: ex, y: yT }, { x: ex, y: y2 }]
          : [{ x: dropX, y: y1 }, { x: dropX, y: yT }, { x: ex, y: yT }, { x: ex, y: y2 }];
      }
      register(pts, source);
      out.set(h.id, { points: pts, label, curved: false });
    }
  }
  return out;
}

/** 折线转 SVG 圆角路径（坐标已乘缩放）。 */
export function routePath(route: Route, z = 1, radius = 12): string {
  let pts: Pt[] = [];
  for (const p of route.points) {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) pts.push(p);
  }
  let k = 1;
  while (k < pts.length - 1) {
    const a = pts[k - 1], m = pts[k], c = pts[k + 1];
    if (Math.abs((m.x - a.x) * (c.y - a.y) - (m.y - a.y) * (c.x - a.x)) < 0.5) pts.splice(k, 1); else k++;
  }
  pts = pts.map((p) => ({ x: p.x * z, y: p.y * z }));
  if (pts.length < 2) return "";
  const f = pts[0], l = pts[pts.length - 1];
  if (route.curved) {
    const my = (f.y + l.y) / 2;
    return `M${f.x},${f.y} C${f.x},${my} ${l.x},${my} ${l.x},${l.y}`;
  }
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  let d = `M${f.x},${f.y}`;
  const r0 = radius * z;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const r = Math.min(r0, dist(p, c) / 2, dist(c, n) / 2);
    if (r < 1) { d += ` L${c.x},${c.y}`; continue; }
    const inX = c.x - Math.sign(c.x - p.x) * r, inY = c.y - Math.sign(c.y - p.y) * r;
    const outX = c.x + Math.sign(n.x - c.x) * r, outY = c.y + Math.sign(n.y - c.y) * r;
    d += ` L${inX},${inY} Q${c.x},${c.y} ${outX},${outY}`;
  }
  return d + ` L${l.x},${l.y}`;
}

/** 某节点的控制链：所有上游与下游节点和连线。 */
export function focusChain(focus: NodeRef | null, holdings: Holding[]): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>(), edges = new Set<string>();
  if (!focus) return { nodes, edges };
  nodes.add(refKey(focus));
  const ancestors = new Set<string>();
  const up = (n: NodeRef) => {
    if (n.kind !== "company" || ancestors.has(refKey(n))) return;
    ancestors.add(refKey(n));
    for (const h of holdings) {
      if (h.companyID !== n.id) continue;
      edges.add(h.id); nodes.add(refKey(h.holder)); up(h.holder);
      if (h.isNominee && h.beneficialOwner) { nodes.add(refKey(h.beneficialOwner)); up(h.beneficialOwner); }
    }
  };
  up(focus);
  const queue = [focus];
  const visited = new Set([refKey(focus)]);
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    for (const h of holdings) {
      if (!(sameRef(h.holder, n) || (h.isNominee && sameRef(h.beneficialOwner, n)))) continue;
      const t = ref("company", h.companyID);
      edges.add(h.id); nodes.add(refKey(h.holder)); nodes.add(refKey(t));
      if (!visited.has(refKey(t))) { visited.add(refKey(t)); queue.push(t); }
    }
  }
  return { nodes, edges };
}

export const clampZoom = (s: number) => Math.min(3, Math.max(0.2, s));
