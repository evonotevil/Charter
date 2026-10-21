Charter 5.0.0：全新视觉与 Electron 桌面内核，同时提供 Mac 和 Windows 版本。

## 下载与安装

- **Mac Apple 芯片（M1 及以后）**：`Charter-5.0.0-Mac-arm64.dmg`
- **Mac Intel**：`Charter-5.0.0-Mac-x64.dmg`
- **Windows 10/11 x64**：`Charter-5.0.0-Windows-Setup.exe`
- **Windows 免安装**：`Charter-5.0.0-Windows-x64.zip`
- Mac 的 `.zip` 与对应 `.dmg` 内容相同，作为备用下载。
- `SHA256SUMS.txt` 用于核对全部下载文件。

安装包没有使用 Apple Developer ID 或 Windows 商业代码签名证书。Mac 包使用 ad-hoc 签名，首次打开时可能需要在访达中右键 Charter →「打开」；Windows 可能显示 SmartScreen 提示，选择「更多信息」→「仍要运行」。

## 本版更新

- 全新视觉系统、新标志，以及更清晰的页面层级和交互反馈。
- 桌面内核改为 Electron，Mac 与 Windows 使用同一套产品代码。
- 分别提供 Apple 芯片和 Intel Mac 安装包，并新增 Windows 免安装 ZIP。
- 修复其他设备同步到数据文件夹后界面没有及时刷新的问题。
- 保留旧版数据文件夹格式，升级后可以直接打开原有资料。

## 验证范围

GitHub Actions 在原生 Windows 与 macOS runner 上运行单元测试和 TypeScript/Vite 构建。Windows 包会执行静默安装、启动和窗口检查；macOS 的两种架构分别检查应用版本、架构、ad-hoc 签名、模板资源、DMG 完整性和 ZIP 内容。自动检查不代替真实设备上的 iCloud、OneDrive、通知、文字识别和完整业务流程验收。
