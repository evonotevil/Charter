// 桌面端（Electron）实现。系统能力由 electron/main.cjs 提供，经 preload 暴露为 window.charter。

import type { CalendarSyncResult, DirEntry, FileStat, Platform, SyncState } from "./platform";

interface Bridge {
  invoke(cmd: string, ...args: unknown[]): Promise<{ ok: true; value: any } | { ok: false; error: string; raw: string }>;
  onFolderChanged(cb: () => void): () => void;
  pathForFile(file: File): string;
  platform: string;
}
declare global { interface Window { charter?: Bridge } }

export const inElectron = () => typeof window !== "undefined" && !!window.charter;

export async function createElectronPlatform(): Promise<Platform> {
  const b = window.charter!;
  // 主进程把系统错误翻成中文后返回；这里统一抛成 Error，界面读 message 即可
  const call = async <T>(cmd: string, ...args: unknown[]): Promise<T> => {
    const r = await b.invoke(cmd, ...args);
    if (r.ok) return r.value as T;
    const err = new Error(r.error); (err as any).raw = r.raw; throw err;
  };
  const os = await call<"mac" | "windows" | "linux">("platform_name");
  const sep = os === "windows" ? "\\" : "/";
  return {
    os,
    defaultRoot: () => call<string>("default_root"),
    join: (...parts) => parts.filter((p) => p !== "").map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, ""))).join(sep),
    readText: (path) => call<string>("read_text", path),
    readBytes: async (path) => new Uint8Array(await call<Uint8Array>("read_bytes", path)),
    writeText: (path, text) => call("write_text", path, text),
    writeBytes: (path, data) => call("write_bytes", path, data),
    calendarSync: (input) => call<CalendarSyncResult>("calendar_sync", input),
    zipFiles: (target, entries) => call<number>("zip_files", target, entries),
    stat: (path) => call<FileStat>("stat", path),
    listDir: (path) => call<DirEntry[]>("list_dir", path),
    mkdirs: (path) => call("mkdirs", path),
    copyFile: (from, to) => call("copy_file", from, to),
    moveFile: (from, to) => call("move_file", from, to),
    removeFile: (path) => call("remove_file", path),
    removeDir: (path) => call("remove_dir", path),
    tempDir: () => call<string>("temp_dir"),
    syncStatus: (root) => call<SyncState>("sync_status", root),
    reveal: (path) => call("reveal", path),
    openPath: (path) => call("open_path", path),
    openURL: (url) => call("open_url", url),
    deviceName: () => call<string>("device_name"),
    pickFiles: (o) => call<string[]>("pick_files", o),
    pickFolder: (o) => call<string | null>("pick_folder", o),
    saveDialog: (o) => call<string | null>("save_dialog", o),
    notify: (title, body) => call("notify", { title, body }),
    copyText: async (text) => { await navigator.clipboard.writeText(text); },
    fileURL: (path) => "charter-file://local/" + encodeURIComponent(path.replace(/\\/g, "/")),
    watch: async (path, onChange) => { const un = b.onFolderChanged(onChange); await call("watch", path); return un; },
    ocr: (png) => call<string>("ocr", png),
    cjkFont: async () => { try { return new Uint8Array(await call<Uint8Array>("cjk_font")); } catch { return null; } },
    bundledTemplates: () => call<string>("bundled_templates"),
    prefGet: (k) => { try { return localStorage.getItem("charter." + k); } catch { return null; } },
    prefSet: (k, v) => { try { if (v === null) localStorage.removeItem("charter." + k); else localStorage.setItem("charter." + k, v); } catch { /* 忽略 */ } },
  };
}

/** 拖入文件：Electron 用标准的 DOM 拖放事件，路径由 preload 取出。 */
export function installElectronDrop(onOver: (x: number, y: number) => void, onEnd: () => void, onDrop: (paths: string[], x: number, y: number) => void) {
  const b = window.charter!;
  const over = (e: DragEvent) => { if (!e.dataTransfer?.types.includes("Files")) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; onOver(e.clientX, e.clientY); };
  const leave = (e: DragEvent) => { if (!e.relatedTarget) onEnd(); };
  const drop = (e: DragEvent) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault(); onEnd();
    const paths = Array.from(e.dataTransfer.files).map((f) => b.pathForFile(f)).filter(Boolean);
    if (paths.length) onDrop(paths, e.clientX, e.clientY);
  };
  window.addEventListener("dragover", over); window.addEventListener("dragleave", leave); window.addEventListener("drop", drop);
  return () => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
}
