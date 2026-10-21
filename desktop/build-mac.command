#!/bin/zsh
# 双击运行：在这台 Mac 上编译 Charter（Electron）。日志写到同目录 build-mac.log。
# 正式发布时 GitHub Actions 会分别用原生 Mac 和 Windows runner 构建（见 README.md）。
cd "$(dirname "$0")"
exec > >(tee build-mac.log) 2>&1
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "node: $(node -v 2>&1)  npm: $(npm -v 2>&1)"
npm install && npm test && npm run build && npx electron-builder --mac dmg --arm64 --publish never
echo "EXIT=$?"
ls -la release/*.dmg 2>/dev/null
echo "BUILD-DONE"
