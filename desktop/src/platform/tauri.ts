// 桌面端（Tauri）实现。

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { DirEntry, FileStat, Platform, SyncState } from "./platform";

export async function createTauriPlatform(): Promise<Platform> {
  const os = (await invoke<string>("platform_name")) as "mac" | "windows" | "linux";
  const sep = os === "windows" ? "\\" : "/";
  let notifyAllowed: boolean | null = null;

  const bytesOf = async (cmd: string, args?: Record<string, unknown>) => new Uint8Array(await invoke<ArrayBuffer>(cmd, args));

  return {
    os,
    defaultRoot: () => invoke<string>("default_root"),
    join: (...parts) => parts.filter((p) => p !== "").map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, ""))).join(sep),
    readText: (path) => invoke<string>("read_text", { path }),
    readBytes: (path) => bytesOf("read_bytes", { path }),
    writeText: (path, text) => invoke("write_text", { path, text }),
    writeBytes: (path, data) => invoke("write_bytes", data, { headers: { "x-path": encodeURIComponent(path) } }),
    stat: (path) => invoke<FileStat>("stat", { path }),
    listDir: (path) => invoke<DirEntry[]>("list_dir", { path }),
    mkdirs: (path) => invoke("mkdirs", { path }),
    copyFile: (from, to) => invoke("copy_file", { from, to }),
    moveFile: (from, to) => invoke("move_file", { from, to }),
    removeFile: (path) => invoke("remove_file", { path }),
    removeDir: (path) => invoke("remove_dir", { path }),
    tempDir: () => invoke<string>("temp_dir"),
    syncStatus: (root) => invoke<SyncState>("sync_status", { root }),
    reveal: (path) => revealItemInDir(path),
    openPath: (path) => openPath(path),
    openURL: (url) => openUrl(url),
    deviceName: () => invoke<string>("device_name"),
    pickFiles: async ({ multiple, extensions, title }) => {
      const r = await openDialog({ multiple, title, filters: extensions ? [{ name: "文件", extensions }] : undefined });
      if (!r) return [];
      return Array.isArray(r) ? r : [r];
    },
    pickFolder: async ({ title, defaultPath }) => {
      const r = await openDialog({ directory: true, title, defaultPath });
      return typeof r === "string" ? r : null;
    },
    saveDialog: async ({ defaultName, extensions, title }) =>
      (await saveDialog({ defaultPath: defaultName, title, filters: extensions ? [{ name: "文件", extensions }] : undefined })) ?? null,
    notify: async (title, body) => {
      if (notifyAllowed === null) {
        notifyAllowed = await isPermissionGranted();
        if (!notifyAllowed) notifyAllowed = (await requestPermission()) === "granted";
      }
      if (notifyAllowed) sendNotification({ title, body });
    },
    copyText: async (text) => { await navigator.clipboard.writeText(text); },
    fileURL: (path) => convertFileSrc(path),
    watch: async (path, onChange) => {
      const un = await listen("charter://folder-changed", () => onChange());
      await invoke("watch", { path });
      return un;
    },
    ocr: (png) => invoke<string>("ocr", png),
    cjkFont: async () => { try { return await bytesOf("cjk_font"); } catch { return null; } },
    bundledTemplates: () => invoke<string>("bundled_templates"),
    prefGet: (k) => { try { return localStorage.getItem("charter." + k); } catch { return null; } },
    prefSet: (k, v) => { try { if (v === null) localStorage.removeItem("charter." + k); else localStorage.setItem("charter." + k, v); } catch { /* 忽略 */ } },
  };
}
