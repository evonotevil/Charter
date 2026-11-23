import { useId, useState } from "react";
import type { InboxImportBatchResult, InboxImportIssue } from "../domain/inboxImport";
import { extname } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { Button, Card } from "../ui/kit";
import "./inboxBatchResults.css";

const supportedFormats = "支持 PDF、DOCX、XLSX、JPG/JPEG、PNG、HEIC 和 TIF/TIFF。";

const issueLabels: Record<InboxImportIssue["reason"], string> = {
  unsupported: "格式不支持", missing: "找不到原件", unreadable: "无法读取",
  empty: "空文件夹", copy: "未能复制", save: "记录未保存",
};

function advice(issue: InboxImportIssue): string {
  switch (issue.reason) {
    case "unsupported":
      switch (extname(issue.name).toLowerCase()) {
        case "xls": return "将旧版 XLS 另存为 XLSX 后再拖入。";
        case "doc": return "将旧版 DOC 另存为 DOCX 后再拖入。";
        default: return "用原应用导出为支持的格式后再拖入。";
      }
    case "missing": return "确认原件的位置；如果已移动，请从新位置重新拖入。";
    case "unreadable": return "确认有读取权限。云端文件请先下载到这台电脑，再重新拖入。";
    case "empty": return "将需要整理的文件放入这个文件夹后，再拖入。";
    case "copy": return "检查档案数据文件夹的可用空间和写入权限后，再拖入原件。";
    case "save": return "文件副本已保留。请到「设置 → 备份与恢复」重试保存。";
  }
}

function BatchResult({ batch, label }: { batch: InboxImportBatchResult; label?: string }) {
  const { added, issues, duplicates } = batch;
  const hasIssues = issues.length > 0;
  const [expanded, setExpanded] = useState(added === 0);
  const detailId = useId();
  const allUnsupported = hasIssues && issues.every(i => i.reason === "unsupported");
  const names = new Set<string>(), repeated = new Set<string>();
  for (const issue of issues) {
    if (names.has(issue.name)) repeated.add(issue.name);
    names.add(issue.name);
  }
  const title = added ? `${added} 份已加入待整理`
    : allUnsupported ? `这 ${issues.length} 份文件未加入`
    : "这批文件需要处理";
  return <Card className={`inbox-result${!added && hasIssues ? " needs-attention" : ""}`}>
    {label && <span className="t-meta muted">{label}</span>}
    <strong className="row gap8 t-subtitle" role="status">
      <Icon name={added ? "checkmark" : "exclamationmark.triangle"} size={18} />{title}
    </strong>
    {duplicates > 0 && <span className="t-meta muted">其中 {duplicates} 份与已有文件重复。</span>}
    {hasIssues && <>
      <div className="inbox-result-actions">
        <span className="amber-text">{!added && allUnsupported ? "文件格式暂不支持。原文件仍在原处。" :
          allUnsupported ? `${issues.length} 份未加入 · 格式暂不支持` :
          `${issues.length} 项${batch.saveFailed ? "需要处理" : "未加入"}`}</span>
        <Button kind="quiet" size="small" ariaControls={detailId} ariaExpanded={expanded}
          onClick={() => setExpanded(v => !v)}>{expanded ? "收起详情" : "查看异常"}</Button>
      </div>
      {expanded && <div id={detailId} className="inbox-result-detail">
        <ul>{issues.map((issue, index) => <li key={`${issue.path}-${index}`}>
          <div className="inbox-issue-line">
            <Icon name={issue.reason === "empty" ? "folder" : "doc.text"} size={16} />
            <strong title={issue.path}>{issue.name}</strong>
            <span className="t-meta amber-text">{issueLabels[issue.reason]}</span>
          </div>
          {repeated.has(issue.name) && <span className="t-meta muted inbox-issue-path">{issue.path}</span>}
          <span className="t-meta muted">{advice(issue)}</span>
        </li>)}</ul>
        {issues.some(i => i.reason === "unsupported") && <span className="t-meta muted">{supportedFormats}</span>}
      </div>}
    </>}
  </Card>;
}

export function InboxBatchResults({ results }: { results: InboxImportBatchResult[] }) {
  const [showHistory, setShowHistory] = useState(false);
  const historyId = useId();
  const [latest, ...previous] = results;
  if (!latest) return null;
  const olderIssues = previous.reduce((sum, batch) => sum + batch.issues.length, 0);
  return <section aria-label="导入结果" className="col gap8">
    <BatchResult key={latest.id} batch={latest} />
    {previous.length > 0 && <>
      <div><Button kind="quiet" size="small" icon={showHistory ? "chevron.up" : "chevron.down"}
        ariaControls={historyId} ariaExpanded={showHistory} onClick={() => setShowHistory(v => !v)}>
        {showHistory ? "收起" : "查看"}此前 {previous.length} 批{olderIssues ? ` · ${olderIssues} 项异常` : ""}
      </Button></div>
      {showHistory && <div id={historyId} className="col gap8">{previous.map((batch, index) =>
        <BatchResult key={batch.id} batch={batch}
          label={`第 ${previous.length - index} 批 · ${new Date(batch.finishedAt).toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"})}`} />)}</div>}
    </>}
  </section>;
}
