# Charter 桌面版

Electron + React + TypeScript。5.3.2 正式发布同时提供 Windows x64、Apple 芯片 Mac 和 Intel Mac 安装包；4.x 的 Tauri 源码保留在 `src-tauri/`，不再用于发布。

GitHub 发布使用三个原生构建环境：

- Windows x64：NSIS 安装版与免安装 ZIP
- macOS arm64：DMG 与 ZIP
- macOS x64：DMG 与 ZIP

Windows 测试完成静默安装、启动和窗口检查；两种 Mac 包分别校验版本、架构、ad-hoc 签名、资源、DMG 和 ZIP。

## 本地构建

先安装 Node.js 22，然后：

```bash
npm ci
npm test
npm run build
```

在 Mac 上生成 Apple 芯片和 Intel 包：

```bash
npm run dist
```

在 Windows PowerShell 中生成 Windows 包：

```powershell
npm run dist
```

`npm run dist` 只在当前系统生成对应平台的安装包，产物汇总在 `release/out/`，并写入 `SHA256SUMS.txt`。正式发布由 [Electron desktop release](../.github/workflows/release.yml) 分别使用原生 runner 构建。

只运行 electron-builder、不经过本地汇总：

```bash
# Mac
npx electron-builder --mac dmg zip --arm64 --x64 --publish never

# Windows
npx electron-builder --win nsis zip --x64 --publish never
```

原始产物位于 `release/`。下载文件使用 ASCII 名称：

| 文件 | 说明 |
| --- | --- |
| `Charter-<版本>-Mac-arm64.dmg` / `.zip` | Apple 芯片 Mac |
| `Charter-<版本>-Mac-x64.dmg` / `.zip` | Intel Mac |
| `Charter-<版本>-Windows-Setup.exe` | Windows 10/11 x64 安装版 |
| `Charter-<版本>-Windows-x64.zip` | Windows 免安装版 |
| `SHA256SUMS.txt` | 全部文件的 SHA-256 |

## 安装提示

- **Mac**：安装包使用 ad-hoc 签名，没有 Apple 公证。首次打开时在访达中右键 Charter →「打开」。
- **Windows**：安装包没有商业代码签名证书。SmartScreen 提示时选择「更多信息」→「仍要运行」。

## 开发

```bash
npm run dev          # 浏览器预览，数据在内存里；地址后加 ?sample 自动载入示例数据
npm run electron     # 编译后用真实 Electron 窗口打开，读写真实文件夹
npm test             # 单元测试
```

## 结构

- `electron/main.cjs`：主进程。窗口、文件读写（原子写入）、文件夹监听、同步盘状态、文字识别、系统字体。
- `electron/preload.cjs`：把白名单系统能力以 `window.charter` 暴露给界面。
- `electron/jxa.cjs`：Mac 上读取 iCloud 状态和 Vision 文字识别。
- `src/platform/electron.ts`：界面侧 Electron 平台实现。
- `scripts/release.mjs`：当前平台的测试、打包与校验值汇总。
- `scripts/after-pack.cjs`：Mac ad-hoc 签名，以及 Windows 图标和版本信息。

## 数据

用户在设置里选择数据文件夹。Mac 与 Windows 共用数据时，请选两端都能访问的同步服务。5.3.2 延续 4.x、5.0、5.1 和 5.3.1 的数据文件夹格式，升级前仍建议备份整个文件夹。
