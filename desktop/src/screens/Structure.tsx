// 股权结构图：按层排列、正交连线、点选高亮控制链、时间回放、核对股东、向上穿透。移植自 StructureView.swift。

import { SlideBg, reducedMotion } from "../ui/motion";
import { CompanyChips } from "./PropChips";
import { isSoft, softBg, softInk, companyTint } from "../ui/uistyle";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Day } from "../domain/day";
import * as D from "../domain/day";
import { type Company, type Holding, type NodeRef, companyStatusLabel, isActiveOn, ref, refKey, latinPad, latinPadStart } from "../domain/models";
import { activeHoldings, percentLabel, portfolio } from "../domain/engine";
import { type Pt, type Route, type StructureSnapshot, buildSnapshot, clampZoom, companySize, focusChain, personSize, routeEdges, routePath, sizeOf, timelineStops } from "../domain/graph";
import { isMember, sourceLabel } from "../domain/groups";
import { useApp } from "../state/hooks";
import type { ShareholderStatus, Store } from "../state/store";
import { platform } from "../platform/platform";
import { installSampleData } from "../state/sample";
import { Icon } from "../ui/Icon";
import { ActionMenu, Button, EmptyStateView, JurisdictionBadge, PageHeader, Pill, Segmented, Spinner, Switch, item } from "../ui/kit";
import { InfoCard } from "./InfoCard";

// MARK: - 股东核对的展示

export const holderStatusLabel = (s: ShareholderStatus) => (s.kind === "missing" ? "没有股东" : s.kind === "partial" ? `合计 ${percentLabel(s.total)}` : s.kind === "pending" ? "待确认" : "完整");
export const holderStatusDetail = (s: ShareholderStatus) => s.kind === "missing" ? "还没有录入任何股东。"
  : s.kind === "partial" ? `已录入的股东合计 ${percentLabel(s.total)}，另有 ${percentLabel(Math.max(0, 100 - s.total))} 未录入。`
    : s.kind === "pending" ? s.reasons.join("；") + "。" : "股东比例合计 100%，信息齐全。";
export const holderStatusColor = (s: ShareholderStatus) => ({ missing: "var(--danger)", partial: "var(--amber)", pending: "var(--amber-text)", complete: "var(--lime)" })[s.kind];
const holderStatusRank = (s: ShareholderStatus) => ({ missing: 0, partial: 1, pending: 2, complete: 3 })[s.kind];

const zoomKey = "structure.zoom";
const readZoom = () => { const z = parseFloat(platform().prefGet(zoomKey) ?? "0"); return Number.isFinite(z) ? z : 0; };

