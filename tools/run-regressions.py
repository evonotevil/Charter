#!/usr/bin/env python3
"""Build and execute isolated native regressions from the project root."""
import pathlib
import subprocess
import tempfile
import sys

root = pathlib.Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="charter-regression-build-") as output:
    binary = pathlib.Path(output) / "app-regression"
    sources = sorted(str(p) for p in (root / "Charter").rglob("*.swift"))
    subprocess.run(["xcrun", "swiftc", "-parse-as-library", "-D", "CHARTER_REGRESSION",
                    "-target", "arm64-apple-macosx26.0", *sources,
                    str(root / "tools/app_regression.swift"), "-o", str(binary)], cwd=root, check=True)
    subprocess.run([str(binary), *sys.argv[1:]], cwd=root, check=True)
    subprocess.run(["swift", "tools/export-regression.swift"], cwd=root, check=True)
    structure = pathlib.Path(output) / "structure-regression"
    subprocess.run(["xcrun", "swiftc", "-parse-as-library", "-O",
                    "Charter/Model/Day.swift", "Charter/Model/Models.swift", "Charter/Model/Archive.swift",
                    "Charter/Model/Templates.swift", "Charter/Model/Groups.swift",
                    "Charter/Engine/Ownership.swift", "Charter/Engine/Chains.swift", "Charter/Engine/StructureSnapshot.swift", "Charter/Engine/GraphInteraction.swift", "Charter/Engine/EdgeRouter.swift",
                    "tools/structure_snapshot_regression.swift", "-o", str(structure)], cwd=root, check=True)
    subprocess.run([str(structure)], cwd=root, check=True)
    holding = pathlib.Path(output) / "holding-regression"
    subprocess.run(["xcrun", "swiftc", "-parse-as-library", "Charter/Model/Day.swift",
                    "Charter/Model/Models.swift", "Charter/Model/Archive.swift", "Charter/Model/Templates.swift",
                    "Charter/Engine/HoldingValidation.swift", "tools/holding_validation_regression.swift",
                    "-o", str(holding)], cwd=root, check=True)
    subprocess.run([str(holding)], cwd=root, check=True)
