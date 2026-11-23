// 文件详情里的预览（5.5.8）。
// PDF 按页显示：纸面完整放进预览区，四周至少留 16px；用左右按钮切页。
// 关闭、切换文件或快速翻页时取消未完成的加载和渲染，并及时释放画布。

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { loadPdfReader } from "../services/extract";
import { officeDocumentExtensions } from "../domain/importFormats";
import { extname, platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { PreviewPager } from "../ui/PreviewPager";
import { Button } from "../ui/kit";
import "./filePreview.css";

const MAX_PIXELS = 4_000_000;
const PAGE_GUTTER = 16;

type RenderTask = { cancel: () => void; promise: Promise<unknown> };
type PreviewState = "loading" | "ok" | "missing" | "locked" | "unreadable";

export function releaseCanvas(c: HTMLCanvasElement | null | undefined) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
  c.remove();
}

export function FilePreview({ path, onOpenOriginal, onRelocate, onReissue }: { path: string; onOpenOriginal?: () => void; onRelocate?: () => void; onReissue?: () => void }) {
  const ext = extname(path).toLowerCase();
  const pdf = ext === "pdf";
  const office = officeDocumentExtensions.includes(ext);
  const [state, setState] = useState<PreviewState>("loading");
  const [pages, setPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    setState("loading");
    setPages(0);
    setCurrent(1);
    (async () => {
      try {
        if (office) {
          const file = await platform().stat(path);
          if (!cancelled) setState(file.exists && !file.isDir ? "ok" : "missing");
          return;
        }
        const bytes = await platform().readBytes(path);
        if (cancelled) return;
        if (!pdf) {
          setState("ok");
          return;
        }
        const pdfjs = await loadPdfReader();
        if (cancelled) return;
        task = pdfjs.getDocument({ data: bytes });
        const doc = await task.promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }
        docRef.current = doc;
        setPages(doc.numPages);
        setState("ok");
      } catch (error) {
        if (cancelled) return;
        if (error instanceof Error && error.name === "PasswordException") {
          setState("locked");
        } else {
          const file = await platform().stat(path).catch(() => null);
          if (!cancelled) setState(file && (!file.exists || file.isDir) ? "missing" : "unreadable");
        }
      }
    })();
    return () => {
      cancelled = true;
      docRef.current = null;
      void task?.destroy().catch(() => undefined);
    };
  }, [path, pdf, office]);

  if (state === "locked" || state === "unreadable") return (
    <div className="file-preview"><div className="file-preview-stage col gap8">
      <Icon name="doc.text" size={28} className="muted" />
      <span className="t-row">{state === "locked" ? "这份 PDF 需要密码" : "无法预览这份文件"}</span>
      <span className="t-meta muted">{state === "locked" ? "打开原件后，在阅读器里输入密码。" : "可尝试用系统应用打开原件。"}</span>
      {onOpenOriginal && <Button size="small" onClick={onOpenOriginal}>打开原件</Button>}
    </div></div>
  );
  if (state === "missing") return (
    <div className="col gap8 muted" style={{ height: "100%", padding: 24, textAlign: "center", alignItems: "center", justifyContent: "center" }}>
      <Icon name="doc.text" size={28} />
      <span className="t-row" style={{ color: "var(--ink)" }}>源文件不可用</span>
      <span className="t-meta">数据文件夹里没有这份文件，可能还没同步下来，或被移动、删除。</span>
      <span className="row gap8" style={{ marginTop: 6 }}>
        {onRelocate && <Button size="small" kind="primary" icon="folder" onClick={onRelocate}>重新定位…</Button>}
        {onReissue && <Button size="small" icon="square.and.arrow.up" onClick={onReissue}>归档新版…</Button>}
      </span>
    </div>
  );
  if (office) return state === "ok" ? (
    <div className="file-preview">
      <div className="file-preview-stage col gap8">
        <Icon name="doc.text" size={28} className="muted" />
        <span className="t-row">{ext === "xlsx" ? "Excel 工作簿" : "Word 文档"}</span>
        {onOpenOriginal && <Button size="small" onClick={onOpenOriginal}>打开原件</Button>}
      </div>
    </div>
  ) : null;
  if (!pdf) return state === "ok" ? <img className="file-preview-image" src={platform().fileURL(path)} alt="文件图像预览" /> : null;

  return (
    <div className="file-preview">
      <div className="file-preview-bar">
        <PreviewPager page={current} pages={pages} onPageChange={setCurrent} />
        {onOpenOriginal && <Button size="small" kind="quiet" onClick={onOpenOriginal}>打开原件</Button>}
      </div>
      <div className="file-preview-stage" aria-busy={state === "loading"}>
        {state === "loading" && <div className="muted t-meta">正在打开…</div>}
        {pages > 0 && <PdfPage key={`${path}:${current}`} index={current} docRef={docRef} />}
      </div>
    </div>
  );
}

