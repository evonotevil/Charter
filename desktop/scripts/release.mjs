#!/usr/bin/env node
// 在 Linux 上一次打出 Mac（Apple 芯片 + Intel）和 Windows 安装包。
//
// 步骤：测试 → 编译界面 → electron-builder 交叉打包 → Mac 临时签名（rcodesign）→ 做 .dmg（HFS+，libdmg-hfsplus）
//       → 校验值 SHA256SUMS.txt。产物在 release/out/。
//
// 需要的工具（Linux）：rcodesign（cargo install apple-codesign）、mkfs.hfsplus（hfsprogs）、
// hfsplus 与 dmg（github.com/mozilla/libdmg-hfsplus）。目录用 CHARTER_TOOLS 指定，默认 /opt/charter-tools。
// 也可以在 Mac / Windows 上直接跑 electron-builder；这个脚本只为“没有 Mac 和 Windows 的环境”准备。

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const tools = process.env.CHARTER_TOOLS || "/opt/charter-tools";
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const out = path.join(root, "release", "out");
const skipTests = process.argv.includes("--skip-tests");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7); // mac | win

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
const tool = (name) => {
  for (const p of [path.join(tools, name), path.join(process.env.HOME || "", ".cargo/bin", name)]) if (fs.existsSync(p)) return p;
  throw new Error(`缺少工具 ${name}（放在 ${tools} 下，或设置 CHARTER_TOOLS）`);
};
const step = (t) => console.log(`\n▶ ${t}`);

fs.rmSync(path.join(root, "release"), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

if (!skipTests) { step("测试"); sh("npx", ["vitest", "run"]); }
step("编译界面"); sh("npm", ["run", "build"]);

if (only !== "win") {
  step("Mac：打包 Apple 芯片和 Intel 两个版本");
  sh("npx", ["electron-builder", "--mac", "dir", "--arm64", "--x64", "--publish", "never"]);
  for (const [dir, arch, label] of [["mac-arm64", "arm64", "Apple芯片"], ["mac", "x64", "Intel"]]) {
    const app = path.join(root, "release", dir, "Charter.app");
    if (!fs.existsSync(app)) throw new Error(`没有找到 ${app}`);
    step(`Mac ${label}：临时签名（不签名的话 Apple 芯片的 Mac 会提示“已损坏”）`);
    sh(tool("rcodesign"), ["sign", app]); // 临时签名（ad-hoc）；不开强化运行时，否则 Electron 需要额外的授权声明
    step(`Mac ${label}：做 .dmg`);
    const dmg = path.join(out, `Charter-${version}-Mac-${label}.dmg`);
    makeDmg(app, dmg);
    step(`Mac ${label}：同时出一份 .zip（备用）`);
    sh("zip", ["-qry", path.join(out, `Charter-${version}-Mac-${label}.zip`), "Charter.app"], { cwd: path.dirname(app) });
    void arch;
  }
}

if (only !== "mac") {
  step("Windows：安装版和免安装版");
  sh("npx", ["electron-builder", "--win", "--x64", "--publish", "never"]);
  for (const f of fs.readdirSync(path.join(root, "release"))) {
    if (/Setup\.exe$/.test(f)) fs.copyFileSync(path.join(root, "release", f), path.join(out, `Charter-${version}-Windows-安装版.exe`));
    if (/win\.zip$|\.zip$/.test(f) && !f.startsWith("Charter-" + version + "-Mac")) fs.copyFileSync(path.join(root, "release", f), path.join(out, `Charter-${version}-Windows-免安装.zip`));
  }
}

if (only !== "mac") {
  step("Windows：启动自检（wine 下打开打包好的程序，确认界面画出来）");
  const exe = path.join(root, "release", "win-unpacked", "Charter.exe");
  const res = path.join(root, "release", "smoke-win.json");
  try {
    fs.rmSync(res, { force: true });
    execFileSync("timeout", ["90", "wine", exe, `--smoke-test=Z:${res.replace(/\//g, "\\")}`, "--no-sandbox"], { stdio: "ignore", env: { ...process.env, WINEDEBUG: "-all" } });
  } catch { /* 结果看文件 */ }
  if (fs.existsSync(res)) {
    const r = JSON.parse(fs.readFileSync(res, "utf8"));
    if (!r.ok) throw new Error("Windows 启动自检失败：" + JSON.stringify(r));
    console.log("  ✓ Windows 版界面正常画出");
  } else {
    // wine 跑不起 Electron 时，用本机 Electron 打开 Windows 包里的同一份 app.asar，至少确认界面代码能画出来
    console.warn("  ⚠ wine 跑不起 Electron，改用本机 Electron 打开 Windows 包里的 app.asar");
    const electronBin = path.join(root, "node_modules", "electron", "dist", "electron");
    try { execFileSync("timeout", ["60", electronBin, path.join(root, "release", "win-unpacked", "resources", "app.asar"), "--no-sandbox", `--smoke-test=${res}`], { stdio: "ignore" }); } catch { /* 结果看文件 */ }
    const r = fs.existsSync(res) ? JSON.parse(fs.readFileSync(res, "utf8")) : { ok: false, reason: "没有结果" };
    if (!r.ok) throw new Error("Windows 包界面自检失败：" + JSON.stringify(r));
    console.log("  ✓ Windows 包里的界面正常画出（真机启动仍需确认）");
  }
}

step("校验值");
const lines = fs.readdirSync(out).filter((f) => !f.endsWith(".txt")).sort().map((f) => {
  const h = createHash("sha256").update(fs.readFileSync(path.join(out, f))).digest("hex");
  const mb = (fs.statSync(path.join(out, f)).size / 1048576).toFixed(1);
  console.log(`  ${f}  ${mb} MB`);
  return `${h}  ${f}`;
});
fs.writeFileSync(path.join(out, "SHA256SUMS.txt"), lines.join("\n") + "\n");
console.log(`\n✓ 完成：${out}`);

/** 用 HFS+ 映像做 .dmg：建空白 HFS+ → 放入 App 和“应用程序”快捷方式（保留符号链接和权限）→ 压缩成 UDZO。 */
function makeDmg(app, dmg) {
  const work = path.join(root, "release", "dmg-work");
  fs.rmSync(work, { recursive: true, force: true });
  const stage = path.join(work, "stage");
  fs.mkdirSync(stage, { recursive: true });
  sh("cp", ["-a", app, stage]);
  fs.symlinkSync("/Applications", path.join(stage, "Applications"));
  const img = path.join(work, "Charter.hfs");
  const size = Math.ceil((dirSize(stage) * 1.25 + 40 * 1048576) / 1048576); // 留出 25% 和 40 MB 余量
  sh("dd", ["if=/dev/zero", `of=${img}`, "bs=1M", `count=${size}`, "status=none"]);
  sh(tool("mkfs.hfsplus"), ["-v", "Charter", img], { stdio: "ignore" });
  // clone_link：符号链接按原样放进映像（Electron 框架靠它们工作），权限按原文件设置
  sh(tool("hfsplus"), ["--symlinks", "clone_link", img, "addall", stage, "/"], { stdio: "ignore" });
  sh(tool("dmg"), ["build", img, dmg], { stdio: "ignore" });
  fs.rmSync(work, { recursive: true, force: true });
}
function dirSize(p) {
  const st = fs.lstatSync(p);
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((s, n) => s + dirSize(path.join(p, n)), 0);
}
