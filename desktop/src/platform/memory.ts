// 内存实现：浏览器预览与单元测试使用，不碰真实文件。

import type { DirEntry, FileStat, Platform, SyncState } from "./platform";

export class MemoryPlatform implements Platform {
  readonly os = "web" as const;
  files = new Map<string, { data: Uint8Array; mtime: number }>();
  dirs = new Set<string>(["/"]);
  prefs = new Map<string, string>();
  notes: { title: string; body: string }[] = [];
  clipboard = "";
  private tick = 1;
  constructor(private templates: string) {}

  private norm(p: string) { return ("/" + p.split("/").filter(Boolean).join("/")).replace(/\/+$/, "") || "/"; }
  private parent(p: string) { const n = this.norm(p); return n.slice(0, n.lastIndexOf("/")) || "/"; }
  private now() { return this.tick++; }

  async defaultRoot() { return "/Charter"; }
  join(...parts: string[]) { return this.norm(parts.join("/")); }
  async readText(p: string) { return new TextDecoder().decode(await this.readBytes(p)); }
  async readBytes(p: string) {
    const f = this.files.get(this.norm(p));
    if (!f) throw new Error(`找不到文件：${p}`);
    return f.data;
  }
  async writeText(p: string, t: string) { await this.writeBytes(p, new TextEncoder().encode(t)); }
  async writeBytes(p: string, data: Uint8Array) {
    await this.mkdirs(this.parent(p));
    this.files.set(this.norm(p), { data, mtime: this.now() });
  }
  async stat(p: string): Promise<FileStat> {
    const n = this.norm(p);
    const f = this.files.get(n);
    if (f) return { exists: true, isDir: false, mtime: f.mtime, size: f.data.length };
    if (this.dirs.has(n)) return { exists: true, isDir: true, mtime: 0, size: 0 };
    return { exists: false, isDir: false, mtime: null, size: 0 };
  }
  async listDir(p: string): Promise<DirEntry[]> {
    const n = this.norm(p);
    const prefix = n === "/" ? "/" : n + "/";
    const out = new Map<string, DirEntry>();
    for (const [k, v] of this.files) if (k.startsWith(prefix) && !k.slice(prefix.length).includes("/")) out.set(k, { name: k.slice(prefix.length), isDir: false, mtime: v.mtime, size: v.data.length });
    for (const d of this.dirs) if (d.startsWith(prefix) && d !== n && !d.slice(prefix.length).includes("/")) out.set(d, { name: d.slice(prefix.length), isDir: true, mtime: 0, size: 0 });
    return [...out.values()];
  }
  async mkdirs(p: string) {
    let cur = "";
    for (const part of this.norm(p).split("/").filter(Boolean)) { cur += "/" + part; this.dirs.add(cur); }
  }
  async copyFile(a: string, b: string) {
    if (this.files.has(this.norm(b))) throw new Error("目标文件已存在");
    await this.writeBytes(b, await this.readBytes(a));
  }
  async moveFile(a: string, b: string) { await this.copyFile(a, b); this.files.delete(this.norm(a)); }
  async removeFile(p: string) { this.files.delete(this.norm(p)); }
  async removeDir(p: string) {
    const n = this.norm(p);
    for (const k of [...this.files.keys()]) if (k === n || k.startsWith(n + "/")) this.files.delete(k);
    for (const d of [...this.dirs]) if (d === n || d.startsWith(n + "/")) this.dirs.delete(d);
  }
  async tempDir() { await this.mkdirs("/tmp"); return "/tmp"; }
  async syncStatus(): Promise<SyncState> { return { kind: "local" }; }
  async reveal() {}
  async openPath() {}
  async openURL() {}
  async deviceName() { return "预览"; }
  // 浏览器预览里用系统选择框读入真实文件，放进内存里的 /uploads；测试环境（无 document）返回空。
  async pickFiles(opts?: { multiple: boolean; extensions?: string[] }): Promise<string[]> {
    if (typeof document === "undefined") return [];
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = !!opts?.multiple;
    if (opts?.extensions) input.accept = opts.extensions.map((e) => "." + e).join(",");
    const files: File[] = await new Promise((res) => {
      input.onchange = () => res([...(input.files ?? [])]);
      input.addEventListener("cancel", () => res([]));
      input.click();
    });
    const out: string[] = [];
    for (const f of files) {
      const p = this.join("/uploads", `${this.now()}`, f.name);
      await this.writeBytes(p, new Uint8Array(await f.arrayBuffer()));
      out.push(p);
    }
    return out;
  }
  async pickFolder() { return null; }
  async saveDialog(opts?: { defaultName: string }) { return typeof document === "undefined" ? null : this.join("/exports", opts?.defaultName ?? "export"); }
  async notify(title: string, body: string) { this.notes.push({ title, body }); }
  async copyText(t: string) { this.clipboard = t; try { await navigator.clipboard?.writeText(t); } catch { /* 忽略 */ } }
  fileURL(p: string) {
    const f = this.files.get(this.norm(p));
    if (!f) return "";
    const type = p.toLowerCase().endsWith(".pdf") ? "application/pdf" : p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    return URL.createObjectURL(new Blob([f.data as BlobPart], { type }));
  }
  async watch() { return () => {}; }
  async ocr() { return ""; }
  async cjkFont() { return null; }
  async bundledTemplates() { return this.templates; }
  prefGet(k: string) { return this.prefs.get(k) ?? null; }
  prefSet(k: string, v: string | null) { if (v === null) this.prefs.delete(k); else this.prefs.set(k, v); }
}
