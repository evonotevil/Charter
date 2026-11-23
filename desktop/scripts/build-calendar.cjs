const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const devTarget = path.resolve(__dirname, "../build/charter-calendar.node");

function buildCalendar(target, architectures) {
  const include = path.resolve(path.dirname(process.execPath), "../include/node");
  if (!fs.existsSync(path.join(include, "node_api.h"))) {
    throw new Error(`需要本机 Node.js 的 Node-API 头文件：${include}/node_api.h`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const archFlags = architectures.flatMap((arch) => ["-arch", arch]);
  execFileSync("/usr/bin/xcrun", ["--sdk", "macosx", "clang", ...archFlags,
    "-mmacosx-version-min=12.0", "-fobjc-arc", "-O2", "-bundle", "-undefined", "dynamic_lookup",
    "-DNAPI_VERSION=8", "-I", include, "-framework", "Foundation", "-framework", "EventKit",
    path.resolve(__dirname, "../native/calendar.m"), "-o", target], { stdio: "inherit" });
}

if (require.main === module && process.platform === "darwin") {
  buildCalendar(devTarget, [process.arch === "x64" ? "x86_64" : process.arch]);
}
module.exports = { buildCalendar };