export function StructureView() {
  const { store, router } = useApp();
  const [stopIndex, setStopIndex] = useState<number | null>(null);
  const [hover, setHover] = useState<NodeRef | null>(null);
  // 选中公司与路由同步（搜索、信息卡里的跳转都会改它）；选中人只在本页
  const [personSel, setPersonSel] = useState<NodeRef | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [drag, setDrag] = useState<{ key: string; dx: number; dy: number } | null>(null);
  const [savedZoom, setSavedZoomState] = useState(readZoom);
  const [playing, setPlaying] = useState(false);
  const [viewport, setViewport] = useState({ width: 900, height: 600 });
  const scroller = useRef<HTMLDivElement>(null);
  const setSavedZoom = (z: number) => { setSavedZoomState(z); platform().prefSet(zoomKey, String(z)); };

  const group = router.groupFilter;
  const upward: string | null = null;
  const scope = (day?: Day) => (upward ? store.upwardScope(upward, day) : store.brandScope(group, day));
  const dataVersion = [store.data.companies, store.data.holdings, store.data.groups, store.data.people, store.today] as const;

  const stops = useMemo(() => timelineStops(store.data.holdings, scope() ?? new Set(store.data.companies.map((c) => c.id)), store.today),
    [group, upward, ...dataVersion]);
  useEffect(() => { setStopIndex(null); setPlaying(false); }, [group, upward]);
  const asOf = stops.length ? stops[Math.min(stopIndex ?? stops.length - 1, stops.length - 1)] : store.today;
  const isToday = asOf === store.today;

  const snapshot: StructureSnapshot = useMemo(() => {
    const names = new Map<string, string>(), saved = new Map<string, { x: number; y: number }>();
    for (const c of store.data.companies) { names.set(refKey(ref("company", c.id)), c.name); if (c.position) saved.set(refKey(ref("company", c.id)), c.position); }
    for (const p of store.data.people) { names.set(refKey(ref("person", p.id)), p.name); if (p.position) saved.set(refKey(ref("person", p.id)), p.position); }
    return buildSnapshot({ companies: store.data.companies, holdings: store.data.holdings, scope: scope(asOf), asOf, names, savedPositions: saved });
  }, [asOf, group, upward, ...dataVersion]);

  // 拖动中的位置
  // #11 历史回放：换年份时节点位置在 panel 档内逐帧补间，连线按中间位置一起重画。
  const [tweenPos, setTweenPos] = useState<Map<string, Pt> | null>(null);
  const shown = useRef(snapshot.positions);
  const lastAsOf = useRef(asOf);
  const tweenRaf = useRef(0);
  useLayoutEffect(() => {
    if (lastAsOf.current === asOf) return;
    lastAsOf.current = asOf;
    cancelAnimationFrame(tweenRaf.current);
    const from = shown.current, to = snapshot.positions;
    if (reducedMotion() || from === to) { setTweenPos(null); return; }
    const t0 = performance.now(), ms = 280;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      if (k >= 1) { setTweenPos(null); return; }
      const m = new Map(to);
      for (const [key, b] of to) { const a = from.get(key); if (a) m.set(key, { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }); }
      setTweenPos(m);
      tweenRaf.current = requestAnimationFrame(step);
    };
    step(t0);
  }, [snapshot]);
  useEffect(() => () => cancelAnimationFrame(tweenRaf.current), []);
  const positions = useMemo(() => {
    const base = tweenPos ?? snapshot.positions;
    if (!drag) return base;
    const m = new Map(base);
    const b = m.get(drag.key);
    if (b) m.set(drag.key, { x: b.x + drag.dx, y: b.y + drag.dy });
    return m;
  }, [snapshot, drag, tweenPos]);
  shown.current = positions;
  const routes = useMemo(() => routeEdges(snapshot.activeHoldings, positions), [snapshot, positions]);
  const nodeKeys = new Set(snapshot.nodes.map(refKey));
  const selected: NodeRef | null = personSel ?? (router.selectedCompanyID && nodeKeys.has("company:" + router.selectedCompanyID) ? ref("company", router.selectedCompanyID) : null);
  const setSelected = (n: NodeRef | null) => {
    if (n?.kind === "person") { setPersonSel(n); router.set("selectedCompanyID", null); }
    else { setPersonSel(null); router.set("selectedCompanyID", n ? n.id : null); }
  };
  useEffect(() => { if (!showHistory) { setStopIndex(null); setPlaying(false); } }, [showHistory]);
  useEffect(() => {
    if (personSel && !nodeKeys.has(refKey(personSel))) setPersonSel(null);
    if (hover && !nodeKeys.has(refKey(hover))) setHover(null);
  }, [snapshot]);

  // 回放
  useEffect(() => {
    if (!playing) return;
    let i = 0;
    setStopIndex(0);
    const t = setInterval(() => { i++; if (i >= stops.length) { setPlaying(false); clearInterval(t); return; } setStopIndex(i); }, 1400);
    return () => clearInterval(t);
  }, [playing]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setViewport({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [store.data.companies.length > 0]);

  const fit = clampZoom(Math.min((viewport.width - 24) / snapshot.canvas.width, (viewport.height - 24) / snapshot.canvas.height, 1.2));
  const z = savedZoom > 0 ? savedZoom : fit;

  // Ctrl/⌘ + 滚轮（或触控板捏合）缩放，锚定在鼠标位置
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ax = e.clientX - rect.left, ay = e.clientY - rect.top;
      const gx = (el.scrollLeft + ax) / z, gy = (el.scrollTop + ay) / z;
      const next = clampZoom(z * Math.exp(-e.deltaY * 0.01));
      setSavedZoom(next);
      requestAnimationFrame(() => { el.scrollLeft = gx * next - ax; el.scrollTop = gy * next - ay; });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  const focus = hover ?? selected;
  const chain = focusChain(focus, snapshot.activeHoldings);
  const focused = !!focus;

  const reveal = (n: NodeRef) => {
    const el = scroller.current, p = snapshot.positions.get(refKey(n));
    if (!el || !p) return;
    const s = sizeOf(n);
    const f = { x: (p.x - s.width / 2) * z, y: (p.y - s.height / 2) * z, w: s.width * z, h: s.height * z };
    const v = { x: el.scrollLeft + 24, y: el.scrollTop + 24, w: el.clientWidth - 48, h: el.clientHeight - 48 };
    if (f.x >= v.x && f.y >= v.y && f.x + f.w <= v.x + v.w && f.y + f.h <= v.y + v.h) return;
    el.scrollTo({ left: Math.max(0, f.x + f.w / 2 - el.clientWidth / 2), top: Math.max(0, f.y + f.h / 2 - el.clientHeight / 2), behavior: "smooth" });
  };
  useEffect(() => { if (selected) { const r = requestAnimationFrame(() => reveal(selected)); return () => cancelAnimationFrame(r); } }, [selected?.id]);

  // #9 用按钮缩放：比例与滚动位置一起过渡（standard），以视口中心为锚点。
  const zoomAnim = useRef(0);
  const animateZoom = (to: number) => {
    const el = scroller.current;
    cancelAnimationFrame(zoomAnim.current);
    if (!el || reducedMotion()) { setSavedZoom(to); return; }
    const from = z, ax = el.clientWidth / 2, ay = el.clientHeight / 2;
    const gx = (el.scrollLeft + ax) / from, gy = (el.scrollTop + ay) / from;
    const t0 = performance.now(), ms = 200;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3), v = from + (to - from) * e;
      setSavedZoom(k < 1 ? v : to);
      requestAnimationFrame(() => { el.scrollLeft = gx * v - ax; el.scrollTop = gy * v - ay; });
      if (k < 1) zoomAnim.current = requestAnimationFrame(step);
    };
    zoomAnim.current = requestAnimationFrame(step);
  };

  const saveNode = (n: NodeRef, p: Pt) => store.commit((d) => {
    const list = n.kind === "company" ? d.companies : d.people;
    const x = list.find((y) => y.id === n.id);
    if (x) x.position = { x: p.x, y: p.y };
  });
  const resetLayout = () => store.commit((d) => {
    const keys = new Set(snapshot.nodes.map(refKey));
    for (const c of d.companies) if (keys.has(`company:${c.id}`)) delete c.position;
    for (const p of d.people) if (keys.has(`person:${p.id}`)) delete p.position;
  });

  const startDrag = (e: React.PointerEvent, n: NodeRef) => {
    if (e.button !== 0) return;
    const key = refKey(n), sx = e.clientX, sy = e.clientY;
    let moved = false;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      setDrag({ key, dx, dy });
    };
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      if (!moved) setSelected(n);
      else {
        const b = snapshot.positions.get(key);
        if (b) saveNode(n, { x: b.x + (ev.clientX - sx) / z, y: b.y + (ev.clientY - sy) / z });
      }
      setDrag(null);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };


  if (!store.data.companies.length) return (
    <div className="col grow" style={{ justifyContent: "center" }}>
      <EmptyStateView symbol="point.3.connected.trianglepath.dotted" title="还没有公司" message="从最上层的控股公司开始建，下面的公司选它做股东，结构图会自己连起来。" actionTitle="新建公司" action={() => router.open({ kind: "newCompany" })} />
      <div className="row gap8" style={{ justifyContent: "center", marginTop: 8 }}><Button onClick={() => void installSampleData(store)}>先看示例数据</Button></div>
    </div>
  );

  const g = store.group(group);
  const excluded = g?.excludedCompanyIDs?.length ?? 0;
  const labels = edgeLabels(store, routes, chain.edges, snapshot.activeHoldings);
  const checkOn = router.structureCheck;

  return (
    <div className="row grow" style={{ alignItems: "stretch", minHeight: 0 }}>
      <div className="col grow" style={{ minWidth: 0, position: "relative" }}>
        <div className="col gap8" style={{ padding: "var(--page-edge) var(--page-edge) 8px" }}>
          <PageHeader title="结构" stats={isToday ? (() => {
            const ids = new Set(snapshot.companies.map((c) => c.id));
            const mine = store.openObligations.filter((o) => ids.has(o.company.id));
            const over = mine.filter((o) => o.due < store.today).length, soon = mine.filter((o) => o.due >= store.today && D.daysBetween(store.today, o.due) <= 30).length;
            const unv = store.unverified.filter((x) => ids.has(x.item.companyID)).length;
            return [
              { label: "已逾期", value: over, unit: "件", tone: over ? "bad" as const : undefined, onClick: over ? () => router.go("due") : undefined },
              { label: "30 天内", value: soon, unit: "件", tone: soon ? "warn" as const : undefined, onClick: soon ? () => router.go("due") : undefined },
              { label: "在管公司", value: snapshot.companies.length, unit: "家" },
              { label: "待核实", value: unv, unit: "条", tone: unv ? "accent" as const : undefined, onClick: () => router.go("verify") },
            ];
          })() : undefined}>
            <Button kind="primary" icon="plus" onClick={() => router.open({ kind: "newCompany" })}>新建公司</Button>
          </PageHeader>
          <div className="row gap8 wrap">
            <BrandPills />
            {g && excluded > 0 && <button className="link t-meta" title={`这些公司股权能推导到，但你把它们排除在${latinPad(g.name)}之外`} onClick={() => router.open({ kind: "groupMembers", group: g.id })}>已排除 {excluded} 家</button>}
            <span className="spacer" />
            <button className={`v4-toggle ${checkOn ? "on" : ""}`} aria-pressed={checkOn} title="按股东录入情况给公司标色，并列出需要补充的公司" onClick={() => router.set("structureCheck", !checkOn)}>核对股东</button>
            <span className="seg-group row">
              <Button kind="quiet" size="small" icon="minus" title="缩小" onClick={() => animateZoom(clampZoom(z - 0.1))} />
              <Button kind="quiet" size="small" title="适合窗口" onClick={() => { scroller.current?.scrollTo({ left: 0, top: 0, behavior: reducedMotion() ? "auto" : "smooth" }); setSavedZoom(0); }}><span className="num">{savedZoom === 0 ? "适合窗口" : `${Math.round(z * 100)}%`}</span></Button>
              <Button kind="quiet" size="small" icon="plus" title="放大" onClick={() => animateZoom(clampZoom(z + 0.1))} />
            </span>
            <button className={`v4-toggle ${showHistory ? "on" : ""}`} aria-pressed={showHistory} title="显示时间轴，回看历年的持股结构" onClick={() => setShowHistory(!showHistory)}>历史</button>
            <ActionMenu icon="ellipsis" ariaLabel="更多" align="end" entries={[
              item("查询链条…", "arrow.triangle.branch", () => router.open({ kind: "chainQuery", from: selected?.kind === "person" ? selected : undefined, to: selected?.kind === "company" ? selected.id : undefined })),
              item("重新排列", "rectangle.3.group", resetLayout),
              item("导出 PDF…", "doc.text", () => void exportStructurePNG(store, snapshot, positions, routes, store.filterName(group), true)),
              item("导出图片（PNG）…", "square.and.arrow.up", () => void exportStructurePNG(store, snapshot, positions, routes, store.filterName(group))),
            ]} />
          </div>
          {isToday ? <span className="t-body muted">按住 {platform().os === "mac" ? "⌘" : "Ctrl"} 滚动或双指捏合缩放。点选固定链路，拖动调整位置。虚线是待核实的持股。</span>
            : <span className="t-body amber-text" style={{ fontWeight: 500 }}>历史视图：{D.year(asOf)} 年末的持股。不显示当前的截止日和文件提醒。{(() => { const n = snapshot.activeHoldings.filter((h) => !h.from).length; return n ? `其中 ${n} 条生效日期未知，按资料截至日期显示为“最晚自”。` : ""; })()}</span>}
        </div>
        <div ref={scroller} className={`grow dotgrid ${isToday ? "" : "tween"}`} style={{ overflow: "auto", minHeight: 0, position: "relative" }} onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.bg) setSelected(null); }}>
          <div data-bg="1" style={{ width: Math.max(snapshot.canvas.width * z, viewport.width), height: Math.max(snapshot.canvas.height * z, viewport.height), position: "relative" }}>
            <div data-bg="1" key={group ?? "all"} className="swap-in" style={{ position: "absolute", left: 0, top: 0, width: snapshot.canvas.width, height: snapshot.canvas.height, transform: `scale(${z})`, transformOrigin: "0 0" }}>
              <svg width={snapshot.canvas.width} height={snapshot.canvas.height} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }} aria-hidden>
                {snapshot.activeHoldings.filter((h) => !chain.edges.has(h.id)).map((h) => { const r = routes.get(h.id); return r && (
                  <path key={h.id} d={routePath(r)} fill="none" stroke={h.isNominee ? "var(--amber)" : "var(--edge)"} strokeOpacity={focused ? 0.22 : 1}
                    strokeWidth={1.4 / z} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={h.isNominee ? `${6 / z} ${4 / z}` : !h.verified ? `${4 / z} ${4 / z}` : undefined} />); })}
                {!isSoft() && snapshot.activeHoldings.filter((h) => chain.edges.has(h.id)).map((h) => { const r = routes.get(h.id); return r && <path key={h.id + "u"} d={routePath(r)} fill="none" stroke="var(--lime)" strokeOpacity={0.85} strokeWidth={8 / z} strokeLinecap="round" strokeLinejoin="round" />; })}
                {snapshot.activeHoldings.filter((h) => chain.edges.has(h.id)).map((h) => { const r = routes.get(h.id); return r && (
                  <path key={h.id + "h"} d={routePath(r)} fill="none" stroke={h.isNominee ? "var(--amber-text)" : isSoft() ? "var(--ink)" : "var(--on-lime)"} strokeWidth={2 / z} strokeLinecap="round" strokeLinejoin="round"
                    strokeDasharray={h.isNominee ? `${6 / z} ${4 / z}` : !h.verified ? `${4 / z} ${4 / z}` : undefined} />); })}
              </svg>
              {labels.map((l) => (
                <span key={l.id} className="t-micro num ellipsis" title={l.text} aria-label={l.text}
                  style={{ position: "absolute", left: l.x - l.width / 2, top: l.y - 11, width: l.width, height: 22, lineHeight: "20px", padding: "0 9px", borderRadius: 999, fontWeight: 600, textAlign: "center", pointerEvents: "none",
                    background: l.hot ? (l.nominee ? "var(--amber)" : isSoft() ? "var(--ink)" : "var(--lime)") : l.nominee ? "var(--amber-soft)" : "var(--surface)",
                    color: l.hot ? (isSoft() && !l.nominee ? "var(--on-ink)" : "var(--on-lime)") : l.nominee ? "var(--amber-text)" : "var(--ink)",
                    border: `1px solid ${l.hot ? "color-mix(in srgb, var(--on-lime) 25%, transparent)" : "var(--hairline)"}`, opacity: focused && !l.hot ? 0.3 : 1 }}>{l.text}</span>
              ))}
              {snapshot.companies.filter((c) => (snapshot.totalsByCompany.get(c.id) ?? 0) < 99.5).map((c) => {
                const total = snapshot.totalsByCompany.get(c.id) ?? 0;
                const p = positions.get(`company:${c.id}`);
                if (!p) return null;
                return <span key={c.id} className="t-micro muted" style={{ position: "absolute", left: p.x + 70, top: p.y + companySize.height / 2 + 14, transform: "translate(-50%, -50%)", height: 22, lineHeight: "20px", padding: "0 9px",
                  borderRadius: 999, border: "1px dashed color-mix(in srgb, var(--muted) 60%, transparent)", fontWeight: 600, whiteSpace: "nowrap", pointerEvents: "none", opacity: focused ? 0.3 : 1 }}>
                  {total === 0 ? "股东未录入" : `另有 ${percentLabel(100 - total)} 股东未录入`}</span>;
              })}
              {snapshot.nodes.map((n) => {
                const k = refKey(n), p = positions.get(k), s = sizeOf(n);
                if (!p) return null;
                const hot = chain.nodes.has(k) && focused;
                return (
                  <div key={k} className="v4-node-wrap" role="button" tabIndex={0} aria-label={store.nameOf(n)} aria-pressed={selected ? refKey(selected) === k : false}
                    onPointerDown={(e) => startDrag(e, n)} onPointerEnter={() => setHover(n)} onPointerLeave={() => setHover((h) => (h && refKey(h) === k ? null : h))}
                    onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setSelected(n); }}
                    onDoubleClick={() => (n.kind === "company" ? router.openCompany(n.id) : router.openPerson(n.id))}
                    style={{ position: "absolute", left: p.x - s.width / 2, top: p.y - s.height / 2, width: s.width, height: s.height, cursor: "default", touchAction: "none" }}>
                    <NodeView n={n} highlighted={hot} selected={!!selected && refKey(selected) === k} dimmed={focused && !chain.nodes.has(k)}
                      showNext={isToday && ((!!hover && refKey(hover) === k) || (!!selected && refKey(selected) === k))} showAlerts={isToday} />
                  </div>
                );
              })}
              {checkOn && isToday && snapshot.companies.filter((c) => store.shareholderCheckApplies(c)).map((c) => {
                const st = store.shareholderStatus(c.id, snapshot.asOf);
                const p = positions.get(`company:${c.id}`);
                if (!p) return null;
                const col = holderStatusColor(st);
                return <div key={c.id} style={{ position: "absolute", left: p.x - companySize.width / 2 - 4, top: p.y - companySize.height / 2 - 4, width: companySize.width + 8, height: companySize.height + 8,
                  borderRadius: 26, border: `${st.kind === "complete" ? 1.5 : 3}px solid ${col}`, pointerEvents: "none" }}>
                  <span className="t-micro" style={{ position: "absolute", right: -6, top: -10, height: 20, lineHeight: "20px", padding: "0 8px", borderRadius: 999, fontWeight: 700,
                    background: col, color: st.kind === "complete" ? "var(--on-lime)" : "var(--on-ink)", whiteSpace: "nowrap" }}>{holderStatusLabel(st)}</span>
                </div>;
              })}
            </div>
          </div>
        </div>
        {checkOn && <CheckList snapshot={snapshot} onPick={(c) => { const r = ref("company", c.id); setSelected(r); reveal(r); }} />}
        {showHistory && <div className="row" style={{ justifyContent: "center", padding: "12px 0" }}>
          <div className="slide-host row gap4 floating" style={{ padding: 6, borderRadius: 26, overflowX: "auto", maxWidth: "calc(100% - 24px)" }}>
            <SlideBg />
            <button onClick={() => setPlaying(!playing)} title={playing ? "暂停" : "回放结构变化"} aria-label={playing ? "暂停结构回放" : "回放结构变化"}
              style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--ink)", color: "var(--on-ink)", display: "grid", placeItems: "center", flex: "none" }}>
              <Icon name={playing ? "pause.fill" : "play.fill"} size={12} />
            </button>
            {stops.map((d, i) => {
              const on = d === asOf;
              return <button key={d} onClick={() => { setPlaying(false); setStopIndex(i); }} aria-pressed={on} aria-label={d === store.today ? "今天" : `${D.year(d)} 年末`}
                className={`num ${on ? "on" : ""}`} style={{ width: 62, height: 36, borderRadius: 999, flex: "none", fontWeight: on ? 700 : 500, color: on ? "var(--on-selection)" : "var(--muted)" }}>
                {d === store.today ? "今天" : D.year(d)}</button>;
            })}
          </div>
        </div>}
      </div>
      {selected?.kind === "company" && isToday && <InfoCard store={store} router={router} id={selected.id} />}
      {selected && !(selected.kind === "company" && isToday) && (
        <div className="col inspector" style={{ width: 340, flex: "none", background: "var(--surface)", borderLeft: "1px solid var(--hairline)", position: "relative", minHeight: 0 }}>
          <button className="close-x" aria-label="关闭详情" title="关闭" onClick={() => setSelected(null)}><Icon name="xmark" size={11} /></button>
          <Inspector key={refKey(selected)} n={selected} asOf={snapshot.asOf} />
        </div>
      )}
    </div>
  );
}

