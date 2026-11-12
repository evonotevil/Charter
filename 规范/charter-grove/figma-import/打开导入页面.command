#!/bin/bash
set -e
cd "$(dirname "$0")"
PORT=8765
URL="http://127.0.0.1:${PORT}/index.html"
echo "Charter Figma Import Kit"
echo "打开：${URL}"
echo "导入完成后按 Control-C 停止本地服务器。"
(sleep 1; open "${URL}") &
exec python3 -m http.server "${PORT}" --bind 127.0.0.1
