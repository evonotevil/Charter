// 股权结构（5.1）：按设计系统的 StructureChart 重做。
// 节点是带 4px 底边的立体卡片，点阵背景；公司用方形法域徽章（按集团着色），个人用圆形紫色头像；
// 连线 2px 圆角折线，比例写在浅绿小胶囊里；待核实为虚线，代持为琥珀色。
// 点选节点高亮整条控制链并在右侧出摘要；双击打开。搜索并居中、折叠、以它为中心、键盘切换、导出图片；另有缩进列表视图。

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Day } from "../domain/day";
import * as D from "../domain/day";
import { type Company, type Holding, type NodeRef, isActiveOn, ref, refKey, latinPad } from "../domain/models";
import { percentLabel, portfolio } from "../domain/engine";
import { buildSnapshot, focusChain, timelineStops } from "../domain/graph";
import { NODE_H, NODE_W, type TreeLayout, chainOf, layoutTree, pathLength } from "../domain/tree";
import { useApp } from "../state/hooks";
import type { ShareholderStatus, Store } from "../state/store";
import { platform } from "../platform/platform";
import { installSampleData } from "../state/sample";
import { reducedMotion } from "../ui/motion";
import { Icon } from "../ui/Icon";
import { ActionMenu, Avatar, shortcutLabel, Button, Card, EmptyStateView, JurisdictionBadge, PageHeader, Pill, item, divider } from "../ui/kit";
import { companyTint } from "../ui/uistyle";
import { CompanyChips } from "./PropChips";
import { GroupFilter } from "./Companies";
import { leftText } from "./InfoCard";

// MARK: - 股东核对的展示

export const holderStatusLabel = (s: ShareholderStatus) => (s.kind === "missing" ? "没有股东" : s.kind === "partial" ? `合计 ${percentLabel(s.total)}` : s.kind === "pending" ? "待确认" : "完整");
export const holderStatusDetail = (s: ShareholderStatus) => s.kind === "missing" ? "还没有录入任何股东。"
  : s.kind === "partial" ? `已录入的股东合计 ${percentLabel(s.total)}，另有 ${percentLabel(Math.max(0, 100 - s.total))} 未录入。`
    : s.kind === "pending" ? s.reasons.join("；") + "。" : "股东比例合计 100%，信息齐全。";
export const holderStatusColor = (s: ShareholderStatus) => ({ missing: "var(--red)", partial: "var(--amber)", pending: "var(--amber-text)", complete: "var(--green)" })[s.kind];
const holderStatusTone = (s: ShareholderStatus) => (s.kind === "missing" ? "bad" : s.kind === "complete" ? "valid" : "warn") as "bad" | "valid" | "warn";

const viewKey = "structure.view";
const LEVEL_MS = 440;

type Xf = { x: number; y: number; k: number };
const clampK = (k: number) => Math.min(2.5, Math.max(0.25, k));

