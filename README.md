# Charter 4

管理海外子公司的跨平台桌面应用：股权结构、到期事项、中介、公司档案、文件与人员。

当前版本：**4.4.0**。

## 下载

从 [GitHub Releases](https://github.com/evonotevil/Charter/releases/latest) 下载：

- Windows 10/11 x64：推荐 `-setup.exe`，也可使用 `.msi`。
- macOS 12+：下载 Universal DMG（Apple Silicon 与 Intel 通用），也可使用 Universal ZIP。
- `SHA256SUMS.txt`：用于核对下载文件。

安装包暂未使用开发者证书签名。Windows 可能显示未知发布者或 SmartScreen 提示；macOS 首次打开可能需要在“系统设置 → 隐私与安全性”中确认。

## 源码

| 文件夹 | 内容 |
| --- | --- |
| `desktop/` | Tauri 2 + React + TypeScript 应用源码、测试和构建脚本 |
| `规范/` | 设计规范、视觉令牌、动效审查和方案记录 |
| `.github/workflows/release.yml` | Windows x64 与 macOS Universal 安装包的自动构建、验证和发布流程 |

编译与开发说明见 [desktop/README.md](desktop/README.md)，发布说明见 [desktop/RELEASE.md](desktop/RELEASE.md)。
