'use strict';
/**
 * backtest.js —— A 股策略回测引擎
 *
 * 与通用版的三处关键差异（决定了回测结果是否可信）：
 *
 * 1. T+1：当日买入的股份当日不可卖出（A 股硬规则）
 * 2. 涨跌停：开盘一字涨停买不进、开盘一字跌停卖不出，信号顺延
 * 3. 费率：佣金（双边，最低 5 元）+ 印花税（卖出单边）+ 过户费（沪市双边）
 *
 * 防未来函数：第 i 根 K 线收盘产生信号 → 第 i+1 根开盘成交
 */
const I = require('./indicators');

const STRATEGIES = {
  ma_cross: {
    name: '双均线交叉',
    desc: '短期均线上穿长期均线买入，下穿卖出。最经典的趋势跟踪。',
    params: [
      { key: 'fast', label: '快线', def: 5, min: 2, max: 60 },
      { key: 'slow', label: '慢线', def: 20, min: 5, max: 200 },
    ],
  },
  macd: {
    name: 'MACD 金叉',
    desc: 'DIF 上穿 DEA 买入，下穿卖出。对中期趋势拐点敏感。',
    params: [
      { key: 'fast', label: '快线', def: 12, min: 2, max: 30 },
      { key: 'slow', label: '慢线', def: 26, min: 5, max: 60 },
      { key: 'signal', label: '信号线', def: 9, min: 2, max: 30 },
    ],
  },
  rsi: {
    name: 'RSI 超卖反弹',
    desc: 'RSI 跌破超卖线买入，升破超买线卖出。震荡市有效，单边牛市易踏空。',
    params: [
      { key: 'period', label: '周期', def: 14, min: 5, max: 30 },
      { key: 'oversold', label: '超卖线', def: 30, min: 10, max: 45 },
      { key: 'overbought', label: '超买线', def: 70, min: 55, max: 90 },
    ],
  },
  boll: {
    name: '布林带回归',
    desc: '跌破下轨买入，回到中轨卖出。押注均值回归。',
    params: [
      { key: 'n', label: '周期', def: 20, min: 5, max: 60 },
      { key: 'k', label: '倍数', def: 2, min: 1, max: 3, step: 0.1 },
    ],
  },
  momentum: {
    name: '动量突破',
    desc: 'N 日动量转正且站上均线买入，动量转负卖出。追涨型策略。',
    params: [
      { key: 'n', label: '动量周期', def: 20, min: 5, max: 120 },
      { key: 'ma', label: '过滤均线', def: 60, min: 0, max: 200 },
    ],
  },
  turtle: {
    name: '海龟突破',
    desc: '突破 N 日最高价买入，跌破 M 日最低价卖出。捕捉大趋势。',
    params: [
      { key: 'in', label: '入场周期', def: 20, min: 5, max: 120 },
      { key: 'out', label: '出场周期', def: 10, min: 3, max: 60 },
    ],
  },
  limit_up: {
    name: '首板追击',
    desc: '【A股特有】首次涨停后次日开盘买入，持有 N 日或跌破 5 日线卖出。赌题材延续，波动大。',
    params: [
      { key: 'hold', label: '最长持有', def: 5, min: 1, max: 30 },
      { key: 'ma', label: '止损均线', def: 5, min: 0, max: 60 },
    ],
  },
  buy_hold: {
    name: '买入持有（基准）',
    desc: '首日买入并一直持有，作为策略对比基准。',
    params: [],
  },
};

function defaultParams(strategy) {
  const s = STRATEGIES[strategy];
  if (!s) return {};
  const out = {};
  for (const p of s.params) out[p.key] = p.def;
  return out;
}

function diffDays(a, b) {
  if (!a || !b) return 0;
  const d1 = new Date(a), d2 = new Date(b);
  return Math.round((d2 - d1) / 86400000);
}