export function StructureView() {
  const { store, router } = useApp();
  const [view, setViewState] = useState<"chart" | "list">(() => (platform().prefGet(viewKey) === "list" ? "list" : "chart"));
  const setView = (v: "chart" | "list") => { setViewState(v); platform().prefSet(viewKey, v); };
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [center, setCenter] = useState<string | null>(null);
  const [personSel, setPersonSel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [stopIndex, setStopIndex] = useState<number | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const chartApi = useRef<{ centerOn: (k: string) => void; fit: () => void } | null>(null);

  const group = router.groupFilter;
  const dataVersion = [store.data.companies, store.data.holdings, store.data.groups, store.data.people, store.today] as const;
  const scope = (day?: Day) => store.brandScope(group, day);
  const stops = useMemo(() => timelineStops(store.data.holdings, scope() ?? new Set(store.data.companies.map((c) => c.id)), store.today), [group, ...dataVersion]);
  useEffect(() => { setStopIndex(null); setCenter(null); setCollapsed(new Set()); }, [group]);
  useEffect(() => { if (!showHistory) setStopIndex(null); }, [showHistory]);
  const asOf = showHistory && stops.length ? stops[Math.min(stopIndex ?? stops.length - 1, stops.length - 1)] : store.today;
  const isToday = asOf === store.today;

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of store.data.companies) m.set("company:" + c.id, c.name);
    for (const p of store.data.people) m.set("person:" + p.id, p.name);
    return m;
  }, [store.data.companies, store.data.people]);
  const snapshot = useMemo(() => buildSnapshot({ companies: store.data.companies, holdings: store.data.holdings, scope: scope(asOf), asOf, names, savedPositions: new Map() }), [asOf, group, ...dataVersion]);
  const allKeys = new Set(snapshot.nodes.map(refKey));
  const centerKey = center && allKeys.has(center) ? center : null;
  const layout = useMemo(() => layoutTree({ nodes: snapshot.nodes, holdings: snapshot.activeHoldings, collapsed, names, only: centerKey ? chainOf(centerKey, snapshot.activeHoldings) : null }),
    [snapshot, collapsed, centerKey, names]);

  const selectedKey = personSel && layout.nodes.has(personSel) ? personSel
    : router.selectedCompanyID && allKeys.has("company:" + router.selectedCompanyID) ? "company:" + router.selectedCompanyID : null;
  const select = (k: string | null) => {
    if (k?.startsWith("person:")) { setPersonSel(k); router.set("selectedCompanyID", null); }
    else { setPersonSel(null); router.set("selectedCompanyID", k ? k.slice(8) : null); }
  };
  const selRef = selectedKey ? toRef(selectedKey) : null;
  const chain = useMemo(() => focusChain(selRef, snapshot.activeHoldings), [selectedKey, snapshot]);
  const open = (k: string) => { const r = toRef(k); if (r.kind === "company") { router.companyTab = 0; router.openCompany(r.id); } else router.openPerson(r.id); };
  const toggleFold = (k: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // 搜索：名称、别名、注册编号
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => !q ? [] : snapshot.nodes.map(refKey).filter((k) => {
    const r = toRef(k);
    if (r.kind === "company") { const c = store.company(r.id); return !!c && [c.name, ...c.formerNames, ...c.aliases, c.registrationNumber].join(" ").toLowerCase().includes(q); }
    const p = store.person(r.id); return !!p && [p.name, ...p.aliases].join(" ").toLowerCase().includes(q);
  }), [q, snapshot]);
  const jump = (k: string) => {
    // 被折叠藏起来的：展开它的上级；不在“以它为中心”范围内的：退出中心模式
    if (centerKey && !chainOf(centerKey, snapshot.activeHoldings).has(k)) setCenter(null);
    setCollapsed((s) => { const n = new Set(s); for (const h of snapshot.activeHoldings) if ("company:" + h.companyID === k) n.delete(refKey(h.holder)); return n; });
    select(k);
    requestAnimationFrame(() => requestAnimationFrame(() => chartApi.current?.centerOn(k)));
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); search.current?.focus(); search.current?.select(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!store.data.companies.length) return (
    <div className="page"><div className="page-inner">
      <PageHeader title="股权结构" />
      <Card>
        <EmptyStateView symbol="point.3.connected.trianglepath.dotted" title="还没有公司" message="从最上层的控股公司开始建，下面的公司选它做股东，结构图会自己连起来。" actionTitle="新建公司" action={() => router.open({ kind: "newCompany" })} />
        <div className="row" style={{ justifyContent: "center" }}><Button onClick={() => void installSampleData(store)}>先看示例数据</Button></div>
      </Card>
    </div></div>
  );

  const g = store.group(group);
  const excluded = g?.excludedCompanyIDs?.length ?? 0;
  const checkOn = router.structureCheck;
  const unchecked = checkOn ? snapshot.companies.filter((c) => store.shareholderCheckApplies(c) && store.shareholderStatus(c.id, asOf).kind !== "complete").length : 0;
  return (
    <div className="page-fill">
      <PageHeader crumb={store.filterName(group)} title="股权结构"
        subtitle={isToday ? `${snapshot.companies.length} 家公司 · ${snapshot.activeHoldings.length} 条持股${centerKey ? ` · 只看“${names.get(centerKey)}”的上下游` : ""}`
          : <span className="amber-text" style={{ fontWeight: 700 }}>历史视图：{D.year(asOf)} 年末的持股。</span>}>
        <Button icon="plus" onClick={() => router.open({ kind: "newCompany" })}>新建公司</Button>
      </PageHeader>
      <div className="toolbar">
        {store.data.groups.length > 0 && <GroupFilter />}
        {g && excluded > 0 && <button className="link t-meta" title={`这些公司股权能推导到，但你把它们排除在${latinPad(g.name)}之外`} onClick={() => router.openSettings("groups", g.id)}>已排除 {excluded} 家</button>}
        <span className="spacer" />
        <div className="search" style={{ width: 190 }}>
          <Icon name="magnifyingglass" size={14} />
          <input ref={search} className="field" value={query} placeholder={`搜索并定位（${shortcutLabel("F")}）`} aria-label="在结构图中搜索"
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) jump(matches[0]); if (e.key === "Escape") { e.stopPropagation(); setQuery(""); } }} />
          {q && <span className="t-meta muted" style={{ position: "absolute", right: 10 }}>{matches.length ? `${matches.length} 个` : "没有"}</span>}
        </div>
        <div className="seg" role="tablist" aria-label="视图">
          <button role="tab" className={view === "chart" ? "on" : ""} aria-selected={view === "chart"} onClick={() => setView("chart")} style={view === "chart" ? { background: "var(--seg-on)", color: "var(--seg-on-text)", boxShadow: "0 0 0 2px var(--green-soft-line)" } : undefined}><Icon name="point.3.connected.trianglepath.dotted" size={13} />结构图</button>
          <button role="tab" className={view === "list" ? "on" : ""} aria-selected={view === "list"} onClick={() => setView("list")} style={view === "list" ? { background: "var(--seg-on)", color: "var(--seg-on-text)", boxShadow: "0 0 0 2px var(--green-soft-line)" } : undefined}><Icon name="list.bullet.indent" size={13} />列表</button>
        </div>
        <button className={`v4-toggle ${checkOn ? "on" : ""}`} aria-pressed={checkOn} title="按股东录入情况给公司标注，列出需要补充的公司" onClick={() => router.set("structureCheck", !checkOn)}>核对股东{checkOn && unchecked ? ` · ${unchecked}` : ""}</button>
        {stops.length > 1 && <button className={`v4-toggle ${showHistory ? "on" : ""}`} aria-pressed={showHistory} title="回看历年的持股结构" onClick={() => setShowHistory(!showHistory)}>历史</button>}
        <ActionMenu icon="ellipsis" ariaLabel="更多" align="end" showsChevron={false} entries={[
          item("查询链条…", "arrow.triangle.branch", () => router.open({ kind: "chainQuery", from: selRef?.kind === "person" ? selRef : undefined, to: selRef?.kind === "company" ? selRef.id : undefined })),
          ...(centerKey ? [item("显示全部", "arrow.up.left.and.arrow.down.right", () => setCenter(null))] : []),
          ...(collapsed.size ? [item("全部展开", "chevron.down", () => setCollapsed(new Set()))] : []),
          divider,
          item("导出图片（PNG）…", "square.and.arrow.up", () => void exportChart(store, layout, store.filterName(group), false)),
          item("导出 PDF…", "doc.text", () => void exportChart(store, layout, store.filterName(group), true)),
        ]} />
      </div>
      {showHistory && stops.length > 1 && <div className="seg" style={{ alignSelf: "flex-start", maxWidth: "100%", overflowX: "auto" }} role="tablist" aria-label="历史年份">
        {stops.map((d, i) => { const on = d === asOf; return (
          <button key={d} role="tab" aria-selected={on} className={`num ${on ? "on" : ""}`} onClick={() => setStopIndex(i)} style={on ? { background: "var(--seg-on)", color: "var(--seg-on-text)", boxShadow: "0 0 0 2px var(--green-soft-line)" } : undefined}>{d === store.today ? "今天" : D.year(d)}</button>); })}
      </div>}
      <div className="row grow" style={{ gap: 16, alignItems: "stretch", minHeight: 0 }}>
        {view === "chart"
          ? <Chart layout={layout} snapshotKey={`${group ?? "all"}|${centerKey ?? ""}|${asOf}`} chain={chain} selectedKey={selectedKey} select={select} open={open} toggleFold={toggleFold}
              matches={new Set(matches)} checkOn={checkOn && isToday} asOf={asOf} totals={snapshot.totalsByCompany} api={chartApi} isToday={isToday} />
          : <TreeList layout={layout} holdings={snapshot.activeHoldings} collapsed={collapsed} toggleFold={toggleFold} selectedKey={selectedKey} select={select} open={open} matches={new Set(matches)} checkOn={checkOn && isToday} asOf={asOf} />}
        {selectedKey && <aside className="chart-side" aria-label="摘要">
          <Summary key={selectedKey} k={selectedKey} asOf={asOf} isToday={isToday} centered={centerKey === selectedKey}
            onCenter={() => { setCenter(centerKey === selectedKey ? null : selectedKey); setCollapsed(new Set()); }} onClose={() => select(null)} open={() => open(selectedKey)} />
          {checkOn && <CheckList companies={snapshot.companies} asOf={asOf} onPick={(c) => jump("company:" + c.id)} />}
        </aside>}
        {!selectedKey && checkOn && <aside className="chart-side"><CheckList companies={snapshot.companies} asOf={asOf} onPick={(c) => jump("company:" + c.id)} /></aside>}
      </div>
    </div>
  );
}

