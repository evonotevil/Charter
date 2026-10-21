"""Flatten verified Electron CI installers and write download checksums."""
import hashlib
import json
import pathlib
import re
import shutil
import sys


if len(sys.argv) != 4:
    raise SystemExit("usage: collect-release.py SOURCE DESTINATION VERSION")

source, destination, version = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
destination.mkdir(parents=True, exist_ok=True)

expected = {
    f"Charter-{version}-Windows-Setup.exe",
    f"Charter-{version}-Windows-x64.zip",
    f"Charter-{version}-Mac-arm64.dmg",
    f"Charter-{version}-Mac-arm64.zip",
    f"Charter-{version}-Mac-x64.dmg",
    f"Charter-{version}-Mac-x64.zip",
}
candidates = [p for p in source.rglob("*") if p.is_file() and p.name in expected]
names = [p.name for p in candidates]
missing = expected.difference(names)
duplicates = {name for name in names if names.count(name) > 1}
unexpected = sorted(
    p.name
    for p in source.rglob("*")
    if p.is_file() and re.search(r"Charter-.*\.(?:exe|dmg|zip)$", p.name, re.IGNORECASE) and p.name not in expected
)
if missing:
    raise RuntimeError(f"Missing release artifacts: {sorted(missing)}")
if duplicates:
    raise RuntimeError(f"Duplicate release artifacts: {sorted(duplicates)}")
if unexpected:
    raise RuntimeError(f"Unexpected Charter installers: {unexpected}")

checksums = []
for file in sorted(candidates, key=lambda p: p.name):
    target = destination / file.name
    if target.exists():
        raise RuntimeError(f"Destination already contains {target.name}")
    shutil.copy2(file, target)
    with target.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    checksums.append(f"{digest}  {target.name}\n")

(destination / "SHA256SUMS.txt").write_text("".join(checksums), encoding="utf-8")
print(json.dumps({"version": version, "artifacts": sorted(names)}, ensure_ascii=False, indent=2))
