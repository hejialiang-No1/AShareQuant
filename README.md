# AShareQuant —— A股量化终端

一个本地运行的 macOS 桌面应用，专为中文用户设计，采用 **Apple 设计语言**（SF Pro 字体 / 毛玻璃材质 / 系统色板 / 连续圆角），集成
**行情 / 技术分析 / 量化选股 / 筹码分布 / 策略回测 / 持仓管理 / 预警 / 板块热力** 等模块。

数据源走 **腾讯 → 新浪** 双源自动降级，国内网络直连可用，无需科学上网、无需 API Key。

## 功能速览

| 模块 | 干啥 |
| --- | --- |
| 自选行情 | 实时报价、涨跌幅（红涨绿跌，A股习惯）、自动刷新、内置 A 股股票池一键加自选 |
| 个股分析 | K线 + MA / BOLL 主图，成交量 / MACD / RSI / KDJ 副图，十字光标、滚轮缩放、拖拽平移 |
| 买卖点信号 | MA 金叉死叉 / MACD / RSI / 布林带 / 量能的边缘触发识别，自动去重；红↑买点 / 绿↓卖点标注在 K 线上 |
| 支撑压力位 | 摆动高低点聚类 + 经典枢轴点(P/R1/R2/S1/S2) + 斐波那契回撤，关键位直接画在 K 线上 |
| K线形态识别 | 早晨之星 / 黄昏之星 / 锤子线 / 上吊线 / 倒锤头 / 射击之星 / 吞没 / 乌云盖顶 / 曙光初现 / 十字星 / 红三兵 / 三只乌鸦 |
| 筹码分布(CYQ) | 换手率衰减 + 三角核模型，输出获利比例 / 平均成本 / 90%成本区间 / 集中度 / 筹码峰，横向柱状图可视化 |
| 量化选股 | A 股多因子打分（动量 / 趋势 / 均值回归 / 量能 / 波动 / 位置 / 涨停强度 / 换手），支持导出 CSV |
| 策略回测 | 双均线 / MACD / RSI / 布林带 / KDJ / 涨停策略 + 买入持有基准，严格 T+1 与涨跌停约束，含手续费与滑点 |
| 持仓管理 | 录入代码 / 股数 / 成本，实时跟踪市值、浮动盈亏、盈亏%、当日盈亏、仓位占比与组合合计 |
| 预警监控 | 价格上破 / 下破 / 涨幅超阈 / 跌幅超阈，命中触发系统通知 |
| 板块热力 | 行业板块涨跌幅热力视图；顶栏「市场情绪」温度计（指数 + 板块加权 0-100） |

## 设计语言（Apple）

- **字体**：SF Pro Display / Text（`-apple-system`），中文 PingFang SC，层级清晰、字距收紧。
- **材质**：`backdrop-filter: blur() saturate()` 毛玻璃，窗体透出色彩渐变壁纸。
- **色彩**：Apple 系统色——蓝 `#0A84FF` / 红 `#FF453A` / 绿 `#30D158` / 橙 `#FF9F0A` / 紫 `#BF5AF2`。
- **形态**：连续圆角、hairline 分隔线、柔和阴影、胶囊按钮与分段控件。
- **动效**：`cubic-bezier(0.32,0.72,0,1)` 弹簧曲线，视图淡入上移、按钮回弹。
- **双主题**：深色 / 亮色 / 跟随系统，设置页一键切换，图表随主题自适应。

## A股专属设计

- **T+1 约束**：当日买入的股份当日不可卖出，回测引擎强制隔日才能平仓。
- **涨跌停约束**：主板 ±10% / 创业板·科创板 ±20% / 北交所 ±30% / ST ±5%，涨停买不进、跌停卖不出，信号自动顺延。
- **红涨绿跌**：遵循国内看盘习惯，与美股配色相反。
- **筹码视角**：以换手率衰减模型还原持仓成本分布，看获利盘 / 套牢盘结构。

## 功能灵感来源（开源致敬）

本项目的进阶分析功能参考并本地重写了以下优秀开源项目的思路：

