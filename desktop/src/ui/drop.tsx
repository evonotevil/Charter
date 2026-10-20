// 拖入文件：Tauri 的原生拖放事件给出文件路径，main.tsx 把它转发到鼠标下方带 data-drop 的区域。

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";

let current: HTMLElement | null = null;

/** main.tsx 调用：拖动经过时标记目标区域。 */
export function dragOver(x: number, y: number) {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]") ?? null;
  if (el === current) return;
  current?.dispatchEvent(new CustomEvent("charter-dragleave"));
  current = el;
  current?.dispatchEvent(new CustomEvent("charter-dragenter"));
}
export function dragEnd() { current?.dispatchEvent(new CustomEvent("charter-dragleave")); current = null; }

export function useDropTarget(onDrop: (paths: string[]) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const [targeted, setTargeted] = useState(false);
  const cb = useRef(onDrop);
  cb.current = onDrop;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const drop = (e: Event) => { setTargeted(false); cb.current((e as CustomEvent<string[]>).detail); };
    const enter = () => setTargeted(true);
    const leave = () => setTargeted(false);
    el.addEventListener("charter-drop", drop);
    el.addEventListener("charter-dragenter", enter);
    el.addEventListener("charter-dragleave", leave);
    return () => { el.removeEventListener("charter-drop", drop); el.removeEventListener("charter-dragenter", enter); el.removeEventListener("charter-dragleave", leave); };
  }, []);
  return { ref, targeted };
}

/** 包住一块区域：拖入时描 2px 黑框、内容轻微内缩，顶部出一行提示（#20）。 */
export function DropTarget({ message, onDrop, children, style }: { message: string; onDrop: (paths: string[]) => void; children: ReactNode; radius?: number; style?: CSSProperties }) {
  const { ref, targeted } = useDropTarget(onDrop);
  return (
    <div ref={ref} data-drop className="drop-host" data-targeted={targeted || undefined} style={{ position: "relative", ...style }}>
      {children}
      {targeted && <div className="drop-tip" role="status">{message}</div>}
    </div>
  );
}

function Paper({ rotate, x }: { rotate: number; x: number }) {
  return (
    <div className="col" style={{ position: "absolute", left: x, top: 3, width: 84, height: 104, background: "#fff", borderRadius: 10, padding: "16px 12px 0", gap: 4, transform: `rotate(${rotate}deg)`, boxShadow: "0 6px 16px rgba(0,0,0,.12)" }}>
      <span style={{ height: 6, borderRadius: 3, background: "color-mix(in srgb, var(--emphasis) 80%, transparent)" }} />
      {[0, 1, 2].map((i) => <span key={i} style={{ height: 6, borderRadius: 3, background: "#ddd", marginTop: i === 0 ? 2 : 0 }} />)}
    </div>
  );
}

export function DropZone({ title, subtitle, action, onDrop }: { title: string; subtitle: string; action: () => void; onDrop: (paths: string[]) => void }) {
  const { ref, targeted } = useDropTarget(onDrop);
  return (
    <div ref={ref} data-drop role="button" tabIndex={0} className="dropzone" onClick={action}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); action(); } }}
      title="拖入文件或文件夹，或点按选择文件" aria-label={`${title}。拖入文件或文件夹，或按回车选择文件`}
      style={{ position: "relative", display: "flex", alignItems: "center", gap: 24, padding: 40, borderRadius: 24, background: "var(--lime)", color: "var(--on-lime)", cursor: "pointer" }}
      data-targeted={targeted || undefined}>
      <div className="col grow" style={{ gap: 6 }}>
        <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>{title}</span>
        <span className="t-body" style={{ opacity: .75 }}>{subtitle}</span>
      </div>
      <div style={{ position: "relative", width: 150, height: 110, flex: "none" }} aria-hidden>
        <Paper rotate={-8} x={0} /><Paper rotate={2} x={32} /><Paper rotate={10} x={64} />
      </div>
      {targeted && <div aria-hidden style={{ position: "absolute", inset: 10, borderRadius: 18, border: "2px dashed color-mix(in srgb, var(--on-lime) 50%, transparent)", pointerEvents: "none" }} />}
    </div>
  );
}
