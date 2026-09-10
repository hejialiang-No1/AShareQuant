# AShareQuant —— A股量化终端

一个本地运行的 macOS 桌面应用，专为中文用户设计，集成 **行情 / 技术分析 / 量化选股 / 策略回测 / 预警 / 板块热力** 六大模块。

数据源走 **腾讯 → 新浪** 双源自动降级，国内网络直连可用，无需科学上网、无需 API Key。

## 功能速览

| 模块 | 干啥 |
| --- | --- |
| 自选行情 | 实时报价、涨跌幅（红涨绿跌，A股习惯）、自动刷新、内置 A 股股票池一键加自选 |
| 个股分析 | K线 + MA / BOLL 主图，成交量 / MACD / RSI / KDJ 副图，十字光标、滚轮缩放、拖拽平移，**红↑买点 / 绿↓卖点**信号自动标注 |
| 买卖点信号 | 基于 MA 金叉死叉 / MACD / RSI / 布林带 / 量能的边缘触发识别，自动去重，面板列出最近买点与卖点及原因 |
| 量化选股 | A 股多因子打分（动量 / 趋势 / 均值回归 / 量能 / 波动 / 位置 / 涨停强度 / 换手），支持导出 CSV |
| 策略回测 | 双均线 / MACD / RSI / 布林带 / KDJ / 涨停策略 + 买入持有基准，严格遵循 **T+1** 与 **涨跌停** 约束，含手续费与滑点、防未来函数 |
| 预警监控 | 价格上破 / 下破 / 涨幅超阈 / 跌幅超阈，命中触发系统通知 |
| 板块热力 | 行业板块涨跌幅热力视图，一眼看清盘面强弱 |

## A股专属设计

- **T+1 约束**：当日买入的股份当日不可卖出，回测引擎强制隔日才能平仓。
- **涨跌停约束**：主板 ±10% / 创业板·科创板 ±20% / 北交所 ±30% / ST ±5%，涨停买不进、跌停卖不出，信号自动顺延。
- **红涨绿跌**：遵循国内看盘习惯，与美股配色相反。
- **板块视角**：行业板块涨跌热力，识别资金主线。

## 安装与启动

### 直接安装（推荐）

到本仓库的 **[Releases](../../releases)** 页面下载 `AShareQuant-1.0.0-arm64.dmg`，双击挂载，把 AShareQuant 拖入 Applications。

首次打开若被 Gatekeeper 拦截（"已损坏"或"无法验证开发者"）：

```bash
sudo xattr -dr com.apple.quarantine /Applications/AShareQuant.app
```

或者在 Finder 里右键 → 打开（绕过 gatekeeper）。

### 源码启动

```bash
git clone https://github.com/hejialiang-No1/AShareQuant.git
cd AShareQuant
npm install --registry=https://registry.npmmirror.com  # 国内镜像
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm start
```

## 命令行自检

```bash
# 数据层 + 算法层（无需 Electron 运行时）
node scripts/smoke.js

# 主进程无头自检（需要 Electron 运行时，在 macOS 本机执行）
node scripts/main-smoke.js
```

## 打包 DMG

```bash
bash scripts/build-dmg.sh   # 输出 build/AShareQuant-1.0.0-arm64.dmg
```

构建方式为「直接组装 App Bundle」：复制 Electron.app → 注入 `src/` → 换图标 → 改 Info.plist → `hdiutil` 打包，结果等价于 electron-builder 产物，但更快更可控。

## 项目结构

```
AShareQuant/
├── package.json               # electron 配置（arm64 / dmg）
├── assets/                    # 应用图标（icns / iconset / png）
├── src/
│   ├── main/                  # 主进程：窗口、IPC、数据调度、扫描任务
│   │   ├── main.js
│   │   ├── preload.js
│   │   ├── datasource.js      # 腾讯/新浪双源行情（GBK 解码、并发池、缓存）
│   │   ├── store.js           # 自选/预警/配置持久化
│   │   └── pool.js            # 内置 A 股股票池
│   ├── shared/                # 主进程与渲染层共用的纯函数
│   │   ├── indicators.js       # MA/EMA/MACD/RSI/BOLL/KDJ/ATR
│   │   ├── factors.js          # A 股多因子打分
│   │   └── backtest.js         # T+1 / 涨跌停 回测引擎
│   └── renderer/              # 渲染层（HTML/CSS/JS，无框架）
│       ├── index.html
│       ├── css/app.css
│       └── js/{app,chart}.js
└── scripts/                  # 冒烟测试 / 打包 / 发布
```

## 已知限制

- 仅 macOS arm64（Apple Silicon）。
- 未做 Apple 开发者签名，首次打开需右键打开或 `xattr` 解锁。
- 行情为盘后/延迟数据，用于研究而非实时交易。

## 风险提示

本工具用于量化研究与回测演练，所有信号、评分、回测结果 **不构成任何投资建议**。股市有风险，投资需谨慎。

## License

MIT © 2026 hejialiang-No1
