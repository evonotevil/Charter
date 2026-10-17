"""Flatten verified CI installers and write download checksums."""
import hashlib
import pathlib
import shutil
import sys

source, destination = map(pathlib.Path, sys.argv[1:])
destination.mkdir(parents=True, exist_ok=True)
files = sorted(p for p in source.rglob('*') if p.suffix.lower() in {'.exe', '.msi', '.dmg', '.zip'})
for extension in ('.exe', '.msi', '.dmg', '.zip'):
    if not any(p.suffix.lower() == extension for p in files):
        raise RuntimeError(f'Missing {extension} release artifact')
checksums = []
for file in files:
    target = destination / file.name
    if target.exists():
        raise RuntimeError(f'Duplicate release artifact: {file.name}')
    shutil.copy2(file, target)
    with target.open('rb') as handle:
        digest = hashlib.file_digest(handle, 'sha256').hexdigest()
    checksums.append(f'{digest}  {target.name}\n')
(destination / 'SHA256SUMS.txt').write_text(''.join(checksums), encoding='utf-8')
