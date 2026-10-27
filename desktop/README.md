# Charter 桌面版

Electron + React + TypeScript（5.0 起；4.x 用的 Tauri 版保留在 `src-tauri/`，不再发布）。
一台 Linux 机器就能同时打出 Mac（Apple 芯片、Intel）和 Windows 安装包。

## 打包（推荐：在 Linux 上一次打出全部）

```bash
npm install
npm run dist          # = node scripts/release.mjs
```

产物在 `release/out/`：

| 文件 | 说明 |
|---|---|
| `Charter-<版本>-Mac-Apple芯片.dmg` / `.zip` | M1 及以后的 Mac |
| `Charter-<版本>-Mac-Intel.dmg` / `.zip` | Intel Mac |
| `Charter-<版本>-Windows-安装版.exe` | Windows 10/11，装在当前用户下 |
| `Charter-<版本>-Windows-免安装.zip` | 解压即用 |
| `SHA256SUMS.txt` | 校验值 |

流程：测试 → 编译界面 → electron-builder 交叉打包 → Mac 临时签名（rcodesign）→ 用 HFS+ 映像做 .dmg（libdmg-hfsplus）→ 校验值。

需要的工具（只在 Linux 上打 Mac 包时需要），放在 `/opt/charter-tools`（或用 `CHARTER_TOOLS` 指定）：

- `rcodesign`：`cargo install apple-codesign --locked --bin rcodesign`
- `mkfs.hfsplus`：Ubuntu 的 `hfsprogs` 包
- `hfsplus`、`dmg`：编译 https://github.com/mozilla/libdmg-hfsplus
- Windows 安装版需要 `wine`（electron-builder 用它生成卸载程序），并在 `xvfb-run` 下运行

只打一边：`node scripts/release.mjs --only=mac` 或 `--only=win`；跳过测试：`--skip-tests`。

在 Mac 上也可以直接 `npx electron-builder --mac`（会用 Xcode 的工具签名和做 dmg）。

## 安装提示

应用没有正式签名：
- **Mac**：第一次打开时提示“无法验证开发者”，在访达里右键 Charter →「打开」，确认一次即可。
- **Windows**：SmartScreen 提示时选「更多信息」→「仍要运行」。

## 开发

```bash
npm run dev          # 浏览器预览，数据在内存里；地址后加 ?sample 自动载入示例数据
npm run electron     # 编译后用真实 Electron 窗口打开，读写真实文件夹
npm test             # 单元测试
```

## 结构

- `electron/main.cjs`：主进程。窗口、文件读写（原子写入）、文件夹监听、同步盘状态、文字识别、系统字体。
- `electron/preload.cjs`：只把这些能力以 `window.charter` 暴露给界面。
- `electron/jxa.cjs`：Mac 上读 iCloud 状态和 Vision 文字识别用的系统脚本。
- `src/platform/electron.ts`：界面这一侧的平台实现（和 `tauri.ts`、`memory.ts` 实现同一个接口）。
- `scripts/release.mjs`：一键打包；`scripts/after-pack.cjs`：给 Windows 程序写入图标和版本信息。

## 数据

用户在设置里选数据文件夹（建议放在 iCloud 云盘或 OneDrive 里，多台电脑共用）。结构见 `src/domain/folder.ts`。
