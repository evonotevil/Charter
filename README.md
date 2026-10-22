# Charter 5

管理海外子公司的跨平台桌面应用：股权结构、到期事项、中介、公司档案、文件与人员。

当前版本：**5.1.0**。Charter 5 使用 Electron + React + TypeScript，Mac 与 Windows 共用一套产品代码。

产品网站：[https://evonotevil.github.io/Charter/](https://evonotevil.github.io/Charter/)

## 下载

从 [GitHub Releases](https://github.com/evonotevil/Charter/releases/latest) 下载：

- **Mac Apple 芯片（M1 及以后）**：`Charter-5.1.0-Mac-arm64.dmg`
- **Mac Intel**：`Charter-5.1.0-Mac-x64.dmg`
- **Windows 10/11 x64**：推荐 `Charter-5.1.0-Windows-Setup.exe`
- **Windows 免安装**：`Charter-5.1.0-Windows-x64.zip`
- **SHA-256 校验值**：`SHA256SUMS.txt`

Mac 用户也可以下载对应的 `.zip`。应用没有使用 Apple Developer ID 或 Windows 商业代码签名证书：Mac 首次打开时可能需要在访达中右键 Charter →「打开」；Windows 可能显示 SmartScreen 提示，选择「更多信息」→「仍要运行」。

## 5.1 更新

- 全界面统一为 Charter 5.1 的新外观，改善字号、层级和可读性。
- Windows 启动流程加固，异常时显示原因并提供恢复入口。
- 股权结构图重做，减少交叉线并支持完整控制链和多种查看方式。
- 人员可以归档个人文件，并在公司「人员与持股」中直接查看。
- 同步文件夹中的外部改动会自动刷新；5.0 和 4.x 数据可直接打开。

## 源码

| 目录 | 内容 |
| --- | --- |
| `desktop/` | Electron + React + TypeScript 应用、测试和打包配置 |
| `desktop/src-tauri/` | 4.x Tauri 源码，保留作兼容参考，不再用于发布 |
| `规范/` | 产品设计、交互与视觉规范 |
| `.github/workflows/release.yml` | Windows 与两种 Mac 架构的原生构建、安装测试和发布流程 |

开发说明见 [desktop/README.md](desktop/README.md)，5.1 发布说明见 [desktop/RELEASE.md](desktop/RELEASE.md)。
