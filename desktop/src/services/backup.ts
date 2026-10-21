// 档案备份：把整个数据文件夹（档案记录、模板库、归档文件、集团图标）打成一个 ZIP，
// 可以存到别处，或在另一台电脑、另一个数据文件夹里恢复。和“配置”不同，备份包含公司、集团、人员和文件。

import JSZip from "jszip";
import { platform } from "../platform/platform";
import { writeZip } from "./files";
import { FORMAT_VERSION, makeSnapshot } from "../domain/folder";
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
  await s.flushWrites();
  const p = platform();
  const f = s.folder;
  const entries: { path: string; data: Uint8Array }[] = [];
  const data: { rel: string[]; full: string }[] = [];
  await walk(f.dataDir, ["data"], data);
  for (const x of data.filter((x) => x.rel[x.rel.length - 1].endsWith(".json"))) entries.push({ path: x.rel.join("/"), data: await p.readBytes(x.full) });
  if ((await p.stat(f.templatesFile)).exists) entries.push({ path: "templates.json", data: await p.readBytes(f.templatesFile) });
  const files: { rel: string[]; full: string }[] = [];
  await walk(f.filesDir, ["files"], files);
  await walk(f.groupIconsDir, ["group-icons"], files);
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
  // 先把备份全部读进内存并校验 JSON，确认完好后才动数据文件夹。
  const dataFiles: { name: string; text: string }[] = [];
  for (const e of b.zip.file(/^data\/[^/]+\.json$/)) {
    const text = await e.async("string");
    try { JSON.parse(text); } catch { s.setError(`备份里的 ${e.name} 已损坏，没有恢复。当前数据未改动。`); return; }
    dataFiles.push({ name: e.name.slice(5), text });
  }
  const tpl = b.zip.file("templates.json");
  const tplText = tpl ? await tpl.async("string") : null;
  try {
    await s.flushWrites();
    if (!s.loadFailed) await makeSnapshot(f, "恢复备份前");
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
    for (const e of b.zip.file(/^(files|group-icons)\//)) {
      const dest = p.join(f.root, ...e.name.split("/"));
      await p.writeBytes(dest, await e.async("uint8array"));
    }
  } catch (e) {
    s.setError(`恢复没有完成：${(e instanceof Error ? e.message : String(e))}。可以在“备份与配置”里用“恢复备份前”的快照回到原来的状态。`);
    await s.load();
    return;
  }
  await s.load();
  s.onDataCleared?.();
  s.showToast(`已从备份恢复：${b.info.companies} 家公司、${b.info.documents} 份文件。`);
}