const toRef = (k: string): NodeRef => { const i = k.indexOf(":"); return ref(k.slice(0, i) as "company" | "person", k.slice(i + 1)); };

// MARK: - 结构图

function Chart({ layout, snapshotKey, chain, selectedKey, select, open, toggleFold, matches, checkOn, asOf, totals, api, isToday }: {
  layout: TreeLayout; snapshotKey: string; chain: { nodes: Set<string>; edges: Set<string> }; selectedKey: string | null; select: (k: string | null) => void; open: (k: string) => void;
  toggleFold: (k: string) => void; matches: Set<string>; checkOn: boolean; asOf: Day; totals: Map<string, number>; api: React.MutableRefObject<{ centerOn: (k: string) => void; fit: () => void } | null>; isToday: boolean;
}) {
  const { store } = useApp();
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [xf, setXf] = useState<Xf>({ x: 0, y: 0, k: 1 });
  const [animating, setAnimating] = useState(false);
  const userMoved = useRef(false);
  const xfRef = useRef(xf); xfRef.current = xf;

  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const smooth = (next: Xf) => {
    if (reducedMotion()) { setXf(next); return; }
    setAnimating(true); setXf(next);
    window.setTimeout(() => setAnimating(false), 340);
  };
  const fitXf = (): Xf => {
    // 太大的图不缩到看不清：最小 55%，从顶层居中开始，其余拖动或滚动查看
    const k = Math.max(0.7, clampK(Math.min((size.w - 48) / layout.width, (size.h - 72) / layout.height, 1.1)));
    const top = layout.roots.map((r) => layout.nodes.get(r)!).filter(Boolean);
    const cx = layout.width * k <= size.w ? (size.w - layout.width * k) / 2
      : size.w / 2 - (top.length ? (Math.min(...top.map((n) => n.x)) + Math.max(...top.map((n) => n.x))) / 2 : layout.width / 2) * k;
    return { k, x: Math.min(24, Math.max(size.w - layout.width * k - 24, cx)) === cx ? cx : Math.min(24, Math.max(size.w - layout.width * k - 24, cx)), y: Math.max(36, (size.h - layout.height * k) / 2) };
  };
  const fit = (anim = true) => { userMoved.current = false; anim ? smooth(fitXf()) : setXf(fitXf()); };
  const centerOn = (k: string) => {
    const n = layout.nodes.get(k); if (!n) return;
    const z = Math.max(xfRef.current.k, 0.8);
    userMoved.current = true;
    smooth({ k: z, x: size.w / 2 - n.x * z, y: size.h / 2 - n.y * z });
  };
  api.current = { centerOn, fit };

  // 筛选、切换中心后自动缩放到合适视野；用户手动缩放或拖动过就不再自动调整（直到下次筛选）。
  const lastKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (lastKey.current !== snapshotKey) { lastKey.current = snapshotKey; userMoved.current = false; setXf(fitXf()); return; }
    if (!userMoved.current) setXf(fitXf());
  }, [snapshotKey, layout, size.w, size.h]);

  // 5.3.1：选中节点后（右侧摘要打开、画布变窄），把节点和左右一段关系留在安全区内；只平移，不改缩放
  useLayoutEffect(() => {
    if (!selectedKey || !size.w) return;
    const n = layout.nodes.get(selectedKey); if (!n) return;
    // 同一次提交里上面的自动适配刚算过新视野：没手动动过时以它为基准
    const { k, x, y } = userMoved.current ? xfRef.current : fitXf();
    const padX = 150 * k + 32, padY = 70 * k + 32;
    const sx = x + n.x * k, sy = y + n.y * k;
    const dx = sx < padX ? padX - sx : sx > size.w - padX ? size.w - padX - sx : 0;
    const dy = sy < padY ? padY - sy : sy > size.h - padY ? size.h - padY - sy : 0;
    if (dx || dy) smooth({ k, x: x + dx, y: y + dy });
  }, [selectedKey, size.w, size.h]);

  // 生长动画：首次打开和切换集团后整棵树按层生长；之后只让新增的节点和连线生长。
  const [grow, setGrow] = useState<Map<string, number> | null>(null);
  const seen = useRef<{ key: string; nodes: Set<string> } | null>(null);
  useLayoutEffect(() => {
    const keys = new Set(layout.nodes.keys());
    const group = snapshotKey.split("|")[0];
    const prev = seen.current;
    let m: Map<string, number>;
    if (!prev || prev.key !== group) {
      const maxL = Math.max(0, ...[...layout.nodes.values()].map((n) => n.layer));
      m = new Map([...layout.nodes.values()].map((n) => [n.key, maxL > 3 ? Math.min(n.layer, 2) : n.layer]));
    } else m = new Map([...keys].filter((k) => !prev.nodes.has(k)).map((k) => [k, 0]));
    seen.current = { key: group, nodes: keys };
    if (!m.size || reducedMotion()) { setGrow(null); return; }
    setGrow(m);
    const total = (Math.max(...m.values()) + 1) * LEVEL_MS + 400;
    const t = window.setTimeout(() => setGrow(null), total);
    return () => window.clearTimeout(t);
  }, [layout]);

  // 滚轮：按住 ⌘/Ctrl 或双指捏合缩放（以鼠标为锚点），否则平移。
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      userMoved.current = true;
      const cur = xfRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect(), ax = e.clientX - r.left, ay = e.clientY - r.top;
        const k = clampK(cur.k * Math.exp(-e.deltaY * 0.01));
        setXf({ k, x: ax - ((ax - cur.x) / cur.k) * k, y: ay - ((ay - cur.y) / cur.k) * k });
      } else setXf({ ...cur, x: cur.x - e.deltaX, y: cur.y - e.deltaY });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const zoomBy = (f: number) => { userMoved.current = true; const k = clampK(xf.k * f); smooth({ k, x: size.w / 2 - ((size.w / 2 - xf.x) / xf.k) * k, y: size.h / 2 - ((size.h / 2 - xf.y) / xf.k) * k }); };

  const panStart = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".node, .chart-tools, .chart-legend")) return;
    const sx = e.clientX, sy = e.clientY, start = xf;
    let moved = false;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true; userMoved.current = true;
      setXf({ ...start, x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy });
    };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); if (!moved) select(null); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
  };

  // 键盘：↑ 上级、↓ 下级、← → 同层相邻；回车打开，Esc 取消选择，空格折叠。
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input")) return;
    const cur = selectedKey ? layout.nodes.get(selectedKey) : undefined;
    const go = (k?: string) => { if (!k) return; e.preventDefault(); select(k); const n = layout.nodes.get(k)!; const sx = xf.x + n.x * xf.k, sy = xf.y + n.y * xf.k; if (sx < 60 || sy < 60 || sx > size.w - 60 || sy > size.h - 60) centerOn(k); };
    if (!cur) { if (e.key.startsWith("Arrow")) go(layout.roots[0]); return; }
    const row = layout.layers[cur.layer];
    const near = (list: string[]) => list.sort((a, b) => Math.abs(layout.nodes.get(a)!.x - cur.x) - Math.abs(layout.nodes.get(b)!.x - cur.x))[0];
    if (e.key === "ArrowUp") go(near([...cur.parents]));
    else if (e.key === "ArrowDown") go(near([...cur.children]));
    else if (e.key === "ArrowLeft") go(row[row.indexOf(cur.key) - 1]);
    else if (e.key === "ArrowRight") go(row[row.indexOf(cur.key) + 1]);
    else if (e.key === "Enter") { e.preventDefault(); open(cur.key); }
    else if (e.key === " ") { e.preventDefault(); if (cur.children.length || cur.hiddenBelow) toggleFold(cur.key); }
    else if (e.key === "Escape") { e.preventDefault(); select(null); }
  };

  const focusing = !!selectedKey;
  const hasKids = (k: string) => layout.nodes.get(k)!.children.length > 0 || layout.nodes.get(k)!.hiddenBelow > 0;
  const lvl = (k: string) => grow?.get(k);
  return (
    <div ref={wrap} className={`chart-wrap ${animating ? "animating" : ""} ${focusing ? "focusing" : ""} ${xf.k < 0.6 ? "lod" : ""}`} tabIndex={0} onKeyDown={onKey} onPointerDown={panStart}
      role="application" aria-label="股权结构图。方向键在节点间移动，回车打开，空格折叠。" style={{ cursor: "grab", ["--k" as any]: xf.k }}>
      <div className="chart-canvas" style={{ width: layout.width, height: layout.height, transform: `translate(${xf.x}px, ${xf.y}px) scale(${xf.k})` }}>
        <svg className="edges" width={layout.width} height={layout.height} style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }} aria-hidden>
          {layout.edges.map((e) => {
            const hl = chain.edges.has(e.holding.id);
            const l = lvl(e.to);
            const len = pathLength(e.points);
            const growing = l !== undefined;
            return <path key={e.id} d={e.path} className={`${!e.holding.verified ? "pending" : ""} ${e.holding.isNominee ? "nominee" : ""} ${hl ? "hl" : ""} ${growing ? "grow" : ""}`}
              style={growing ? { ["--len" as any]: len, animationDelay: `${Math.max(0, l - 1) * LEVEL_MS + (l ? 80 : 0)}ms` } : undefined} />;
          })}
          {layout.edges.map((e) => {
            const hl = chain.edges.has(e.holding.id);
            const text = e.holding.isNominee ? `代持 ${percentLabel(e.holding.percent)}` : percentLabel(e.holding.percent);
            const w = [...text].reduce((a, ch) => a + (ch.codePointAt(0)! > 0x2e80 ? 11 : 7), 16);
            const l = lvl(e.to);
            return <g key={e.id + "l"} className={`lbl ${hl ? "hl" : ""} ${e.holding.isNominee ? "nominee" : ""} ${l !== undefined ? "grow" : ""}`} style={l !== undefined ? { animationDelay: `${l * LEVEL_MS}ms` } : undefined}>
              <rect x={e.label.x - w / 2} y={e.label.y - 10} width={w} height={20} rx={10} />
              <text x={e.label.x} y={e.label.y + 4} textAnchor="middle">{text}</text>
            </g>;
          })}
        </svg>
        {[...layout.nodes.values()].map((n) => {
          const sel = n.key === selectedKey;
          const l = lvl(n.key);
          return (
            <div key={n.key} className={`node ${chain.nodes.has(n.key) && focusing ? "chain" : ""} ${matches.has(n.key) ? "match" : ""} ${l !== undefined ? "grow" : ""}`} aria-selected={sel}
              role="button" tabIndex={-1} aria-label={store.nameOf(n.ref)} title={store.nameOf(n.ref)}
              style={{ left: n.x - NODE_W / 2, top: n.y - NODE_H / 2, width: NODE_W, height: NODE_H, ...(l !== undefined ? { animationDelay: `${l * LEVEL_MS}ms` } : null) }}
              onClick={(e) => { e.stopPropagation(); select(n.key); wrap.current?.focus({ preventScroll: true }); }} onDoubleClick={() => open(n.key)}>
              <NodeBody n={n.ref} isToday={isToday} />
              {hasKids(n.key) && <button className="fold" title={n.hiddenBelow ? `展开下面 ${n.hiddenBelow} 家` : "收起下级"} aria-label={n.hiddenBelow ? "展开" : "收起"}
                onClick={(e) => { e.stopPropagation(); toggleFold(n.key); }}>{n.hiddenBelow ? <><Icon name="plus" size={8} strokeWidth={3} />{n.hiddenBelow}</> : <Icon name="minus" size={8} strokeWidth={3} />}</button>}
              {checkOn && n.ref.kind === "company" && (() => { const c = store.company(n.ref.id); if (!c || !store.shareholderCheckApplies(c)) return null; const st = store.shareholderStatus(c.id, asOf);
                return st.kind !== "complete" && <span className={`pill ${holderStatusTone(st)}`} style={{ position: "absolute", right: -8, top: -11, height: 20 }}>{holderStatusLabel(st)}</span>; })()}
              {n.ref.kind === "company" && (totals.get(n.ref.id) ?? 0) < 99.5 && (totals.get(n.ref.id) ?? 0) > 0 && !n.children.length && <span className="t-label" style={{ position: "absolute", left: 0, right: 0, bottom: -20, textAlign: "center" }}>另有 {percentLabel(100 - (totals.get(n.ref.id) ?? 0))} 未录入</span>}
            </div>
          );
        })}
      </div>
      <div className="chart-legend" aria-hidden><span><i />已核实</span><span><i className="pending" />待核实</span><span><i className="nominee" />代持</span></div>
      <div className="chart-tools">
        <Button size="small" icon="minus" ariaLabel="缩小" onClick={() => zoomBy(1 / 1.2)} />
        <Button size="small" onClick={() => fit()} title="缩放到合适视野"><span className="num">{Math.round(xf.k * 100)}%</span></Button>
        <Button size="small" icon="plus" ariaLabel="放大" onClick={() => zoomBy(1.2)} />
      </div>
    </div>
  );
}

