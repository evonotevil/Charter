// 5.5.6 入门教程：演示数据上的聚光说明（Coachmark）。只高亮和说明，由教程切换页面；可以上一步、下一步、跳过。
// 设计稿：Figma · 5.5.6 · 入门教程（T1–T8）与组件 Feedback / Coachmark。

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../state/hooks";
import type { Router } from "../state/router";
import type { Store } from "../state/store";
import { finishTour, isDemo } from "../state/demo";
import { platform } from "../platform/platform";
import { Button, Note } from "../ui/kit";

interface Step { title: string; body: string; label?: string; go?: (r: Router, s: Store) => void; target?: () => Element | null }

const mod = () => (platform().os === "windows" ? "Ctrl+" : "⌘");
const sampleCompany = (s: Store) => s.data.companies.find((c) => c.name.includes("远澜控股")) ?? s.data.companies[0];

export function tourSteps(): Step[] {
  return [
    { title: "欢迎使用 Charter", label: "入门 · 约 2 分钟", body: "用一套虚构的远澜集团档案，带你认识界面和常用操作。演示中的修改不会保存，随时可以跳过。", go: (r) => r.go("companies") },
    { title: "侧栏：切换工作区", body: `公司总览、申报日历、股权结构、文件、人员与中介都在这里。${mod()}1–5 直接切换，${mod()}K 搜索公司或人。`, go: (r) => r.go("companies"), target: () => document.querySelector("aside.side") },
    { title: "公司总览：先看要处理的事", body: "每家公司的下一项申报、我负责的材料齐全度和状态一眼看完。点一行打开公司。", go: (r) => r.go("companies"), target: () => document.querySelector(".tour-companies") },
    { title: "公司页：资料与关系", body: "名称下面的法域、实体类型、集团都可以直接点开修改，改动记入历史、可以撤销。", go: (r, s) => { const c = sampleCompany(s); if (c) r.openCompany(c.id, 0) }, target: () => document.querySelector(".page-head") },
    { title: "股权结构：从集团看到最终持有人", body: "已核实的持股是实线，待核实的是虚线。点一家公司，高亮它上下的持股链。", go: (r) => r.go("structure"), target: () => document.querySelector(".chart-canvas")?.parentElement ?? null },
    { title: "申报日历：到期不漏", body: "按日期排好的待办。做完点右侧圆圈标为完成；到期前 60、30、7 天会提醒。", go: (r) => r.go("due"), target: () => document.querySelector(".tour-due") },
    { title: "文件：上传、核对、对外发送", body: "把文件拖到公司页即可归档，Charter 识别类型和日期。需要对外提供时，点右上角“准备文件包”。", go: (r, s) => { const c = sampleCompany(s); if (c) r.openCompany(c.id, 2) }, target: () => document.querySelector(".tour-files") },
    { title: "开始建立你的档案", body: "演示数据会清空。可以新建公司、拖入文件，或选择一个已有的数据文件夹。设置里随时可以重新看教程。", go: (r) => r.go("companies") },
  ];
}

/** 顶部横幅：演示中 · 修改不会保存。 */
export function DemoBanner() {
  if (!isDemo()) return null;
  return <div className="demo-banner"><Note tone="info" action={<Button size="small" onClick={() => finishTour()}>退出演示</Button>}>演示中 · 这是一套虚构的远澜集团档案，修改不会保存。</Note></div>;
}

type Rect = { x: number; y: number; w: number; h: number };

export function TourOverlay() {
  const { store, router } = useApp();
  const steps = useRef(tourSteps()).current;
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const card = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 340, h: 200 });
  const step = steps[i];
  const last = i === steps.length - 1;

  function goTo(index: number) {
    // 让页面切换和说明卡更新在同一次交互中提交。
    steps[index].go?.(router, store);
    setI(index);
  }

  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const target = step.target?.() ?? null;
    const measure = () => {
      const bounds = target?.getBoundingClientRect();
      const next = bounds ? { x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height } : null;
      setRect((prev) => prev && next && prev.x === next.x && prev.y === next.y
        && prev.w === next.w && prev.h === next.h ? prev : next);
      const w = el.offsetWidth, h = el.offsetHeight;
      setCardSize((prev) => prev.w === w && prev.h === h ? prev : { w, h });
    };
    const onResize = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight });
      measure();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (target) observer.observe(target);
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [step]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finishTour(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (last) finishTour(); else goTo(i + 1); }
      else if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); e.stopPropagation(); goTo(i - 1); }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [i]);

  const pad = 8, gap = 16, edge = 24;
  // Windows 右上角是系统的最小化/关闭按钮（34px 高），说明卡避开这一条
  const top = platform().os === "windows" ? 44 : edge;
  const hole = rect ? { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), r: Math.min(vp.w, rect.x + rect.w + pad), b: Math.min(vp.h, rect.y + rect.h + pad) } : null;
  let cx = (vp.w - cardSize.w) / 2, cy = (vp.h - cardSize.h) / 2;
  if (hole) {
    if (vp.w - hole.r >= cardSize.w + gap + edge) { cx = hole.r + gap; cy = hole.y; }
    else if (vp.h - hole.b >= cardSize.h + gap + edge) { cx = hole.r - cardSize.w; cy = hole.b + gap; }
    else { cx = hole.r - cardSize.w - edge; cy = hole.b - cardSize.h - edge; }
  }
  cx = Math.max(edge, Math.min(cx, vp.w - cardSize.w - edge));
  cy = Math.max(top, Math.min(cy, vp.h - cardSize.h - edge));

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="入门教程">
      {hole ? <>
        <div className="tour-scrim" style={{ left: 0, top: 0, width: vp.w, height: hole.y }} />
        <div className="tour-scrim" style={{ left: 0, top: hole.b, width: vp.w, height: vp.h - hole.b }} />
        <div className="tour-scrim" style={{ left: 0, top: hole.y, width: hole.x, height: hole.b - hole.y }} />
        <div className="tour-scrim" style={{ left: hole.r, top: hole.y, width: vp.w - hole.r, height: hole.b - hole.y }} />
        <div className="tour-ring" style={{ left: hole.x, top: hole.y, width: hole.r - hole.x, height: hole.b - hole.y }} />
      </> : <div className="tour-scrim" style={{ inset: 0 }} />}
      <div ref={card} className="coachmark" style={{ left: cx, top: cy }} aria-live="polite">
        <span className="t-meta muted">{step.label ?? `第 ${i + 1} / ${steps.length} 步`}</span>
        <span className="t-title">{step.title}</span>
        <span className="t-body muted">{step.body}</span>
        <div className="coachmark-foot">
          <span className="coachmark-dots" aria-hidden>{steps.map((_, k) => <i key={k} className={k <= i ? "on" : ""} />)}</span>
          <span className="spacer" />
          {!last && <Button kind="quiet" size="small" onClick={() => finishTour()}>跳过</Button>}
          {i > 0 && <Button size="small" onClick={() => goTo(i - 1)}>上一步</Button>}
          <Button kind="primary" size="small" onClick={() => (last ? finishTour() : goTo(i + 1))}>{i === 0 ? "开始" : last ? "开始使用" : "下一步"}</Button>
        </div>
      </div>
    </div>
  );
}
