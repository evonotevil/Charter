// electron-builder 打包后处理：Windows 程序写入图标和版本信息（用纯 JS 的 resedit，在 Linux 上也能做，不需要 wine）。
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== "win32") return;
  const ResEdit = await import("resedit");
  const { NtExecutable, NtExecutableResource, Resource, Data } = ResEdit.default ?? ResEdit;
  const version = ctx.packager.appInfo.version;
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const exeData = NtExecutable.from(fs.readFileSync(exe));
  const res = NtExecutableResource.from(exeData);
  const ico = Data.IconFile.from(fs.readFileSync(path.join(__dirname, "..", "electron", "resources", "icon.ico")));
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, ico.icons.map((i) => i.data));
  const vi = Resource.VersionInfo.fromEntries(res.entries)[0] ?? Resource.VersionInfo.createEmpty();
  const [a, b, c] = version.split(".").map(Number);
  vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: "Charter", ProductName: "Charter", CompanyName: "Charter", LegalCopyright: "Charter", OriginalFilename: "Charter.exe", InternalName: "Charter" });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exeData);
  fs.writeFileSync(exe, Buffer.from(exeData.generate()));
  console.log("  • 已写入 Windows 图标和版本信息", exe);
};
