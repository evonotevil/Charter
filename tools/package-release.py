#!/usr/bin/env python3
"""Build and package a locally signed Universal macOS release."""
import argparse
import hashlib
import pathlib
import plistlib
import subprocess
import tempfile


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=pathlib.Path, default=root / "dist")
    parser.add_argument("--app", type=pathlib.Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="charter-release-") as temporary:
        work = pathlib.Path(temporary)
        if args.app:
            source = args.app.resolve()
        else:
            derived = work / "DerivedData"
            run("xcodebuild", "-project", root / "Charter.xcodeproj", "-scheme", "Charter",
                "-configuration", "Release", "-derivedDataPath", derived,
                "ARCHS=arm64 x86_64", "ONLY_ACTIVE_ARCH=NO", "CODE_SIGNING_ALLOWED=NO", "build")
            source = derived / "Build/Products/Release/Charter.app"
        stage = work / "installer"
        stage.mkdir()
        app = stage / "Charter.app"
        run("ditto", source, app)
        with (app / "Contents/Info.plist").open("rb") as handle:
            info = plistlib.load(handle)
        version = info["CFBundleShortVersionString"]
        executable = app / "Contents/MacOS" / info["CFBundleExecutable"]
        architectures = subprocess.check_output(["lipo", "-archs", str(executable)], text=True).split()
        if set(architectures) != {"arm64", "x86_64"}:
            raise RuntimeError(f"Expected Universal binary, got {architectures}")
        if not (app / "Contents/Resources/charter-templates.json").is_file():
            raise RuntimeError("Missing bundled compliance templates")
        run("codesign", "--force", "--sign", "-", app)
        run("codesign", "--verify", "--deep", "--strict", "--verbose=2", app)
        stem = f"Charter-{version}-macOS-universal"
        archive = output / f"{stem}.zip"
        disk = output / f"{stem}.dmg"
        for path in (archive, disk, output / "SHA256SUMS.txt"):
            if path.exists():
                raise FileExistsError(f"Refusing to overwrite {path}; choose a new output directory")
        run("ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, archive)
        (stage / "Applications").symlink_to("/Applications")
        (stage / "安装说明.txt").write_text(
            "Charter " + version + "\n\n要求 macOS 26 或更新系统，支持 Apple Silicon 与 Intel。\n"
            "将 Charter.app 拖到 Applications，然后从应用程序打开。\n"
            "本版本使用本地临时签名，未经过 Apple 公证。\n"
            "若系统阻止打开，尝试启动一次后在系统设置 → 隐私与安全性中选择“仍要打开”。\n"
            "示例数据为虚构演示数据；内置合规规则为待核对草稿。\n",
            encoding="utf-8")
        run("hdiutil", "create", "-volname", f"Charter {version}", "-srcfolder", stage,
            "-format", "UDZO", disk)
        run("hdiutil", "verify", disk)
        checksums = []
        for artifact in (disk, archive):
            with artifact.open("rb") as handle:
                digest = hashlib.file_digest(handle, "sha256").hexdigest()
            checksums.append(f"{digest}  {artifact.name}\n")
        (output / "SHA256SUMS.txt").write_text("".join(checksums), encoding="utf-8")
        print(f"Release packages: {output}")


if __name__ == "__main__":
    main()
