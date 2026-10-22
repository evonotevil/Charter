// 数据文件夹读写。目录结构：
//   charter.json（文件夹标记与格式版本）   data/*.json   templates.json
//   files/<公司>/…   files/people/<姓名>/…   packets/   snapshots/<yyyy-MM-dd HHmmss>/   .undo/   group-icons/
// 所有 JSON 为标准格式（两格缩进），时间戳为 ISO 8601 字符串。

import { platform, extname, basename } from "../platform/platform";
import type { Day } from "./day";
import { toJSON } from "./json";
import type { NodeRef, TemplateLibrary } from "./models";
import { normLibrary } from "./normalize";

export const FORMAT_VERSION = 1;

export const collections = ["companies", "people", "holdings", "appointments", "parties", "documents", "obligations", "changes", "settings", "groups", "requests"] as const;

export class CollectionSaveError extends Error {
  constructor(public cause: unknown, public rollbackFailures: string[]) {
    super(String((cause as Error)?.message ?? cause) + (rollbackFailures.length
      ? "；部分档案无法恢复，请停止编辑并检查数据文件夹：" + rollbackFailures.join("；") : "（原档案已恢复）"));
  }
}

export class FolderStore {
  constructor(public root: string) {}
  private get p() { return platform(); }
  get dataDir() { return this.p.join(this.root, "data"); }
  get filesDir() { return this.p.join(this.root, "files"); }
  get packetsDir() { return this.p.join(this.root, "packets"); }
  get templatesFile() { return this.p.join(this.root, "templates.json"); }
  get snapshotsDir() { return this.p.join(this.root, "snapshots"); }
  get undoDir() { return this.p.join(this.root, ".undo"); }
  get groupIconsDir() { return this.p.join(this.root, "group-icons"); }
  get markerFile() { return this.p.join(this.root, "charter.json"); }
  url(name: string) { return this.p.join(this.dataDir, name + ".json"); }
  abs(rel: string) { return this.p.join(this.root, ...rel.split("/")); }

  async isInCloud(): Promise<boolean> {
    const s = await this.p.syncStatus(this.root);
    return s.kind !== "local";
  }

  async prepare() {
    for (const d of [this.root, this.dataDir, this.filesDir, this.packetsDir]) await this.p.mkdirs(d);
    if (!(await this.p.stat(this.markerFile)).exists) {
      await this.p.writeText(this.markerFile, toJSON({ app: "Charter", format: FORMAT_VERSION, createdAt: new Date().toISOString() }));
    }
  }

  /** 读文件夹标记；不是 Charter 文件夹时返回 null。格式比本程序新时报错，避免旧版本覆盖新数据。 */
  async checkFormat(): Promise<number | null> {
    if (!(await this.p.stat(this.markerFile)).exists) return null;
    const m = JSON.parse(await this.p.readText(this.markerFile));
    if (typeof m.format === "number" && m.format > FORMAT_VERSION) throw new Error("这个数据文件夹由更新版本的 Charter 创建，请先升级 Charter。");
    return m.format ?? FORMAT_VERSION;
  }

  async load<T>(name: string): Promise<T | null> {
    const u = this.url(name);
    if (!(await this.p.stat(u)).exists) return null;
    const text = await this.p.readText(u);
    return JSON.parse(text) as T;
  }

  async save(value: unknown, name: string) {
    await this.p.writeText(this.url(name), toJSON(value));
  }

  /** 一组相关集合的补偿式事务：先读出原文件，写入失败时逐个回滚。 */
  async saveCollections(writes: [string, unknown][]) {
    const originals: [string, string | null][] = [];
    for (const [name] of writes) {
      const u = this.url(name);
      originals.push([name, (await this.p.stat(u)).exists ? await this.p.readText(u) : null]);
    }
    let attempted = 0;
    try {
      for (const [name, value] of writes) { attempted++; await this.p.writeText(this.url(name), toJSON(value)); }
    } catch (e) {
      const failures: string[] = [];
      for (const [name, data] of originals.slice(0, attempted).reverse()) {
        try {
          if (data !== null) await this.p.writeText(this.url(name), data);
          else if ((await this.p.stat(this.url(name))).exists) await this.p.removeFile(this.url(name));
        } catch (err) { failures.push(`${name}：${(err as Error).message}`); }
      }
      throw new CollectionSaveError(e, failures);
    }
  }