interface EdgeLabel { id: string; text: string; x: number; y: number; width: number; hot: boolean; nominee: boolean }
function edgeLabels(store: Store, routes: Map<string, Route>, hot: Set<string>, holdings: Holding[]): EdgeLabel[] {
  const est = (t: string) => Math.min(companySize.width - 10, [...t].reduce((a, ch) => a + (ch.codePointAt(0)! > 0x2e80 ? 12 : 8.5), 28));
  const labels: EdgeLabel[] = [];
  for (const h of holdings) {
    const r = routes.get(h.id);
    if (!r) continue;
    const text = h.isNominee ? `${store.nameOf(h.holder)}代${h.beneficialOwner ? store.nameOf(h.beneficialOwner) : "他人"}持有 ${percentLabel(h.percent)}` : percentLabel(h.percent);
    labels.push({ id: h.id, text, x: r.label.x, y: r.label.y, width: est(text), hot: hot.has(h.id), nominee: h.isNominee });
  }
  const rows = new Map<number, EdgeLabel[]>();
  for (const l of labels) { const k = Math.round(l.y / 8); rows.set(k, [...(rows.get(k) ?? []), l]); }
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) { const min = row[i - 1].x + row[i - 1].width / 2 + 6 + row[i].width / 2; if (row[i].x < min) row[i].x = min; }
  }
  return labels;
}