- [myhhub/stock (InStock)](https://github.com/myhhub/stock) —— 筹码分布、K 线形态识别、综合选股
- [a-stock-data-quant](https://github.com/jangviktor-web/a-stock-data-quant) —— CYQ 筹码（换手率衰减 + 高斯核）、形态识别、市场温度
- [FinGenius](https://github.com/FinGenius) —— 支撑阻力位、筹码集中度、主力识别
- [microsoft/qlib](https://github.com/microsoft/qlib) / [ricequant/rqalpha](https://github.com/ricequant/rqalpha) —— 多因子与 A 股回测工程实践
- [fin-primitives](https://github.com/) / [quantstats](https://github.com/ranaroussi/quantstats) —— 持仓账本与组合绩效分析

> 以上均为思路借鉴，本项目所有代码为独立实现，不依赖上述项目运行。

## 安装与启动

### 直接安装（推荐）

到本仓库的 **[Releases](../../releases)** 页面下载 `AShareQuant-1.1.0-arm64.dmg`，双击挂载，把 AShareQuant 拖入 Applications。

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
# 数据层 + 算法层（无需 Electron 运行时，52 项断言）
node scripts/smoke.js            # = npm run smoke

# 主进程无头自检（需要 Electron 运行时，在 macOS 本机执行）
node scripts/main-smoke.js

# 渲染层无头自检：启动应用 → 切到分析页 → 回读 DOM 与画布像素
bash scripts/ui-smoke.sh         # = npm run ui-smoke
```

渲染层自检会输出一行 `SMOKE_RESULT {...}`，其中 `canvasPainted` 用 `getImageData`
采样整块画布判断 K 线是否真的画出来了（0 非透明像素即视为未渲染），
配合 `klineMinY / klineMaxY` 可定位空白区。

## 界面截图

```bash
bash scripts/shots.sh            # = npm run shots，输出 build/shots/*.png
QD_SHOT_DIR=/tmp/x npm run shots # 指定输出目录
```

用 Electron 自身的 `webContents.capturePage()` 抓窗口，**不需要「屏幕录制」系统权限**
（`screencapture` 在未授权终端下会直接报 `could not create image from display`）。
依次抓取分析 / 自选 / 持仓 / 选股 / 板块 / 回测 / 设置七个页面。

## 打包 DMG

```bash
bash scripts/build-dmg.sh   # 输出 build/AShareQuant-1.1.0-arm64.dmg
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
│   │   ├── store.js           # 自选/持仓/预警/配置持久化
│   │   └── pool.js            # 内置 A 股股票池
│   ├── shared/                # 主进程与渲染层共用的纯函数
│   │   ├── indicators.js      # MA/EMA/MACD/RSI/BOLL/KDJ/ATR
│   │   ├── factors.js         # A 股多因子打分
│   │   ├── signals.js         # 买卖点信号
│   │   ├── patterns.js        # K线形态识别
│   │   ├── chip.js            # 筹码分布（CYQ）
│   │   ├── levels.js          # 支撑/压力位
│   │   └── backtest.js        # T+1 / 涨跌停 回测引擎
│   └── renderer/              # 渲染层（HTML/CSS/JS，无框架）
│       ├── index.html
│       ├── css/app.css        # Apple 设计系统（双主题）
│       └── js/{app,chart}.js
└── scripts/                  # 冒烟测试 / 打包 / 发布
```

## 已知限制

- 仅 macOS arm64（Apple Silicon）。
- 未做 Apple 开发者签名，首次打开需右键打开或 `xattr` 解锁。
- 行情为盘后/延迟数据，用于研究而非实时交易。
- 筹码分布为基于量价的统计模型估算，非交易所真实筹码数据。

## 更新日志

### v1.1.0

- **Apple 设计语言重构**：毛玻璃材质 / 系统色板 / 连续圆角 / 弹簧动效，深色·亮色·跟随系统三态主题。
- **新增分析模块**：筹码分布(CYQ)、K线形态识别、支撑压力位、买卖点标注。
- **新增视图**：持仓管理（组合盈亏跟踪）、顶栏市场情绪温度计。
- **数据契约修复**（渲染层曾大面积显示 `--` / K线空白）：
  - `chart.js` / `app.js` 直接读 `{date,open,high,low,close,volume}`，而数据源 `datasource.js`
    输出的是短名 `{t,o,h,l,c,v}`。二者不匹配导致 K 线主图、均线、BOLL、MACD
    坐标全部算成 `NaN` 而无法绘制。已按项目既有约定统一为「双字段名兼容」。
  - `factors.js` 的 `metrics` 缺少 `ma120 / macdHist / kdjK / volatility / hi52 / lo52`，
    且涨幅字段名为 `r5/r20/r60` 而面板读的是 `ret5/ret20/ret60` → 已补齐并统一，
    `smoke.js` 新增字段契约断言，防止再次回归。
  - 关键指标面板的均线涨跌配色误读 `metrics.price`（实际在 `analyze()` 顶层），
    导致 MA 涨跌色恒为绿 → 已修正。

## 风险提示

本工具用于量化研究与回测演练，所有信号、评分、回测结果 **不构成任何投资建议**。股市有风险，投资需谨慎。

## License

MIT © 2026 hejialiang-No1
