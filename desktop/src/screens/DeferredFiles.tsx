// 只在文件进入滚动视区附近时挂载行内操作、菜单和缩略图。已访问的内容保留，以便焦点和弹窗继续工作。
import { type CSSProperties, type FocusEvent, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

const buffer = 560;
type Reveal = () => void;

function observeFileBlocks(root: Element, viewportHeight: number) {
  const pending = new Map<Element, Reveal>();
  const warm = new Set<Element>();
  let idle: number | undefined;
  let quietTimer: number | undefined;
  let nearby: IntersectionObserver | undefined;
  const show = (element: Element) => {
    warm.delete(element);
    const mount = pending.get(element);
    pending.delete(element);
    mount?.();
  };
  const visible = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) show(entry.target);
  }, { root, rootMargin: `${buffer}px 0px` });

  const schedule = () => {
    if (quietTimer === undefined && idle === undefined && warm.size) {
      idle = requestIdleCallback(() => {
        idle = undefined;
        const next = warm.values().next();
        if (!next.done) show(next.value);
        schedule();
      });
    }
  };
  // 首屏绘好、滚动停下后才预热。手势进行中只渲染接近可见区域的内容。
  const waitForQuiet = () => {
    if (idle !== undefined) cancelIdleCallback(idle);
    idle = undefined;
    window.clearTimeout(quietTimer);
    quietTimer = window.setTimeout(() => {
      quietTimer = undefined;
      schedule();
    }, 110);
  };
  if (typeof requestIdleCallback === "function") {
    waitForQuiet();
    root.addEventListener("scroll", waitForQuiet, { passive: true });
    nearby = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && pending.has(entry.target)) warm.add(entry.target);
        else warm.delete(entry.target);
      }
      schedule();
    }, { root, rootMargin: `${Math.round(viewportHeight * 3)}px 0px` });
  }

  return {
    watch(element: Element, reveal: Reveal) {
      pending.set(element, reveal);
      visible.observe(element);
      nearby?.observe(element);
      return () => {
        visible.unobserve(element);
        nearby?.unobserve(element);
        warm.delete(element);
        pending.delete(element);
      };
    },
    disconnect() {
      root.removeEventListener("scroll", waitForQuiet);
      window.clearTimeout(quietTimer);
      if (idle !== undefined) cancelIdleCallback(idle);
      visible.disconnect();
      nearby?.disconnect();
      warm.clear();
      pending.clear();
    },
  };
}

export function useFileViewport() {
  const blocks = useRef<ReturnType<typeof observeFileBlocks> | null>(null);
  useLayoutEffect(() => () => { blocks.current?.disconnect(); blocks.current = null; }, []);
  return useCallback((element: HTMLElement, reveal: Reveal) => {
    const root = element.closest(".page");
    const viewport = root?.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    if (!root || !viewport || (bounds.top < viewport.bottom + buffer && bounds.bottom > viewport.top - buffer)) {
      reveal();
      return;
    }
    blocks.current ??= observeFileBlocks(root, viewport.height);
    return blocks.current.watch(element, reveal);
  }, []);
}

type Props = {
  watch: ReturnType<typeof useFileViewport>;
  children: () => ReactNode;
  label: string;
  rows?: number;
  columns?: number;
};

export function DeferredFiles({ watch, children, label, rows, columns }: Props) {
  const [ready, setReady] = useState(false);
  const host = useRef<HTMLElement | null>(null);
  const attach = useCallback((el: HTMLElement | null) => { host.current = el; }, []);
  useLayoutEffect(() => {
    if (!ready && host.current) return watch(host.current, () => setReady(true));
  }, [ready, watch]);

  const revealOnFocus = (e: FocusEvent<HTMLElement>) => {
    const from = e.relatedTarget;
    const backwards = from instanceof Node && !!(e.currentTarget.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING);
    flushSync(() => setReady(true));
    const controls = host.current?.querySelectorAll<HTMLElement>('[tabindex="0"],button:not(:disabled)');
    if (controls?.length) controls[backwards ? controls.length - 1 : 0].focus();
  };

  if (rows === undefined) return <div ref={attach} className="file-card-slot">
    {ready ? children() : <button type="button" className="file-card-placeholder" aria-label={label} onFocus={revealOnFocus}>{label}</button>}
  </div>;

  return <tbody ref={attach}>
    {ready ? children() : <tr className="file-row-placeholder" tabIndex={0} aria-label={label} onFocus={revealOnFocus}>
      <td colSpan={columns} style={{ "--file-rows": rows } as CSSProperties} />
    </tr>}
  </tbody>;
}
