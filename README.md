# Charter 5

管理海外子公司的跨平台桌面应用：股权结构、到期事项、中介、公司档案、文件与人员。

当前版本：**5.4.0**（源码与已发布安装包已核验一致）。Charter 5 使用 Electron + React + TypeScript，Mac 与 Windows 共用一套产品代码。

产品网站：[https://evonotevil.github.io/Charter/](https://evonotevil.github.io/Charter/)

## 下载

从 [GitHub Releases](https://github.com/evonotevil/Charter/releases/latest) 下载：

- **Mac Apple 芯片（M1 及以后）**：`Charter-5.4.0-Mac-arm64.dmg`
- **Mac Intel**：`Charter-5.3.2-Mac-x64.dmg`
- **Windows 10/11 x64**：推荐 `Charter-5.4.0-Windows-Setup.exe`
- **Windows 免安装**：`Charter-5.3.2-Windows-x64.zip`
- **SHA-256 校验值**：`SHA256SUMS.txt`

5.4.0 安装包与仓库源码的前端构建、Electron 主程序已核验一致。Mac Intel 和 Windows ZIP 暂为 5.3.2。应用没有使用 Apple Developer ID 或 Windows 商业代码签名证书：Mac 首次打开时可能需要在访达中右键 Charter →「打开」；Windows 可能显示 SmartScreen 提示，选择「更多信息」→「仍要运行」。

## 5.3.2 更新

- 人员与公司档案新增“已有材料 / 完整性审阅”切换，并可设置我负责、中介保管、待确认、不在我的范围或不适用。
- 只有“我负责”的缺项计入完整度；中介保管和待确认分别展示。
- 支持标记文件上写明的长期有效状态，修复文件页到期日期和列对齐。
- 一份文件可以关联多家公司、人员、任职或持股，并记录证据类型和页码。
- Windows 安装包升级后会清理旧界面缓存，避免仍显示之前版本的前端资源。
- 安装包由 GitHub Actions 在原生 macOS 和 Windows 环境重新构建并验证。
- 延续现有数据格式，5.0、5.1、5.3.1 和 4.x 数据可以直接打开。

## 源码

| 目录 | 内容 |
| --- | --- |
| `desktop/` | Electron + React + TypeScript 应用、测试和打包配置 |
| `desktop/src-tauri/` | 4.x Tauri 源码，保留作兼容参考，不再用于发布 |
| `规范/` | 产品设计、交互与视觉规范 |
| `.github/workflows/release.yml` | Windows 与两种 Mac 架构的原生构建、安装测试和发布流程 |

开发说明见 [desktop/README.md](desktop/README.md)，5.3.2 发布说明见 [desktop/RELEASE.md](desktop/RELEASE.md)。