function NodeBody({ n, isToday }: { n: NodeRef; isToday: boolean }) {
  const { store } = useApp();
  if (n.kind === "person") {
    const p = store.person(n.id);
    const nominee = store.data.holdings.some((h) => h.holder.kind === "person" && h.holder.id === n.id && h.isNominee);
    return <>
      <Avatar name={p?.name ?? "?"} size={36} dashed={nominee} />
      <span className="col" style={{ minWidth: 0 }}><span className="nm name-2">{p?.name}</span><span className="sub">{nominee ? "名义股东" : "个人股东"}</span></span>
    </>;
  }
  const c = store.company(n.id);
  const g = store.brandOf(n.id);
  const color = g ? store.brandColor(g) : null;
  const next = isToday ? store.openObligations.find((o) => o.company.id === n.id) : undefined;
  const left = next ? D.daysBetween(store.today, next.due) : 999;
  const sub = left < 0 ? `逾期：${next!.rule.name}` : left <= 30 ? `${left} 天后：${next!.rule.name}` : store.jurisdictionName(c?.jurisdiction ?? "");
  return <>
    <span className="jbadge" title={g ? g.name : "各集团共用"} style={{ width: 36, height: 36, borderRadius: 10, fontSize: 12, ...(color ? { background: `color-mix(in srgb, ${color} 22%, var(--surface))`, color: `color-mix(in srgb, ${color} 55%, var(--ink))` } : null) }}>{c?.jurisdiction}</span>
    <span className="col" style={{ minWidth: 0 }}>
      <span className="nm name-2" title={c?.name}>{c?.name}</span>
      <span className="sub ellipsis" style={left <= 30 ? { color: left < 0 ? "var(--red-text)" : "var(--amber-text)", fontWeight: 700 } : undefined}>{sub}</span>
    </span>
  </>;
}

