# Charter

为公司法务管理多家海外公司的桌面应用：股权结构、到期事项、中介、档案与文件包。当前版本 4.1.1（Tauri 2 + React + TypeScript），提供 Windows 与 Mac 安装包。

## 下载

从 [GitHub Releases](https://github.com/evonotevil/Charter/releases/latest) 下载：Windows 10/11 x64 使用 `-setup.exe` 或 MSI；macOS 12+ 使用 Universal DMG（Apple Silicon / Intel 通用）或 ZIP。安装包暂未使用开发者证书签名；首次安装可能需要系统确认。

这是从 Swift 版完整重写的桌面应用。连接旧数据文件夹前请先备份，不保证所有旧版数据都可直接迁移。详细安装和验证范围见 [发布说明](desktop/docs/RELEASE.md)。

- 代码：`desktop/`
- 打包：在访达里双击 `desktop/build-mac.command`，安装包在 `desktop/src-tauri/target/release/bundle/dmg/`
- 自动构建：GitHub Actions 的 `Desktop release`，手动运行生成两平台附件；推送与版本号一致的 `v*` 标签会在全部检查通过后发布。
- 设计原则与方案：`desktop/docs/CHARTER4-PLAN.md`
- 视觉规范：`desktop/docs/DESIGN.md`
- 交接说明：`desktop/docs/HANDOFF-4.1.0.md`

更早的 Swift 版（Charter 1–3）已移除，可在 git 历史里找回。