function CheckList({ snapshot, onPick }: { snapshot: StructureSnapshot; onPick: (c: Company) => void }) {
  const { store } = useApp();
  const items = snapshot.companies.filter((c) => store.shareholderCheckApplies(c)).map((c) => [c, store.shareholderStatus(c.id, snapshot.asOf)] as const)
    .filter(([, s]) => s.kind !== "complete").sort((a, b) => holderStatusRank(a[1]) - holderStatusRank(b[1]) || a[0].name.localeCompare(b[0].name, "zh"));
  return (
    <div className="col floating appear" style={{ position: "absolute", left: 16, bottom: 76, width: 280, borderRadius: 16, background: "var(--surface)", zIndex: 3 }}>
      <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>{items.length ? `${items.length} 家需要补充` : "股东都已录入完整"}</div>
      {items.length > 0 && <><div className="hairline" />
        <div className="scroll" style={{ maxHeight: 240 }}>
          {items.map(([c, s]) => (
            <button key={c.id} className="row gap8 hover-band" style={{ width: "100%", height: 30, padding: "0 14px", textAlign: "left" }} title={holderStatusDetail(s)} onClick={() => onPick(c)}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: holderStatusColor(s), flex: "none" }} />
              <span className="t-meta ellipsis grow">{c.name}</span>
              <span className="t-micro muted">{holderStatusLabel(s)}</span>
            </button>
          ))}
        </div></>}
    </div>
  );
}