/** 归一化为 {date, open, high, low, close, volume} */
function normBars(bars) {
  return bars.map((b) => ({
    date: b.date || b.t,
    open: b.open != null ? b.open : b.o,
    high: b.high != null ? b.high : b.h,
    low: b.low != null ? b.low : b.l,
    close: b.close != null ? b.close : b.c,
    volume: b.volume != null ? b.volume : (b.v || 0),
  }));
}

function buildSignals(B, strategy, p) {
  const closes = B.map((b) => b.close);
  const highs = B.map((b) => b.high);
  const lows = B.map((b) => b.low);
  const sig = new Array(B.length).fill(null);

  if (strategy === 'buy_hold') {
    if (B.length > 1) sig[0] = 'buy';
    return sig;
  }

  if (strategy === 'ma_cross') {
    const f = I.sma(closes, p.fast);
    const s = I.sma(closes, p.slow);
    for (let i = 1; i < B.length; i++) {
      if (f[i] == null || s[i] == null || f[i - 1] == null || s[i - 1] == null) continue;
      if (f[i - 1] <= s[i - 1] && f[i] > s[i]) sig[i] = 'buy';
      else if (f[i - 1] >= s[i - 1] && f[i] < s[i]) sig[i] = 'sell';
    }
    return sig;
  }

  if (strategy === 'macd') {
    const m = I.macd(closes, p.fast, p.slow, p.signal);
    for (let i = 1; i < B.length; i++) {
      const prev = m.hist[i - 1], cur = m.hist[i];
      if (prev == null || cur == null) continue;
      if (prev <= 0 && cur > 0) sig[i] = 'buy';
      else if (prev >= 0 && cur < 0) sig[i] = 'sell';
    }
    return sig;
  }

  if (strategy === 'rsi') {
    const r = I.rsi(closes, p.period);
    for (let i = 1; i < B.length; i++) {
      if (r[i] == null) continue;
      if (r[i] < p.oversold) sig[i] = 'buy';
      else if (r[i] > p.overbought) sig[i] = 'sell';
    }
    return sig;
  }

  if (strategy === 'boll') {
    const b = I.boll(closes, p.n, p.k);
    for (let i = 1; i < B.length; i++) {
      if (b.mid[i] == null) continue;
      if (closes[i] < b.lower[i]) sig[i] = 'buy';
      else if (closes[i] > b.mid[i]) sig[i] = 'sell';
    }
    return sig;
  }

  if (strategy === 'momentum') {
    const ma = p.ma > 0 ? I.sma(closes, p.ma) : null;
    for (let i = p.n; i < B.length; i++) {
      const mom = closes[i] / closes[i - p.n] - 1;
      const above = !ma || ma[i] == null || closes[i] > ma[i];
      if (mom > 0 && above) sig[i] = 'buy';
      else if (mom < 0) sig[i] = 'sell';
    }
    return sig;
  }

  if (strategy === 'turtle') {
    for (let i = Math.max(p.in, p.out); i < B.length; i++) {
      const hi = Math.max(...highs.slice(i - p.in, i));
      const lo = Math.min(...lows.slice(i - p.out, i));
      if (closes[i] > hi) sig[i] = 'buy';
      else if (closes[i] < lo) sig[i] = 'sell';
    }
    return sig;
  }

  if (strategy === 'limit_up') {
    // 需要一个涨跌停幅度估计：用全样本的分位数近似（无法知道每只股票的确切板块时用 10%）
    const limit = p.limitPct || 10;
    for (let i = 1; i < B.length; i++) {
      const chg = (closes[i] / closes[i - 1] - 1) * 100;
      const prevChg = i >= 2 ? (closes[i - 1] / closes[i - 2] - 1) * 100 : 0;
      // 首板：当天涨停，且前一天没涨停
      if (chg >= limit - 0.6 && prevChg < limit - 0.6) sig[i] = 'buy';
    }
    return sig;
  }

  return sig;
}

/**
 * 运行回测
 * @param {Object} opt
 * @param {Array}  opt.bars
 * @param {String} opt.strategy
 * @param {Object} opt.params
 * @param {Number} opt.initialCapital
 * @param {Number} opt.commission   佣金费率（双边）
 * @param {Number} opt.stampTax     印花税（卖出单边）
 * @param {Number} opt.transferFee  过户费（双边，沪市）
 * @param {Number} opt.slippage     滑点
 * @param {Number} opt.limitPct     涨跌停幅度（%），0 表示不做涨跌停约束
 */
