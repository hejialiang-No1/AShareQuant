/**
 * main-smoke.js —— 主进程无头自检（不开 GUI）
 *
 * 模拟 main.js 的核心流程：加载 datasource、跑一次因子分析与回测，
 * 验证主进程上下文下 require('electron') 正常、数据层与算法层协作无误。
 *
 * 用法：node scripts/main-smoke.js
 * （需要 electron 运行时，正常在本机或 CI 的 macOS 环境执行）
 */
const electron = require('electron');
const { app } = electron;

const path = require('path');
const os = require('os');
const ds = require('../src/main/datasource');
const { Store } = require('../src/main/store');
const Factors = require('../src/shared/factors');
const Backtest = require('../src/shared/backtest');
const { POOL } = require('../src/main/pool');

ds.initCache(path.join(os.tmpdir(), 'asharequant-mainsmoke'));

function ok(n, c, e) {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? '  ' + e : ''}`);
}

app.whenReady().then(async () => {
  console.log('Electron 主进程 ready，versions=' + JSON.stringify({
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  }));

  // 数据层
  try {
    const q = await ds.quoteOne('sh.600519');
    ok('主进程下 贵州茅台 行情', !!q && q.price > 0, `${q.name} ${q.price} 涨跌停价${q.limitUp} src=${q.src}`);
  } catch (e) {
    ok('主进程下 茅台行情', false, e.message);
  }

  try {
    const k = await ds.kline('sh.600519', { period: 'day', limit: 200, fq: 1 });
    ok('主进程下 茅台 K线', !!k && k.bars.length > 100, `${k.bars.length} 根 src=${k.src}`);
    const q = await ds.quoteOne('sh.600519');
    const a = Factors.analyze(k.bars, q);
    ok('主进程下因子分析', !!a && typeof a.score === 'number', `评分 ${a.score} ${Factors.rating(a.score).label}`);
    const bt = Backtest.run({ bars: k.bars, strategy: 'ma_cross', initialCapital: 100000, limitPct: 10 });
    ok('主进程下回测', !bt.error, `收益 ${bt.totalReturn}% 回撤 ${bt.maxDrawdown}% 交易 ${bt.tradeCount}`);
  } catch (e) {
    ok('主进程下 K线/算法', false, e.message);
  }

  // 持久化
  try {
    const tmpFile = path.join(os.tmpdir(), 'asharequant-store-smoke.json');
    const s1 = new Store(tmpFile);
    s1.set('watchlist', [{ secid: 'sh.600519', code: '600519', name: '贵州茅台' }]);
    const s2 = new Store(tmpFile);
    const wl = s2.get('watchlist');
    ok('Store 持久化', Array.isArray(wl) && wl[0].code === '600519', `${wl.length} 项`);
  } catch (e) {
    ok('Store', false, e.message);
  }

  // 内置池
  ok('POOL 加载', POOL.length > 100, `${POOL.length} 只股票`);

  console.log('\n==> 主进程自检完成');
  app.exit(0);
});
