export type InboxImportIssueReason = "unsupported" | "missing" | "unreadable" | "empty" | "copy" | "save";

/** A source path that was not durably added to the inbox. */
export interface InboxImportIssue {
  path: string;
  name: string;
  reason: InboxImportIssueReason;
  /** Platform error text, for the expandable detail view. */
  detail?: string;
}

export interface InboxImportOutcome {
  added: number;
  duplicates: number;
  unsupported: number;
  failed: number;
  saveFailed: number;
  issues: InboxImportIssue[];
}

export type InboxImportProgressPhase = "preparing" | "recognizing" | "saving";

/** 当前批次的可视进度。文件列表来自展开文件夹后的真实可处理文件。 */
export interface InboxImportProgress {
  phase: InboxImportProgressPhase;
  files: string[];
  total: number;
  completed: number;
  /** 保存阶段中识别成功、准备写入待整理的文件数。 */
  successful?: number;
  /** 识别阶段是从 0 开始的当前文件下标。 */
  currentIndex?: number;
  detail?: string;
}

export interface InboxImportBatch {
  id: string;
  paths: string[];
  dataRoot: string;
}

export interface InboxImportBatchResult extends InboxImportOutcome {
  id: string;
  dataRoot: string;
  finishedAt: number;
}
