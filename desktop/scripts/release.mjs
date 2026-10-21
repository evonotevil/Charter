#!/usr/bin/env node
// Test and package Charter on the current native platform, then collect the
// downloadable files and SHA-256 checksums under release/out.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const releaseDir = path.join(root, "release");
const outDir = path.join(releaseDir, "out");
const skipTests = process.argv.includes("--skip-tests");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

fs.rmSync(releaseDir, { recursive: true, force: true });
if (!skipTests) run(npm, ["test"]);
run(npm, ["run", "build"]);

let expected;
if (process.platform === "darwin") {
  run(npx, ["--no-install", "electron-builder", "--mac", "dmg", "zip", "--arm64", "--x64", "--publish", "never"]);
  expected = [
    `Charter-${version}-Mac-arm64.dmg`,
    `Charter-${version}-Mac-arm64.zip`,
    `Charter-${version}-Mac-x64.dmg`,
    `Charter-${version}-Mac-x64.zip`,
  ];
} else if (process.platform === "win32") {
  run(npx, ["--no-install", "electron-builder", "--win", "nsis", "zip", "--x64", "--publish", "never"]);
  expected = [
    `Charter-${version}-Windows-Setup.exe`,
    `Charter-${version}-Windows-x64.zip`,
  ];
} else {
  throw new Error("正式安装包需要原生 Mac 或 Windows 环境；请运行 GitHub Actions 的 Electron desktop release 工作流。");
}

fs.mkdirSync(outDir, { recursive: true });
const checksums = [];
for (const name of expected) {
  const source = path.join(releaseDir, name);
  if (!fs.existsSync(source)) throw new Error(`Missing electron-builder artifact: ${name}`);
  const target = path.join(outDir, name);
  fs.copyFileSync(source, target);
  const digest = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  checksums.push(`${digest}  ${name}`);
  console.log(`  ${name}  ${(fs.statSync(target).size / 1048576).toFixed(1)} MB`);
}
fs.writeFileSync(path.join(outDir, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
console.log(`\n完成：${outDir}`);