function NodeView({ n, highlighted, selected, dimmed, showNext, showAlerts }: { n: NodeRef; highlighted: boolean; selected: boolean; dimmed: boolean; showNext: boolean; showAlerts: boolean }) {
  const { store } = useApp();
  const soft = isSoft();
  // 柔和风格：链路上的节点不加描边和 lime 光晕（靠其余节点变淡来突出），选中的节点用 2px 墨色描边 + 抬起阴影。
  if (soft) highlighted = false;
  const ring = selected ? "2px solid var(--ink)" : highlighted ? "2px solid color-mix(in srgb, var(--on-lime) 70%, transparent)" : "1px solid var(--hairline)";
  const halo = highlighted || selected ? "0 0 0 4px var(--lime)" : "none";
  const base: React.CSSProperties = { width: "100%", height: "100%", background: "var(--surface)", border: ring, opacity: dimmed ? 0.4 : 1, filter: dimmed ? "saturate(.2)" : undefined,
    transition: "opacity var(--fast) var(--ease), box-shadow var(--fast) var(--ease), border-color var(--fast) var(--ease)", display: "flex", alignItems: "center" };
  if (n.kind === "company") {
    const c = store.company(n.id);
    const next = store.complianceOn ? store.openObligations.find((o) => o.company.id === n.id) : undefined;
    const alert = showAlerts && store.ownedDocuments(n).some((d) => { const f = store.freshness(d); return f.kind === "expired" || f.kind === "expiring" || f.kind === "needsUpdate" || f.kind === "unknown"; });
    let detail: string, warn = false;
    if (showNext && next) { const left = Math.round(D.daysBetween(store.today, next.due)); detail = left < 0 ? `逾期 ${-left} 天：${next.rule.name}` : `${left} 天后：${next.rule.name}`; }
    else if (showAlerts && !store.directShareholders(n.id).length) { detail = "股东待补"; warn = true; }
    else if (alert) { detail = "有文件需要更新"; warn = true; }
    else {
      const dirs = [...new Set(store.officers(n.id).map((a) => store.person(a.personID)?.name ?? ""))].filter(Boolean);
      detail = store.jurisdictionName(c?.jurisdiction ?? "") + (dirs.length ? " · 董事 " + dirs.join("、") : "");
    }
    const brand = store.brandOf(n.id);
    const soon = showAlerts && !!next && D.daysBetween(store.today, next.due) <= 30;
    const tint = soft && brand ? store.brandColor(brand) : null;
    return (
      <div className={tint ? "tinted" : undefined} style={{ ...base, ...(soft ? { background: tint ? softBg(tint) : "var(--surface)", border: selected ? ring : `1px solid ${tint ? "transparent" : "var(--hairline)"}` } : null), gap: 12, padding: "0 14px", borderRadius: 22, boxShadow: `${halo}, 0 ${selected ? 8 : 3}px ${selected ? 16 : 8}px rgba(0,0,0,${selected ? 0.16 : 0.06})` }}>
        <JurisdictionBadge code={c?.jurisdiction ?? "?"} size={42} highlighted={highlighted} />
        <span className="col grow" style={{ minWidth: 0 }}>
          <span className="t-row" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c?.name ?? ""}</span>
          <span className="t-meta num ellipsis" style={{ color: warn ? "var(--amber-text)" : tint ? softInk(tint) : "var(--muted)", fontWeight: warn ? 600 : 400 }}>{detail}</span>
        </span>
        <span className="col" style={{ gap: 6, alignItems: "center", flex: "none" }}>
          {!tint && <span className="v4-dot" title={brand ? brand.name : "各集团共用"} style={{ background: brand ? store.brandColor(brand) : "transparent", boxShadow: brand ? undefined : "inset 0 0 0 1.5px var(--muted)" }} />}
          {soon && <span className="v4-dot" title="30 天内有事项到期" style={{ background: next && next.due < store.today ? "var(--danger)" : "var(--amber)" }} />}
        </span>
      </div>
    );
  }
  const p = store.person(n.id);
  const nominee = store.data.holdings.some((h) => h.holder.kind === "person" && h.holder.id === n.id && h.isNominee);
  return (
    <div style={{ ...base, gap: 10, padding: "0 18px 0 6px", borderRadius: 999, boxShadow: `${halo}, 0 8px 12px rgba(0,0,0,.12)` }}>
      <span style={{ width: 44, height: 44, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", fontSize: 16, fontWeight: 700,
        color: highlighted || !nominee ? "var(--on-ink)" : "var(--ink)", background: highlighted ? "var(--ink)" : nominee ? "transparent" : "color-mix(in srgb, var(--ink) 85%, transparent)",
        border: nominee && !highlighted ? "1.5px dashed var(--muted)" : "none" }}>{[...(p?.name ?? "?")][0]}</span>
      <span className="col" style={{ minWidth: 0, gap: 1 }}>
        <span className="t-row" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p?.name ?? ""}</span>
        <span className="t-meta muted">{nominee ? "名义股东" : "股东"}</span>
      </span>
    </div>
  );
}

// MARK: - 详情栏

const palette = ["var(--ink)", "var(--lime)", "color-mix(in srgb, var(--muted) 50%, transparent)"];
const holderColor = (h: Holding, i: number) => (h.isNominee ? "var(--amber)" : palette[i % palette.length]);

