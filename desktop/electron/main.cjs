// Charter 桌面端主进程（Electron）：窗口、文件读写（原子写入）、文件夹监听、同步状态、文字识别、系统字体。
// 界面全部在前端（dist/）；这里只提供前端做不到的系统能力。与 Tauri 版 src-tauri/src/*.rs 一一对应。

const { app, BrowserWindow, ipcMain, dialog, shell, Notification, protocol, net, nativeTheme, Menu, session } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { SYNC_SCRIPT, OCR_SCRIPT } = require("./jxa.cjs");
const { MAC_SCRIPT: CAL_MAC, WIN_SCRIPT: CAL_WIN } = require("./calendar.cjs");

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
// 5.3.3：菜单和“关于”里显示 Charter，而不是包名 charter-desktop。
// 改名会让 userData 换目录（数据文件夹位置等设置存在那里），所以先记下原路径再改回去。
{ const ud = app.getPath("userData"); app.setName("Charter"); app.setPath("userData", ud); }
if (isMac) app.setAboutPanelOptions({ applicationName: "Charter", applicationVersion: app.getVersion(), copyright: "数据只保存在你选择的文件夹里。" });
const DIST = path.join(__dirname, "..", "dist");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: "charter-file", privileges: { secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } },
]);

// MARK: - 日志（Windows：%APPDATA%\\Charter\\logs；Mac：~/Library/Logs/Charter）

let logFile = null;
function log(level, ...msg) {
  try {
    if (!logFile) {
      const dir = app.getPath("logs");
      fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, "main.log");
      try { if (fs.statSync(logFile).size > 2 * 1048576) fs.renameSync(logFile, logFile + ".1"); } catch { /* 新文件 */ }
    }
    fs.appendFileSync(logFile, `${new Date().toISOString()} [${level}] ${msg.join(" ")}\n`);
  } catch { /* 写不了日志也不影响使用 */ }
}
process.on("uncaughtException", (e) => log("error", "主进程异常", e && e.stack || e));
process.on("unhandledRejection", (e) => log("error", "主进程未处理", e && e.stack || e));

// MARK: - 文件

