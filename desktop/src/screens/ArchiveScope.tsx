import { useSyncExternalStore } from "react";
import {
  type ArchiveItem, type MaterialCounts, type NodeRef,
  archiveItemName, custodyIsVisible, hasFile, materialCustodyExplanation,
  materialCustodyLabel, materialCustodies, materialRatio,
} from "../domain/models";
import { useApp } from "../state/hooks";
import { ProgressTrack, PopoverRow } from "../ui/kit";
import { PickChip } from "./PropChips";
import { type StatusView, statusOfArchive } from "./Status";

export type FileView = "held" | "review";
const FILE_VIEW_KEY = "charter.fileView";
const fileViewListeners = new Set<() => void>();
let currentView: FileView = (() => {
  try { return localStorage.getItem(FILE_VIEW_KEY) === "review" ? "review" : "held"; }
  catch { return "held"; }
})();

function setFileView(view: FileView) {
  currentView = view;
  try { localStorage.setItem(FILE_VIEW_KEY, view); } catch { /* 预览环境可能禁用存储 */ }
  for (const listener of fileViewListeners) listener();
}

export function useFileView(): FileView {
  return useSyncExternalStore(
    (listener) => { fileViewListeners.add(listener); return () => fileViewListeners.delete(listener); },
    () => currentView,
  );
}

export function FileViewSwitch() {
  const view = useFileView();
  const option = (value: FileView, label: string, title: string) => (
    <button
      className={view === value ? "on" : ""}
      aria-pressed={view === value}
      title={title}
      onClick={() => setFileView(value)}
    >{label}</button>
  );
  return (
    <div className="seg" role="group" aria-label="文件视图">
      {option("held", "已有材料", "只显示已经归档的文件")}
      {option("review", "完整性审阅", "显示我负责但缺少的、待确认的和中介保管的条目")}
    </div>
  );
}

/** 把材料范围转换成现有状态标签；已经归档的条目仍优先显示文件有效期状态。 */
export function statusOfArchiveItem(item: ArchiveItem): StatusView {
  if (hasFile(item.state)) return statusOfArchive(item.state);
  switch (item.custody) {
    case "mine":
      return { key: "missing", text: "缺件", icon: "circle.dashed", cls: "warn-o", hint: "由你保管，但还没有归档" };
    case "agent":
      return { key: "external", text: "中介保管", icon: "lock.circle", cls: "quiet", hint: "由中介或其他机构保管，不算缺件" };
    case "pending":
      return { key: "unverifiedMark", text: "待确认", icon: "questionmark.circle", cls: "miss", hint: "尚未决定由谁保管，不算缺件" };
    case "outOfScope":
      return { key: "notApplicable", text: "不在我的范围", icon: "minus.circle", cls: "quiet", hint: "不归你管，普通视图不显示" };
    case "na":
      return { key: "notApplicable", text: "不适用", icon: "minus.circle", cls: "quiet", hint: "这个对象用不到该类材料" };
  }
}

export function CustodyChip({ owner, item }: { owner: NodeRef; item: ArchiveItem }) {
  const { store } = useApp();
  const visibleLabel = item.custody === "outOfScope" ? "不在我的范围" : materialCustodyLabel[item.custody];
  return (
    <PickChip
      label={<span><span className="muted" style={{ fontWeight: 500 }}>保管 </span>{visibleLabel}{item.explicit ? "" : <span className="muted" style={{ fontWeight: 500 }}>（未设置）</span>}</span>}
      title="设置由谁保管；只有“我负责”的缺项算缺件"
      width={280}
      className="outline"
    >
      {(close) => <>
        {materialCustodies.map((custody) => (
          <PopoverRow
            key={custody}
            title={materialCustodyLabel[custody]}
            trailing={item.custody === custody && item.explicit ? "✓" : undefined}
            checked={item.custody === custody}
            onClick={() => { close(); store.setCustody([owner], [item.typeID], custody); }}
          />
        ))}
        {item.explicit && <>
          <div className="hairline" style={{ margin: "4px 6px" }} />
          <PopoverRow
            title="恢复默认"
            icon="arrow.uturn.backward"
            onClick={() => { close(); store.setCustody([owner], [item.typeID], null); }}
          />
        </>}
        <span className="t-meta muted" style={{ display: "block", padding: "6px 10px", maxWidth: 260 }}>
          {materialCustodyExplanation[item.custody]}
        </span>
      </>}
    </PickChip>
  );
}

export function ArchiveCountSummary({ counts, compact = false }: { counts: MaterialCounts; compact?: boolean }) {
  const ratio = materialRatio(counts);
  if (!counts.configured) {
    return (
      <span className="row gap8 wrap">
        <span className="v4-chip" style={{ color: "var(--muted)" }}>未配置材料范围</span>
        <span className="t-meta muted">已归档 {counts.docs} 份{counts.docs !== counts.files ? ` · ${counts.files} 类` : ""}</span>
      </span>
    );
  }
  return (
    <span className="row gap10 wrap">
      {ratio !== null
        ? <><ProgressTrack value={ratio} width={compact ? 64 : 120} /><span className="t-meta num">我负责 <b>{counts.held}/{counts.total}</b> 类{counts.missing ? ` · 缺 ${counts.missing} 类` : " · 齐全"}</span></>
        : <span className="t-meta muted">没有“我负责”的条目</span>}
      {!compact && counts.agent > 0 && <span className="t-meta muted">中介保管 {counts.agent}</span>}
      {!compact && counts.pending > 0 && <span className="t-meta amber-text">待确认 {counts.pending}</span>}
    </span>
  );
}

export interface ArchiveReviewGroup {
  key: string;
  title: string;
  hint?: string;
  items: ArchiveItem[];
}

export function archiveReviewGroups(items: ArchiveItem[]): ArchiveReviewGroup[] {
  const visibleMissing = items.filter((item) => custodyIsVisible(item.custody) && !hasFile(item.state));
  return [
    { key: "mine", title: "我负责但还没有", items: visibleMissing.filter((item) => item.custody === "mine") },
    {
      key: "attention",
      title: "已归档但需要处理",
      items: items.filter((item) => hasFile(item.state) && custodyIsVisible(item.custody) && item.state.kind !== "valid"),
    },
    {
      key: "pending",
      title: "待确认",
      hint: "决定是否由你保管；法域模板建议的条目也在这里",
      items: visibleMissing.filter((item) => item.custody === "pending"),
    },
    { key: "agent", title: "中介保管", items: visibleMissing.filter((item) => item.custody === "agent") },
    { key: "held", title: "已归档", items: items.filter((item) => hasFile(item.state) && item.state.kind === "valid") },
  ];
}

export const hiddenArchiveItems = (items: ArchiveItem[]) => items.filter((item) => !custodyIsVisible(item.custody));
export const visibleArchiveItems = (items: ArchiveItem[]) => items.filter((item) => custodyIsVisible(item.custody));
export const heldArchiveItems = (items: ArchiveItem[]) => items.filter((item) => hasFile(item.state));
export const archiveName = archiveItemName;