function Donut({ values, colors, size = 64 }: { values: number[]; colors: string[]; size?: number }) {
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const r = size / 2, ir = r * 0.62, gap = 1.5 * Math.PI / 180;
  let a0 = -Math.PI / 2;
  const arcs = values.map((v, i) => {
    const a1 = a0 + (v / total) * Math.PI * 2;
    const s = a0 + (values.length > 1 ? gap / 2 : 0), e = a1 - (values.length > 1 ? gap / 2 : 0);
    a0 = a1;
    if (values.length === 1) return <circle key={i} cx={r} cy={r} r={(r + ir) / 2} fill="none" stroke={colors[i]} strokeWidth={r - ir} />;
    const large = e - s > Math.PI ? 1 : 0;
    const p = (rad: number, ang: number) => `${r + rad * Math.cos(ang)} ${r + rad * Math.sin(ang)}`;
    return <path key={i} fill={colors[i]} d={`M ${p(r, s)} A ${r} ${r} 0 ${large} 1 ${p(r, e)} L ${p(ir, e)} A ${ir} ${ir} 0 ${large} 0 ${p(ir, s)} Z`} />;
  });
  return <svg width={size} height={size} aria-hidden style={{ flex: "none" }}>{arcs}</svg>;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><div className="hairline" /><div className="col gap12" style={{ padding: "20px 24px" }}><span className="t-section" role="heading" aria-level={3}>{title}</span>{children}</div></div>;
}

function Inspector({ n, asOf }: { n: NodeRef; asOf: Day }) {
  const { store, router } = useApp();
  return (
    <>
      <div className="scroll grow appear" style={{ fontSize: 13.5 }}>{n.kind === "company" ? <CompanyInspector id={n.id} asOf={asOf} /> : <PersonInspector id={n.id} asOf={asOf} />}</div>
      <div className="row gap8" style={{ padding: "16px 24px", borderTop: "1px solid var(--hairline)", flex: "none" }}>
        {n.kind === "company" ? <>
          <Button size="small" onClick={() => router.open({ kind: "addRelation", companyID: n.id, upward: true })}>添加上级…</Button>
          <Button size="small" onClick={() => router.open({ kind: "addRelation", companyID: n.id, upward: false })}>添加下级…</Button>
          <span className="spacer" />
          <Button kind="primary" size="small" onClick={() => { router.companyTab = 0; router.openCompany(n.id); }}>打开档案</Button>
        </> : <><span className="spacer" /><Button kind="primary" onClick={() => router.openPerson(n.id)}>打开档案</Button></>}
      </div>
      {void store}
    </>
  );
}

function ChangeMenu({ companyID, appointmentID, holdingID }: { companyID: string; appointmentID?: string; holdingID?: string }) {
  const { router } = useApp();
  return <ActionMenu icon="ellipsis" kind="quiet" size="small" align="end" ariaLabel="更多操作" entries={[
    item(holdingID ? "记录变更（股权转让）…" : "记录变更（离任或变更）…", "arrow.triangle.2.circlepath",
      () => router.open({ kind: "changeFrom", companyID, changeKind: holdingID ? "shareholderChange" : "directorChange", appointmentID, holdingID })),
  ]} />;
}

