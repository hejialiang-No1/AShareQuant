'use strict';
/**
 * signals.js —— 买卖点信号识别
 *
 * 输入 K 线，输出一串「边缘触发」的买卖点：
 *   { index, date, type:'buy'|'sell', price, reason, strength }
 *
 * 设计原则：
 *   1. 边缘触发：只在条件「由不满足 → 满足」的那一根 K 线打点，避免连续刷屏。
 *   2. 同方向去重：同一类买卖点至少间隔 minGap 根 K 线（默认 8）。
 *   3. 纯本地计算，复用 indicators 里的 MA/MACD/RSI/BOLL，和界面画的是同一套。
 *   4. A 股语义：红 = 涨 = 买点，绿 = 跌 = 卖点（与界面配色一致）。
 */
const I = require('./indicators');

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

function detect(rawBars, opts) {
  opts = opts || {};
  const bars = norm(rawBars);
  const n = bars.length;
  if (n < 60) return [];

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const vols = bars.map((b) => b.volume);

  const ma5 = I.sma(closes, 5);
  const ma20 = I.sma(closes, 20);
  const macd = I.macd(closes);
  const rsi = I.rsi(closes, 14);
  const boll = I.boll(closes, 20, 2);
  const volMa5 = I.sma(vols, 5);
  const volMa20 = I.sma(vols, 20);

  const minGap = opts.minGap || 8;
  const out = [];
  let lastBuy = -999;
  let lastSell = -999;

  const push = (i, type, price, reason, strength) => {
    out.push({ index: i, date: bars[i].date, type, price, reason, strength });
  };

  for (let i = 1; i < n; i++) {
    const c = closes[i];
    const o = bars[i].open;
    const hi = highs[i];
    const lo = lows[i];

    // ---------------- 买点 ----------------
    let buyReason = null;
    let buyStrength = 0;

    // MA5 上穿 MA20 金叉
    if (ma5[i] != null && ma20[i] != null && ma5[i - 1] != null && ma20[i - 1] != null) {
      if (ma5[i - 1] <= ma20[i - 1] && ma5[i] > ma20[i]) {
        buyReason = 'MA5上穿MA20金叉';
        buyStrength = 3;
      }
    }
    // MACD 金叉（柱由负转正）
    if (!buyReason && macd.hist[i] != null && macd.hist[i - 1] != null) {
      if (macd.hist[i - 1] <= 0 && macd.hist[i] > 0) {
        buyReason = 'MACD金叉';
        buyStrength = 3;
      }
    }
    // RSI 超卖回升（<30 后回到 30 上方第一根）
    if (!buyReason && rsi[i] != null && rsi[i - 1] != null) {
      if (rsi[i - 1] < 30 && rsi[i] >= 30) {
        buyReason = 'RSI超卖回升';
        buyStrength = 2;
      }
    }
    // 布林下轨反弹：前一根收在下轨下方，本根收回到下轨上方
    if (!buyReason && boll.lower[i] != null && boll.lower[i - 1] != null) {
      if (closes[i - 1] < boll.lower[i - 1] && closes[i] > boll.lower[i]) {
        buyReason = '布林下轨反弹';
        buyStrength = 2;
      }
    }
    // 放量站上 MA20 突破（量比 > 1.8 且收阳）
    if (!buyReason && ma20[i] != null && volMa20[i] != null && volMa5[i] != null) {
      const vr = volMa5[i] / volMa20[i];
      if (vr > 1.8 && c > ma20[i] && c > o) {
        buyReason = '放量突破MA20';
        buyStrength = 2;
      }
    }

    if (buyReason && i - lastBuy >= minGap) {
      push(i, 'buy', lo, buyReason, buyStrength);
      lastBuy = i;
    }

    // ---------------- 卖点 ----------------
    let sellReason = null;
    let sellStrength = 0;

    // MA5 下穿 MA20 死叉
    if (ma5[i] != null && ma20[i] != null && ma5[i - 1] != null && ma20[i - 1] != null) {
      if (ma5[i - 1] >= ma20[i - 1] && ma5[i] < ma20[i]) {
        sellReason = 'MA5下穿MA20死叉';
        sellStrength = 3;
      }
    }
    // MACD 死叉（柱由正转负）
    if (!sellReason && macd.hist[i] != null && macd.hist[i - 1] != null) {
      if (macd.hist[i - 1] >= 0 && macd.hist[i] < 0) {
        sellReason = 'MACD死叉';
        sellStrength = 3;
      }
    }
    // RSI 超买回落（>70 后跌破 70 第一根）
    if (!sellReason && rsi[i] != null && rsi[i - 1] != null) {
      if (rsi[i - 1] > 70 && rsi[i] <= 70) {
        sellReason = 'RSI超买回落';
        sellStrength = 2;
      }
    }
    // 布林上轨回落：前一根收在上轨上方，本根收回到上轨下方
    if (!sellReason && boll.upper[i] != null && boll.upper[i - 1] != null) {
      if (closes[i - 1] > boll.upper[i - 1] && closes[i] < boll.upper[i]) {
        sellReason = '布林上轨回落';
        sellStrength = 2;
      }
    }
    // 高位放量滞涨：量比 > 2.2 但收阴，且处于近期高位
    if (!sellReason && volMa20[i] != null && volMa5[i] != null) {
      const vr = volMa5[i] / volMa20[i];
      const lo60 = Math.max(0, i - 59);
      const hi60 = Math.max(...highs.slice(lo60, i + 1));
      if (vr > 2.2 && c < o && c >= hi60 * 0.92) {
        sellReason = '高位放量滞涨';
        sellStrength = 2;
      }
    }

    if (sellReason && i - lastSell >= minGap) {
      push(i, 'sell', hi, sellReason, sellStrength);
      lastSell = i;
    }
  }

  return out;
}

/** 摘要：最近买点 / 卖点 / 计数，供面板快速展示 */
function summary(points, opts) {
  opts = opts || {};
  const window = opts.window || 9999;
  const recent = window < points.length ? points.slice(-window) : points;
  const buys = recent.filter((p) => p.type === 'buy');
  const sells = recent.filter((p) => p.type === 'sell');
  return {
    lastBuy: buys.length ? buys[buys.length - 1] : null,
    lastSell: sells.length ? sells[sells.length - 1] : null,
    buyCount: buys.length,
    sellCount: sells.length,
    total: recent.length,
  };
}

module.exports = { detect, summary };
