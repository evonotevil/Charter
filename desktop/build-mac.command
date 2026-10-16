#!/bin/zsh
# 双击运行：编译 Charter Mac 安装包。日志写到同目录 build-mac.log。
cd "$(dirname "$0")"
exec > >(tee build-mac.log) 2>&1
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "node: $(node -v 2>&1)  npm: $(npm -v 2>&1)  cargo: $(cargo -V 2>&1)"
xcode-select -p || { echo "缺少 Xcode 命令行工具"; exit 1; }
npm install && npm run tauri build -- --bundles app,dmg
echo "EXIT=$?"
ls -la src-tauri/target/release/bundle/dmg 2>/dev/null
echo "BUILD-DONE"
