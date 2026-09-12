'use strict';
/**
 * patterns.js —— K 线形态识别
 *
 * 借鉴 InStock(myhhub/stock) / a-stock-data-quant 的形态库，覆盖 A 股最常用的
 * 单根 / 两根 / 三根 K 线组合形态：
 *
 *   单根：锤子线、上吊线、倒锤头、射击之星、十字星、大阳线、大阴线、长下影、长上影
 *   两根：看涨吞没、看跌吞没、乌云盖顶、曙光初现、孕线
 *   三根：早晨之星、黄昏之星、红三兵、三只乌鸦
 *
 * 输出 { index, date, name, type:'bull'|'bear'|'neutral', strength:1..3 }
 */
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

const body = (b) => Math.abs(b.close - b.open);
const range = (b) => Math.max(1e-9, b.high - b.low);
const upper = (b) => b.high - Math.max(b.open, b.close);
const lower = (b) => Math.min(b.open, b.close) - b.low;
const isUp = (b) => b.close >= b.open;
const bodyPct = (b) => body(b) / range(b);

/** 在 i 处相对前 N 根的趋势方向（-1 跌 / 0 平 / 1 涨） */
function trendAt(bars, i, n) {
  const s = Math.max(0, i - n);
  const a = bars[s].close;
  const b = bars[i].close;
  if (!a) return 0;
  const chg = (b - a) / a;
  if (chg > 0.03) return 1;
  if (chg < -0.03) return -1;
  return 0;
}

function detect(rawBars, opts) {
  opts = opts || {};
  const bars = norm(rawBars);
  const n = bars.length;
  if (n < 10) return [];
  const minBody = opts.minBody || 0.55; // 实体占振幅比例阈值
  const out = [];

  const push = (i, name, type, strength) => {
    out.push({ index: i, date: bars[i].date, name, type, strength });
  };

  for (let i = 2; i < n; i++) {
    const a = bars[i - 2];
    const b = bars[i - 1];
    const c = bars[i];
    const tr = trendAt(bars, i - 2, 10);

    // ---------------- 单根 ----------------
    const bp = bodyPct(c);
    // 锤子线 / 上吊线：小实体 + 长下影（≥2倍实体）+ 短上影
    if (bp < 0.35 && lower(c) > body(c) * 2 && upper(c) < body(c) * 1.1) {
      if (tr < 0) push(i, '锤子线', 'bull', 2);
      else if (tr > 0) push(i, '上吊线', 'bear', 2);
    }
    // 倒锤头 / 射击之星：小实体 + 长上影
    if (bp < 0.35 && upper(c) > body(c) * 2 && lower(c) < body(c) * 1.1) {
      if (tr < 0) push(i, '倒锤头', 'bull', 2);
      else if (tr > 0) push(i, '射击之星', 'bear', 2);
    }
    // 十字星：实体极小
    if (bp < 0.1 && range(c) > 0) push(i, '十字星', 'neutral', 1);
    // 大阳线 / 大阴线：实体占振幅 ≥ minBody 且振幅可观
    if (bp >= minBody) {
      if (isUp(c)) push(i, '大阳线', 'bull', 1);
      else push(i, '大阴线', 'bear', 1);
    }

    // ---------------- 两根 ----------------
    const bUp = isUp(b);
    const cUp = isUp(c);
    const bBody = body(b);
    const cBody = body(c);
    // 看涨吞没：前阴后阳，阳线实体完全包住前阴线实体
    if (!bUp && cUp && c.close > b.open && c.open < b.close && cBody > bBody * 1.05)
      push(i, '看涨吞没', 'bull', 3);
    // 看跌吞没
    if (bUp && !cUp && c.open > b.close && c.close < b.open && cBody > bBody * 1.05)
      push(i, '看跌吞没', 'bear', 3);
    // 乌云盖顶：前阳后开高收低，收盘跌破前阳线实体中点
    if (bUp && !cUp && c.open > b.high && c.close < (b.open + b.close) / 2 && c.close > b.open)
      push(i, '乌云盖顶', 'bear', 2);
    // 曙光初现：前阴后开低收高，收盘升破前阴线实体中点
    if (!bUp && cUp && c.open < b.low && c.close > (b.open + b.close) / 2 && c.close < b.open)
      push(i, '曙光初现', 'bull', 2);
    // 孕线：后一根完全被前一根实体包住
    if (Math.max(c.open, c.close) < Math.max(b.open, b.close) &&
        Math.min(c.open, c.close) > Math.min(b.open, b.close) && body(b) > body(c) * 1.5)
      push(i, '孕线(变盘前夕)', 'neutral', 1);

    // ---------------- 三根 ----------------
    // 早晨之星：大阴 → 小实体（跳空）→ 大阳
    if (!isUp(a) && bodyPct(a) > 0.5 && bodyPct(b) < 0.4 &&
        isUp(c) && c.close > (a.open + a.close) / 2)
      push(i, '早晨之星', 'bull', 3);
    // 黄昏之星：大阳 → 小实体 → 大阴
    if (isUp(a) && bodyPct(a) > 0.5 && bodyPct(b) < 0.4 &&
        !isUp(c) && c.close < (a.open + a.close) / 2)
      push(i, '黄昏之星', 'bear', 3);
    // 红三兵：三连阳且依次走高
    if (isUp(a) && isUp(b) && isUp(c) &&
        b.close > a.close && c.close > b.close &&
        bodyPct(a) > 0.4 && bodyPct(b) > 0.4 && bodyPct(c) > 0.4)
      push(i, '红三兵', 'bull', 2);
    // 三只乌鸦：三连阴且依次走低
    if (!isUp(a) && !isUp(b) && !isUp(c) &&
        b.close < a.close && c.close < b.close &&
        bodyPct(a) > 0.4 && bodyPct(b) > 0.4 && bodyPct(c) > 0.4)
      push(i, '三只乌鸦', 'bear', 2);
  }

  return out;
}

/** 最近 N 根内的形态摘要 */
function recent(points, bars, lookback) {
  lookback = lookback || 30;
  const n = bars.length;
  const from = Math.max(0, n - lookback);
  return points.filter((p) => p.index >= from);
}

module.exports = { detect, recent };
