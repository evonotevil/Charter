#!/bin/bash
# Charter 内存采样（Mac）。只读，不碰档案。
# 用法：bash measure-mac.sh 5.3.5   （测完换 5.3.6 再跑一次：bash measure-mac.sh 5.3.6）
# 每一步做完按回车，脚本记录当时所有 Charter 进程（含 Helper）的内存合计（RSS，MB）。
# 结果写在当前目录 charter-mem-<版本>.csv。
set -u
ver="${1:-unknown}"; out="charter-mem-$ver.csv"
echo "step,rss_mb,time" > "$out"
sample() { ps -axo rss=,comm= | awk '/Charter/ { s += $1 } END { printf "%d", s/1024 }'; }
mark() { sleep 3; local m; m=$(sample); echo "$1,$m,$(date +%H:%M:%S)" >> "$out"; printf "  %-28s %6s MB\n" "$1" "$m"; }
step() { read -r -p "▶ $1，完成后按回车 " _; mark "$2"; }
echo "Charter $ver 内存采样。请先：退出 Charter → 打开 → 设备与同步 → 更换文件夹，选一个空的测试文件夹 → 设置 → 备份与恢复 → 载入示例数据，"
echo "再把同一份大型扫描 PDF（建议 50 页以上）通过“上传材料”归档到任意一家公司。不要用真实档案文件夹。"
step "打开“文件”页（列表视图）" "list"
step "切到“缩略图”" "grid_first_open"
step "在缩略图里滚到底" "grid_scrolled"
step "切回“列表”" "back_to_list"
for i in $(seq 1 20); do
  step "第 $i 次：打开那份大 PDF 的详情（预览出现后）" "pdf_open_$i"
  step "第 $i 次：关闭详情" "pdf_closed_$i"
done
read -r -p "▶ 停留 10 秒不操作，然后按回车 " _; sleep 10; mark "idle_after"
echo "完成：$out"
