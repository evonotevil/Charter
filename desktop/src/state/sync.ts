// 数据文件夹的真实同步状态：Mac 读 iCloud 的文件标记，Windows 读云文件接口（OneDrive、iCloud for Windows）。

import { platform, type SyncState } from "../platform/platform";

export function syncTitle(s: SyncState): string {
  switch (s.kind) {
    case "checking": return "正在检查同步";
    case "synced": return "已同步";
    case "syncing": return s.count > 0 ? `正在同步 ${s.count} 个文件` : "正在同步";
    case "conflict": return "有冲突需要处理";
    case "failed": return "无法同步";
    case "signedOut": return "未登录 iCloud";
    case "local": return "仅保存在本机";
  }
}
export function syncSymbol(s: SyncState): string {
  switch (s.kind) {
    case "checking": case "syncing": return "arrow.triangle.2.circlepath.icloud";
    case "synced": return "checkmark.icloud";
    case "conflict": return "exclamationmark.icloud";
    case "failed": case "signedOut": return "xmark.icloud";
    case "local": return "internaldrive";
  }
}
export const syncNeedsAttention = (s: SyncState) => s.kind === "conflict" || s.kind === "failed" || s.kind === "signedOut";
export function syncDetail(s: SyncState): string {
  switch (s.kind) {
    case "checking": return "正在读取同步盘的状态。";
    case "synced": return `所有档案记录都已上传到同步盘。最后检查：${new Date(s.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}。`;
    case "syncing": return "同步盘正在上传或下载文件，完成前另一台电脑可能看不到最新内容。";
    case "conflict": return `两台电脑同时修改了 ${s.files.slice(0, 3).join("、")}${s.files.length > 3 ? ` 等 ${s.files.length} 个文件` : ""}。Charter 使用最新的版本；在文件夹中可以找到其他版本。`;
    case "failed": return `${s.message} 请检查网络和云盘空间。`;
    case "signedOut": return "数据文件夹在 iCloud 云盘里，但这台电脑没有登录 iCloud，修改不会同步。";
    case "local": return "数据文件夹不在同步盘（iCloud 云盘、OneDrive 等）中，修改只保存在这台电脑上。要在多台电脑之间同步，请把数据文件夹换到同步盘里。";
  }
}

export class SyncMonitor {
  state: SyncState = { kind: "checking" };
  private root: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private emit() { this.version++; for (const l of this.listeners) l(); }

  start(root: string) {
    if (this.root !== root) { this.root = root; this.state = { kind: "checking" }; this.emit(); }
    void this.refresh();
    if (!this.timer) this.timer = setInterval(() => void this.refresh(), 15000);
  }

  refreshSoon() {
    if (!this.root || this.state.kind === "local" || this.state.kind === "signedOut") return;
    if (this.state.kind === "synced") { this.state = { kind: "syncing", count: 0 }; this.emit(); }
    setTimeout(() => void this.refresh(), 3000);
  }

  async refresh() {
    if (!this.root) return;
    const root = this.root;
    try {
      const s = await platform().syncStatus(root);
      if (root !== this.root) return;
      const next = s.kind === "synced" && !("at" in s && s.at) ? { kind: "synced" as const, at: Date.now() } : s;
      if (JSON.stringify({ ...next, at: 0 }) !== JSON.stringify({ ...this.state, at: 0 })) { this.state = next; this.emit(); }
      else if (next.kind === "synced") { this.state = next; }
    } catch { /* 读不到状态时保持原样 */ }
  }
}