  async modificationDate(name: string): Promise<number | null> {
    return (await this.p.stat(this.url(name))).mtime;
  }

  async modificationDates(): Promise<Record<string, number | null>> {
    const out: Record<string, number | null> = {};
    for (const c of collections) out[c] = await this.modificationDate(c);
    return out;
  }

  // MARK: 模板

  async loadTemplates(): Promise<TemplateLibrary> {
    const bundled = normLibrary(JSON.parse(await this.p.bundledTemplates()));
    if ((await this.p.stat(this.templatesFile)).exists) {
      let lib = normLibrary(JSON.parse(await this.p.readText(this.templatesFile)));
      if (bundled.version > lib.version) {
        lib = migrateTemplates(lib, bundled);
        await this.saveTemplates(lib);
      }
      return lib;
    }
    await this.saveTemplates(bundled);
    return bundled;
  }

  async saveTemplates(lib: TemplateLibrary) {
    await this.p.writeText(this.templatesFile, toJSON(lib));
  }

  // MARK: 文件

  folderFor(owner: NodeRef, name: string) {
    return owner.kind === "company"
      ? this.p.join(this.filesDir, safeName(name))
      : this.p.join(this.filesDir, "people", safeName(name));
  }

  /** 把外部文件复制进数据文件夹，按“公司名_类型_签发日”命名，返回相对路径（用 / 分隔，两个系统通用）。 */
  async archive(source: string, ownerName: string, owner: NodeRef, typeName: string, issued?: Day): Promise<string> {
    const dir = this.folderFor(owner, ownerName);
    await this.p.mkdirs(dir);
    const ext = (extname(source) || "pdf").toLowerCase();
    const base = safeName([ownerName, typeName, issued ?? "未注明日期"].join("_"));
    let file = `${base}.${ext}`;
    let n = 2;
    while ((await this.p.stat(this.p.join(dir, file))).exists) { file = `${base} (${n}).${ext}`; n++; }
    await this.p.copyFile(source, this.p.join(dir, file));
    const rel = ["files", ...(owner.kind === "person" ? ["people"] : []), safeName(ownerName), file];
    return rel.join("/");
  }
}

