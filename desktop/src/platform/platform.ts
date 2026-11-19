// 系统能力的抽象：桌面端由 Tauri（Rust）实现，浏览器开发与测试用内存实现。

export type SyncState =
  | { kind: "checking" }
  | { kind: "synced"; at: number }
  | { kind: "syncing"; count: number }
  | { kind: "conflict"; files: string[] }
  | { kind: "failed"; message: string }
  | { kind: "signedOut" }
  | { kind: "local" }
  /** 5.5.5：无法确认同步盘是否已上传完成（检测脚本失败等）。 */
  | { kind: "unknown"; reason: string }
  /** 5.5.6：在同步盘里，但读不到上传状态（Mac 上的 OneDrive）。 */
  | { kind: "cloud"; provider: string };

/** 5.5.6：数据文件夹所在的同步盘；null = 只在这台电脑上。 */
export type CloudKind = "icloud" | "onedrive" | null;
export const cloudName = (k: CloudKind, os: string) => (k === "onedrive" ? "OneDrive" : k === "icloud" ? (os === "windows" ? "iCloud Drive" : "iCloud 云盘") : "这台电脑");
export interface TreeInfo { files: number; bytes: number; cloudOnly: number }

export interface FileStat { exists: boolean; isDir: boolean; mtime: number | null; size: number; /** 5.5.5：读不到（权限、读写错误等），不等于不存在。 */ error?: string }
export interface DirEntry { name: string; isDir: boolean; mtime: number | null; size: number }

export interface Platform {
  readonly os: "mac" | "windows" | "linux" | "web";
  /** 安装包所需的 CPU 架构。旧实现可不提供，更新界面会明确提示无法判断。 */
  readonly arch?: "arm64" | "x64" | "unknown";
  /** 默认数据文件夹。5.5.6 起新安装在这台电脑上；旧默认位置（同步盘里的 Charter）已有档案时沿用它。 */
  defaultRoot(): Promise<string>;
  /** 5.5.6 多台电脑共用：路径在哪个同步盘里（只认 iCloud 云盘、OneDrive）。 */
  cloudKind?(path: string): Promise<CloudKind>;
  /** 这台电脑上的程序数据位置（Mac ~/Library/Application Support/Charter/Data，Windows %LOCALAPPDATA%\Charter\Data）。 */
  localRoot?(): Promise<string>;
  /** 同步盘里建议的位置。 */
  cloudSuggestions?(): Promise<{ kind: Exclude<CloudKind, null>; path: string }[]>;
  treeInfo?(path: string): Promise<TreeInfo>;
  freeSpace?(path: string): Promise<number | null>;
  /** 整份复制文件夹：先下载只在云端的文件；复制期间有改动的再补一次；失败或取消时删除已复制的部分。 */
  copyTree?(from: string, to: string, onProgress?: (done: number, total: number) => void): Promise<{ files: number }>;
  cancelCopy?(): Promise<void>;
  join(...parts: string[]): string;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  /** 原子写入：先写临时文件再替换，避免同步盘读到写了一半的文件。 */
  writeText(path: string, text: string): Promise<void>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  /** 5.3.3：流式打包 ZIP（只在桌面端提供）。返回写入的字节数。 */
  /** 5.4：同步到系统日历（Mac：EventKit；Windows：桌面版 Outlook）。只在桌面端提供。 */
  calendarSync?(input: CalendarSyncInput): Promise<CalendarSyncResult>;
  zipFiles?(target: string, entries: ({ name: string; path: string } | { name: string; text: string })[]): Promise<number>;
  stat(path: string): Promise<FileStat>;
  listDir(path: string): Promise<DirEntry[]>;
  mkdirs(path: string): Promise<void>;
  /** 复制文件；目标已存在时报错。 */
  copyFile(from: string, to: string): Promise<void>;
  moveFile(from: string, to: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  tempDir(): Promise<string>;
  /** 读取同步盘的真实状态。 */
  syncStatus(root: string): Promise<SyncState>;
  reveal(path: string): Promise<void>;
  openPath(path: string): Promise<void>;
  openURL(url: string): Promise<void>;
  deviceName(): Promise<string>;
  pickFiles(opts: { multiple: boolean; extensions?: string[]; title?: string }): Promise<string[]>;
  pickFolder(opts: { title?: string; defaultPath?: string }): Promise<string | null>;
  saveDialog(opts: { defaultName: string; extensions?: string[]; title?: string }): Promise<string | null>;
  notify(title: string, body: string): Promise<void>;
  /** 按时间发出的提醒（应用运行时由前端调度；Windows/Mac 都可在后台运行）。 */
  copyText(text: string): Promise<void>;
  /** 把本地文件转成界面可以加载的 URL（PDF/图片预览）。 */
  fileURL(path: string): string;
  /** 监听文件夹变化（其他设备同步过来）。返回取消函数。 */
  watch(path: string, onChange: () => void): Promise<() => void>;
  /** 系统自带的文字识别（Mac：Vision；Windows：Windows.Media.Ocr）。传入 PNG 图像。 */
  ocr(png: Uint8Array): Promise<string>;
  /** 5.5.6：一次识别多张图（PNG / JPEG），按顺序返回；onPage 在每识别完一页时回调。没有实现时逐张调用 ocr。 */
  ocrBatch?(images: Uint8Array[], onPage?: (done: number, total: number) => void): Promise<string[]>;
  /** 系统里可嵌入 PDF 的中文字体（单个 TTF/OTF 文件）；找不到时为 null。 */
  cjkFont(): Promise<Uint8Array | null>;
  /** 应用自带的资源（内置模板）。 */
  bundledTemplates(): Promise<string>;
  /** 本机偏好（数据文件夹位置、设备 ID）。 */
  prefGet(key: string): string | null;
  prefSet(key: string, value: string | null): void;
}

let current: Platform | null = null;
export const setPlatform = (p: Platform) => { current = p; };
export const platform = (): Platform => {
  if (!current) throw new Error("platform not initialised");
  return current;
};

/** Join path components without treating a POSIX filename's literal backslash as a separator. */
const POSIX_PATH_EDGE = /^\/+|\/+$/g;
const POSIX_PATH_END = /\/+$/;
const WINDOWS_PATH_EDGE = /^[\\/]+|[\\/]+$/g;
const WINDOWS_PATH_END = /[\\/]+$/;
export function joinPlatformPath(os: Platform["os"], ...parts: string[]): string {
  const windows = os === "windows";
  const sep = windows ? "\\" : "/";
  const trimEdge = windows ? WINDOWS_PATH_EDGE : POSIX_PATH_EDGE;
  const trimEnd = windows ? WINDOWS_PATH_END : POSIX_PATH_END;
  return parts.filter((part) => part !== "").map((part, index) =>
    index === 0 ? part.replace(trimEnd, "") : part.replace(trimEdge, "")
  ).join(sep);
}

export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}
export function extname(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1) : "";
}

export interface CalendarEvent { key: string; title: string; date: string; notes: string }
export interface CalendarSyncInput { name: string; calendarId?: string; checkOnly?: boolean; chunks?: [number, number][]; events: CalendarEvent[] }
export type CalendarSyncResult =
  | { ok: true; calendarId?: string; added?: number; updated?: number; removed?: number }
  | { ok?: undefined; error: "denied" | "writeOnly" | "noOutlook" | "unsupported" | "failed" | "noSource" | "createCalendar" | "commit" | "outlook"; message?: string };