// MARK: - 列表视图（缩进）

function TreeList({ layout, holdings, collapsed, toggleFold, selectedKey, select, open, matches, checkOn, asOf }: {
  layout: TreeLayout; holdings: Holding[]; collapsed: Set<string>; toggleFold: (k: string) => void; selectedKey: string | null; select: (k: string) => void; open: (k: string) => void;
  matches: Set<string>; checkOn: boolean; asOf: Day;
}) {
  const { store } = useApp();
  const rows: { key: string; depth: number; via?: Holding; path: string; repeat: boolean }[] = [];
  const shown = new Set<string>();
  const walk = (k: string, depth: number, via: Holding | undefined, path: Set<string>, pk: string) => {
    const repeat = shown.has(k);
    shown.add(k);
    rows.push({ key: k, depth, via, path: pk, repeat });
    if (collapsed.has(k) || repeat || path.has(k)) return;
    const next = new Set(path); next.add(k);
    const kids = holdings.filter((h) => refKey(h.holder) === k && layout.nodes.has("company:" + h.companyID))
      .sort((a, b) => b.percent - a.percent || store.nameOf(ref("company", a.companyID)).localeCompare(store.nameOf(ref("company", b.companyID)), "zh"));
    for (const h of kids) walk("company:" + h.companyID, depth + 1, h, next, pk + ">" + h.id);
  };
  for (const r of layout.roots) walk(r, 0, undefined, new Set(), r);
  for (const k of layout.nodes.keys()) if (!shown.has(k)) walk(k, 0, undefined, new Set(), k);
  return (
    <div className="card flush grow scroll" style={{ minHeight: 0 }} role="tree" aria-label="股权结构列表">
      {rows.map((r) => {
        const n = toRef(r.key);
        const kids = holdings.some((h) => refKey(h.holder) === r.key);
        const c = n.kind === "company" ? store.company(n.id) : undefined;
        const st = checkOn && c && store.shareholderCheckApplies(c) ? store.shareholderStatus(c.id, asOf) : null;
        return (
          <div key={r.path} role="treeitem" aria-selected={r.key === selectedKey} aria-expanded={kids && !r.repeat ? !collapsed.has(r.key) : undefined} tabIndex={0}
            className="tree-row" style={{ ["--depth" as any]: r.depth, cursor: "pointer", background: matches.has(r.key) && r.key !== selectedKey ? "var(--blue-soft)" : undefined }}
            onClick={() => select(r.key)} onDoubleClick={() => open(r.key)}
            onKeyDown={(e) => { if (e.key === "Enter") open(r.key); if (e.key === " " && kids) { e.preventDefault(); toggleFold(r.key); } }}>
            {kids && !r.repeat ? <button className="tw" aria-label={collapsed.has(r.key) ? "展开" : "收起"} onClick={(e) => { e.stopPropagation(); toggleFold(r.key); }}>
              <Icon name="chevron.right" size={11} className={`chev ${collapsed.has(r.key) ? "" : "open"}`} /></button> : <span className="tw" />}
            {n.kind === "company" ? <JurisdictionBadge code={c?.jurisdiction ?? ""} size={28} tint={companyTint(store, n.id)} /> : <Avatar name={store.nameOf(n)} size={28} />}
            <span className="col" style={{ minWidth: 0 }}>
              <span className="ellipsis" style={{ fontWeight: 700 }}>{store.nameOf(n)}</span>
              {r.repeat && <span className="t-meta muted">同一家公司，已在上面列出</span>}
            </span>
            {r.via && !r.via.verified && <Pill text="待核实" kind="warn" />}
            {r.via?.isNominee && <Pill text="代持" kind="warn" />}
            {st && st.kind !== "complete" && <Pill text={holderStatusLabel(st)} kind={holderStatusTone(st)} />}
            {r.via && <span className="pctc">{percentLabel(r.via.percent)}</span>}
          </div>
        );
      })}
    </div>
  );
}

