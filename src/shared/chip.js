'use strict';
/**
 * chip.js —— 筹码分布（CYQ）
 *
 * 借鉴开源 A 股工具（myhhub/stock、a-stock-data-quant）的筹码模型：
 *   1. 把价格轴切成 NBINS 个等宽价格桶；
 *   2. 逐日把当日成交量按「三角核」摊到 [low, high] 区间（越靠近均价权重越高）；
 *   3. 同时让已有筹码按换手率衰减（当日换手越多，旧筹码被洗得越狠）；
 *   4. 归一化成占比，得到获利比例 / 平均成本 / 90% 成本区间 / 集中度 / 筹码峰。
 *
 * 无换手率数据时用「成交量 / 20 日均量」近似活跃度，保证纯 K 线也能算。
 */
const I = require('./indicators');

const NBINS = 90;      // 价格桶数量
const DEFAULT_DECAY = 0.965; // 无换手率时的日衰减

function norm(bars) {
  return bars.map((b) => ({
    date: b.date || b.t,
    open: b.open != null ? b.open : b.o,
    high: b.high != null ? b.high : b.h,
    low: b.low != null ? b.low : b.l,
    close: b.close != null ? b.close : b.c,
    volume: b.volume != null ? b.volume : (b.v || 0),
  }));
}

/**
 * @param {Array}  rawBars  K线（时间正序）
 * @param {Object} opts     { turnover } 最新换手率(%) 可空
 * @returns {Object|null}
 */
function compute(rawBars, opts) {
  opts = opts || {};
  const bars = norm(rawBars);
  const n = bars.length;
  if (n < 30) return null;

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const vols = bars.map((b) => b.volume);

  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  if (!(hi > lo)) return null;

  const width = (hi - lo) / NBINS;
  const chips = new Float64Array(NBINS);
  const volMa20 = I.sma(vols, 20);
  const recent = bars.slice(-60);

  // 逐日演进
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    // 衰减：当日越活跃，旧筹码被置换越多
    let decay = DEFAULT_DECAY;
    if (i >= 19 && volMa20[i] > 0) {
      // 量比越高 → 衰减越快（0.90 ~ 0.995）
      const vr = Math.min(6, (b.volume || 0) / volMa20[i]);
      decay = Math.max(0.90, Math.min(0.995, 1 - 0.02 * (vr + 0.5)));
    }
    for (let k = 0; k < NBINS; k++) chips[k] *= decay;

    // 新筹码：三角核摊到 [low, high]
    const avg = (b.high + b.low + b.close) / 2;
    const l = b.low;
    const h = b.high;
    const span = h - l || width;
    const b0 = Math.max(0, Math.floor((l - lo) / width));
    const b1 = Math.min(NBINS - 1, Math.ceil((h - lo) / width));
    let wsum = 0;
    const w = [];
    for (let k = b0; k <= b1; k++) {
      const price = lo + (k + 0.5) * width;
      // 三角形权重：峰值在均价处
      const dist = Math.abs(price - avg) / (span / 2 + width);
      const wk = Math.max(0.05, 1 - dist);
      w.push(wk);
      wsum += wk;
    }
    const add = (b.volume || 0);
    if (wsum > 0) {
      for (let k = b0; k <= b1; k++) chips[k] += (add * w[k - b0]) / wsum;
    } else {
      const kc = Math.max(0, Math.min(NBINS - 1, Math.floor((b.close - lo) / width)));
      chips[kc] += add;
    }
  }

  // 归一化
  let total = 0;
  for (let k = 0; k < NBINS; k++) total += chips[k];
  if (!(total > 0)) return null;
  const pct = new Array(NBINS);
  for (let k = 0; k < NBINS; k++) pct[k] = chips[k] / total;

  const price = closes[n - 1];

  // 获利比例：成本 ≤ 现价的筹码占比
  let profit = 0;
  let avgCost = 0;
  let peakK = 0;
  for (let k = 0; k < NBINS; k++) {
    const p = lo + (k + 0.5) * width;
    if (p <= price) profit += pct[k];
    avgCost += p * pct[k];
    if (pct[k] > pct[peakK]) peakK = k;
  }

  // 90% 成本区间（按价格从低到高累计到 5% 与 95%）
  let acc = 0;
  let low90 = lo;
  let high90 = hi;
  for (let k = 0; k < NBINS; k++) {
    acc += pct[k];
    if (acc >= 0.05) { low90 = lo + (k + 0.5) * width; break; }
  }
  acc = 0;
  for (let k = NBINS - 1; k >= 0; k--) {
    acc += pct[k];
    if (acc >= 0.05) { high90 = lo + (k + 0.5) * width; break; }
  }

  // 集中度：(高 - 低) / (高 + 低)，越小越集中
  const concentration = (high90 - low90) / (high90 + low90 || 1);

  // 逐桶输出（价格升序），供横向柱状图渲染
  const bins = [];
  for (let k = 0; k < NBINS; k++) {
    bins.push({ price: Math.round((lo + (k + 0.5) * width) * 100) / 100, weight: pct[k] });
  }
  let maxW = 0;
  for (const b of bins) if (b.weight > maxW) maxW = b.weight;

  return {
    price,
    avgCost: Math.round(avgCost * 100) / 100,
    profitRatio: Math.round(profit * 1000) / 10,      // %
    concentration: Math.round(concentration * 1000) / 10, // %
    peakPrice: Math.round((lo + (peakK + 0.5) * width) * 100) / 100,
    costLow90: Math.round(low90 * 100) / 100,
    costHigh90: Math.round(high90 * 100) / 100,
    range: { low: Math.round(lo * 100) / 100, high: Math.round(hi * 100) / 100 },
    maxWeight: maxW,
    bins,
    days: n,
    recentSpan: recent.length,
  };
}

/** 筹码形态解读（人话版） */
function verdict(chip) {
  if (!chip) return { label: '数据不足', cls: '' };
  const { profitRatio, concentration, price, avgCost } = chip;
  const above = price >= avgCost;
  if (concentration < 18 && profitRatio > 70)
    return { label: above ? '低位密集·多头占优' : '低位密集·套牢盘重', cls: above ? 'bull' : 'warn' };
  if (concentration < 18)
    return { label: '筹码高度集中', cls: 'warn' };
  if (concentration > 32)
    return { label: '筹码发散·分歧大', cls: 'gray' };
  if (profitRatio > 85) return { label: '获利盘沉重·注意抛压', cls: 'warn' };
  if (profitRatio < 15) return { label: '深度套牢·反弹弹性大', cls: 'bull' };
  return { label: '筹码结构中性', cls: 'gray' };
}

module.exports = { compute, verdict, NBINS };
