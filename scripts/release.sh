#!/bin/bash
# 创建 GitHub Release 并上传 dmg
set -e
cd "$(dirname "$0")/.."
# 默认走本机 Clash 代理；若已通过环境变量指定代理则尊重之（便于在别的网络环境下发布）
export HTTPS_PROXY="${HTTPS_PROXY:-socks5h://127.0.0.1:7890}"
export HTTP_PROXY="${HTTP_PROXY:-socks5h://127.0.0.1:7890}"
TOKEN="$1"
OWNER="hejialiang-No1"
REPO="AShareQuant"
TAG="v1.0.0"
DMG="build/AShareQuant-1.0.0-arm64.dmg"

echo "[1/3] 创建 Release $TAG ..."
REL=$(curl -s -m 60 -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$OWNER/$REPO/releases" \
  -d "{
    \"tag_name\": \"$TAG\",
    \"name\": \"AShareQuant v1.0.0 —— A股量化终端\",
    \"body\": \"## AShareQuant v1.0.0\n\nmacOS 桌面端 A 股量化终端，国内网络直连可用，无需 API Key、无需科学上网。\n\n### 五大模块\n\n- **自选行情**：实时报价、红涨绿跌（A股习惯）、自动刷新、内置 A 股股票池一键加自选\n- **个股分析**：K线 + MA/BOLL 主图，成交量/MACD/RSI/KDJ 副图，十字光标、滚轮缩放、拖拽平移\n- **量化选股**：A 股多因子打分（动量/趋势/均值回归/量能/波动/位置/涨停强度/换手），支持导出 CSV\n- **策略回测**：双均线/MACD/RSI/布林带/KDJ/涨停策略 + 买入持有基准，严格遵循 **T+1** 与 **涨跌停** 约束，含手续费与滑点、防未来函数\n- **预警监控**：价格上破/下破/涨跌幅超阈，命中触发系统通知\n- **板块热力**：行业板块涨跌幅热力视图，一键查看盘面强弱\n\n### 数据源\n\n腾讯 → 新浪 双源自动降级，任一源限流或挂掉自动切换。\n\n### 安装\n\n1. 下载下方 \`AShareQuant-1.0.0-arm64.dmg\`\n2. 双击挂载，把 AShareQuant 拖入 Applications\n3. 若被 Gatekeeper 拦截：\n\n\`\`\`bash\nsudo xattr -dr com.apple.quarantine /Applications/AShareQuant.app\n\`\`\`\n\n或在 Finder 中右键 → 打开\n\n### 已知限制\n\n- 仅 macOS arm64（Apple Silicon）\n- 未做 Apple 开发者签名，首次打开需右键打开或 xattr 解锁\n- 行情为盘后/延迟数据，用于研究而非实时交易\n\n### 风险提示\n\n本工具用于量化研究与回测演练，所有信号、评分、回测结果**不构成投资建议**。\",
    \"draft\": false,
    \"prerelease\": false
  }")

REL_ID=$(echo "$REL" | /Users/hejialiang/.workbuddy/binaries/node/versions/22.22.2-2/bin/node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.id){console.log(j.id)}else{console.log('ERR:'+j.message)}})")
echo "    Release ID: $REL_ID"

if [[ "$REL_ID" == ERR:* ]]; then
  echo "    ❌ 创建失败"
  exit 1
fi

echo "[2/3] 上传 dmg ($(du -h "$DMG" | cut -f1)) ..."
curl -s -m 900 --retry 3 --retry-delay 5 \
  -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"$DMG" \
  "https://uploads.github.com/repos/$OWNER/$REPO/releases/$REL_ID/assets?name=AShareQuant-1.0.0-arm64.dmg" \
  | /Users/hejialiang/.workbuddy/binaries/node/versions/22.22.2-2/bin/node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(s);if(j.id){console.log('    ✅ 上传成功:',j.name,(j.size/1048576).toFixed(1)+'MB','| 下载:',j.browser_download_url)}else{console.log('    ❌',j.message)}}catch(e){console.log('    RAW:',s.slice(0,200))}})"
echo "[3/3] 完成: https://github.com/$OWNER/$REPO/releases/tag/$TAG"