// MARK: - 摘要

function Summary({ k, asOf, isToday, centered, onCenter, onClose, open }: { k: string; asOf: Day; isToday: boolean; centered: boolean; onCenter: () => void; onClose: () => void; open: () => void }) {
  const { store, router } = useApp();
  const n = toRef(k);
  const close = <button className="v4-x" aria-label="关闭摘要" title="关闭（Esc）" onClick={onClose}><Icon name="xmark" size={11} /></button>;
  const actions = <div className="row gap8 wrap">
    <Button kind="primary" onClick={open}>{n.kind === "company" ? "打开公司" : "打开人员"}</Button>
    <Button onClick={onCenter} title="只看它的上下游">{centered ? "显示全部" : "以它为中心"}</Button>
  </div>;
  if (n.kind === "person") {
    const p = store.person(n.id);
    const owned = portfolio(n, store.data.companies, store.data.holdings, asOf);
    const roles = store.data.appointments.filter((a) => a.personID === n.id && isActiveOn(a, asOf));
    return (
      <Card>
        <div className="row start gap12"><Avatar name={p?.name ?? "?"} size={44} /><span className="col grow" style={{ minWidth: 0 }}><span className="t-title">{p?.name}</span><span className="t-meta muted">个人</span></span>{close}</div>
        {actions}
        <div className="col gap6"><span className="t-label">穿透后持有</span>
          {owned.length ? owned.map((x) => <div key={x.company.id} className="row gap8"><span className="ellipsis grow">{x.company.name}</span>{x.viaNominee && <Pill text="含代持" kind="warn" />}<span className="pct">{percentLabel(x.percent)}</span></div>) : <span className="muted">没有持股</span>}</div>
        {roles.length > 0 && <div className="col gap6"><span className="t-label">任职</span>{roles.map((a) => <div key={a.id} className="row gap8"><span className="ellipsis grow">{store.company(a.companyID)?.name}</span><span className="t-meta muted">{a.title}</span></div>)}</div>}
      </Card>
    );
  }
  const c = store.company(n.id);
  if (!c) return null;
  const holders = store.data.holdings.filter((h) => h.companyID === c.id && isActiveOn(h, asOf)).sort((a, b) => b.percent - a.percent);
  const subs = store.data.holdings.filter((h) => h.holder.kind === "company" && h.holder.id === c.id && isActiveOn(h, asOf));
  const b = store.breakdownOf(c.id, asOf);
  const officers = store.officers(c.id, asOf);
  const people = [...new Set(officers.map((a) => a.personID))];
  const next = isToday ? store.openObligations.find((o) => o.company.id === c.id) : undefined;
  const left = next ? D.daysBetween(store.today, next.due) : 0;
  return (
    <Card>
      <div className="row start gap12">
        <JurisdictionBadge code={c.jurisdiction} size={44} tint={companyTint(store, c.id)} />
        <span className="col grow" style={{ minWidth: 0, gap: 6 }}><span className="t-card name-2">{c.name}</span><span className="row gap6 wrap"><CompanyChips c={c} /></span></span>
        {close}
      </div>
      {actions}
      {next && <button className="row gap10" style={{ padding: "10px 12px", borderRadius: 12, background: left < 0 ? "var(--red-soft)" : left <= 30 ? "var(--amber-soft)" : "var(--surface-sunken)", textAlign: "left" }} onClick={() => router.openDue(next.key)}>
        <Icon name="clock" size={14} /><span className="grow ellipsis" style={{ fontWeight: 700 }}>{next.rule.name}</span><span className="t-meta" style={{ fontWeight: 700 }}>{leftText(left)}</span></button>}
      <div className="col gap6"><span className="t-label">直接股东</span>
        {holders.length ? holders.map((h) => (
          <div key={h.id} className="row gap8">
            <button className="ellipsis grow" style={{ textAlign: "left", fontWeight: 600 }} onClick={() => h.holder.kind === "company" ? router.update((r) => { r.selectedCompanyID = h.holder.id; }) : router.openPerson(h.holder.id)}>{store.nameOf(h.holder)}</button>
            {!h.verified && <Pill text="待核实" kind="warn" />}{h.isNominee && <Pill text="代持" kind="warn" />}
            <span className="pct">{percentLabel(h.percent)}</span>
          </div>)) : <span className="muted">未录入</span>}
      </div>
      {b.owners.length > 0 && <div className="col gap6"><span className="t-label">最终受益（穿透）</span>
        {b.owners.slice(0, 6).map((u) => <div key={refKey(u.owner)} className="row gap8"><span className="ellipsis grow">{store.nameOf(u.owner)}</span>{u.viaNominee && <Pill text="含代持" kind="warn" />}<span className="pct">{percentLabel(u.percent)}</span></div>)}
        {b.unknown > 0.005 && <div className="row gap8 amber-text"><span className="grow">未识别</span><span className="pct">{percentLabel(b.unknown)}</span></div>}
      </div>}
      <div className="col gap6"><span className="t-label">下属公司</span>
        {subs.length ? <span className="row gap6 wrap">{subs.map((h) => <button key={h.id} className="v4-chip btnlike" onClick={() => router.update((r) => { r.selectedCompanyID = h.companyID; })}>{store.company(h.companyID)?.jurisdiction} {store.company(h.companyID)?.name} · {percentLabel(h.percent)}</button>)}</span> : <span className="muted">没有</span>}
      </div>
      {people.length > 0 && <div className="col gap6"><span className="t-label">董事和高管</span>
        {people.map((pid) => <div key={pid} className="row gap8"><button className="ellipsis grow" style={{ textAlign: "left", fontWeight: 600 }} onClick={() => router.openPerson(pid)}>{store.person(pid)?.name}</button><span className="t-meta muted">{officers.filter((a) => a.personID === pid).map((a) => a.title).join("、")}</span></div>)}
      </div>}
      <div className="row gap8 wrap">
        <Button size="small" onClick={() => router.open({ kind: "addRelation", companyID: c.id, upward: true })}>添加上级…</Button>
        <Button size="small" onClick={() => router.open({ kind: "addRelation", companyID: c.id, upward: false })}>添加下级…</Button>
        <Button size="small" kind="quiet" icon="doc.on.doc" onClick={() => { void platform().copyText(store.companySummary(c, asOf)); store.showToast("公司资料摘要已复制。"); }}>复制摘要</Button>
      </div>
    </Card>
  );
}