async function writeAtomic(p, data, attempt = 0) {
  const dir = path.dirname(p);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.charter-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`);
  const fh = await fsp.open(tmp, "w");
  try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
  // Windows：目标文件被 OneDrive、杀毒软件或预览占用时，替换会被拒绝（EPERM/EBUSY/EACCES），稍等再试
  for (let i = 0; ; i++) {
    try { await fsp.rename(tmp, p); return; }
    catch (e) {
      if (isWin && ["EPERM", "EBUSY", "EACCES"].includes(e.code) && i < 8) { await new Promise((r) => setTimeout(r, 100 * (i + 1))); continue; }
      await fsp.rm(tmp, { force: true });
      // 5.4：临时文件或目录在改名前被同步盘、杀毒软件移走（ENOENT）：重建目录、整份重写，最多再试 2 次
      if (e.code === "ENOENT" && attempt < 2) { log("warn", "写入时临时文件消失，重试", p); await new Promise((r) => setTimeout(r, 150 * (attempt + 1))); return writeAtomic(p, data, attempt + 1); }
      log("warn", "写入失败", p, e.code || e.message); throw e;
    }
  }
}
const mtime = (st) => (st ? st.mtimeMs : null);

/** 系统错误翻成用户能看懂的话（和 Tauri 版 describeOSError 一致）。 */
function describe(e) {
  const code = e && e.code;
  const map = { ENOENT: "找不到文件", EACCES: "没有权限读写这个位置", EPERM: "没有权限读写这个位置", ENOSPC: "磁盘空间不足", EROFS: "这个位置是只读的", ENAMETOOLONG: "文件名太长", EDEADLK: "文件还在 iCloud 里，没有下载到这台电脑", EAGAIN: "文件还在 iCloud 里，没有下载到这台电脑", EEXIST: "目标文件已存在" };
  return map[code] || (e && e.message) || String(e);
}
function handle(name, fn) {
  ipcMain.handle(name, async (_e, ...args) => {
    try { return { ok: true, value: await fn(...args) }; }
    catch (e) { if (name !== "stat") log("warn", name, String(e && e.message || e)); return { ok: false, error: describe(e), raw: String(e && e.message || e) }; }
  });
}

handle("log", (level, msg) => log(level === "error" ? "renderer-error" : "renderer", msg));
handle("log_path", () => (logFile || path.join(app.getPath("logs"), "main.log")));
handle("platform_name", () => (isMac ? "mac" : isWin ? "windows" : "linux"));
handle("default_root", () => defaultRoot());
handle("read_text", (p) => fsp.readFile(p, "utf8"));
handle("read_bytes", async (p) => new Uint8Array(await fsp.readFile(p)));
handle("write_text", (p, text) => writeAtomic(p, Buffer.from(text, "utf8")));
handle("write_bytes", (p, data) => writeAtomic(p, Buffer.from(data)));
handle("calendar_sync", (input) => calendarSync(input));
// 5.3.3：流式写 ZIP（不压缩，带数据描述符）。逐个文件分块读、边写边算 CRC，内存只占一个分块。
// entries: [{ name, path }] 或 [{ name, text }]；先写到 .partial，完成后改名。
handle("zip_files", async (target, entries) => {
  const zlib = require("node:zlib");
  const tmp = target + ".partial";
  const out = await fsp.open(tmp, "w");
  let offset = 0;
  const central = [];
  const w = async (buf) => { await out.write(buf); offset += buf.length; };
  const dosTime = (d) => ({ time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() });
  try {
    for (const e of entries) {
      const name = Buffer.from(e.name, "utf8");
      const { time, date } = dosTime(new Date());
      const start = offset;
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0808, 6); lh.writeUInt16LE(0, 8);
      lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt16LE(name.length, 26);
      await w(lh); await w(name);
      let crc = 0, size = 0;
      if (e.text !== undefined) { const b = Buffer.from(e.text, "utf8"); crc = zlib.crc32(b); size = b.length; await w(b); }
      else {
        const fh = await fsp.open(e.path, "r");
        try {
          const chunk = Buffer.alloc(1 << 20);
          for (;;) { const { bytesRead } = await fh.read(chunk, 0, chunk.length, null); if (!bytesRead) break; const part = chunk.subarray(0, bytesRead); crc = zlib.crc32(part, crc); size += bytesRead; await w(part); }
        } catch (err) { throw new Error(`读取“${e.name}”时出错（${err.message}）`); } finally { await fh.close(); }
      }
      if (size >= 0xffffffff || offset >= 0xffffffff) throw new Error("备份超过 4 GB，暂不支持");
      const dd = Buffer.alloc(16); dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc >>> 0, 4); dd.writeUInt32LE(size, 8); dd.writeUInt32LE(size, 12);
      await w(dd);
      central.push({ name, crc: crc >>> 0, size, start, time, date });
    }
    const cdStart = offset;
    for (const c of central) {
      const h = Buffer.alloc(46); h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(0x0314, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0808, 8); h.writeUInt16LE(0, 10);
      h.writeUInt16LE(c.time, 12); h.writeUInt16LE(c.date, 14); h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.size, 20); h.writeUInt32LE(c.size, 24);
      h.writeUInt16LE(c.name.length, 28); h.writeUInt32LE((0o100644 << 16) >>> 0, 38); h.writeUInt32LE(c.start, 42);
      await w(h); await w(c.name);
    }
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - cdStart, 12); end.writeUInt32LE(cdStart, 16);
    await w(end);
    await out.close();
    await fsp.rename(tmp, target);
    return offset;
  } catch (err) { await out.close().catch(() => {}); await fsp.rm(tmp, { force: true }); throw err; }
});
handle("stat", async (p) => {
  try { const st = await fsp.stat(p); return { exists: true, isDir: st.isDirectory(), mtime: mtime(st), size: st.size }; }
  catch { return { exists: false, isDir: false, mtime: null, size: 0 }; }
});
handle("list_dir", async (p) => {
  const out = [];
  for (const d of await fsp.readdir(p, { withFileTypes: true })) {
    try { const st = await fsp.stat(path.join(p, d.name)); out.push({ name: d.name, isDir: st.isDirectory(), mtime: mtime(st), size: st.size }); } catch { /* 跳过读不到的 */ }
  }
  return out;
});
handle("mkdirs", (p) => fsp.mkdir(p, { recursive: true }));
handle("copy_file", async (from, to) => {
  if (fs.existsSync(to)) throw Object.assign(new Error("目标文件已存在"), { code: "EEXIST" });
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL);
});
handle("move_file", async (from, to) => {
  if (fs.existsSync(to)) throw Object.assign(new Error("目标文件已存在"), { code: "EEXIST" });
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try { await fsp.rename(from, to); } catch { await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL); await fsp.rm(from); }
});
handle("remove_file", (p) => fsp.rm(p, { force: true }));
handle("remove_dir", (p) => fsp.rm(p, { recursive: true, force: true }));
handle("temp_dir", async () => { const d = path.join(os.tmpdir(), "Charter"); await fsp.mkdir(d, { recursive: true }); return d; });
handle("device_name", () => os.hostname() || "这台电脑");
handle("bundled_templates", () => fsp.readFile(resourcePath("charter-templates.json"), "utf8"));
handle("cjk_font", async () => { const p = cjkFontPath(); if (!p) throw new Error("没有找到中文字体"); return new Uint8Array(await fsp.readFile(p)); });
handle("sync_status", (root) => syncStatus(root));
handle("ocr", (png) => ocr(Buffer.from(png)));

// 对话框、打开、通知
handle("pick_files", async ({ multiple, extensions, title }) => {
  const r = await dialog.showOpenDialog(win(), { title, properties: multiple ? ["openFile", "multiSelections"] : ["openFile"], filters: extensions ? [{ name: "文件", extensions }] : undefined });
  return r.canceled ? [] : r.filePaths;
});
handle("pick_folder", async ({ title, defaultPath }) => {
  const r = await dialog.showOpenDialog(win(), { title, defaultPath, properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0] || null;
});
handle("save_dialog", async ({ defaultName, extensions, title }) => {
  const r = await dialog.showSaveDialog(win(), { title, defaultPath: defaultName, filters: extensions ? [{ name: "文件", extensions }] : undefined });
  return r.canceled ? null : r.filePath || null;
});
handle("reveal", (p) => shell.showItemInFolder(p));
handle("open_path", async (p) => { const e = await shell.openPath(p); if (e) throw new Error(e); });
handle("open_url", (u) => (/^(https?|mailto):/i.test(u) ? shell.openExternal(u) : undefined));
handle("notify", ({ title, body }) => { if (Notification.isSupported()) new Notification({ title, body }).show(); });

// 文件夹监听：data/ 和 templates.json 的变化（其他设备同步过来），合并 1.5 秒内的多次变化
let watchers = [];
let watchTimer = null;
handle("watch", (root) => {
  watchers.forEach((w) => w.close()); watchers = [];
  // 整个数据文件夹递归监听（data/ 可能在启动后才建立），只关心 data/*.json 和 templates.json
  if (!fs.existsSync(root)) return;
  try {
    watchers.push(fs.watch(root, { recursive: true }, (_ev, name) => {
      const n = String(name || "").replace(/\\/g, "/");
      const base = n.split("/").pop();
      if (!base.endsWith(".json") || base.startsWith(".charter-")) return;
      if (!(n === "templates.json" || /^data\/[^/]+\.json$/.test(n))) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => win()?.webContents.send("charter:folder-changed"), 1500);
    }));
  } catch { /* 监听失败时，回到前台仍会重新检查 */ }
});

// MARK: - 各平台

const home = os.homedir();
function defaultRoot() {
  if (isMac) {
    const icloud = path.join(home, "Library/Mobile Documents/com~apple~CloudDocs");
    return fs.existsSync(icloud) ? path.join(icloud, "Charter") : path.join(home, "Documents/Charter");
  }
  if (isWin) {
    for (const v of ["OneDriveConsumer", "OneDrive", "OneDriveCommercial"]) if (process.env[v] && fs.existsSync(process.env[v])) return path.join(process.env[v], "Charter");
    const icloud = path.join(home, "iCloudDrive");
    if (fs.existsSync(icloud)) return path.join(icloud, "Charter");
  }
  return path.join(app.getPath("documents"), "Charter");
}

/** 数据文件夹里的档案文件：data/*.json 和根目录的 templates.json（结构见 src/domain/folder.ts）。 */
function dataFiles(root) {
  const out = [];
  try { for (const n of fs.readdirSync(path.join(root, "data"))) if (n.endsWith(".json")) out.push(path.join(root, "data", n)); } catch { /* 还没有 data 目录 */ }
  if (fs.existsSync(path.join(root, "templates.json"))) out.push(path.join(root, "templates.json"));
  return out;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 60000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

async function syncStatus(root) {
  if (isMac) {
    const out = await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", SYNC_SCRIPT, root, ...dataFiles(root)]);
    let v; try { v = JSON.parse(out); } catch { v = { kind: root.includes("Mobile Documents") ? "synced" : "local" }; }
    if (v.kind === "synced") v.at = Date.now();
    return v;
  }
  if (isWin) {
    // OneDrive / iCloud for Windows：文件属性里带“仅在线”标记时还没下载完；无法细分上传中的状态
    const synced = ["OneDriveConsumer", "OneDrive", "OneDriveCommercial"].some((v) => process.env[v] && root.toLowerCase().startsWith(process.env[v].toLowerCase())) || /icloud ?drive/i.test(root);
    if (!synced) return { kind: "local" };
    const ps = "$n=0; foreach($f in $args){ $a=(Get-Item -LiteralPath $f -Force).Attributes; if(($a -band 0x400000) -or ($a -band 0x1000)){ $n++ } }; $n";
    const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps, ...dataFiles(root)]);
    const n = parseInt(out || "0", 10) || 0;
    return n > 0 ? { kind: "syncing", count: n } : { kind: "synced", at: Date.now() };
  }
  return { kind: "local" };
}

const WIN_OCR = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($args[0])) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$result.Lines | ForEach-Object { $_.Text }
`;

// 5.4：同步到系统日历（Mac：EventKit；Windows：桌面版 Outlook）。数据经临时 JSON 文件传入，结束后删除。
async function calendarSync(input) {
  if (!isMac && !isWin) return { error: "unsupported" };
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "charter-cal-"));
  try {
    const file = path.join(dir, "events.json");
    await fsp.writeFile(file, JSON.stringify(input), "utf8");
    let out;
    if (isMac) out = await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", CAL_MAC, file], { timeout: 180000 });
    else {
      const script = path.join(dir, "cal.ps1");
      await fsp.writeFile(script, "\uFEFF" + CAL_WIN, "utf8");
      out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, file], { timeout: 180000 });
    }
    if (out === null) { log("warn", "日历同步脚本失败"); return { error: "failed" }; }
    try { const r = JSON.parse(out.split("\n").pop()); if (r.error) log("warn", "日历同步", r.error, r.message || ""); else log("info", "日历同步完成", JSON.stringify({ added: r.added, updated: r.updated, removed: r.removed })); return r; }
    catch { log("warn", "日历同步输出无法解析"); return { error: "failed" }; }
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
}

