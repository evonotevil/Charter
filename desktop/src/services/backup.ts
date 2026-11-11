// 档案备份：把整个数据文件夹（档案记录、模板库、归档文件、集团图标）打成一个 ZIP，
// 可以存到别处，或在另一台电脑、另一个数据文件夹里恢复。和“配置”不同，备份包含公司、集团、人员和文件。

import JSZip from "jszip";
import { platform } from "../platform/platform";
import { writeZip } from "./files";
import { type DataSnapshot, FORMAT_VERSION, makeSnapshot, restoreSnapshot } from "../domain/folder";
import type { Store } from "../state/store";

const MANIFEST = "charter-backup.json";

export interface BackupInfo {
  exportedAt: string;
  format: number;
  companies: number; groups: number; people: number; documents: number; files: number;
}

async function walk(dir: string, rel: string[], out: { rel: string[]; full: string }[]) {
  const p = platform();
  if (!(await p.stat(dir)).exists) return;
  for (const e of await p.listDir(dir)) {
    if (e.name.startsWith(".") || e.name === "Thumbs.db" || e.name === "desktop.ini") continue;
    const full = p.join(dir, e.name);
    if (e.isDir) await walk(full, [...rel, e.name], out);
    else out.push({ rel: [...rel, e.name], full });
  }
}

/** 导出备份，返回包含的内容统计。 */
export async function exportBackup(s: Store, path: string, onProgress?: (done: number, total: number) => void): Promise<BackupInfo> {
  // 5.5.5：有保存失败的修改时不导出（否则备份里是旧数据却显示成功）
  if (!(await s.ensureSaved("导出备份"))) throw new Error(`有修改还没保存到数据文件夹（${s.unsavedLabels.join("、")}），没有导出备份。`);
  const p = platform();
  const f = s.folder;
  const data: { rel: string[]; full: string }[] = [];
  await walk(f.dataDir, ["data"], data);
  const files0: { rel: string[]; full: string }[] = [];
  await walk(f.filesDir, ["files"], files0);
  await walk(f.groupIconsDir, ["group-icons"], files0);
  // 5.5.5：待整理和废纸篓的文件跟记录一起备份
  await walk(platform().join(f.root, "inbox"), ["inbox"], files0);
  await walk(platform().join(f.root, "trash"), ["trash"], files0);
  // 5.3.3：桌面端流式打包，不把全部材料读进内存
  if (p.zipFiles) {
    const d0 = s.data;
    const info0: BackupInfo = {
      exportedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), format: FORMAT_VERSION,
      companies: d0.companies.length, groups: d0.groups.length, people: d0.people.length, documents: d0.documents.length,
      files: files0.filter((x) => x.rel[0] === "files").length,
    };
    const list: ({ name: string; path: string } | { name: string; text: string })[] = [
      { name: MANIFEST, text: JSON.stringify({ app: "Charter", ...info0 }, null, 2) },
      ...data.filter((x) => x.rel[x.rel.length - 1].endsWith(".json")).map((x) => ({ name: x.rel.join("/"), path: x.full })),
      ...((await p.stat(f.templatesFile)).exists ? [{ name: "templates.json", path: f.templatesFile }] : []),
      ...files0.map((x) => ({ name: x.rel.join("/"), path: x.full })),
    ];
    onProgress?.(0, list.length);
    await p.zipFiles(path, list);
    onProgress?.(list.length, list.length);
    return info0;
  }
  const entries: { path: string; data: Uint8Array }[] = [];
  for (const x of data.filter((x) => x.rel[x.rel.length - 1].endsWith(".json"))) entries.push({ path: x.rel.join("/"), data: await p.readBytes(x.full) });
  if ((await p.stat(f.templatesFile)).exists) entries.push({ path: "templates.json", data: await p.readBytes(f.templatesFile) });
  const files: { rel: string[]; full: string }[] = [];
  await walk(f.filesDir, ["files"], files);
  await walk(f.groupIconsDir, ["group-icons"], files);
  await walk(p.join(f.root, "inbox"), ["inbox"], files);
  await walk(p.join(f.root, "trash"), ["trash"], files);
  for (const x of files) {
    try { entries.push({ path: x.rel.join("/"), data: await p.readBytes(x.full) }); }
    catch (e) { throw new Error(`读取“${x.rel.slice(1).join("/")}”时出错（${e instanceof Error ? e.message : String(e)}）`); }
  }
  const d = s.data;
  const info: BackupInfo = {
    exportedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), format: FORMAT_VERSION,
    companies: d.companies.length, groups: d.groups.length, people: d.people.length, documents: d.documents.length,
    files: files.filter((x) => x.rel[0] === "files").length,
  };
  entries.unshift({ path: MANIFEST, data: new TextEncoder().encode(JSON.stringify({ app: "Charter", ...info }, null, 2)) });
  const zip = await writeZip(entries, onProgress);
  try { await p.writeBytes(path, zip); }
  catch (e) { throw new Error(`写入备份文件时出错（${e instanceof Error ? e.message : String(e)}，大小 ${(zip.byteLength / 1048576).toFixed(1)} MB）`); }
  return info;
}