function fitPage(stageWidth: number, stageHeight: number, aspect: number) {
  const availableWidth = Math.max(0, stageWidth - PAGE_GUTTER * 2);
  const availableHeight = Math.max(0, stageHeight - PAGE_GUTTER * 2);
  if (availableWidth * aspect <= availableHeight) return { width: availableWidth, height: availableWidth * aspect };
  return { width: availableHeight / aspect, height: availableHeight };
}

function PdfPage({ index, docRef }: { index: number; docRef: React.MutableRefObject<PDFDocumentProxy | null> }) {
  const host = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loadedPage: PDFPageProxy | null = null;
    const doc = docRef.current;
    if (!doc) return;
    void doc.getPage(index).then((nextPage) => {
      loadedPage = nextPage;
      if (cancelled) {
        nextPage.cleanup();
        return;
      }
      const viewport = nextPage.getViewport({ scale: 1 });
      setAspect(viewport.height / viewport.width);
      setPage(nextPage);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => {
      cancelled = true;
      // 渲染 effect 会先同步取消任务；延后一拍再释放这一页的 PDF.js 资源。
      if (loadedPage) queueMicrotask(() => loadedPage?.cleanup());
    };
  }, [index, docRef]);

  useEffect(() => {
    const element = host.current?.parentElement;
    if (!element || aspect === null) return;
    const measure = () => setSize(fitPage(element.clientWidth, element.clientHeight, aspect));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [aspect]);

  useEffect(() => {
    const element = host.current;
    if (!element || !page || !size.width || !size.height) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let canvas: HTMLCanvasElement | null = null;
    (async () => {
      try {
        const base = page.getViewport({ scale: 1 });
        let scale = (size.width / base.width) * Math.min(window.devicePixelRatio || 1, 2);
        const pixels = base.width * base.height * scale * scale;
        if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);
        const viewport = page.getViewport({ scale });
        canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.cssText = "width:100%;height:100%;display:block";
        task = page.render({ canvasContext: canvas.getContext("2d")!, viewport }) as unknown as RenderTask;
        await task.promise;
        if (cancelled) return;
        element.replaceChildren(canvas);
      } catch (error) {
        if (!cancelled && (error as { name?: string })?.name !== "RenderingCancelledException") setError(true);
      }
    })();
    return () => {
      cancelled = true;
      try { task?.cancel(); } catch { /* 已完成 */ }
      releaseCanvas(canvas);
      if (element) element.replaceChildren();
    };
  }, [page, size.width, size.height]);

  if (error) return <div className="file-preview-page-error" role="status">
    <Icon name="exclamationmark.triangle" size={22} />
    <span className="t-row">第 {index} 页无法显示</span>
    <span className="t-meta muted">可以继续翻页，或打开原件查看这一页。</span>
  </div>;
  return <div ref={host} data-page={index} className="file-preview-page" aria-label={`第 ${index} 页`}
    style={{ width: size.width, height: size.height }} />;
}