function CheckList({ companies, asOf, onPick }: { companies: Company[]; asOf: Day; onPick: (c: Company) => void }) {
  const { store } = useApp();
  const rank = (s: ShareholderStatus) => ({ missing: 0, partial: 1, pending: 2, complete: 3 })[s.kind];
  const items = companies.filter((c) => store.shareholderCheckApplies(c)).map((c) => [c, store.shareholderStatus(c.id, asOf)] as const)
    .filter(([, s]) => s.kind !== "complete").sort((a, b) => rank(a[1]) - rank(b[1]) || a[0].name.localeCompare(b[0].name, "zh"));
  return (
    <Card title={items.length ? `${items.length} 家需要补充股东` : "股东都已录入完整"}>
      {items.map(([c, s]) => (
        <button key={c.id} className="row gap8" style={{ textAlign: "left" }} title={holderStatusDetail(s)} onClick={() => onPick(c)}>
          <span className="gdot" style={{ background: holderStatusColor(s) }} /><span className="ellipsis grow">{c.name}</span><span className="t-meta muted">{holderStatusLabel(s)}</span>
        </button>
      ))}
    </Card>
  );
}

// MARK: - 导出图片

/** 单页 PDF，内嵌一张 JPEG（DCTDecode），页面尺寸按图片比例，单位 pt。 */
function jpegPDF(jpeg: Uint8Array, w: number, h: number, pageW: number, pageH: number): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (b: Uint8Array | string) => { const x = typeof b === "string" ? enc.encode(b) : b; parts.push(x); len += x.length; };
  push("%PDF-1.4\n");
  const obj = (n: number, body: (Uint8Array | string)[]) => { offsets[n] = len; push(`${n} 0 obj\n`); body.forEach(push); push("\nendobj\n"); };
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  obj(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`]);
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"]);
  obj(5, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n` + [1, 2, 3, 4, 5].map((i) => String(offsets[i]).padStart(10, "0") + " 00000 n \n").join(""));
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len); let o = 0; for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

