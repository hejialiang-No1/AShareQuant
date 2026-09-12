'use strict';
/**
 * levels.js —— 支撑 / 压力位识别
 *
 * 借鉴 FinGenius 与 a-stock-data-quant 的做法，三种来源合成：
 *   1. 摆动高低点（swing pivot）：窗口内局部极值，聚类成支撑/压力带，触碰次数=强度；
 *   2. 经典枢轴点（Pivot Points）：由最新一根 K 线 OHLC 推 P / R1 / R2 / S1 / S2；
 *   3. 斐波那契回撤：近期高低点之间的 23.6% / 38.2% / 50% / 61.8% / 78.6%。
 *
 * 输出 { supports:[{price,strength}], resistances:[...], pivot:{...}, fib:[{ratio,price}] }
 */
function norm(bars) {
  return bars.map((b) => ({
    date: b.date || b.t,
    open: b.open != null ? b.open : b.o,
    high: b.high != null ? b.high : b.h,
    low: b.low != null ? b.low : b.l,
    close: b.close != null ? b.close : b.c,
  }));
}

function swingPivots(bars, k) {
  const highs = [];
  const lows = [];
  for (let i = k; i < bars.length - k; i++) {
    let isH = true;
    let isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) isH = false;
      if (bars[j].low <= bars[i].low) isL = false;
    }
    if (isH) highs.push({ price: bars[i].high, index: i });
    if (isL) lows.push({ price: bars[i].low, index: i });
  }
  return { highs, lows };
}

/** 把邻近的价格点聚成一簇，簇内点数=强度 */
function cluster(points, tol) {
  const sorted = points.slice().sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const p of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(p.price - last.price) / last.price <= tol) {
      last.price = (last.price * last.count + p.price) / (last.count + 1);
      last.count++;
    } else {
      clusters.push({ price: p.price, count: 1 });
    }
  }
  return clusters.map((c) => ({ price: Math.round(c.price * 100) / 100, strength: c.count }));
}

/**
 * @param {Array} rawBars
 * @param {Object} opts { price, pivotK, tol, maxLevels }
 */
function compute(rawBars, opts) {
  opts = opts || {};
  const bars = norm(rawBars);
  const n = bars.length;
  if (n < 20) return null;
  const price = opts.price || bars[n - 1].close;
  const k = opts.pivotK || 3;
  const tol = opts.tol || 0.012;      // 1.2% 内视为同一价位
  const maxLevels = opts.maxLevels || 4;

  const { highs, lows } = swingPivots(bars, k);

  // 聚类后按距现价远近排序，取最近且最强的几档
  const rank = (arr) =>
    cluster(arr, tol)
      .sort((a, b) => {
        const da = Math.abs(a.price - price) / price;
        const db = Math.abs(b.price - price) / price;
        return da - db;
      })
      .slice(0, maxLevels)
      .sort((a, b) => a.price - b.price);

  const supportsRaw = lows.filter((p) => p.price < price);
  const resistRaw = highs.filter((p) => p.price > price);

  const supports = rank(supportsRaw.length ? supportsRaw : lows).sort((a, b) => b.price - a.price);
  const resistances = rank(resistRaw.length ? resistRaw : highs).sort((a, b) => a.price - b.price);

  // 经典枢轴点（用倒数第二根已收盘 K 线，避免用未走完的当日）
  const bar = bars[n - 2] || bars[n - 1];
  const p = (bar.high + bar.low + bar.close) / 3;
  const pivot = {
    P: round(p),
    R1: round(2 * p - bar.low),
    R2: round(p + (bar.high - bar.low)),
    R3: round(bar.high + 2 * (p - bar.low)),
    S1: round(2 * p - bar.high),
    S2: round(p - (bar.high - bar.low)),
    S3: round(bar.low - 2 * (bar.high - p)),
  };

  // 斐波那契（近 60 根高低点）
  const seg = bars.slice(-60);
  const hi = Math.max(...seg.map((b) => b.high));
  const lo = Math.min(...seg.map((b) => b.low));
  const fib = [0.236, 0.382, 0.5, 0.618, 0.786].map((r) => ({
    ratio: r,
    price: round(hi - (hi - lo) * r),
  }));

  return { price: round(price), supports, resistances, pivot, fib, swingHigh: round(hi), swingLow: round(lo) };
}

function round(v) {
  return Math.round(v * 100) / 100;
}

module.exports = { compute };