function CompanyInspector({ id, asOf }: { id: string; asOf: Day }) {
  const { store, router } = useApp();
  const c = store.company(id);
  const holders = activeHoldings(store.data.holdings, asOf).filter((h) => h.companyID === id).sort((a, b) => b.percent - a.percent);
  const b = store.breakdownOf(id, asOf);
  const officers = store.officers(id, asOf);
  const chains = store.chainsFromTops(id, asOf);
  const groupedOfficers: { personID: string; titles: string[]; first: string }[] = [];
  for (const a of officers) { const g = groupedOfficers.find((x) => x.personID === a.personID); if (g) g.titles.push(a.title); else groupedOfficers.push({ personID: a.personID, titles: [a.title], first: a.id }); }
  const memberships = store.data.groups.map((g) => [g, store.membership(id, g)] as const).filter(([, m]) => m.kind !== "none");
  const fact = (label: string, value: string, mono: boolean) => (
    <div className="col grow" style={{ gap: 6, padding: "16px 24px" }}>
      <span className="t-meta muted">{label}</span>
      <span className={`selectable ${mono ? "mono" : ""}`} style={{ fontSize: 14, fontWeight: 500, color: value ? "var(--ink)" : "var(--muted)" }}>{value || "未填写"}</span>
    </div>
  );
  const next = store.complianceOn && asOf === store.today ? store.openObligations.find((o) => o.company.id === id) : undefined;
  const left = next ? D.daysBetween(store.today, next.due) : 0;
  return (
    <div className="col">
      <div className="col gap16" style={{ padding: "24px 40px 24px 24px" }}>
        <JurisdictionBadge code={c?.jurisdiction ?? "?"} size={48} highlighted />
        <div className="col gap6">
          <span className="t-title selectable" style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c?.name}</span>
          <div className="row gap6 wrap">{c && <CompanyChips c={c} />}</div>
        </div>
      </div>
      <div className="hairline" />
      <div className="row" style={{ alignItems: "stretch" }}>{fact("注册编号", c?.registrationNumber ?? "", true)}<span className="vrule" />{fact("成立日期", c?.incorporationDate ?? "", true)}</div>
      <div className="hairline" />
      {fact("注册地址", c?.registeredAddress ?? "", false)}
      {router.structureCheck && c && store.shareholderCheckApplies(c) && (() => {
        const st = store.shareholderStatus(c.id, asOf);
        return <Block title="股东核对">
          <span className="row gap8"><span style={{ width: 9, height: 9, borderRadius: "50%", background: holderStatusColor(st) }} /><b>{holderStatusLabel(st)}</b></span>
          <span className="muted">{holderStatusDetail(st)}</span>
          <span className="row gap8">
            <Button size="small" onClick={() => router.open({ kind: "addRelation", companyID: c.id, upward: true })}>添加股东…</Button>
            <Button kind="quiet" size="small" onClick={() => router.open({ kind: "editCompany", companyID: c.id })}>编辑股东…</Button>
          </span>
        </Block>;
      })()}
      <Block title="集团归属">
        {!memberships.length && <span className="muted">不属于任何集团</span>}
        {memberships.map(([g, m]) => (
          <div key={g.id} className="col gap4">
            <div className="row gap6">
              <span style={{ fontWeight: 600, color: m.kind === "excluded" ? "var(--muted)" : "var(--ink)" }}>{g.name}</span>
              <Pill text={sourceLabel(m)} kind={m.kind === "manual" || m.kind === "excluded" ? "outline" : "neutral"} />
              <span className="spacer" />
              {m.kind === "excluded" ? <Button kind="quiet" size="small" onClick={() => { store.restoreToGroup(id, g.id); store.showToast(`已恢复为按股权归入${latinPadStart(g.name)}`); }}>恢复</Button>
                : m.kind !== "top" && <Button kind="quiet" size="small" onClick={() => {
                  let text = "";
                  const u = store.undoable("移出集团", () => { text = store.moveOut(id, g.id); });
                  store.showToast(text, u ? () => store.undoID(u) : undefined);
                }}>移出</Button>}
            </div>
            <span className="t-meta muted">{store.membershipExplanation(id, g)}</span>
          </div>
        ))}
        {memberships.filter(([, m]) => isMember(m)).length > 1 && <span className="t-meta amber-text">同时属于多个集团。如果只应归入其中一个，把其他的移出即可。</span>}
        
      </Block>
      <Block title="任职人员">
        {!officers.length && <span className="muted">未录入</span>}
        {groupedOfficers.map((a) => (
          <div key={a.personID} className="row gap8">
            <button className="row gap4" onClick={() => router.openPerson(a.personID)}><b>{store.nameOf(ref("person", a.personID))}</b><Icon name="arrow.up.right" size={9} className="muted" /></button>
            <span className="spacer" /><span className="muted" style={{ textAlign: "right" }}>{a.titles.join("、")}</span>
            <ChangeMenu companyID={id} appointmentID={a.first} />
          </div>
        ))}
      </Block>
      {holders.length > 0 && <Block title="直接股东">
        <div className="row start gap14">
          <Donut values={holders.map((h) => h.percent)} colors={holders.map(holderColor)} />
          <div className="col gap6 grow" style={{ minWidth: 0 }}>
            {holders.map((h, i) => (
              <div key={h.id} className="row gap6">
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: holderColor(h, i), flex: "none" }} />
                <span className="col grow" style={{ minWidth: 0, gap: 1 }}>
                  <span className="ellipsis">{store.nameOf(h.holder)}</span>
                  {h.isNominee && <span className="amber-text" style={{ fontSize: 11.5 }}>名义股东，代{h.beneficialOwner ? store.nameOf(h.beneficialOwner) : "他人"}持有</span>}
                </span>
                <b className="num">{percentLabel(h.percent)}</b>
                <ChangeMenu companyID={id} holdingID={h.id} />
              </div>
            ))}
          </div>
        </div>
      </Block>}
      <Block title="最终受益（穿透）">
        {!b.owners.length && b.unknown < 0.005 && <span className="muted">股东未录入</span>}
        {b.owners.map((u) => (
          <div key={refKey(u.owner)} className="row gap6">
            <span style={{ fontWeight: 500 }}>{store.nameOf(u.owner)}</span>
            {u.viaNominee && <Pill text="含代持" kind="warn" />}{u.isTopCompany && <Pill text="上层未录入" />}
            <span className="spacer" /><b className="num">{percentLabel(u.percent)}</b>
          </div>
        ))}
        {b.unknown > 0.005 && <div className="col" style={{ gap: 2 }}>
          <div className="row amber-text"><span style={{ fontWeight: 500 }}>未识别</span><span className="spacer" /><b className="num">{percentLabel(b.unknown)}</b></div>
          {b.gaps.map((g) => <span key={g.companyID} className="muted" style={{ fontSize: 12 }}>{store.nameOf(ref("company", g.companyID))} 有 {percentLabel(g.missing)} 股东未录入</span>)}
          {b.cyclicCompanyIDs.length > 0 && <span className="t-meta amber-text">存在循环持股，相关比例暂列未识别，需单独核算。</span>}
          {b.unresolvedNominees.map((h) => <span key={h.id} className="amber-text" style={{ fontSize: 12 }}>{store.nameOf(h.holder)} 的代持受益人尚未确认</span>)}
        </div>}
      </Block>
      {chains.length > 0 && <Block title="所在链条">
        {chains.slice(0, 6).map((x) => <div key={x.group.id + x.chain.id} className="col" style={{ gap: 1 }}><span className="muted" style={{ fontSize: 12 }}>{x.group.name}</span><span className="selectable">{store.chainText(x.chain)}</span></div>)}
      </Block>}
      {next && <Block title="下一项截止">
        <div className="row baseline"><span style={{ fontWeight: 500 }}>{next.rule.name}</span><span className="spacer" />
          <b className="num" style={{ color: left < 0 ? "var(--danger)" : left <= 7 ? "var(--amber-text)" : "var(--ink)" }}>{left < 0 ? `逾期 ${-left} 天` : `${left} 天后`}</b></div>
      </Block>}
      {c && <><div className="hairline" /><div style={{ padding: 24 }}>
        <Button kind="accent" icon="doc.on.doc" title="公司名称、注册编号、成立日期、地址、董事、股东、穿透和链条，可直接发给同事或中介"
          onClick={() => { void platform().copyText(store.companySummary(c, asOf)); store.showToast("公司资料摘要已复制。"); }}>复制公司资料摘要</Button>
      </div></>}
    </div>
  );
}

function PersonInspector({ id, asOf }: { id: string; asOf: Day }) {
  const { store, router } = useApp();
  const p = store.person(id);
  const owned = portfolio(ref("person", id), store.data.companies, store.data.holdings, asOf);
  const roles = store.data.appointments.filter((a) => a.personID === id && isActiveOn(a, asOf));
  return (
    <div className="col">
      <div className="col gap16" style={{ padding: "24px 40px 24px 24px" }}>
        <span aria-hidden style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--ink)", color: "var(--on-ink)", display: "grid", placeItems: "center", fontSize: 20, fontWeight: 700 }}>{[...(p?.name ?? "?")][0]}</span>
        <div className="col gap6"><span className="t-title selectable">{p?.name}</span>{p?.notes && <span className="muted">{p.notes}</span>}</div>
      </div>
      <Block title="穿透后持有">
        {!owned.length && <span className="muted">没有持股</span>}
        {owned.map((x) => (
          <button key={x.company.id} className="row gap10" style={{ textAlign: "left" }} onClick={() => router.openCompany(x.company.id)}>
            <JurisdictionBadge code={x.company.jurisdiction} size={30} tint={companyTint(store, x.company.id)} /><span className="ellipsis">{x.company.name}</span>
            {x.viaNominee && <Pill text="含代持" kind="warn" />}<span className="spacer" /><b className="num">{percentLabel(x.percent)}</b>
          </button>
        ))}
      </Block>
      {roles.length > 0 && <Block title="任职">
        {roles.map((a) => <div key={a.id} className="row gap8"><span className="ellipsis">{store.company(a.companyID)?.name ?? ""}</span><span className="spacer" /><span className="muted">{a.title}</span></div>)}
      </Block>}
    </div>
  );
}

