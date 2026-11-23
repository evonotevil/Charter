import type { InboxImportProgress } from "../domain/inboxImport";
import { extname } from "../platform/platform";
import { Icon } from "../ui/Icon";
import "./inboxImportProgress.css";

function format(name: string) {
  return extname(name).replace(/^\./, "").toUpperCase() || "文件";
}

export function inboxProgressText(progress: InboxImportProgress) {
  if (progress.phase === "recognizing" && progress.currentIndex !== undefined) {
    return {
      title: "正在识别文件",
      fileName: progress.files[progress.currentIndex] ?? "正在读取文件",
      count: `${progress.currentIndex + 1} / ${progress.total}`,
      completed: `已完成 ${progress.completed} 份`,
    };
  }
  if (progress.phase === "saving") {
    const successful = progress.successful ?? progress.completed;
    const failed = Math.max(0, progress.completed - successful);
    return {
    title: "正在保存到待整理",
    fileName: failed ? `已识别 ${successful} 份，${failed} 份未能加入` : "正在保存本批识别结果",
    count: `${progress.completed} / ${progress.total}`,
    completed: `已处理 ${progress.completed} 份 · ${successful} 份待保存`,
    };
  }
  return {
    title: "正在准备文件",
    fileName: progress.detail ?? "正在检查文件和文件夹",
    count: progress.files.length ? `${progress.files.length} 份` : `${progress.total} 项`,
    completed: "准备完成后会逐份识别",
  };
}

export function InboxImportProgressCard({ progress, queued }: { progress: InboxImportProgress; queued: number }) {
  const text = inboxProgressText(progress);
  const current = progress.currentIndex ?? -1;
  const waitingStart = progress.phase === "recognizing" ? current + 1 : progress.files.length;
  const waitingCount = Math.max(0, progress.files.length - waitingStart);
  const visibleWaiting = progress.files.slice(waitingStart, waitingStart + 3);
  const ratio = progress.total ? Math.max(0, Math.min(1, progress.completed / progress.total)) : 0;
  return <section className="inbox-import-progress" data-inbox-import-status="active" data-inbox-progress={progress.phase} data-current-index={current + 1}
    data-total={progress.total} data-completed={progress.completed} role="status" aria-live="polite" aria-label={text.title}>
    <div className="inbox-import-current">
      <span className="inbox-import-file-icon"><Icon name="doc.text" size={22} /></span>
      <div className="inbox-import-file-copy">
        <strong className="t-label green-text">{text.title}</strong>
        <span className="t-headline inbox-import-file-name" data-current-file title={text.fileName}>{text.fileName}</span>
      </div>
      <div className="inbox-import-count"><span className="t-meta muted">当前文件</span><strong className="t-figure num">{text.count}</strong></div>
      <div className="inbox-import-track" aria-hidden><span style={{ transform: `scaleX(${ratio})` }} /></div>
      <span className="t-meta muted inbox-import-completed">{text.completed}</span>
      <span className="row gap6 t-meta muted inbox-import-local"><Icon name="lock.circle" size={13} />在本机识别，确认后归档</span>
    </div>
    {visibleWaiting.length > 0 && <div className="inbox-import-waiting">
      <div className="inbox-import-waiting-head"><strong className="t-title">等待识别</strong><span className="t-meta muted">{waitingCount} 份</span></div>
      <div className="inbox-import-waiting-list">{visibleWaiting.map((name, index) => <div className="inbox-import-waiting-row" data-queued-file key={`${name}-${index}`}>
        <span className="doc-ic"><Icon name="doc.text" size={15} /></span>
        <strong className="ellipsis" title={name}>{name}</strong>
        <span className="t-label muted">{format(name)}</span>
      </div>)}</div>
      {waitingCount > visibleWaiting.length && <span className="t-meta muted">后面还有 {waitingCount - visibleWaiting.length} 份</span>}
    </div>}
    {queued > 0 && <span className="t-meta muted inbox-import-next-batch">下一批还有 {queued} 项，当前批次完成后自动开始。</span>}
  </section>;
}
