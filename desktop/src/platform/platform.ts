// 系统能力的抽象：桌面端由 Tauri（Rust）实现，浏览器开发与测试用内存实现。

export type SyncState =
  | { kind: "checking" }
  | { kind: "synced"; at: number }
  | { kind: "syncing"; count: number }
  | { kind: "conflict"; files: string[] }
  | { kind: "failed"; message: string }
  | { kind: "signedOut" }
  | { kind: "local" };

export interface FileStat { exists: boolean; isDir: boolean; mtime: number | null; size: number }
export interface DirEntry { name: string; isDir: boolean; mtime: number | null; size: number }

export interface Platform {
  readonly os: "mac" | "windows" | "linux" | "web";
  /** 默认数据文件夹（Mac 为 iCloud 云盘/Charter，Windows 优先 OneDrive/Charter）。 */
  defaultRoot(): Promise<string>;
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
export interface CalendarSyncInput { name: string; calendarId?: string; checkOnly?: boolean; events: CalendarEvent[] }
export type CalendarSyncResult =
  | { ok: true; calendarId?: string; added?: number; updated?: number; removed?: number }
  | { ok?: undefined; error: "denied" | "writeOnly" | "noOutlook" | "unsupported" | "failed" | "noSource" | "createCalendar" | "commit" | "outlook"; message?: string };
