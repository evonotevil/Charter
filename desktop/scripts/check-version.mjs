import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const electron = pkg.devDependencies?.electron;
const electronBuilder = pkg.devDependencies?.["electron-builder"];
const lockRoot = lock.packages?.[""] ?? {};
const checks = {
  "package-lock.version": lock.version,
  "package-lock root version": lockRoot.version,
  "package-lock Electron": lockRoot.devDependencies?.electron,
  "installed Electron": lock.packages?.["node_modules/electron"]?.version,
  "package-lock electron-builder": lockRoot.devDependencies?.["electron-builder"],
  "installed electron-builder": lock.packages?.["node_modules/electron-builder"]?.version,
  "builder Electron": pkg.build?.electronVersion,
};

for (const [name, value] of Object.entries(checks)) {
  if (!value) throw new Error(`Missing ${name}`);
}
if (new Set([pkg.version, checks["package-lock.version"], checks["package-lock root version"]]).size !== 1) {
  throw new Error(`App version mismatch: ${pkg.version}, ${checks["package-lock.version"]}, ${checks["package-lock root version"]}`);
}
if (!/^\d+\.\d+\.\d+$/.test(electron)) throw new Error(`Pin Electron to an exact version, got ${electron}`);
if (new Set([electron, checks["package-lock Electron"], checks["installed Electron"], checks["builder Electron"]]).size !== 1) {
  throw new Error(`Electron version mismatch: ${electron}, ${checks["package-lock Electron"]}, ${checks["installed Electron"]}, ${checks["builder Electron"]}`);
}
if (new Set([electronBuilder, checks["package-lock electron-builder"], checks["installed electron-builder"]]).size !== 1) {
  throw new Error(`electron-builder version mismatch: ${electronBuilder}, ${checks["package-lock electron-builder"]}, ${checks["installed electron-builder"]}`);
}

const ref = process.argv[2] ?? "";
if (ref.startsWith("v") && ref !== `v${pkg.version}`) {
  throw new Error(`Tag ${ref} does not match v${pkg.version}`);
}
console.log(`Charter ${pkg.version}: app, lockfile, Electron ${electron} and electron-builder ${electronBuilder} agree`);