async function ocr(png) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "charter-ocr-"));
  const img = path.join(dir, "page.png");
  try {
    await fsp.writeFile(img, png);
    let out = null;
    if (isMac) out = await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", OCR_SCRIPT, img]);
    else if (isWin) {
      const script = path.join(dir, "ocr.ps1");
      await fsp.writeFile(script, "\uFEFF" + WIN_OCR, "utf8");
      out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, img]);
    } else out = await run("tesseract", [img, "-", "-l", "chi_sim+eng"]);
    if (out === null) throw new Error(isMac || isWin ? "文字识别失败" : "这台电脑没有安装文字识别组件");
    return out;
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
}

function cjkFontPath() {
  const list = isMac
    ? ["/Library/Fonts/Arial Unicode.ttf", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"]
    : isWin
      ? ["simhei.ttf", "Deng.ttf", "simkai.ttf", "simfang.ttf", "malgun.ttf"].map((f) => path.join(process.env.WINDIR || "C:\\Windows", "Fonts", f))
      : ["/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"];
  return list.find((p) => fs.existsSync(p)) || null;
}

function resourcePath(name) {
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, "..", "src", "assets", name);
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm", ".pdf": "application/pdf" };
const mime = (f) => MIME[path.extname(f).toLowerCase()] || "application/octet-stream";

// MARK: - 窗口

let mainWindow = null;
const win = () => mainWindow;

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 720, title: "Charter", show: false,
    backgroundColor: dark ? "#111813" : "#F7F9F5",
    ...(isMac ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 18, y: 18 } } : {}),
    ...(isWin ? { titleBarStyle: "hidden", titleBarOverlay: { color: "#00000000", symbolColor: dark ? "#E9F1E6" : "#25352C", height: 34 } } : {}),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  // 万一 ready-to-show 没来（渲染进程卡住），3 秒后也显示窗口，至少能看到错误页
  setTimeout(() => { if (mainWindow && !mainWindow.isVisible()) { log("warn", "ready-to-show 超时，强制显示窗口"); mainWindow.show(); } }, 3000);
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => log("error", "页面载入失败", code, desc, url));
  mainWindow.webContents.on("render-process-gone", (_e, d) => log("error", "渲染进程退出", JSON.stringify(d)));
  mainWindow.webContents.on("console-message", (_e, level, message) => { if (level >= 3) log("renderer-console", message); });
  // 外部链接用系统浏览器打开；界面内不跳转
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url); return { action: "deny" }; });
  mainWindow.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("app://")) e.preventDefault(); });
  if (isWin) nativeTheme.on("updated", () => mainWindow?.setTitleBarOverlay?.({ symbolColor: nativeTheme.shouldUseDarkColors ? "#E9F1E6" : "#25352C" }));
  const dev = process.env.CHARTER_DEV_URL;
  void mainWindow.loadURL(dev || "app://charter/index.html");
  mainWindow.on("closed", () => { mainWindow = null; });
  // 打包后的启动自检：charter --smoke-test=<结果文件>。界面画出来（侧栏或错误页）就写 ok，然后退出。
  const smoke = process.argv.find((x) => x.startsWith("--smoke-test="))?.slice(13);
  if (smoke) {
    const done = (r) => { try { fs.writeFileSync(smoke, JSON.stringify(r)); } catch { /* 忽略 */ } app.exit(r.ok ? 0 : 1); };
    setTimeout(() => done({ ok: false, reason: "超时：20 秒内界面没有画出来" }), 20000);
    mainWindow.webContents.on("did-finish-load", () => setTimeout(async () => {
      try {
        const r = await mainWindow.webContents.executeJavaScript(`({ app: !!document.querySelector(".app .side"), fatal: document.querySelector(".fatal")?.innerText ?? null, text: document.body.innerText.slice(0, 200) })`);
        done({ ok: r.app && !r.fatal, ...r });
      } catch (e) { done({ ok: false, reason: String(e) }); }
    }, 5000));
  }
}

