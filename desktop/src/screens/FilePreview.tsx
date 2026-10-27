// 文件详情里的预览（5.3.6）。
// PDF：所有页都能滚动查看，但只渲染可见页及上下各一页；离开可见区域的页释放画布。
// 关闭或切换文件时取消未完成的加载和渲染，销毁 PDF 文档，把画布缩成 0×0 再移除。
// 顶部显示“共 N 页 · 第 x 页”和“打开原件”，避免误以为缺页。

import { useEffect, useRef, useState } from "react";
import { pdfjs } from "../services/extract";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { Button } from "../ui/kit";

/** 单页画布的像素上限：避免一张 300dpi 扫描件在高分屏上生成上亿像素的画布。 */
const MAX_PIXELS = 4_000_000;
/** 预渲染范围：可见页上下各约一屏。 */
const MARGIN = "100% 0px";

type PdfDoc = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
type RenderTask = { cancel: () => void; promise: Promise<unknown> };

/** 释放画布占用的内存并移出页面。 */
export function releaseCanvas(c: HTMLCanvasElement | null | undefined) {
  if (!c) return;
  c.width = 0; c.height = 0;
  c.remove();
}

export function FilePreview({ path, onOpenOriginal, onRelocate, onReissue }: { path: string; onOpenOriginal?: () => void; onRelocate?: () => void; onReissue?: () => void }) {
  const pdf = path.toLowerCase().endsWith(".pdf");
  const scroller = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "partial">("loading");
  const [pages, setPages] = useState(0);
  const [aspect, setAspect] = useState(1.414);
  const [current, setCurrent] = useState(1);
  const docRef = useRef<PdfDoc | null>(null);

  // 1. 加载文档（只读一次，不渲染）
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    setState("loading"); setPages(0); setCurrent(1);
    (async () => {
      try {
        const bytes = await platform().readBytes(path);
        if (cancelled) return;
        if (!pdf) { setState("ok"); return; }
        task = pdfjs.getDocument({ data: bytes });
        const doc = await task.promise;
        if (cancelled) { await doc.destroy(); return; }
        const p1 = await doc.getPage(1);
        const vp = p1.getViewport({ scale: 1 });
        p1.cleanup();
        if (cancelled) return;
        docRef.current = doc;
        setAspect(vp.height / vp.width);
        setPages(doc.numPages);
        setState("ok");
      } catch { if (!cancelled) setState("missing"); }
    })();
    return () => {
      cancelled = true;
      docRef.current = null;
      // destroy() 会同时终止加载、销毁已加载的文档和它的 worker 资源
      void task?.destroy().catch(() => undefined);
    };
  }, [path, pdf]);

  if (state === "missing") return (
    <div className="col gap8 muted" style={{ height: "100%", padding: 24, textAlign: "center", alignItems: "center", justifyContent: "center" }}>
      <Icon name="doc.text" size={28} />
      <span className="t-row" style={{ color: "var(--ink)" }}>源文件不可用</span>
      <span className="t-meta">数据文件夹里没有这份文件，可能还没同步下来，或被移动、删除。</span>
      <span className="row gap8" style={{ marginTop: 6 }}>
        {onRelocate && <Button size="small" kind="primary" icon="folder" onClick={onRelocate}>重新定位…</Button>}
        {onReissue && <Button size="small" icon="square.and.arrow.up" onClick={onReissue}>归档新版…</Button>}
      </span>
    </div>);
  if (!pdf) return state === "ok" ? <img src={platform().fileURL(path)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : null;
  return (
    <div className="col" style={{ height: "100%", minHeight: 0 }}>
      {pages > 0 && (
        <div className="row gap8 preview-bar">
          <span className="t-meta num grow" aria-live="polite">共 {pages} 页 · 第 {current} 页{state === "partial" ? " · 部分页面无法显示" : ""}</span>
          {onOpenOriginal && <Button size="small" kind="quiet" icon="arrow.up.forward.app" onClick={onOpenOriginal}>打开原件</Button>}
        </div>
      )}
      <div ref={scroller} className="scroll grow" style={{ minHeight: 0, paddingBottom: 12 }} aria-busy={state === "loading"}
        onScroll={(e) => {
          const el = e.currentTarget; const first = el.querySelector<HTMLElement>("[data-page]");
          if (!first || !pages) return;
          const h = first.offsetHeight + 12;
          setCurrent(Math.min(pages, Math.max(1, Math.floor((el.scrollTop + el.clientHeight / 3) / h) + 1)));
        }}>
        {state === "loading" && <div className="muted t-meta" style={{ padding: 16 }}>正在打开…</div>}
        {pages > 0 && Array.from({ length: pages }, (_, i) => (
          <PdfPage key={path + i} index={i + 1} docRef={docRef} aspect={aspect} root={scroller} onFail={() => setState("partial")} />
        ))}
      </div>
    </div>
  );
}

/** 一页：进入可见范围才渲染；离开就取消渲染并释放画布。 */
function PdfPage({ index, docRef, aspect, root, onFail }: { index: number; docRef: React.MutableRefObject<PdfDoc | null>; aspect: number; root: React.RefObject<HTMLDivElement>; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const io = new IntersectionObserver((es) => setNear(es.some((e) => e.isIntersecting)), { root: root.current, rootMargin: MARGIN });
    io.observe(el); return () => io.disconnect();
  }, [root]);
  useEffect(() => {
    const host = box.current, doc = docRef.current;
    if (!near || !host || !doc) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let page: Awaited<ReturnType<PdfDoc["getPage"]>> | null = null;
    (async () => {
      try {
        page = await doc.getPage(index);
        if (cancelled) return;
        const cssW = host.clientWidth;
        const base = page.getViewport({ scale: 1 });
        let scale = (cssW / base.width) * Math.min(window.devicePixelRatio || 1, 2);
        const px = base.width * base.height * scale * scale;
        if (px > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / px);
        const vp = page.getViewport({ scale });
        canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        canvas.style.cssText = "width:100%;height:100%;display:block";
        task = page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }) as unknown as RenderTask;
        await task.promise;
        if (cancelled) return;
        host.replaceChildren(canvas);
      } catch (e) {
        if (!cancelled && (e as { name?: string })?.name !== "RenderingCancelledException") onFail();
      }
    })();
    return () => {
      cancelled = true;
      try { task?.cancel(); } catch { /* 已完成 */ }
      page?.cleanup();
      releaseCanvas(canvas);
      if (host) host.replaceChildren();
    };
  }, [near, index, docRef]);
  return (
    <div ref={box} data-page={index} className="pdf-page" aria-label={`第 ${index} 页`}
      style={{ aspectRatio: `1 / ${aspect}` }} />
  );
}