function run(opt) {
  const {
    bars,
    strategy = 'ma_cross',
    params = {},
    initialCapital = 100000,
    commission = 0.00025,
    stampTax = 0.0005,
    transferFee = 0.00001,
    slippage = 0.001,
    limitPct = 10,
  } = opt;

  if (!bars || bars.length < 30) return { error: 'K线数据不足（至少需要 30 根）' };

  const B = normBars(bars);
  const p = { ...defaultParams(strategy), ...params };
  if (strategy === 'limit_up') p.limitPct = limitPct;
  const sig = buildSignals(B, strategy, p);

  let cash = initialCapital;
  let shares = 0;
  let entryPrice = 0;
  let entryDate = null;
  let entryIdx = -1;
  const trades = [];
  const equity = [];
  let peak = initialCapital;
  let maxDD = 0;
  let blockedByLimit = 0;   // 因涨跌停无法成交的次数
  let blockedByT1 = 0;

  const buyFee = (amount) => Math.max(5, amount * commission) + amount * transferFee;
  const sellFee = (amount) => Math.max(5, amount * commission) + amount * stampTax + amount * transferFee;

  for (let i = 1; i < B.length; i++) {
    const act = sig[i - 1];               // 昨日收盘信号 → 今日开盘成交
    const openPx = B[i].open;
    const prevClose = B[i - 1].close;
    if (!(openPx > 0) || !(prevClose > 0)) {
      equity.push({ date: B[i].date, value: cash + shares * B[i].close, position: shares > 0 });
      continue;
    }

    // 开盘涨跌停判定（一字板无法成交）
    const openChg = (openPx / prevClose - 1) * 100;
    const isOpenUpLimit = limitPct > 0 && openChg >= limitPct - 0.4;
    const isOpenDownLimit = limitPct > 0 && openChg <= -(limitPct - 0.4);

    if (act === 'buy' && shares === 0) {
      if (isOpenUpLimit) {
        blockedByLimit++;                  // 一字涨停，买不进
      } else {
        const px = openPx * (1 + slippage);
        const fee = buyFee(px * 1);
        const n = Math.floor((cash - 5) / (px * (1 + commission + transferFee)));
        const cost = n * px + Math.max(5, n * px * commission) + n * px * transferFee;
        if (n > 0 && cost <= cash) {
          shares = n;
          cash -= cost;
          entryPrice = px;
          entryDate = B[i].date;
          entryIdx = i;
          trades.push({
            date: B[i].date, type: 'buy', price: px, shares: n,
            amount: n * px, fee: Math.max(5, n * px * commission) + n * px * transferFee,
          });
        }
      }
    } else if (act === 'sell' && shares > 0) {
      // T+1：当日买入不可卖出
      if (i <= entryIdx) {
        blockedByT1++;
      } else if (isOpenDownLimit) {
        blockedByLimit++;                  // 一字跌停，卖不出（信号顺延到下一日）
      } else {
        const px = openPx * (1 - slippage);
        const amount = shares * px;
        const fee = sellFee(amount);
        cash += amount - fee;
        const buyTrade = trades[trades.length - 1];
        const profit = (px - entryPrice) * shares - fee - (buyTrade && buyTrade.type === 'buy' ? buyTrade.fee : 0);
        trades.push({
          date: B[i].date, type: 'sell', price: px, shares, amount, fee,
          profit,
          profitPct: ((px - entryPrice) / entryPrice) * 100,
          holdDays: entryDate ? diffDays(entryDate, B[i].date) : null,
        });
        shares = 0;
        entryPrice = 0;
        entryDate = null;
        entryIdx = -1;
      }
    }

    // 首板策略：达到最长持有天数或跌破止损均线则次日卖出
    if (strategy === 'limit_up' && shares > 0 && i > entryIdx) {
      const held = i - entryIdx;
      let exit = false;
      if (p.hold > 0 && held >= p.hold) exit = true;
      if (!exit && p.ma > 0) {
        const ma = I.sma(B.map((b) => b.close), p.ma);
        if (ma[i] != null && B[i].close < ma[i]) exit = true;
      }
      if (exit && !isOpenDownLimit) {
        const px = B[i].close * (1 - slippage);
        const amount = shares * px;
        const fee = sellFee(amount);
        cash += amount - fee;
        const buyTrade = trades[trades.length - 1];
        const profit = (px - entryPrice) * shares - fee - (buyTrade && buyTrade.type === 'buy' ? buyTrade.fee : 0);
        trades.push({
          date: B[i].date, type: 'sell', price: px, shares, amount, fee,
          profit,
          profitPct: ((px - entryPrice) / entryPrice) * 100,
          holdDays: entryDate ? diffDays(entryDate, B[i].date) : null,
          reason: '到期/破线',
        });
        shares = 0;
        entryPrice = 0;
        entryDate = null;
        entryIdx = -1;
      }
    }

    const value = cash + shares * B[i].close;
    equity.push({ date: B[i].date, value, position: shares > 0 });
    if (value > peak) peak = value;
    const dd = (peak - value) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // 期末按收盘价强制平仓
  const last = B[B.length - 1];
  if (shares > 0) {
    const px = last.close * (1 - slippage);
    const amount = shares * px;
    const fee = sellFee(amount);
    cash += amount - fee;
    const buyTrade = trades[trades.length - 1];
    const profit = (px - entryPrice) * shares - fee - (buyTrade && buyTrade.type === 'buy' ? buyTrade.fee : 0);
    trades.push({
      date: last.date, type: 'sell', price: px, shares, amount, fee,
      profit,
      profitPct: ((px - entryPrice) / entryPrice) * 100,
      holdDays: entryDate ? diffDays(entryDate, last.date) : null,
      forced: true,
    });
    shares = 0;
  }

  const finalCapital = cash;
  const totalReturn = ((finalCapital - initialCapital) / initialCapital) * 100;
  const days = diffDays(B[0].date, last.date) || B.length;
  const years = Math.max(days / 252, 0.02);
  const annualized = (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100;

  const rets = [];
  for (let i = 1; i < equity.length; i++) rets.push(equity[i].value / equity[i - 1].value - 1);
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length > 1 ? rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1) : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

  // 交易统计
  const sells = trades.filter((t) => t.type === 'sell');
  const wins = sells.filter((t) => (t.profit || 0) > 0);
  const losses = sells.filter((t) => (t.profit || 0) <= 0);
  const grossWin = wins.reduce((a, t) => a + (t.profit || 0), 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + (t.profit || 0), 0));
  const avgHold = sells.length
    ? sells.reduce((a, t) => a + (t.holdDays || 0), 0) / sells.length
    : 0;

  // 相对基准（买入持有）
  const bhReturn = ((last.close / B[0].close) - 1) * 100;

  return {
    strategy,
    strategyName: STRATEGIES[strategy] ? STRATEGIES[strategy].name : strategy,
    initialCapital,
    finalCapital,
    totalReturn: Math.round(totalReturn * 100) / 100,
    annualized: Math.round(annualized * 100) / 100,
    maxDrawdown: Math.round(maxDD * 10000) / 100,
    sharpe: Math.round(sharpe * 100) / 100,
    trades: trades,
    tradeCount: sells.length,
    winRate: sells.length ? Math.round((wins.length / sells.length) * 1000) / 10 : 0,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : (grossWin > 0 ? 99 : 0),
    avgHoldDays: Math.round(avgHold * 10) / 10,
    equity,
    buyHoldReturn: Math.round(bhReturn * 100) / 100,
    excessReturn: Math.round((totalReturn - bhReturn) * 100) / 100,
    blockedByLimit,
    blockedByT1,
    startDate: B[0].date,
    endDate: last.date,
  };
}

module.exports = { STRATEGIES, run, defaultParams };