export function safeName(s: string): string {
  return s.split(/[/\\:?%*|"<>]/).join("-").trim();
}

export function migrateTemplates(old: TemplateLibrary, next: TemplateLibrary): TemplateLibrary {
  const lib: TemplateLibrary = structuredClone(old);
  const renamed: Record<string, string> = { "在职证明": "董事在职证明", "地址证明": "住址证明" };
  for (const t of next.documentTypes) {
    const i = lib.documentTypes.findIndex((x) => x.id === t.id);
    if (i >= 0) {
      const cur = lib.documentTypes[i];
      if (cur.builtIn && renamed[cur.name] === t.name) { cur.name = t.name; cur.localNames = t.localNames; }
    } else lib.documentTypes.push(t);
  }
  for (const j of next.jurisdictions) if (!lib.jurisdictions.some((x) => x.code === j.code)) lib.jurisdictions.push(j);
  for (const r of next.rules) if (!lib.rules.some((x) => x.id === r.id)) lib.rules.push(r);
  for (const p of next.packets) if (!lib.packets.some((x) => x.id === p.id)) lib.packets.push(p);
  lib.version = next.version;
  return lib;
}

// MARK: - 本地快照

export interface DataSnapshot { id: string; folder: string; date: number; reason: string; companies?: number; documents?: number }
export const snapshotKeep = 20;

const pad = (n: number) => String(n).padStart(2, "0");
function snapshotName(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function makeSnapshot(f: FolderStore, reason: string): Promise<DataSnapshot> {
  const p = platform();
  const now = new Date();
  let target = p.join(f.snapshotsDir, snapshotName(now));
  for (let n = 2; (await p.stat(target)).exists; n++) target = p.join(f.snapshotsDir, snapshotName(now) + `-${n}`);
  const dataT = p.join(target, "data");
  await p.mkdirs(dataT);
  try {
    for (const e of await p.listDir(f.dataDir)) {
      if (!e.isDir && e.name.toLowerCase().endsWith(".json")) await p.copyFile(p.join(f.dataDir, e.name), p.join(dataT, e.name));
    }
    if ((await p.stat(f.templatesFile)).exists) await p.copyFile(f.templatesFile, p.join(target, "templates.json"));
    const count = async (file: string) => {
      try { const a = JSON.parse(await p.readText(file)); return Array.isArray(a) ? a.length : undefined; } catch { return undefined; }
    };
    const info = {
      reason, date: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
      companies: await count(p.join(dataT, "companies.json")), documents: await count(p.join(dataT, "documents.json")),
    };
    await p.writeText(p.join(target, "info.json"), JSON.stringify(info));
    await pruneSnapshots(f);
    return { id: basename(target), folder: target, date: now.getTime(), reason, companies: info.companies, documents: info.documents };
  } catch (e) {
    try { await p.removeDir(target); } catch { /* 忽略 */ }
    throw e;
  }
}

export async function listSnapshots(f: FolderStore): Promise<DataSnapshot[]> {
  const p = platform();
  if (!(await p.stat(f.snapshotsDir)).exists) return [];
  const out: DataSnapshot[] = [];
  for (const e of await p.listDir(f.snapshotsDir)) {
    if (!e.isDir || e.name.startsWith(".")) continue;
    try {
      const info = JSON.parse(await p.readText(p.join(f.snapshotsDir, e.name, "info.json")));
      out.push({ id: e.name, folder: p.join(f.snapshotsDir, e.name), date: Date.parse(info.date), reason: info.reason, companies: info.companies, documents: info.documents });
    } catch { /* 没有 info.json：写到一半中断的目录 */ }
  }
  return out.sort((a, b) => b.date - a.date);
}

async function pruneSnapshots(f: FolderStore) {
  const p = platform();
  const list = await listSnapshots(f);
  for (const old of list.slice(snapshotKeep)) { try { await p.removeDir(old.folder); } catch { /* 忽略 */ } }
  const cutoff = Date.now() - 86400000;
  for (const e of await p.listDir(f.snapshotsDir)) {
    if (!e.isDir || e.name.startsWith(".")) continue;
    const info = p.join(f.snapshotsDir, e.name, "info.json");
    if (!(await p.stat(info)).exists && (e.mtime ?? 0) < cutoff) { try { await p.removeDir(p.join(f.snapshotsDir, e.name)); } catch { /* 忽略 */ } }
  }
}

export async function needsDailySnapshot(f: FolderStore): Promise<boolean> {
  const latest = (await listSnapshots(f))[0];
  if (!latest) return true;
  return new Date(latest.date).toDateString() !== new Date().toDateString();
}

export async function restoreSnapshot(s: DataSnapshot, f: FolderStore) {
  const p = platform();
  const src = p.join(s.folder, "data");
  const files = (await p.listDir(src)).filter((e) => !e.isDir && e.name.toLowerCase().endsWith(".json"));
  if (!files.length) throw new Error("快照内容不完整");
  await f.prepare();
  const names = new Set(files.map((e) => e.name));
  for (const e of files) await p.writeText(p.join(f.dataDir, e.name), await p.readText(p.join(src, e.name)));
  for (const e of await p.listDir(f.dataDir)) {
    if (!e.isDir && e.name.toLowerCase().endsWith(".json") && !names.has(e.name)) await p.removeFile(p.join(f.dataDir, e.name));
  }
  const tpl = p.join(s.folder, "templates.json");
  if ((await p.stat(tpl)).exists) await p.writeText(f.templatesFile, await p.readText(tpl));
  // 清空数据前的快照里带着归档文件（files/…）：放回原位，已存在的不覆盖。
  const walk = async (dir: string, rel: string[]) => {
    for (const e of await p.listDir(dir)) {
      const full = p.join(dir, e.name);
      if (e.isDir) await walk(full, [...rel, e.name]);
      else {
        const dest = p.join(f.root, ...rel, e.name);
        if (!(await p.stat(dest)).exists) { await p.mkdirs(p.join(f.root, ...rel)); await p.copyFile(full, dest); }
      }
    }
  };
  const kept = p.join(s.folder, "files");
  if ((await p.stat(kept)).exists) await walk(kept, ["files"]);
}

export function snapshotTitle(ms: number): string {
  const d = new Date(ms);
  const year = d.getFullYear() === new Date().getFullYear() ? "" : `${d.getFullYear()}年`;
  return `${year}${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
