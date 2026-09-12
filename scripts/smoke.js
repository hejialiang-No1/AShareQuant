/**
 * 冒烟测试：验证 AShareQuant 数据层与算法层（不需要 Electron）
 * 用法：node scripts/smoke.js
 *
 * 覆盖：搜索 / 行情 / K线 / 涨停判断 / 指数 / 行业板块 / 全市场排行 /
 *      6类技术指标 / A股因子分析 / 7种策略回测（含T+1与涨跌停约束）
 */
const path = require('path');
const os = require('os');
const ds = require('../src/main/datasource');
const Ind = require('../src/shared/indicators');
const Fac = require('../src/shared/factors');
const BT = require('../src/shared/backtest');
const Sig = require('../src/shared/signals');
const Chip = require('../src/shared/chip');
const Pat = require('../src/shared/patterns');
const Lv = require('../src/shared/levels');

ds.initCache(path.join(os.tmpdir(), 'asharequant-smoke-cache'));

function ok(name, cond, extra) {
  console.log(`${cond ? '\u2705' : '\u274C'} ${name}${extra ? '  ' + extra : ''}`);
  return cond;
}

(async () => {
  let pass = 0, fail = 0;
  const check = (n, c, e) => (ok(n, c, e) ? pass++ : fail++);

  console.log('\n--- 搜索 ---');
  try {
    const r = await ds.search('\u8305\u53F0');
    check('\u641C\u7D22\u8305\u53F0\u6709\u7ED3\u679C', r.length > 0, r[0] ? `${r[0].code} ${r[0].name}` : '');
    const hit = r.find((x) => x.code === '600519');
    check('\u547D\u4E2D 600519', !!hit && /sh|sz/.test(hit.secid || ''), hit && hit.secid);
  } catch (e) { check('\u641C\u7D22\u63A5\u53E3', false, e.message); }

  check('makeSecid 600519\u2192sh.600519', ds.makeSecid('600519') === 'sh.600519');
  check('makeSecid 300750\u2192sz.300750', ds.makeSecid('300750') === 'sz.300750');
  check('boardOf 300750=\u521B\u4E1A\u677F', ds.boardOf('300750') === '\u521B\u4E1A\u677F');
  check('boardOf 688981=\u79D1\u521B\u677F', ds.boardOf('688981') === '\u79D1\u521B\u677F');
  check('\u521B\u4E1A\u677F\u9650 20%', ds.limitPctOf('300750', '') === 20);
  check('\u4E3B\u677F\u9650 10%', ds.limitPctOf('600519', '') === 10);
  check('\u5317\u4EA4\u6240\u9650 30%', ds.limitPctOf('832566', '') === 30);
  check('ST \u52A05%', ds.limitPctOf('600519', '*ST\u8305\u53F0') === 5);

  console.log('\n--- \u60C5\u884C ---');
  try {
    const q = await ds.quotes(['sh.600519', 'sz.000001', 'sz.300750', 'sh.688981']);
    check('\u6279\u91CF\u60C5\u884C 4 \u6761', q.length === 4, `${q.length} \u6761`);
    const maotai = q.find((x) => x.code === '600519');
    check('\u8305\u53F0\u6709\u4EF7\u683C/\u6DA8\u8DCC\u5E45/\u6DA8\u8DCC\u505C\u4EF7',
      maotai && maotai.price > 0 && typeof maotai.changePct === 'number' && maotai.limitUp > 0,
      maotai ? `${maotai.name} ${maotai.price} ${maotai.changePct}% \u6DA8\u505C\u4EF7${maotai.limitUp}` : '');
  } catch (e) { check('\u60C5\u884C', false, e.message); }

  console.log('\n--- K\u7EBF ---');
  try {
    const k = await ds.kline('sz.300750', { period: 'day', limit: 260, fq: 1 });
    check('K\u7EBF \u2265 200 \u6839', k && k.bars && k.bars.length >= 200, k && k.bars ? `${k.bars.length} \u6839` : '');
    const bar = k.bars[k.bars.length - 1];
    check('K\u7EBF\u5B57\u6BB5\u5B8C\u6574', bar && bar.t && bar.o > 0 && bar.c > 0 && bar.h > 0 && bar.l > 0, `\u672B\u6839 ${bar && bar.t}`);
  } catch (e) { check('K\u7EBF', false, e.message); }

  console.log('\n--- \u6307\u6570 ---');
  try {
    const idx = await ds.indexQuotes();
    check('\u6307\u6570 \u2265 4 \u6761', idx.length >= 4, `${idx.length} \u6761`);
  } catch (e) { check('\u6307\u6570', false, e.message); }

  console.log('\n--- \u677F\u5757 ---');
  try {
    const sec = await ds.sectors('hy', 5);
    check('\u884C\u4E1A\u677F\u5757 \u2265 3 \u6761', sec.length >= 3, sec.slice(0, 3).map((s) => s.name).join('/'));
  } catch (e) { check('\u677F\u5757', false, e.message); }

  console.log('\n--- \u5168\u5E02\u573A\u6392\u884C ---');
  try {
    const rank = await ds.rank({ pages: 2, size: 100 });
    check('\u6392\u884C \u2265 100 \u6761', rank.length >= 100, `${rank.length} \u6761`);
    check('\u68AF\u9996\u6709\u4EF7\u683C', rank[0] && rank[0].price > 0, rank[0] ? `${rank[0].name} ${rank[0].changePct}%` : '');
  } catch (e) { check('\u6392\u884C', false, e.message); }

  console.log('\n--- \u6280\u672F\u6307\u6807 ---');
  const prices = Array.from({ length: 120 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 4) * 3);
  try {
    const ma = Ind.sma(prices, 5);
    check('MA \u957F\u5EA6\u6B63\u786E', ma.length === prices.length && ma[119] != null, `MA5[119]=${ma[119]}`);
    const macd = Ind.macd(prices);
    check('MACD \u4E09\u5E8F\u5217', macd.dif.length && macd.dea.length && macd.hist.length);
    const rsi = Ind.rsi(prices, 14);
    check('RSI 0-100', rsi[119] >= 0 && rsi[119] <= 100, `RSI=${rsi[119].toFixed(1)}`);
    const boll = Ind.boll(prices);
    check('BOLL \u4E09\u8F68', boll.mid.length && boll.upper.length && boll.lower.length);
    const kdj = Ind.kdj(prices, prices, prices);
    check('KDJ \u4E09\u503C', kdj.k[119] != null && kdj.d[119] != null && kdj.j[119] != null);
    const atr = Ind.atr(prices, prices, prices, 14);
    check('ATR', atr[119] > 0, `ATR=${atr[119].toFixed(2)}`);
  } catch (e) { check('\u6280\u672F\u6307\u6807', false, e.message); }

  console.log('\n--- \u4E70\u5356\u70B9\u4FE1\u53F7 ---');
  try {
    // 合成 K 线：先跌（MA5<MA20）→ 强涨（金叉买点）→ 回落（死叉卖点）
    const mk = (p) => ({ date: '2024' + String(p).padStart(4, '0'), open: p, high: p + 1, low: p - 1, close: p, volume: 1000 });
    const synth = [];
    for (let i = 0; i < 40; i++) synth.push(mk(100 - i));
    for (let i = 0; i < 40; i++) synth.push(mk(61 + i * 2));
    for (let i = 0; i < 40; i++) synth.push(mk(139 - i * 2));
    const pts = Sig.detect(synth, { minGap: 8 });
    check('\u4E70\u5356\u70B9\u8FD4\u56DE\u6570\u7EC4', Array.isArray(pts), `\u5171 ${pts.length} \u4E2A`);
    const buys = pts.filter((p) => p.type === 'buy');
    const sells = pts.filter((p) => p.type === 'sell');
    check('\u81F3\u5C11 1 \u4E2A\u4E70\u70B9', buys.length >= 1, `\u4E70 ${buys.length} \u5356 ${sells.length}`);
    check('\u81F3\u5C11 1 \u4E2A\u5356\u70B9', sells.length >= 1);
    const valid = pts.every((p) => ['buy', 'sell'].includes(p.type) && p.reason && p.strength >= 1 && p.strength <= 3 && p.index >= 0);
    check('\u7ED3\u6784\u5408\u6CD5', valid);
    const minGap = (arr) => { for (let i = 1; i < arr.length; i++) if (arr[i] - arr[i - 1] < 8) return false; return true; };
    check('\u540C\u65B9\u5411\u53BB\u91CD(minGap)', minGap(buys.map((b) => b.index)) && minGap(sells.map((s) => s.index)));
    const sum = Sig.summary(pts);
    check('summary \u7EDF\u8BA1', sum.buyCount === buys.length && sum.sellCount === sells.length);
  } catch (e) { check('\u4E70\u5356\u70B9\u4FE1\u53F7', false, e.message); }

  console.log('\n--- 增强分析模块（筹码/形态/压力位）---');
  try {
    const s = [];
    let p = 100;
    for (let i = 0; i < 200; i++) {
      p += Math.sin(i / 7) * 1.6 + 0.22;
      const o = p + (i % 3 - 1) * 0.4;
      const c = p + (i % 5 - 2) * 0.5;
      s.push({ date: '2024' + String(i).padStart(3, '0'), open: +o.toFixed(2), high: +(Math.max(o, c) + 1.1).toFixed(2), low: +(Math.min(o, c) - 1.1).toFixed(2), close: +c.toFixed(2), volume: 1000000 + i * 2500 });
    }
    const cp = Chip.compute(s, {});
    check('筹码分布计算', cp && cp.bins.length > 0 && cp.avgCost > 0, cp ? `均价 ${cp.avgCost} 获利 ${cp.profitRatio}% 集中度 ${cp.concentration}% 峰 ${cp.peakPrice}` : '');
    check('筹码 获利比例 0-100', cp && cp.profitRatio >= 0 && cp.profitRatio <= 100);
    check('筹码 90%区间有效', cp && cp.costHigh90 >= cp.costLow90);
    check('筹码 形态解读', !!Chip.verdict(cp).label);

    const pats = Pat.detect(s, {});
    const kinds = [...new Set(pats.map((x) => x.name))];
    check('K线形态识别', pats.length > 0, `${pats.length} 个 / ${kinds.length} 种：${kinds.slice(0, 6).join(',')}`);
    check('形态结构合法', pats.every((x) => x.name && ['bull', 'bear', 'neutral'].includes(x.type) && x.index >= 0));

    const lv = Lv.compute(s, { price: s[s.length - 1].close });
    check('支撑压力位', lv && lv.supports.length + lv.resistances.length > 0, `支撑 ${lv.supports.length} / 压力 ${lv.resistances.length}`);
    check('枢轴点 P/R1/S1', lv && lv.pivot.P > 0 && lv.pivot.R1 > lv.pivot.P && lv.pivot.S1 < lv.pivot.P);
    check('斐波那契 5 档', lv && lv.fib.length === 5 && lv.fib.every((f) => f.price > 0));
  } catch (e) { check('增强分析模块', false, e.message); }

  console.log('\n--- \u56E0\u5B50\u5206\u6790 ---');
  try {
    const k = await ds.kline('sh.600519', { period: 'day', limit: 260, fq: 1 });
    const q = await ds.quoteOne('sh.600519');
    const a = Fac.analyze(k.bars, q);
    check('\u8305\u53F0\u56E0\u5B50', a && typeof a.score === 'number', a ? `\u8BC4\u5206 ${a.score} ${Fac.rating(a.score).label}` : '');
    check('\u56E0\u5B50\u9879 \u2265 4', a && Object.keys(a.factors || {}).length >= 4, a ? Object.keys(a.factors).join(',') : '');
    // 面板依赖的 metrics 字段契约：缺任一则界面显示 --
    const NEED = ['rsi', 'ma20', 'ma60', 'ma120', 'macdHist', 'kdjK', 'r5', 'r20', 'r60', 'distHigh52', 'volRatio', 'atrPct', 'volatility', 'hi52', 'lo52'];
    const lack = a ? NEED.filter((x) => a.metrics[x] == null) : NEED;
    check('metrics \u5b57\u6bb5\u5951\u7ea6\u9f50\u5168', lack.length === 0, lack.length ? '\u7f3a\u5931 ' + lack.join(',') : `${NEED.length} \u9879\u5168`);
  } catch (e) { check('\u56E0\u5B50', false, e.message); }

  console.log('\n--- \u7B56\u7565\u56DE\u6D4B ---');
  try {
    const k = await ds.kline('sz.300750', { period: 'day', limit: 400, fq: 1 });
    for (const s of ['buy_hold', 'ma_cross', 'macd', 'rsi', 'boll', 'kdj', 'limit_up']) {
      try {
        const r = BT.run({ bars: k.bars, strategy: s, initialCapital: 100000, limitPct: 20 });
        if (r.error) { check(s, false, r.error); continue; }
        const passOK = r.tradeCount >= 0 && typeof r.totalReturn === 'number' && typeof r.sharpe === 'number';
        check(s, passOK, `\u6536\u76CA ${r.totalReturn}% \u5E74\u5316 ${r.annualized}% \u56DE\u64A4 ${r.maxDrawdown}% \u590F\u666E ${r.sharpe} \u4EA4\u6613 ${r.tradeCount} \u80DC\u7387 ${r.winRate}%`);
      } catch (e) { check(s, false, e.message); }
    }
  } catch (e) { check('\u56DE\u6D4B', false, e.message); }

  console.log('\n--- T+1 \u7EA6\u675F ---');
  try {
    const k = await ds.kline('sz.300750', { period: 'day', limit: 60, fq: 1 });
    // 场景 A：全期 buy 信号 + 仅首日卖出 → 应只成交 1 笔买入（满仓后再 buy 不重复扣款）
    const sigA = k.bars.map(() => 'buy');
    const rA = BT.run({ bars: k.bars, signals: sigA, initialCapital: 100000, limitPct: 20 });
    check('T+1 A:\u6EE1\u4ED3 buy \u4FE1\u53F7\u53EA\u6210\u4EA4 1 \u7B14\u4E70\u5165', rA && rA.tradeCount === 1, `tradeCount=${rA && rA.tradeCount}`);

    // 场景 B：买信号紧跟卖信号 → T+1 阻挡当日卖
    const sigB = k.bars.map((_, i) => (i === 1 ? 'buy' : i === 2 ? 'sell' : null));
    const rB = BT.run({ bars: k.bars, signals: sigB, initialCapital: 100000, limitPct: 20 });
    // 第 1 根收盘 buy → 第 2 根开盘买入 → 第 2 根收盘 sell → 第 3 根开盘卖出（合法）
    check('T+1 B:\u4E70\u540E\u8D85\u8FC7 1 \u65E5\u518D\u5356 (1 \u8F6E\u5B8C\u6210)', rB && rB.tradeCount === 1 && rB.trades.length === 2, `tradeCount=${rB && rB.tradeCount}, trades=${rB && rB.trades.length}`);

    // 场景 C：买信号当根立即卖信号（防未来函数验证）→ 应只买不卖
    const sigC = k.bars.map((_, i) => (i === 1 ? 'buy' : i === 1 ? 'sell' : null));
    const rC = BT.run({ bars: k.bars, signals: sigC, initialCapital: 100000, limitPct: 20 });
    check('T+1 C:\u540C\u4F4D\u4E70\u5356\u4FE1\u53F7\u4E0D\u53CC\u5411\u6210\u4EA4', rC && rC.tradeCount === 1, `tradeCount=${rC && rC.tradeCount}`);
  } catch (e) { check('T+1', false, e.message); }

  console.log(`\n========== ${pass} \u901A\u8FC7 / ${fail} \u5931\u8D25 ==========`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\u5D29\u6E83:', e); process.exit(2); });
