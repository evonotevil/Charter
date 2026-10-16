# Charter 桌面版

Tauri 2 + React + TypeScript。目前只出 Mac 安装包；代码本身也能在 Windows 和 Linux 上编译。

## 在 Mac 上编译安装包

第一次需要装三样东西（已装过可跳过）：

```bash
xcode-select --install                                   # 苹果命令行工具
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust
brew install node                                        # Node.js 18 以上
```

然后在这个文件夹里：

```bash
npm install
npm run tauri build -- --bundles dmg
```

装好的安装包在 `src-tauri/target/release/bundle/dmg/Charter_3.0.0_*.dmg`。

应用没有签名。第一次打开时 macOS 会提示“无法验证开发者”：在“访达”里右键 Charter →“打开”，确认一次即可。

## 开发

```bash
npm run dev          # 浏览器预览，数据在内存里；地址后加 ?sample 自动载入示例数据
npm run tauri dev    # 真实应用窗口，读写真实文件夹
npm test             # 单元测试
```

## 数据

用户在设置里选数据文件夹（建议放在 iCloud 云盘或 OneDrive 里，多台电脑共用）。结构见 `../handoff/BUILD-PLAN.md`。