void Spinner; void personSize;

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

async function exportStructurePNG(store: Store, snap: StructureSnapshot, positions: Map<string, Pt>, routes: Map<string, Route>, title: string, pdf = false) {
  const p = platform();
  const name = `${title} 结构图 ${store.today}.${pdf ? "pdf" : "png"}`;
  const path = await p.saveDialog({ defaultName: name, extensions: [pdf ? "pdf" : "png"], title: "导出结构图" });
  if (!path) return;
  const pad = 40, head = 56, scale = 2;
  const W = snap.canvas.width + pad * 2, H = snap.canvas.height + pad * 2 + head;
  const cv = document.createElement("canvas"); cv.width = W * scale; cv.height = H * scale;
  const g = cv.getContext("2d")!; g.scale(scale, scale);
  const font = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei UI", sans-serif';
  g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#121212"; g.font = `700 20px ${font}`; g.fillText(name.replace(/\.(png|pdf)$/, ""), pad, pad + 6);
  g.translate(pad, pad + head);
  for (const h of snap.activeHoldings) {
    const r = routes.get(h.id); if (!r) continue;
    g.strokeStyle = h.isNominee ? "#E3A21A" : "#B0B0B8"; g.lineWidth = 1.4; g.setLineDash(h.isNominee ? [6, 4] : []);
    g.stroke(new Path2D(routePath(r)));
  }
  g.setLineDash([]);
  for (const l of edgeLabels(store, routes, new Set(), snap.activeHoldings)) {
    g.font = `600 11px ${font}`; const w = l.width;
    g.beginPath(); g.roundRect(l.x - w / 2, l.y - 10, w, 20, 10); g.fillStyle = l.nominee ? "#FCEFD3" : "#FFFFFF"; g.fill(); g.strokeStyle = "#E4E4E8"; g.stroke();
    g.fillStyle = l.nominee ? "#8A5A00" : "#121212"; g.textAlign = "center"; g.fillText(l.text, l.x, l.y + 4); g.textAlign = "left";
  }
  const clip = (t: string, w: number) => { if (g.measureText(t).width <= w) return t; let x = t; while (x && g.measureText(x + "…").width > w) x = x.slice(0, -1); return x + "…"; };
  for (const n of snap.nodes) {
    const c = positions.get(refKey(n)); if (!c) continue;
    const s = sizeOf(n), x = c.x - s.width / 2, y = c.y - s.height / 2;
    g.beginPath(); g.roundRect(x, y, s.width, s.height, n.kind === "company" ? 22 : s.height / 2); g.fillStyle = "#FFFFFF"; g.fill(); g.strokeStyle = "#D6D6DB"; g.lineWidth = 1; g.stroke();
    if (n.kind === "company") {
      const co = store.company(n.id)!;
      g.beginPath(); g.roundRect(x + 14, y + s.height / 2 - 21, 42, 42, 12); g.fillStyle = "#F4F4F6"; g.fill();
      g.fillStyle = "#121212"; g.font = `700 13px ${font}`; g.textAlign = "center"; g.fillText(co.jurisdiction, x + 35, y + s.height / 2 + 5); g.textAlign = "left";
      g.font = `600 14px ${font}`; g.fillText(clip(co.name, s.width - 90), x + 68, y + s.height / 2 - 3);
      const dirs = [...new Set(store.officers(n.id).map((a) => store.person(a.personID)?.name ?? ""))].filter(Boolean);
      g.fillStyle = "#6B6B73"; g.font = `12px ${font}`; g.fillText(clip(store.jurisdictionName(co.jurisdiction) + (dirs.length ? " · 董事 " + dirs.join("、") : ""), s.width - 90), x + 68, y + s.height / 2 + 15);
      const b = store.brandOf(n.id); if (b) { g.beginPath(); g.arc(x + s.width - 16, y + s.height / 2, 4, 0, Math.PI * 2); g.fillStyle = store.brandColor(b); g.fill(); }
    } else {
      g.fillStyle = "#121212"; g.beginPath(); g.arc(x + 28, y + s.height / 2, 20, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#FFFFFF"; g.font = `700 15px ${font}`; g.textAlign = "center"; g.fillText([...store.nameOf(n)][0] ?? "", x + 28, y + s.height / 2 + 5); g.textAlign = "left";
      g.fillStyle = "#121212"; g.font = `600 14px ${font}`; g.fillText(clip(store.nameOf(n), s.width - 70), x + 56, y + s.height / 2 + 5);
    }
  }
  if (pdf) {
    const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b!), "image/jpeg", 0.92));
    await p.writeBytes(path, jpegPDF(new Uint8Array(await blob.arrayBuffer()), cv.width, cv.height, W, H));
  } else {
    const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b!), "image/png"));
    await p.writeBytes(path, new Uint8Array(await blob.arrayBuffer()));
  }
  store.showToast("结构图已导出。", () => void p.reveal(path), "在访达中显示");
}

/** 集团切换：结构页和公司页共用 router.groupFilter。 */
export function BrandPills() {
  const { store, router } = useApp();
  const group = router.groupFilter;
  return (
    <div className="v4-pills slide-host" role="tablist" aria-label="集团">
      <SlideBg />
      <button role="tab" aria-selected={!group} className={!group ? "on" : ""} onClick={() => router.set("groupFilter", null)}>全部</button>
      {[...store.data.groups].sort((a, b) => a.name.localeCompare(b.name)).map((x) => (
        <button key={x.id} role="tab" aria-selected={group === x.id} className={group === x.id ? "on" : ""} onClick={() => router.set("groupFilter", x.id)}>
          <span className="v4-dot" style={{ background: store.brandColor(x) }} />{x.name}
        </button>
      ))}
      <ActionMenu icon="ellipsis" ariaLabel="集团" align="end" showsChevron={false} kind="quiet" size="small" entries={[
        ...(store.group(group) ? [item(`编辑“${store.group(group)!.name}”…`, "pencil", () => router.openSettings("groups", group))] : []),
        item("新建集团…", "plus", () => router.openSettings("groups", "new")),
        item("管理全部集团…", "square.stack.3d.up", () => router.openSettings("groups")),
      ]} />
    </div>
  );
}
