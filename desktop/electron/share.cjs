// 5.5.6 多台电脑共用：判断文件夹是否在同步盘（iCloud 云盘 / OneDrive），以及把数据文件夹整份复制到另一个位置。
// 只认 iCloud 云盘和 OneDrive。复制时先让只在云端的文件下载下来；复制期间源文件有改动的，复制完再补一次。

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
const home = os.homedir();

// Mac：问系统这个路径（或最近的已存在上级）是否在 iCloud 里——开了“桌面与文稿”同步时 ~/Documents 也在 iCloud，但路径看不出来
const UBIQUITOUS_SCRIPT = "ObjC.import('Foundation');\nfunction run(argv) {\n  var u = $.NSURL.fileURLWithPath(argv[0]); var v = Ref();\n  u.getResourceValueForKeyError(v, $.NSURLIsUbiquitousItemKey, null);\n  return (v[0] && !v[0].isNil() && v[0].boolValue) ? 'yes' : 'no';\n}";

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 20000, windowsHide: true, ...opts }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

const lower = (p) => (isWin ? p.toLowerCase() : p);
const under = (p, dir) => !!dir && (lower(p) === lower(dir) || lower(p).startsWith(lower(dir.replace(/[\\/]+$/, "")) + path.sep));

function oneDriveRoots() {
  const out = [];
  if (isWin) for (const v of ["OneDriveConsumer", "OneDrive", "OneDriveCommercial"]) if (process.env[v]) out.push(process.env[v]);
  if (isMac) {
    const cs = path.join(home, "Library/CloudStorage");
    try { for (const n of fs.readdirSync(cs)) if (/^OneDrive/i.test(n)) out.push(path.join(cs, n)); } catch { /* 没装 OneDrive */ }
  }
  return out;
}
function iCloudRoot() {
  if (isMac) return path.join(home, "Library/Mobile Documents/com~apple~CloudDocs");
  if (isWin) return path.join(home, "iCloudDrive");
  return null;
}

/** 这个路径在哪个同步盘里：icloud / onedrive / null（本机）。 */
async function cloudKind(p) {
  if (!p) return null;
  const abs = path.resolve(p);
  if (oneDriveRoots().some((r) => under(abs, r))) return "onedrive";
  if (isMac && abs.includes("/Library/Mobile Documents/")) return "icloud";
  if (isWin && /[\\/]icloud ?drive([\\/]|$)/i.test(abs)) return "icloud";
  if (isMac) {
    let q = abs;
    while (q && !fs.existsSync(q)) { const up = path.dirname(q); if (up === q) break; q = up; }
    if (q && (await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", UBIQUITOUS_SCRIPT, q])) === "yes") return "icloud";
  }
  return null;
}

/** 这台电脑上的程序数据位置（不在同步盘、不随域账户漫游）。 */
function localRoot(app) {
  if (isWin) return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Charter", "Data");
  if (isMac) return path.join(home, "Library", "Application Support", "Charter", "Data");
  return path.join(app.getPath("userData"), "Data");
}

/** 同步盘里建议的位置。 */
function cloudSuggestions() {
  const out = [];
  const ic = iCloudRoot();
  if (ic && fs.existsSync(ic)) out.push({ kind: "icloud", path: path.join(ic, "Charter") });
  for (const r of oneDriveRoots()) if (fs.existsSync(r)) out.push({ kind: "onedrive", path: path.join(r, "Charter") });
  return out;
}

/** 5.5.5 以前的默认位置：同步盘里的 Charter。老用户没改过文件夹时一直在用它，不能因为默认值改了就“丢”数据。 */
function legacyDefaultRoot(app) {
  if (isMac) {
    const icloud = iCloudRoot();
    return fs.existsSync(icloud) ? path.join(icloud, "Charter") : path.join(home, "Documents/Charter");
  }
  if (isWin) {
    for (const v of ["OneDriveConsumer", "OneDrive", "OneDriveCommercial"]) if (process.env[v] && fs.existsSync(process.env[v])) return path.join(process.env[v], "Charter");
    const icloud = iCloudRoot();
    if (fs.existsSync(icloud)) return path.join(icloud, "Charter");
  }
  return path.join(app.getPath("documents"), "Charter");
}
/** 默认数据文件夹：旧默认位置已有档案就沿用；否则新安装放在这台电脑上（5.5.6）。 */
function defaultRoot(app) {
  const legacy = legacyDefaultRoot(app);
  if (fs.existsSync(path.join(legacy, "charter.json"))) return legacy;
  return localRoot(app);
}

// MARK: - 复制

async function walk(dir, rel = "", out = []) {
  for (const d of await fsp.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? path.join(rel, d.name) : d.name;
    if (d.isDirectory()) await walk(dir, r, out);
    else if (d.isFile()) out.push(r);
  }
  return out;
}
// Mac 旧版 iCloud 把没下载的文件显示成 “.名字.icloud” 占位文件
const placeholderOf = (rel) => { const b = path.basename(rel); return isMac && /^\..+\.icloud$/.test(b) ? path.join(path.dirname(rel), b.slice(1, -7)) : null; };

/** 文件数、大小、只在云端的文件数。 */
async function treeInfo(src) {
  const files = await walk(src);
  let bytes = 0, cloudOnly = 0;
  for (const r of files) {
    if (placeholderOf(r)) { cloudOnly++; continue; }
    try {
      const st = await fsp.stat(path.join(src, r));
      bytes += st.size;
      // 已从本机清除、只留在云端的文件（APFS 无数据文件）：有大小但没占块
      if (isMac && st.size > 0 && st.blocks === 0) cloudOnly++;
    } catch { /* 读不到的稍后复制时报错 */ }
  }
  if (isWin) {
    const ps = "$n=0; Get-ChildItem -LiteralPath $args[0] -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object { if(($_.Attributes -band 0x400000) -or ($_.Attributes -band 0x1000)){ $n++ } }; $n";
    const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps, src], { timeout: 60000 });
    if (out && /^\d+$/.test(out)) cloudOnly = parseInt(out, 10);
  }
  return { files: files.length, bytes, cloudOnly };
}

