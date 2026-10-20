// 动效工具（DESIGN.md §5）：滑动底块、列表增删、数字变化、离场残影。

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 节点即将或已经被 React 移除时，在原位置留一个复制品淡出，再删掉。 */
export function ghostOut(node: HTMLElement, at: { parent: Element; left: number; top: number; width: number; height: number }, cls = "ghost-out", ms = 160) {
  if (reducedMotion() || !at.parent.isConnected) return;
  const g = node.cloneNode(true) as HTMLElement;
  g.removeAttribute("id");
  g.setAttribute("aria-hidden", "true");
  g.classList.remove("cp-new", "appear");
  g.classList.add(cls);
  Object.assign(g.style, { position: "absolute", left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px`, height: `${at.height}px`,
    margin: "0", pointerEvents: "none", zIndex: "30", boxSizing: "border-box" });
  at.parent.appendChild(g);
  setTimeout(() => g.remove(), ms);
}

/** 列表行：新出现的行（新增或撤销恢复）给 1 秒浅色高亮；被删掉的行原地淡出。首次渲染的行不算新。 */
export function useListMotion(ids: string[]) {
  const prev = useRef<Set<string> | null>(null);
  const marks = useRef(new Map<string, number>());
  const nodes = useRef(new Map<string, HTMLElement>());
  const places = useRef(new Map<string, { parent: Element; left: number; top: number; width: number; height: number; el: HTMLElement }>());
  const cur = new Set(ids);
  if (prev.current) for (const id of ids) if (!prev.current.has(id) && !marks.current.has(id)) marks.current.set(id, Date.now());
  useLayoutEffect(() => {
    if (prev.current) for (const [id, p] of places.current) if (!cur.has(id)) ghostOut(p.el, p);
    places.current.clear();
    for (const [id, el] of nodes.current) {
      if (!cur.has(id) || !el.isConnected) { nodes.current.delete(id); continue; }
      const parent = el.offsetParent;
      if (parent) places.current.set(id, { parent, left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight, el });
    }
    for (const id of [...marks.current.keys()]) if (!cur.has(id)) marks.current.delete(id);
    prev.current = cur;
  });
  return {
    isNew: (id: string) => { const t = marks.current.get(id); return t !== undefined && Date.now() - t < 1500; },
    rowRef: (id: string) => (el: HTMLElement | null) => { if (el) nodes.current.set(id, el); },
  };
}

/** 数字变化：只在值改变后过渡（600ms），首次显示不动。 */
export function useTweenNumber(value: number, ms = 600) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || reducedMotion()) { from.current = value; setShown(value); return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(start + (value - start) * e);
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

export function TweenNumber({ value }: { value: number }) {
  return <>{useTweenNumber(value)}</>;
}

/**
 * 共享的黑色选中底块：放在容器里作为第一个子元素，容器加 `slide-host`。
 * 底块跟随容器内带 `.on` 的项滑动（standard）；首次出现时不滑。
 */
export function SlideBg({ selector = ".on" }: { selector?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const place = () => {
    const bg = ref.current, host = bg?.parentElement;
    if (!bg || !host) return;
    const on = host.querySelector<HTMLElement>(selector);
    if (!on) { bg.style.opacity = "0"; placed.current = false; return; }
    const h = host.getBoundingClientRect(), r = on.getBoundingClientRect();
    const x = r.left - h.left + host.scrollLeft - host.clientLeft, y = r.top - h.top + host.scrollTop - host.clientTop;
    if (!placed.current) bg.style.transition = "none";
    bg.style.transform = `translate(${x}px, ${y}px)`;
    bg.style.width = `${r.width}px`;
    bg.style.height = `${r.height}px`;
    bg.style.borderRadius = getComputedStyle(on).borderRadius;
    bg.style.opacity = "1";
    if (!placed.current) { void bg.offsetWidth; bg.style.transition = ""; placed.current = true; }
  };
  useLayoutEffect(place);
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const ro = new ResizeObserver(() => { const bg = ref.current; if (bg) { bg.style.transition = "none"; place(); void bg.offsetWidth; bg.style.transition = ""; } });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  return <span ref={ref} className="slide-bg" aria-hidden />;
}

/**
 * 容器级的增删动效：容器内带 `data-mid` 的元素算一行（任意层级）。scope 变化（换选中项、搜索）时不算增删。
 * 删掉的行原地淡出，新出现的行（含撤销恢复）浅色高亮 1 秒。首次渲染不动。容器需要 position: relative。
 */
export function useChildMotion<T extends HTMLElement>(scope?: string) {
  const ref = useRef<T>(null);
  const lastScope = useRef(scope);
  const prev = useRef<Map<string, { el: HTMLElement; left: number; top: number; width: number; height: number }> | null>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const now = new Map<string, { el: HTMLElement; left: number; top: number; width: number; height: number }>();
    const h = host.getBoundingClientRect();
    for (const el of host.querySelectorAll<HTMLElement>("[data-mid]")) {
      if (el.classList.contains("ghost-out")) continue;
      const r = el.getBoundingClientRect();
      now.set(el.dataset.mid!, { el, left: r.left - h.left + host.scrollLeft - host.clientLeft, top: r.top - h.top + host.scrollTop - host.clientTop, width: r.width, height: r.height });
    }
    const was = lastScope.current === scope ? prev.current : null;
    lastScope.current = scope;
    if (was && !reducedMotion()) {
      for (const [id, p] of was) if (!now.has(id)) ghostOut(p.el, { parent: host, ...p });
      for (const [id, p] of now) if (!was.has(id)) {
        p.el.classList.remove("cp-new"); void p.el.offsetWidth; p.el.classList.add("cp-new");
        window.setTimeout(() => p.el.classList.remove("cp-new"), 1200);
      }
    }
    prev.current = now;
  });
  return ref;
}