/** 5.5.5：备份条目路径必须是相对、无“..”、无反斜杠，并且只能落在这些目录里。 */
const ROOTS = new Set(["data", "files", "group-icons", "inbox", "trash"]);
export function safeEntryName(name: string): boolean {
  if (!name || name.includes("\\") || name.includes("\0") || /^[a-zA-Z]:/.test(name) || name.startsWith("/")) return false;
  const parts = name.split("/");
  if (parts.some((x) => x === ".." || x === "." || x.includes(":"))) return false;
  return name === MANIFEST || name === "templates.json" || (parts.length >= 2 && ROOTS.has(parts[0]));
}
const ARRAY_FILES = new Set(["companies", "people", "holdings", "appointments", "parties", "documents", "obligations", "changes", "groups", "requests", "inbox", "trash", "sends"]);
/** 检查一份数据文件的结构：集合必须是对象数组，设置必须是对象。 */
export function checkDataFile(name: string, value: unknown): string | null {
  const base = name.replace(/\.json$/, "");
  if (ARRAY_FILES.has(base)) return Array.isArray(value) && value.every((x) => x && typeof x === "object" && !Array.isArray(x)) ? null : `${name} 内容不完整`;
  if (base === "settings") return value && typeof value === "object" && !Array.isArray(value) ? null : `${name} 内容不完整`;
  return null;
}

export interface OpenedBackup { info: BackupInfo; zip: JSZip }

