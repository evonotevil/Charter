import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version = "([^"]+)"/m)?.[1];
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const versions = [pkg.version, config.version, cargo, lock.version, lock.packages[''].version];
if (versions.some(v => v !== pkg.version)) throw new Error(`Version mismatch: ${versions}`);
const ref = process.argv[2] ?? '';
if (ref.startsWith('v') && ref !== `v${pkg.version}`) throw new Error(`Tag ${ref} does not match ${pkg.version}`);
console.log(`Charter ${pkg.version}: package, lockfile, Rust, Tauri and release tag agree`);
