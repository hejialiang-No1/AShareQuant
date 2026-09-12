'use strict';
/**
 * factors.js —— A 股多因子打分
 *
 * A 股的市场特征（T+1、涨跌停、散户主导）与通用量化框架差别很大，因子权重必须针对 A 股重写：
 *
 *   动量 18 分  —— 20/60 日趋势惯性
 *   趋势 18 分  —— 均线多空排列（MA5>MA10>MA20>MA60）
 *   均值回归 14 —— RSI + 乖离率，A 股短期反转效应明显
 *   量能 12 分  —— 放量突破 / 缩量回调，量在价先
 *   波动  8 分  —— 波动过高惩罚，过低说明没资金
 *   位置  8 分  —— 距 60 日高低，判断追高还是低吸
 *   涨停 12 分  —— 【A股特有】近期涨停次数，题材强度的直接体现
 *   换手 10 分  —— 【A股特有】换手率代表筹码活跃度
 *
 * 额外规则：ST 股直接扣分（退市/风险警示），停牌剔除
 */
const I = require('./indicators');

const W = {
  momentum: 18,
  trend: 18,
  reversion: 14,
  volume: 12,
  volatility: 8,
  position: 8,
  limitUp: 12,
  turnover: 10,
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function mapRange(v, lo, hi) {
  if (v == null || !Number.isFinite(v)) return 0;
  return clamp((v - lo) / (hi - lo), 0, 1);
}

/** 归一化 K 线字段：兼容 {o,h,l,c,v} 与 {open,high,low,close,volume} */
function norm(bars) {
  return {
    o: bars.map((b) => b.o != null ? b.o : b.open),
    h: bars.map((b) => b.h != null ? b.h : b.high),
    l: bars.map((b) => b.l != null ? b.l : b.low),
    c: bars.map((b) => b.c != null ? b.c : b.close),
    v: bars.map((b) => b.v != null ? b.v : (b.volume || 0)),
  };
}

/**
 * @param {Array} bars K线（时间正序）
 * @param {Object} quote 实时行情（可空，提供换手率/涨停价/名称等）
 */
function analyze(bars, quote) {
  if (!bars || bars.length < 60) return null;
  const { o, h, l, c, v } = norm(bars);
  const n = c.length - 1;
  const price = c[n];
  if (!Number.isFinite(price) || price <= 0) return null;

  const q = quote || {};
  const name = q.name || '';
  const limitPct = q.limitPct || 10;
  const isST = /ST/i.test(name);

  // ---------------- 指标
  const ma5 = I.sma(c, 5);
  const ma10 = I.sma(c, 10);
  const ma20 = I.sma(c, 20);
  const ma60 = I.sma(c, 60);
  const ma120 = I.sma(c, 120);
  const rsiArr = I.rsi(c, 14);
  const rsi = rsiArr[n] ?? 50;
  const macd = I.macd(c);
  const kdj = I.kdj(h, l, c);
  const boll = I.boll(c, 20, 2);
  const atrArr = I.atr(h, l, c, 14);
  const atr = atrArr[n] ?? 0;
  const volMa5 = I.sma(v, 5);
  const volMa20 = I.sma(v, 20);
  const annualVol = I.volatility(c, 60);          // 年化波动率 %
  const hi52 = I.highest(h, 250);                 // 52周（约250个交易日）最高
  const lo52 = I.lowest(l, 250);                  // 52周最低

  // ---------------- 1. 动量（18）
  const r5 = n >= 5 ? (c[n] / c[n - 5] - 1) * 100 : 0;
  const r20 = n >= 20 ? (c[n] / c[n - 20] - 1) * 100 : 0;
  const r60 = n >= 60 ? (c[n] / c[n - 60] - 1) * 100 : 0;
  // A 股动量：中期为主，短期过热反而扣分
  let momentum = (
    mapRange(r20, -12, 22) * 0.45 +
    mapRange(r60, -20, 40) * 0.35 +
    mapRange(r5, -8, 12) * 0.20
  ) * W.momentum;
  if (r20 > 60) momentum *= 0.75;   // 一个月翻倍以上，追高风险

  // ---------------- 2. 趋势（18）
  let trendScore = 0;
  if (ma5[n] && ma10[n] && ma20[n]) {
    if (price > ma5[n]) trendScore += 0.16;
    if (ma5[n] > ma10[n]) trendScore += 0.20;
    if (ma10[n] > ma20[n]) trendScore += 0.22;
    if (ma20[n] > ma60[n]) trendScore += 0.22;
    if (price > ma60[n]) trendScore += 0.20;
  }
  // MACD 状态加成
  const macdHist = macd.hist ? macd.hist[n] : null;
  if (macdHist != null) {
    if (macdHist > 0) trendScore += 0.1;
    else trendScore -= 0.1;
  }
  const trend = clamp(trendScore, 0, 1) * W.trend;

  // ---------------- 3. 均值回归（14）
  // RSI 超卖给高分（低吸机会），超买给低分；结合乖离率
  let reversion;
  if (rsi <= 30) reversion = 0.95 - (30 - rsi) * 0.004;      // 深度超卖最高分
  else if (rsi <= 45) reversion = 0.72;
  else if (rsi <= 55) reversion = 0.55;
  else if (rsi <= 70) reversion = 0.38;
  else reversion = 0.18;                                      // 超买区
  const bias = ma20[n] ? ((price - ma20[n]) / ma20[n]) * 100 : 0;
  if (bias > 20) reversion *= 0.6;      // 大幅正乖离，回归压力大
  if (bias < -18) reversion *= 1.15;    // 深跌，反弹弹性大
  reversion = clamp(reversion, 0, 1) * W.reversion;

  // ---------------- 4. 量能（12）
  const vRatio = volMa20[n] ? (volMa5[n] || 0) / volMa20[n] : 1;
  const todayVolRatio = volMa20[n] ? (v[n] || 0) / volMa20[n] : 1;
  // 温和放量最好（1.2~2.5 倍），爆量（>4）警惕出货
  let volume = mapRange(vRatio, 0.6, 2.2);
  if (vRatio > 4) volume *= 0.7;
  if (todayVolRatio > 3) volume = Math.min(1, volume * 1.15);
  volume = clamp(volume, 0, 1) * W.volume;

  // ---------------- 5. 波动（8）
  const atrPct = price ? (atr / price) * 100 : 0;
  // A 股个股日均波动 2~4% 属健康区间
  let volScore;
  if (atrPct < 1.2) volScore = 0.35;
  else if (atrPct <= 4.5) volScore = 1.0;
  else if (atrPct <= 7) volScore = 0.65;
  else volScore = 0.3;
  const volatility = volScore * W.volatility;

  // ---------------- 6. 位置（8）
  const hi60 = Math.max(...h.slice(-60));
  const lo60 = Math.min(...l.slice(-60));
  const posInRange = hi60 > lo60 ? (price - lo60) / (hi60 - lo60) : 0.5;
  // 中低位偏低吸，高位接盘扣分；但强势突破高位另算
  let position = mapRange(1 - Math.abs(posInRange - 0.62), 0.15, 1);
  if (posInRange > 0.92 && r20 > 25) position = 0.85;   // 强势创新高
  position = clamp(position, 0, 1) * W.position;

  // ---------------- 7. 涨停强度（12）【A股特有】
  let limitUpCount = 0;
  let recentLimitUp = 0;
  for (let i = Math.max(1, n - 19); i <= n; i++) {
    const pct = (c[i] / c[i - 1] - 1) * 100;
    if (pct >= limitPct - 0.5) {
      limitUpCount++;
      if (i >= n - 4) recentLimitUp++;
    }
  }
  let limitScore = 0;
  if (recentLimitUp >= 3) limitScore = 1.0;        // 连板妖股
  else if (recentLimitUp === 2) limitScore = 0.85;
  else if (recentLimitUp === 1) limitScore = 0.7;
  else if (limitUpCount >= 3) limitScore = 0.55;   // 近期活跃
  else if (limitUpCount >= 1) limitScore = 0.35;
  else limitScore = 0.15;
  // 当前正封涨停 → 买不进，反而降权
  if (q.isLimitUp) limitScore *= 0.55;
  const limitUp = clamp(limitScore, 0, 1) * W.limitUp;

  // ---------------- 8. 换手活跃度（10）【A股特有】
  const turnover = q.turnover || 0;
  let turnScore;
  if (turnover <= 0) turnScore = 0.4;             // 无数据时中性
  else if (turnover < 1) turnScore = 0.3;         // 太低没人玩
  else if (turnover <= 8) turnScore = 0.95;       // 健康活跃
  else if (turnover <= 15) turnScore = 0.8;
  else if (turnover <= 25) turnScore = 0.55;      // 过热
  else turnScore = 0.35;                          // 击鼓传花
  const turnoverScore = turnScore * W.turnover;

  // ---------------- 汇总
  let total = momentum + trend + reversion + volume + volatility + position + limitUp + turnoverScore;

  // ST / 退市风险：直接砍分
  if (isST) total *= 0.8;
  // 停牌
  if (q.suspended) total *= 0.5;

  total = clamp(total, 0, 100);

  // ---------------- 信号识别
  const signals = [];
  if (q.isLimitUp) signals.push({ text: '当前封涨停', type: 'warn' });
  if (recentLimitUp >= 2) signals.push({ text: `5日${recentLimitUp}次涨停`, type: 'bull' });
  else if (recentLimitUp === 1) signals.push({ text: '5日内涨停', type: 'bull' });
  if (ma5[n] && ma10[n] && ma5[n] > ma10[n] && ma10[n] > ma20[n] && ma20[n] > ma60[n]) {
    signals.push({ text: '均线多头排列', type: 'bull' });
  }
  if (ma5[n] && ma20[n] && ma5[n] < ma20[n] && ma20[n] < ma60[n]) {
    signals.push({ text: '均线空头排列', type: 'bear' });
  }
  if (macd.hist && macd.hist[n] > 0 && macd.hist[n - 1] <= 0) signals.push({ text: 'MACD金叉', type: 'bull' });
  if (macd.hist && macd.hist[n] < 0 && macd.hist[n - 1] >= 0) signals.push({ text: 'MACD死叉', type: 'bear' });
  if (rsi < 30) signals.push({ text: `RSI超卖 ${rsi.toFixed(0)}`, type: 'bull' });
  if (rsi > 72) signals.push({ text: `RSI超买 ${rsi.toFixed(0)}`, type: 'bear' });
  if (todayVolRatio > 2) signals.push({ text: `放量 ${todayVolRatio.toFixed(1)}倍`, type: 'bull' });
  if (vRatio < 0.7) signals.push({ text: '持续缩量', type: 'bear' });
  if (boll.lower && price <= boll.lower[n]) signals.push({ text: '触及布林下轨', type: 'bull' });
  if (boll.upper && price >= boll.upper[n]) signals.push({ text: '触及布林上轨', type: 'bear' });
  if (price >= hi60 * 0.995) signals.push({ text: '创60日新高', type: 'bull' });
  if (price <= lo60 * 1.005) signals.push({ text: '创60日新低', type: 'bear' });
  if (isST) signals.push({ text: 'ST风险警示', type: 'warn' });

  const bullCount = signals.filter((s) => s.type === 'bull').length;
  const bearCount = signals.filter((s) => s.type === 'bear').length;

  return {
    price,
    changePct: q.changePct != null ? q.changePct : (n > 0 ? ((c[n] / c[n - 1] - 1) * 100) : 0),
    score: Math.round(total * 10) / 10,
    factors: {
      momentum: Math.round(momentum * 10) / 10,
      trend: Math.round(trend * 10) / 10,
      reversion: Math.round(reversion * 10) / 10,
      volume: Math.round(volume * 10) / 10,
      volatility: Math.round(volatility * 10) / 10,
      position: Math.round(position * 10) / 10,
      limitUp: Math.round(limitUp * 10) / 10,
      turnover: Math.round(turnoverScore * 10) / 10,
    },
    signals,
    bullCount,
    bearCount,
    isST,
    limitUpCount,
    recentLimitUp,
    metrics: {
      rsi: Math.round(rsi * 10) / 10,
      ma5: ma5[n], ma10: ma10[n], ma20: ma20[n], ma60: ma60[n], ma120: ma120[n],
      macdDif: macd.dif ? macd.dif[n] : null,
      macdDea: macd.dea ? macd.dea[n] : null,
      macdHist: macdHist,
      kdjK: kdj.k ? kdj.k[n] : null,
      kdjD: kdj.d ? kdj.d[n] : null,
      kdjJ: kdj.j ? kdj.j[n] : null,
      bollUp: boll.upper ? boll.upper[n] : null,
      bollLow: boll.lower ? boll.lower[n] : null,
      atr: Math.round(atr * 100) / 100,
      atrPct: Math.round(atrPct * 100) / 100,
      volatility: annualVol == null ? null : Math.round(annualVol * 100) / 100,
      volRatio: Math.round(vRatio * 100) / 100,
      r5: Math.round(r5 * 100) / 100,
      r20: Math.round(r20 * 100) / 100,
      r60: Math.round(r60 * 100) / 100,
      turnover,
      distHigh: Math.round(((price / hi60) - 1) * 1000) / 10,
      hi60, lo60,
      // 52周口径（供面板展示，与 60 日的 hi60/lo60 区分）
      hi52, lo52,
      distHigh52: hi52 ? Math.round(((price / hi52) - 1) * 1000) / 10 : null,
    },
  };
}

function rating(score) {
  if (score >= 78) return { label: '强烈看多', cls: 'r1' };
  if (score >= 66) return { label: '看多', cls: 'r2' };
  if (score >= 52) return { label: '中性偏多', cls: 'r3' };
  if (score >= 40) return { label: '中性', cls: 'r4' };
  if (score >= 28) return { label: '偏弱', cls: 'r5' };
  return { label: '回避', cls: 'r6' };
}

module.exports = { analyze, rating, clamp, mapRange, WEIGHTS: W };
