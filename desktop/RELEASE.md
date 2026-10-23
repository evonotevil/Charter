Charter 5.3.1：维护版本，统一应用、网站与安装包版本。

## 下载与安装

- **Mac（Apple 芯片，M1 及以后）**：`Charter-5.3.1-Mac-arm64.dmg`。打开后把 Charter 拖进「应用程序」。
- **Mac（Intel）**：`Charter-5.3.1-Mac-x64.dmg`。
- **Windows 10/11**：推荐 `Charter-5.3.1-Windows-Setup.exe`；也可以使用免安装版 `Charter-5.3.1-Windows-x64.zip`。
- `SHA256SUMS.txt` 用于核对下载文件。

应用没有正式签名：Mac 第一次打开时在访达里右键 →「打开」；Windows SmartScreen 提示时选「更多信息」→「仍要运行」。

## 本版说明

- **统一版本**：桌面应用、产品网站、GitHub Release、下载链接与校验文件同步更新到 5.3.1。
- **重新构建安装包**：由 GitHub Actions 生成 Apple 芯片 Mac、Intel Mac、Windows 安装版和免安装版。
- **原生环境验证**：Windows 安装流程、应用启动，以及 macOS 架构、签名、DMG 和 ZIP 完整性均由对应构建环境检查。
- **产品网站**：延续 5.3 的全新产品介绍、界面预览、数据存放方式、更新说明与下载入口。

## 数据

数据文件夹格式不变，4.x、5.0 和 5.1 的数据可以直接打开。

## 验证范围

GitHub Actions 会在原生 macOS 和 Windows 构建环境运行单元测试与生产构建。macOS 包会校验版本、架构、ad-hoc 签名、应用资源和 DMG/ZIP 完整性；Windows 会静默安装、启动应用并检查窗口。
