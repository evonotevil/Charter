Charter 4.1.1：Tauri 2 + React 桌面重写版，管理公司档案、股权结构、到期事项、中介与文件包。

## 下载与安装

- Windows 10/11（x64）：推荐下载 `-setup.exe`，也可使用 `.msi`。首次安装可能需要联网安装 Microsoft Edge WebView2 Runtime。安装器未签名，系统可能显示未知发布者或 SmartScreen 提示。
- macOS 12+：下载 `universal.dmg`（Apple Silicon 与 Intel 通用），打开并拖入 Applications。也可下载 Universal ZIP。应用使用本地临时签名，尚未经过 Apple 公证；若被系统拦截，在“系统设置 → 隐私与安全性”选择“仍要打开”。
- `SHA256SUMS.txt` 用于核对下载文件。

## 数据与升级

用户资料存放在所选数据文件夹中，安装包不含真实业务资料。首次使用建议选择独立文件夹，先用示例数据确认新版操作；连接旧资料前请先备份。此版本是完整重写，未声明能无损迁移所有 Swift 1.x 数据。跨 Mac 和 Windows 共用文件夹时，需要两端都能访问的同步服务，例如 OneDrive。

## 验证范围

发布流程在 Windows 和 macOS 上运行前端测试、TypeScript 构建、Rust 回归和安装包构建。Windows 另运行静默安装和应用启动检查；Mac 验证双架构、签名、模板资源与 DMG 完整性。这些检查不代替真实设备上的 OCR、同步盘、通知和完整业务流程验收。
