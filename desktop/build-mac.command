#!/bin/zsh
# 双击运行：在这台 Mac 上编译 Charter（Electron）。日志写到同目录 build-mac.log。
# 平时不需要：在 Linux 上运行 npm run dist 可以同时打出 Mac 和 Windows 安装包（见 README.md）。
cd "$(dirname "$0")"
exec > >(tee build-mac.log) 2>&1
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "node: $(node -v 2>&1)  npm: $(npm -v 2>&1)"
npm install && npm test && npm run build && npx electron-builder --mac dmg --arm64 --publish never
echo "EXIT=$?"
ls -la release/*.dmg 2>/dev/null
echo "BUILD-DONE"
