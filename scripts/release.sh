#!/bin/bash
# 创建 GitHub Release 并上传 dmg
# 用法: bash scripts/release.sh <GITHUB_TOKEN>
set -e
cd "$(dirname "$0")/.."
# 默认走本机 Clash 代理；如网络环境不同，用 RELEASE_PROXY 覆盖
# （注意：不要直接读 HTTPS_PROXY，沙箱/CI 里常被设成一个不可用的本地代理）
export HTTPS_PROXY="${RELEASE_PROXY:-socks5h://127.0.0.1:7890}"
export HTTP_PROXY="${RELEASE_PROXY:-socks5h://127.0.0.1:7890}"
TOKEN="$1"
# node 仅用于解析 JSON，优先用 PATH 里的，退回到 WorkBuddy 托管版本（不要硬编码版本号）
NODE_BIN="$(command -v node 2>/dev/null || ls -d /Users/hejialiang/.workbuddy/binaries/node/versions/*/bin/node 2>/dev/null | tail -1)"
OWNER="hejialiang-No1"
REPO="AShareQuant"
TAG="v1.1.0"
DMG="build/AShareQuant-1.1.0-arm64.dmg"

echo "[1/3] 创建 Release $TAG ..."
REL=$(curl -s -m 60 -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$OWNER/$REPO/releases" \
  -d "{
    \"tag_name\": \"$TAG\",
    \"name\": \"AShareQuant v1.1.0 —— A股量化终端\",
    \"body\": \"## AShareQuant v1.1.0\n\nmacOS 桌面端 A 股量化终端，国内网络直连可用，无需 API Key、无需科学上网。\n\n### 本次新增\n\n- **筹码分布（CYQ）**：价格轴切 90 个等宽价格桶，逐日按三角核把成交量摊到当日 [low, high] 区间，旧筹码按换手率衰减；输出获利比例、平均成本、90% 成本区间、集中度与筹码峰\n- **支撑 / 压力位识别**：摆动高低点聚类（触碰次数=强度）+ 经典枢轴点 P/R1/R2/S1/S2 + 斐波那契回撤 23.6%/38.2%/50%/61.8%/78.6%\n- **K 线形态识别**：19 种单根/两根/三根组合形态（锤子线、看涨吞没、乌云盖顶、早晨之星、红三兵、三只乌鸦…），带方向与 1-3 级强度\n- **买卖点信号**：信号引擎 + K 线图上直接标注 + 分析面板汇总\n- **持仓管理**：成本、市值、浮动盈亏一屏查看\n- **市场情绪指标**：量化当前盘面冷热\n\n### 本次修复\n\n- **K 线主图完全空白（真 bug）**：数据源输出短字段名 {t,o,h,l,c,v}，而绘图代码读长字段名 {date,open,high,low,close}，导致 low/high 为 undefined → lo=Infinity → 坐标映射全为 NaN，主图一笔都画不出来；现六个共享模块与 chart/app 统一采用双字段名兼容\n- **KPI 面板 8 格只显示 --**：metrics 缺 ma120/macdHist/kdjK/volatility/hi52/lo52 字段，且涨幅字段命名不一致（ret5/ret20/ret60 vs r5/r20/r60），已补齐并统一\n- **均线涨跌颜色恒为绿色**：误读不存在的 metrics.price，改读分析结果顶层 price\n\n### 界面\n\n按 Apple 审美全面重构，对齐 macOS Liquid Glass 规范：毛玻璃质感、统一圆角语言、深色/浅色主题。\n\n### 六大模块\n\n- **自选行情**：实时报价、红涨绿跌（A股习惯）、自动刷新、内置 A 股股票池一键加自选\n- **个股分析**：K线 + MA/BOLL 主图，成交量/MACD/RSI/KDJ 副图，十字光标、滚轮缩放、拖拽平移\n- **量化选股**：多因子打分（动量/趋势/均值回归/量能/波动/位置/涨停强度/换手），支持导出 CSV\n- **策略回测**：双均线/MACD/RSI/布林带/KDJ/涨停策略 + 买入持有基准，严格遵循 **T+1** 与 **涨跌停** 约束，含手续费与滑点、防未来函数\n- **预警监控**：价格上破/下破/涨跌幅超阈，命中触发系统通知\n- **板块热力**：行业板块涨跌幅热力视图，一键查看盘面强弱\n\n### 数据源\n\n腾讯（主）→ 新浪（备）双源自动降级，任一源限流或挂掉自动切换。\n\n### 安装\n\n1. 下载下方 \`AShareQuant-1.1.0-arm64.dmg\`\n2. 双击挂载，把 AShareQuant 拖入 Applications\n3. 若被 Gatekeeper 拦截：\n\n\`\`\`bash\nsudo xattr -dr com.apple.quarantine /Applications/AShareQuant.app\n\`\`\`\n\n或在 Finder 中右键 → 打开\n\n### 已知限制\n\n- 仅 macOS arm64（Apple Silicon）\n- 未做 Apple 开发者签名，首次打开需右键打开或 xattr 解锁\n- 行情为盘后/延迟数据，用于研究而非实时交易\n\n### 风险提示\n\n本工具用于量化研究与回测演练，所有信号、评分、回测结果**不构成投资建议**。\",
    \"draft\": false,
    \"prerelease\": false
  }")

REL_ID=$(echo "$REL" | "$NODE_BIN" -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.id){console.log(j.id)}else{console.log('ERR:'+j.message)}})")
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
  "https://uploads.github.com/repos/$OWNER/$REPO/releases/$REL_ID/assets?name=AShareQuant-1.1.0-arm64.dmg" \
  | "$NODE_BIN" -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(s);if(j.id){console.log('    ✅ 上传成功:',j.name,(j.size/1048576).toFixed(1)+'MB','| 下载:',j.browser_download_url)}else{console.log('    ❌',j.message)}}catch(e){console.log('    RAW:',s.slice(0,200))}})"
echo "[3/3] 完成: https://github.com/$OWNER/$REPO/releases/tag/$TAG"