/** 读取并检查备份文件。 */
export async function readBackup(path: string): Promise<OpenedBackup> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(await platform().readBytes(path)); }
  catch { throw new Error("这个文件不是 Charter 备份，或者已经损坏。请选择用“导出备份…”生成的 ZIP 文件。"); }
  const m = zip.file(MANIFEST);
  if (!m) {
    if (zip.file("templates.json") && !zip.file(/^data\//).length) throw new Error("这个文件不是 Charter 备份。");
    throw new Error("这个文件不是 Charter 备份，或者已经损坏。请选择用“导出备份…”生成的 ZIP 文件。");
  }
  let info: BackupInfo;
  try { info = JSON.parse(await m.async("string")); } catch { throw new Error("备份文件的说明信息已损坏，无法恢复。"); }
  if (info.format > FORMAT_VERSION) throw new Error("这份备份来自更新版本的 Charter。请先把这台电脑上的 Charter 升级到最新版本再恢复。");
  if (!zip.file(/^data\/.+\.json$/).length) throw new Error("备份里没有档案记录，无法恢复。");
  return { info, zip };
}

/** 用备份替换当前数据文件夹的档案。先给当前状态做快照，失败时当前数据不受影响。 */
export async function restoreBackup(s: Store, b: OpenedBackup) {
  if (s.isImporting) { s.setError("文件正在归档，请完成后再恢复备份。"); return; }
  if (s.isLoading) return;
  const p = platform();
  const f = s.folder;
  // 先把备份全部读进内存并校验路径和结构，确认完好后才动数据文件夹。
  const bad = Object.keys(b.zip.files).filter((n) => !b.zip.files[n].dir && !safeEntryName(n));
  if (bad.length) { s.setError(`这份备份含有不安全的文件路径（${bad[0]}${bad.length > 1 ? ` 等 ${bad.length} 个` : ""}），已拒绝恢复。当前数据未改动。`); return; }
  const dataFiles: { name: string; text: string }[] = [];
  for (const e of b.zip.file(/^data\/[^/]+\.json$/)) {
    const text = await e.async("string");
    let v: unknown;
    try { v = JSON.parse(text); } catch { s.setError(`备份里的 ${e.name} 已损坏，没有恢复。当前数据未改动。`); return; }
    const why = checkDataFile(e.name.slice(5), v);
    if (why) { s.setError(`这份备份里的 ${why}，无法载入，没有恢复。当前数据未改动。`); return; }
    dataFiles.push({ name: e.name.slice(5), text });
  }
  if (!dataFiles.some((x) => x.name === "companies.json")) { s.setError("这份备份缺少公司数据（companies.json），没有恢复。当前数据未改动。"); return; }
  let snap: DataSnapshot | null = null, overwritten = 0;
  const tpl = b.zip.file("templates.json");
  const tplText = tpl ? await tpl.async("string") : null;
  try {
    if (!s.loadFailed && !(await s.ensureSaved("恢复备份"))) return;
    if (!s.loadFailed) {
      snap = await makeSnapshot(f, "恢复备份前");
      // 5.5.5：会被覆盖的归档文件也存进这份快照，从快照恢复时放回
      for (const e of b.zip.file(/^(files|group-icons|inbox|trash)\//)) {
        const dest = p.join(f.root, ...e.name.split("/"));
        if ((await p.stat(dest)).exists) {
          const keep = p.join(snap.folder, "overwritten", ...e.name.split("/"));
          await p.mkdirs(keep.slice(0, Math.max(keep.lastIndexOf("/"), keep.lastIndexOf("\\"))));
          await p.copyFile(dest, keep); overwritten++;
        }
      }
    }
  } catch (e) {
    s.setError(`恢复前的快照没有写成，没有恢复：${(e instanceof Error ? e.message : String(e))}。请确认数据文件夹可写入后重试。`);
    return;
  }
  try {
    await f.prepare();
    const names = new Set(dataFiles.map((x) => x.name));
    for (const x of dataFiles) await p.writeText(p.join(f.dataDir, x.name), x.text);
    for (const e of await p.listDir(f.dataDir)) {
      if (!e.isDir && e.name.endsWith(".json") && !names.has(e.name)) await p.removeFile(p.join(f.dataDir, e.name));
    }
    if (tplText) await p.writeText(f.templatesFile, tplText);
    for (const e of b.zip.file(/^(files|group-icons|inbox|trash)\//)) {
      const dest = p.join(f.root, ...e.name.split("/"));
      if (!dest.startsWith(f.root)) throw new Error(`不安全的文件路径：${e.name}`);
      await p.writeBytes(dest, await e.async("uint8array"));
    }
  } catch (e) {
    s.setError(`恢复没有完成：${(e instanceof Error ? e.message : String(e))}。可以在“备份与配置”里用“恢复备份前”的快照回到原来的状态。`);
    await s.load();
    return;
  }
  await s.load();
  if (s.loadFailed) {
    // 5.5.5：载入失败就回到恢复前，不显示成功
    if (snap) { try { await restoreSnapshot(snap, f); await s.load(); } catch { /* 下面报错 */ } }
    s.setError("备份写入后无法载入，已回到恢复前的状态。这份备份可能来自不兼容的版本或已损坏。");
    return;
  }
  // 旧版备份没有待整理和废纸篓的文件：去掉指向不存在文件的记录
  const dropped = await dropDanglingLifecycle(s);
  s.onDataCleared?.();
  s.showToast(`已从备份恢复：${b.info.companies} 家公司、${b.info.documents} 份文件。${overwritten ? `恢复前会被覆盖的 ${overwritten} 个文件已存进快照。` : ""}${dropped ? `另有 ${dropped} 条待整理或废纸篓记录找不到文件，已略过。` : ""}`);
}

async function dropDanglingLifecycle(s: Store): Promise<number> {
  const p = platform();
  const inbox = [], trash = [];
  for (const i of s.data.inbox) if ((await p.stat(s.folder.abs(i.path))).exists) inbox.push(i);
  for (const e of s.data.trash) if ((await p.stat(s.folder.abs(e.path))).exists) trash.push(e);
  const n = s.data.inbox.length - inbox.length + s.data.trash.length - trash.length;
  if (n) { await s.persistCollections({ inbox, trash }); s.replace({ inbox, trash }); }
  return n;
}
