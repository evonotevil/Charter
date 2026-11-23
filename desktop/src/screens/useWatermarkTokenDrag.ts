import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { WMPart } from "../services/watermark";

function moved<T>(items: T[], from: number, to: number): T[] {
  const result = [...items];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

const wrappers = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>(":scope > [data-wm-index]"));
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Slot = { index: number; left: number; width: number; centerY: number };

// Choose a visual row first, then compare horizontal midpoints in reading order.
// A row with only the placeholder remains a valid drop target.
export function watermarkDropIndex(slots: Slot[], dragged: number, x: number, y: number): number {
  const rowY = slots.reduce((best, slot) =>
    Math.abs(slot.centerY - y) < Math.abs(best - y) ? slot.centerY : best, slots[0]?.centerY ?? y);
  let insertion = 0;
  for (const slot of slots) {
    const onRow = Math.abs(slot.centerY - rowY) < 2;
    if (slot.index === dragged) {
      if (onRow && x >= slot.left && x <= slot.left + slot.width) return insertion;
      continue;
    }
    if ((!onRow && slot.centerY > rowY) || (onRow && x < slot.left + slot.width / 2)) break;
    insertion++;
  }
  return insertion;
}

interface Gesture {
  origin: WMPart[];
  cancel: () => void;
  dispose: () => void;
}

export function useWatermarkTokenDrag(parts: WMPart[], onChange: (next: WMPart[]) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const active = useRef<Gesture | null>(null);
  const latestChange = useRef(onChange);
  const suppressClick = useRef(false);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const previousRects = useRef<Map<HTMLElement, DOMRect> | null>(null);
  const animations = useRef(new Map<HTMLElement, Animation>());
  const [draft, setDraft] = useState<{ origin: WMPart[]; from: number; to: number } | null>(null);
  const committedOrder = useMemo(() => parts.map((_, i) => i), [parts]);
  const live = draft?.origin === parts ? draft : null;
  const order = useMemo(() => live ? moved(committedOrder, live.from, live.to) : committedOrder, [committedOrder, live]);

  function snapshotPositions() {
    const host = containerRef.current;
    if (host && !reduceMotion()) previousRects.current = new Map(wrappers(host).map(node => [node, node.getBoundingClientRect()]));
  }

  useLayoutEffect(() => {
    latestChange.current = onChange;
    if (active.current && active.current.origin !== parts) active.current.cancel();
    const previous = previousRects.current;
    previousRects.current = null;
    if (previous) {
      for (const animation of animations.current.values()) animation.cancel();
      animations.current.clear();
      const shifts = Array.from(previous, ([node, rect]) => {
        const next = node.getBoundingClientRect();
        return { node, dx: rect.left - next.left, dy: rect.top - next.top };
      });
      for (const { node, dx, dy } of shifts) {
        if (!node.isConnected || (!dx && !dy) || reduceMotion()) continue;
        const animation = node.animate([
          { transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" },
        ], { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" });
        animations.current.set(node, animation);
        animation.onfinish = () => {
          if (animations.current.get(node) === animation) animations.current.delete(node);
        };
      }
    }
    if (document.hasFocus()) restoreFocus.current?.focus({ preventScroll: true });
    restoreFocus.current = null;
  });

  useLayoutEffect(() => {
    const clearSuppression = () => { suppressClick.current = false; };
    window.addEventListener("pointerdown", clearSuppression, true);
    return () => {
      window.removeEventListener("pointerdown", clearSuppression, true);
      active.current?.dispose();
      for (const animation of animations.current.values()) animation.cancel();
    };
  }, []);

  function move(from: number, to: number) {
    if (active.current || from === to || from < 0 || to < 0 || from >= parts.length || to >= parts.length) return;
    snapshotPositions();
    onChange(moved(parts, from, to));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>, from: number) {
    const button = event.currentTarget;
    const wrapper = button.closest<HTMLElement>("[data-wm-index]");
    const container = containerRef.current;
    if (!container || !wrapper || !event.isPrimary || event.button !== 0 || active.current) return;
    const host = container, source = wrapper;
    const pointer = event.pointerId;
    const startX = event.clientX, startY = event.clientY;
    const bounds = source.getBoundingClientRect();
    const grabX = startX - bounds.left, grabY = startY - bounds.top;
    const listeners = new AbortController();
    const options = { capture: true, signal: listeners.signal };
    let ghost: HTMLElement | null = null;
    let to = from;
    let lastX = startX, lastY = startY;

    function dispose() {
      listeners.abort();
      ghost?.remove();
      if (host.hasPointerCapture(pointer)) host.releasePointerCapture(pointer);
      active.current = null;
    }
    function finish(commit: boolean) {
      const wasDragging = !!ghost;
      if (wasDragging) snapshotPositions();
      suppressClick.current = wasDragging || !commit;
      dispose();
      if (wasDragging) {
        restoreFocus.current = button;
        setDraft(null);
        if (commit && to !== from) latestChange.current(moved(parts, from, to));
      }
    }
    function update(e: PointerEvent) {
      if (e.pointerId !== pointer || (e.clientX === lastX && e.clientY === lastY)) return;
      lastX = e.clientX;
      lastY = e.clientY;
      const started = !ghost;
      if (!ghost) {
        if (Math.hypot(lastX - startX, lastY - startY) < 5) return;
        ghost = source.cloneNode(true) as HTMLElement;
        ghost.inert = true;
        ghost.setAttribute("aria-hidden", "true");
        ghost.removeAttribute("data-wm-index");
        ghost.removeAttribute("id");
        for (const element of ghost.querySelectorAll("[id]")) element.removeAttribute("id");
        ghost.classList.add("wm-token-ghost");
        Object.assign(ghost.style, { position: "fixed", top: "0", left: "0", width: `${bounds.width}px`,
          height: `${bounds.height}px`, pointerEvents: "none" });
        document.body.appendChild(ghost);
        // Capture on the stable container. Reordering a focused chip may briefly detach it.
        if (e.buttons) host.setPointerCapture(pointer);
      }
      ghost.style.translate = `${lastX - grabX}px ${lastY - grabY}px`;
      const box = host.getBoundingClientRect();
      const x = lastX - box.left - host.clientLeft + host.scrollLeft;
      const y = lastY - box.top - host.clientTop + host.scrollTop;
      const slots = wrappers(host).map(node => ({
        index: Number(node.dataset.wmIndex), left: node.offsetLeft, width: node.offsetWidth,
        centerY: node.offsetTop + node.offsetHeight / 2,
      }));
      const next = watermarkDropIndex(slots, from, x, y);
      if (started || next !== to) {
        snapshotPositions();
        to = next;
        setDraft({ origin: parts, from, to });
      }
    }

    active.current = { origin: parts, cancel: () => finish(false), dispose };
    window.addEventListener("pointermove", update, options);
    window.addEventListener("pointerup", e => {
      if (e.pointerId !== pointer) return;
      update(e);
      const box = host.getBoundingClientRect();
      finish(e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom);
    }, options);
    window.addEventListener("pointercancel", e => { if (e.pointerId === pointer) finish(false); }, options);
    host.addEventListener("lostpointercapture", e => { if (e.target === host && e.pointerId === pointer) finish(false); }, options);
    window.addEventListener("blur", () => finish(false), { signal: listeners.signal });
    window.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      finish(false);
    }, options);
  }

  function onClickCapture(event: ReactMouseEvent) {
    if (event.detail === 0 || !suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }
  return { containerRef, order, dragIndex: live?.from ?? null, onPointerDown, onClickCapture, move };
}
