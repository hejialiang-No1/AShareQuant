#!/bin/bash
# shots.sh —— 界面截图：把应用自己的窗口抓成 PNG，输出到 build/shots/
#
# 为什么不用 screencapture：macOS 需要对终端授予「屏幕录制」权限，
# 未授权时报 "could not create image from display"。而 Electron 的
# webContents.capturePage() 抓的是自己进程的窗口，不需要任何系统权限。
#
# 用法：
#   bash scripts/shots.sh                 # 输出到 build/shots/
#   QD_SHOT_DIR=/tmp/x bash scripts/shots.sh
cd "$(dirname "$0")/.." || exit 1

# WorkBuddy/CI 环境可能带 ELECTRON_RUN_AS_NODE，会让 Electron 以 Node 模式启动而报 bad option
unset ELECTRON_RUN_AS_NODE
unset NODE_OPTIONS

if [ -x "./build/AShareQuant.app/Contents/MacOS/AShareQuant" ]; then
  echo "==> 使用已构建的 app（含最新 src，需先同步）"
  exec ./build/AShareQuant.app/Contents/MacOS/AShareQuant --shot
fi

echo "==> 未找到已构建的 app，改用开发版 Electron"
exec ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --shot