function menu() {
  if (!isMac) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Charter", submenu: [
      { role: "about", label: "关于 Charter" }, { type: "separator" },
      { role: "services", label: "服务" }, { type: "separator" },
      { role: "hide", label: "隐藏 Charter" }, { role: "hideOthers", label: "隐藏其他" }, { role: "unhide", label: "全部显示" }, { type: "separator" },
      { role: "quit", label: "退出 Charter" },
    ] },
    { label: "编辑", submenu: [{ role: "undo", label: "撤销" }, { role: "redo", label: "重做" }, { type: "separator" }, { role: "cut", label: "剪切" }, { role: "copy", label: "拷贝" }, { role: "paste", label: "粘贴" }, { role: "selectAll", label: "全选" }] },
    { label: "显示", submenu: [{ role: "reload", label: "重新载入" }, { role: "togglefullscreen", label: "全屏" }, ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }])] },
    { role: "windowMenu", label: "窗口" },
  ]));
}

app.whenReady().then(async () => {
  log("info", `启动 Charter ${app.getVersion()} · ${process.platform} ${process.arch} · Electron ${process.versions.electron}`);
  // 5.3.2：版本变了就清掉旧的网页缓存和 Service Worker，避免升级后仍看到旧界面
  try {
    const mark = path.join(app.getPath("userData"), "last-version.txt");
    const last = await fsp.readFile(mark, "utf8").catch(() => "");
    if (last.trim() !== app.getVersion()) {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData({ storages: ["serviceworkers", "cachestorage", "shadercache"] });
      await fsp.writeFile(mark, app.getVersion());
      log("info", `版本由 ${last.trim() || "（首次）"} 变为 ${app.getVersion()}，已清理界面缓存`);
    }
  } catch (e) { log("warn", "清理界面缓存失败", e && e.message); }
  protocol.handle("app", (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "") || "index.html";
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response("禁止访问", { status: 403 });
    // 直接读文件返回，不依赖 net.fetch(file://)（Windows 上对 asar 内路径不稳定）
    // 5.3.2：界面文件不进缓存，升级后一定读新包里的文件
    return fsp.readFile(file).then((buf) => new Response(buf, { headers: { "content-type": mime(file), "cache-control": "no-store" } }))
      .catch((e) => { log("error", "界面文件读取失败", file, e.code || e.message); return new Response("找不到界面文件", { status: 404 }); });
  });
  // 本地文件预览（PDF、图片）：charter-file://local/<编码后的完整路径>
  protocol.handle("charter-file", (req) => {
    const raw = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ""));
    const p = isWin ? raw.replace(/\//g, "\\") : "/" + raw.replace(/^\/+/, "");
    try {
      const st = fs.statSync(p);
      const { Readable } = require("node:stream");
      return new Response(Readable.toWeb(fs.createReadStream(p)), { headers: { "content-type": mime(p), "content-length": String(st.size) } });
    } catch (e) { return new Response("找不到文件", { status: 404 }); }
  });
  menu();
  createWindow();
  app.on("activate", () => { if (!mainWindow) createWindow(); });
});
app.on("window-all-closed", () => { if (!isMac) app.quit(); });
// 只允许一个实例（Windows 双击安装包或快捷方式时回到已打开的窗口）
if (!app.requestSingleInstanceLock()) app.quit();
else app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