async function exportChart(store: Store, layout: TreeLayout, title: string, pdf: boolean) {
  const p = platform();
  const name = `${title} 股权结构 ${store.today}.${pdf ? "pdf" : "png"}`;
  const path = await p.saveDialog({ defaultName: name, extensions: [pdf ? "pdf" : "png"], title: "导出结构图" });
  if (!path) return;
  const head = 64, scale = 2;
  const W = layout.width, H = layout.height + head;
  const cv = document.createElement("canvas"); cv.width = W * scale; cv.height = H * scale;
  const g = cv.getContext("2d")!; g.scale(scale, scale);
  const sans = 'Inter, "PingFang SC", "Microsoft YaHei UI", sans-serif', display = 'Nunito, "PingFang SC", "Microsoft YaHei UI", sans-serif';
  g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#E0E7DD"; for (let x = 10; x < W; x += 20) for (let y = head + 10; y < H; y += 20) { g.beginPath(); g.arc(x, y, 1.2, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#25352C"; g.font = `900 22px ${display}`; g.fillText(name.replace(/\.(png|pdf)$/, ""), 48, 40);
  g.translate(0, head);
  for (const e of layout.edges) {
    g.strokeStyle = e.holding.isNominee ? "#F4D36B" : "#87947F"; g.lineWidth = 2; g.lineCap = "round"; g.setLineDash(e.holding.verified ? [] : [6, 5]);
    g.stroke(new Path2D(e.path));
  }
  g.setLineDash([]);
  for (const e of layout.edges) {
    const text = e.holding.isNominee ? `代持 ${percentLabel(e.holding.percent)}` : percentLabel(e.holding.percent);
    g.font = `800 11px ${sans}`; const w = g.measureText(text).width + 16;
    g.beginPath(); g.roundRect(e.label.x - w / 2, e.label.y - 10, w, 20, 10); g.fillStyle = e.holding.isNominee ? "#FFF3CF" : "#EDFAE2"; g.fill();
    g.fillStyle = e.holding.isNominee ? "#8A5B00" : "#2F7A00"; g.textAlign = "center"; g.fillText(text, e.label.x, e.label.y + 4); g.textAlign = "left";
  }
  const clip = (t: string, w: number) => { if (g.measureText(t).width <= w) return t; let x = t; while (x && g.measureText(x + "…").width > w) x = x.slice(0, -1); return x + "…"; };
  for (const n of layout.nodes.values()) {
    const x = n.x - NODE_W / 2, y = n.y - NODE_H / 2;
    g.beginPath(); g.roundRect(x, y + 4, NODE_W, NODE_H, 12); g.fillStyle = "#E0E7DD"; g.fill();
    g.beginPath(); g.roundRect(x, y, NODE_W, NODE_H, 12); g.fillStyle = "#FFFFFF"; g.fill(); g.strokeStyle = "#E0E7DD"; g.lineWidth = 2; g.stroke();
    if (n.ref.kind === "company") {
      const co = store.company(n.ref.id)!;
      const b = store.brandOf(n.ref.id);
      g.beginPath(); g.roundRect(x + 12, y + 12, 36, 36, 10); g.fillStyle = b ? store.brandColor(b) + "38" : "#F2F5EF"; g.fill();
      g.fillStyle = "#25352C"; g.font = `800 11px ${sans}`; g.textAlign = "center"; g.fillText(co.jurisdiction, x + 30, y + 34); g.textAlign = "left";
      g.font = `700 12.5px ${sans}`; g.fillText(clip(co.name, NODE_W - 72), x + 58, y + 27);
      g.fillStyle = "#5F6D66"; g.font = `11px ${sans}`; g.fillText(clip(store.jurisdictionName(co.jurisdiction), NODE_W - 72), x + 58, y + 44);
    } else {
      g.fillStyle = "#F0EBFC"; g.beginPath(); g.arc(x + 30, y + 30, 18, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#6F4F9E"; g.font = `800 15px ${sans}`; g.textAlign = "center"; g.fillText([...store.nameOf(n.ref)][0] ?? "", x + 30, y + 35); g.textAlign = "left";
      g.fillStyle = "#25352C"; g.font = `700 12.5px ${sans}`; g.fillText(clip(store.nameOf(n.ref), NODE_W - 72), x + 58, y + 27);
      g.fillStyle = "#5F6D66"; g.font = `11px ${sans}`; g.fillText("个人股东", x + 58, y + 44);
    }
  }
  if (pdf) {
    const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b!), "image/jpeg", 0.92));
    await p.writeBytes(path, jpegPDF(new Uint8Array(await blob.arrayBuffer()), cv.width, cv.height, W, H));
  } else {
    const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b!), "image/png"));
    await p.writeBytes(path, new Uint8Array(await blob.arrayBuffer()));
  }
  store.showToast("结构图已导出。", () => void p.reveal(path), p.os === "windows" ? "在资源管理器中显示" : "在访达中显示");
}