let cancelRequested = false;
function cancelCopy() { cancelRequested = true; }

async function download(src) {
  if (!isMac) return;
  let files = await walk(src);
  if (!files.some(placeholderOf)) return;
  await run("/usr/bin/brctl", ["download", src], { timeout: 60000 });
  const until = Date.now() + 10 * 60 * 1000;
  while (Date.now() < until) {
    if (cancelRequested) throw Object.assign(new Error("已取消"), { code: "CANCELLED" });
    files = await walk(src);
    if (!files.some(placeholderOf)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("有文件还没有从 iCloud 下载到这台电脑，请检查网络后重试。");
}

/**
 * 把 src 整份复制到 dst（dst 必须不存在或是空文件夹）。
 * 复制完对比每个文件的修改时间和大小，复制期间被改过的再补一遍（最多 3 轮）。失败或取消时删除已复制的部分。
 */
async function copyTree(src, dst, onProgress) {
  cancelRequested = false;
  if (path.resolve(src) === path.resolve(dst) || under(path.resolve(dst), path.resolve(src))) throw new Error("不能复制到数据文件夹自身里面。");
  if (fs.existsSync(dst) && (await fsp.readdir(dst)).length) throw Object.assign(new Error("目标文件夹不是空的，请换一个位置。"), { code: "ENOTEMPTY" });
  const created = !fs.existsSync(dst);
  try {
    await download(src);
    const stamp = async (r) => { const st = await fsp.stat(path.join(src, r)); return `${st.mtimeMs}:${st.size}`; };
    let files = await walk(src);
    const total = files.length;
    const seen = new Map();
    let done = 0;
    for (const r of files) {
      if (cancelRequested) throw Object.assign(new Error("已取消"), { code: "CANCELLED" });
      const before = await stamp(r);
      await fsp.mkdir(path.dirname(path.join(dst, r)), { recursive: true });
      await fsp.copyFile(path.join(src, r), path.join(dst, r));
      seen.set(r, before);
      done++;
      onProgress({ done, total });
    }
    for (let pass = 0; pass < 3; pass++) {
      const now = await walk(src);
      const changed = [];
      for (const r of now) { let s = null; try { s = await stamp(r); } catch { /* 刚被删 */ } if (s && seen.get(r) !== s) changed.push([r, s]); }
      const removed = [...seen.keys()].filter((r) => !now.includes(r));
      if (!changed.length && !removed.length) return { files: seen.size };
      for (const [r, s] of changed) { await fsp.mkdir(path.dirname(path.join(dst, r)), { recursive: true }); await fsp.copyFile(path.join(src, r), path.join(dst, r)); seen.set(r, s); }
      for (const r of removed) { await fsp.rm(path.join(dst, r), { force: true }); seen.delete(r); }
      files = now;
    }
    throw new Error("复制期间另一台电脑一直在修改档案，请稍后再试。");
  } catch (e) {
    try { if (created) await fsp.rm(dst, { recursive: true, force: true }); else for (const n of await fsp.readdir(dst)) await fsp.rm(path.join(dst, n), { recursive: true, force: true }); } catch { /* 留给用户手动删除 */ }
    throw e;
  }
}

/** 磁盘剩余空间（字节）。读不到时返回 null。 */
async function freeSpace(p) {
  let q = path.resolve(p);
  while (q && !fs.existsSync(q)) { const up = path.dirname(q); if (up === q) break; q = up; }
  try { const s = await fsp.statfs(q); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

module.exports = { cloudKind, localRoot, cloudSuggestions, defaultRoot, treeInfo, copyTree, cancelCopy, freeSpace, oneDriveRoots };
