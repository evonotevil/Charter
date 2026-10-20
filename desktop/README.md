# Charter 桌面版

Tauri 2 + React + TypeScript。正式发布同时提供 Windows x64 与 macOS Universal 安装包，从 [GitHub Releases](https://github.com/evonotevil/Charter/releases/latest) 下载。

## 在 Windows 上编译安装包

安装 Node.js 22、Rust MSVC 工具链，以及带“使用 C++ 的桌面开发”工作负载的 Visual Studio Build Tools；随后运行：

```powershell
npm ci
npm test
npm run tauri build -- --bundles nsis,msi
```

产物位于 `src-tauri/target/release/bundle/nsis/` 和 `msi/`。安装器在需要时联网安装 WebView2。GitHub Actions 会在原生 Windows runner 上编译、测试、静默安装并检查应用能否创建窗口。

## 在 Mac 上编译安装包

第一次需要装三样东西（已装过可跳过）：

```bash
xcode-select --install                                   # 苹果命令行工具
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust
brew install node                                        # Node.js 18 以上
```

然后在这个文件夹里：

```bash
npm ci
npm run tauri build -- --bundles dmg
```

装好的安装包在 `src-tauri/target/release/bundle/dmg/Charter_<版本号>_aarch64.dmg`。

应用没有开发者签名或公证。第一次打开时 macOS 可能会提示“无法验证开发者”：在“访达”里右键 Charter →“打开”，确认一次即可。正式 Universal 包由 GitHub Actions 构建并验证双架构。

## 开发

```bash
npm run dev          # 浏览器预览，数据在内存里；地址后加 ?sample 自动载入示例数据
npm run tauri dev    # 真实应用窗口，读写真实文件夹
npm test             # 单元测试
```

## 数据

用户在设置里选择数据文件夹。跨 Mac 和 Windows 使用时，请放在两端都能访问的同步服务中，例如 OneDrive。连接旧版资料前请先备份。设计与数据结构见 [规范/DESIGN.md](../规范/DESIGN.md)。
