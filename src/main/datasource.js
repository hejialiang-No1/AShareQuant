'use strict';
/**
 * A 股数据层 —— 腾讯(主) / 新浪(备) 双源自动降级
 *
 * 为什么不用东财：push2 系列接口对部分网络环境会被拦截（返回空），
 * 而腾讯 qt.gtimg.cn / 新浪 vip.stock.finance.sina.com.cn 在国内直连稳定。
 *
 * 腾讯优势：字段全（含涨停价/跌停价、量比、换手、PE/PB、市值）
 * 新浪优势：全市场排行扫描（Market_Center 支持分页 + 排序 + 板块筛选）
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- 常量

const MARKET = { SH: 'sh', SZ: 'sz', BJ: 'bj' };
const MARKET_NAME = { sh: '沪市', sz: '深市', bj: '北交所' };

/** A股代码 → 市场前缀 */
function marketOfCode(code) {
  const c = String(code || '').replace(/\D/g, '');
  if (/^6/.test(c)) return MARKET.SH;       // 60 主板 / 68 科创板
  if (/^9/.test(c)) return MARKET.SH;       // 900 B股
  if (/^5/.test(c)) return MARKET.SH;       // 基金/ETF
  if (/^[03]/.test(c)) return MARKET.SZ;    // 00 主板 / 30 创业板
  if (/^1/.test(c)) return MARKET.SZ;       // 15/16/18 基金
  if (/^(43|83|87|88|92)/.test(c)) return MARKET.BJ; // 北交所
  return MARKET.SH;
}

/** 生成 secid: 'sh.600519' */
function makeSecid(code, market) {
  return `${market || marketOfCode(code)}.${String(code)}`;
}
const codeOf = (secid) => String(secid || '').split('.')[1] || '';
const marketOf = (secid) => String(secid || '').split('.')[0] || MARKET.SH;

/** 板块判定：主板 / 创业板 / 科创板 / 北交所 */
function boardOf(code) {
  const c = String(code || '').replace(/\D/g, '');
  if (/^30/.test(c)) return '创业板';
  if (/^68/.test(c)) return '科创板';
  if (/^(43|83|87|88|92)/.test(c)) return '北交所';
  if (/^0/.test(c)) return '深主板';
  if (/^6/.test(c)) return '沪主板';
  return '其他';
}

/** 涨跌停幅度（%）：主板10 / 创业板科创板20 / 北交所30 / ST股5 */
function limitPctOf(code, name) {
  const b = boardOf(code);
  const isST = /ST/i.test(String(name || ''));
  if (isST) return b === '创业板' || b === '科创板' ? 20 : 5;
  if (b === '创业板' || b === '科创板') return 20;
  if (b === '北交所') return 30;
  return 10;
}

const num = (v) => {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let gbkDecoder = null;
function decodeGbk(buf) {
  try {
    if (!gbkDecoder) gbkDecoder = new TextDecoder('gbk');
    return gbkDecoder.decode(buf);
  } catch {
    return Buffer.from(buf).toString('utf8');
  }
}

// ---------------------------------------------------------------- 请求队列

class RequestQueue {
  constructor({ concurrency = 4, minInterval = 110 } = {}) {
    this.concurrency = concurrency;
    this.minInterval = minInterval;
    this.active = 0;
    this.queue = [];
    this.lastStart = 0;
  }
  async run(task) {
    if (this.active >= this.concurrency) await new Promise((r) => this.queue.push(r));
    this.active++;
    try {
      const w = this.minInterval - (Date.now() - this.lastStart);
      if (w > 0) await sleep(w);
      this.lastStart = Date.now();
      return await task();
    } finally {
      this.active--;
      const n = this.queue.shift();
      if (n) n();
    }
  }
}
const queue = new RequestQueue({ concurrency: 4, minInterval: 110 });

async function httpGet(url, { timeout = 15000, retries = 1, headers, raw = false } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const buf = await queue.run(async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        try {
          const res = await fetch(url, {
            signal: ctrl.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
              ...headers,
            },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const ab = await res.arrayBuffer();
          return Buffer.from(ab);
        } finally {
          clearTimeout(timer);
        }
      });
      if (!buf || !buf.length) throw new Error('empty response');
      return raw ? buf : buf.toString('utf8');
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

async function httpGbk(url, opts) {
  const buf = await httpGet(url, { ...opts, raw: true });
  return decodeGbk(buf);
}
async function httpJson(url, opts) {
  const txt = await httpGet(url, opts);
  try { return JSON.parse(txt); } catch { return null; }
}

// ---------------------------------------------------------------- 源健康度

const PROVIDERS = ['tx', 'sina'];
const health = { tx: { fail: 0, until: 0 }, sina: { fail: 0, until: 0 } };

function providerOrder() {
  const now = Date.now();
  return PROVIDERS.slice().sort((a, b) => {
    const ha = health[a], hb = health[b];
    const da = ha.until > now ? 1 : 0, db = hb.until > now ? 1 : 0;
    if (da !== db) return da - db;
    return ha.fail - hb.fail;
  });
}
function markOk(p) { health[p].fail = 0; health[p].until = 0; }
function markFail(p) {
  health[p].fail++;
  health[p].until = Date.now() + Math.min(120000, 15000 * health[p].fail);
}
const activeSource = () => providerOrder()[0];

// ---------------------------------------------------------------- 缓存

let cacheDir = null;
const memCache = new Map();

function initCache(dir) {
  cacheDir = dir;
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
}
function cachePath(key) {
  return cacheDir ? path.join(cacheDir, `${key.replace(/[^a-z0-9._-]/gi, '_')}.json`) : null;
}
function cacheGet(key, ttl) {
  const m = memCache.get(key);
  if (m && Date.now() - m.t < ttl) return m.v;
  const f = cachePath(key);
  if (f) {
    try {
      const st = fs.statSync(f);
      if (Date.now() - st.mtimeMs < ttl) {
        const v = JSON.parse(fs.readFileSync(f, 'utf8'));
        memCache.set(key, { t: st.mtimeMs, v });
        return v;
      }
    } catch { /* miss */ }
  }
  return null;
}
function cacheSet(key, v) {
  memCache.set(key, { t: Date.now(), v });
  const f = cachePath(key);
  if (f) {
    try { fs.writeFileSync(f, JSON.stringify(v)); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------- 腾讯源

const txSymbol = (secid) => `${marketOf(secid)}${codeOf(secid)}`;

/**
 * 腾讯实时行情解析
 * v_sh600519="1~名称~代码~现价~昨收~今开~成交量~..."
 */
function txParse(line) {
  const m = /v_(\w+)="([^"]*)"/.exec(line);
  if (!m) return null;
  const sym = m[1];
  const f = m[2].split('~');
  if (f.length < 50) return null;
  const market = /^sh/.test(sym) ? MARKET.SH : /^sz/.test(sym) ? MARKET.SZ : MARKET.BJ;
  const code = f[2];
  const price = num(f[3]);
  const limitUp = num(f[47]);
  const limitDown = num(f[48]);
  return {
    secid: `${market}.${code}`,
    code, market,
    name: f[1],
    board: boardOf(code),
    price,
    prevClose: num(f[4]),
    open: num(f[5]),
    high: num(f[33]),
    low: num(f[34]),
    change: num(f[31]),
    changePct: num(f[32]),
    volume: num(f[36]),                 // 手
    amount: num(f[37]) * 10000,         // 万 → 元
    turnover: num(f[38]),               // 换手率 %
    pe: num(f[39]),
    pb: num(f[46]),
    circMktCap: num(f[44]),             // 亿
    mktCap: num(f[45]),                 // 亿
    marketCap: num(f[45]),             // 别名，兼容 UI
    limitUp, limitDown,
    limitPct: limitPctOf(code, f[1]),
    volRatio: num(f[49]),               // 量比
    amplitude: num(f[43]),
    avgPrice: num(f[51]),
    suspended: price === 0 || num(f[36]) === 0,
    isLimitUp: limitUp > 0 && price > 0 && price >= limitUp - 1e-6,
    isLimitDown: limitDown > 0 && price > 0 && price <= limitDown + 1e-6,
    updatedAt: f[30],
  };
}

async function txQuotes(secids) {
  if (!secids.length) return [];
  const out = [];
  for (let i = 0; i < secids.length; i += 50) {
    const batch = secids.slice(i, i + 50);
    const q = batch.map(txSymbol).join(',');
    const txt = await httpGbk(`https://qt.gtimg.cn/q=${q}`, { retries: 1 });
    for (const line of txt.split('\n')) {
      const p = txParse(line);
      if (p) out.push(p);
    }
  }
  return out;
}

async function txKline(secid, { period = 'day', limit = 320, fq = 1 } = {}) {
  const sym = txSymbol(secid);
  const fqStr = fq === 1 ? 'qfq' : fq === 2 ? 'hfq' : '';
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},${period},,,${limit},${fqStr}`;
  const j = await httpJson(url, { retries: 1 });
  const node = j && j.data && j.data[sym];
  if (!node) throw new Error('no kline data');
  const key = fqStr ? `${fqStr}${period}` : period;
  const arr = node[key] || node[period] || [];
  // 腾讯格式: [日期, 开, 收, 高, 低, 成交量(手)]
  return arr.map((r) => ({
    t: r[0],
    o: num(r[1]),
    c: num(r[2]),
    h: num(r[3]),
    l: num(r[4]),
    v: num(r[5]),
  })).filter((b) => b.c > 0);
}

async function txSearch(kw, limit = 12) {
  const url = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(kw)}&t=all`;
  const txt = await httpGet(url, { retries: 1 });
  const out = [];
  for (const line of txt.split('\n')) {
    const m = /v_hint="([^"]*)"/.exec(line);
    if (!m) continue;
    // 形如 sh~600519~贵州茅台~gzmt~GP-A
    const f = m[1].split('~');
    if (f.length < 3) continue;
    const market = f[0];
    const code = f[1];
    if (!/^\d{6}$/.test(code)) continue;
    let name = f[2];
    try { name = JSON.parse(`"${name.replace(/"/g, '\\"')}"`); } catch { /* keep */ }
    out.push({
      secid: `${market}.${code}`,
      code, market,
      name,
      board: boardOf(code),
      type: f[4] || '',
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** 腾讯行业/概念/地域板块 */
async function txSectors(type = 'hy', limit = 60) {
  const url = `https://proxy.finance.qq.com/cgi/cgi-bin/rank/pt/getRank?board_type=${type}&sort_type=price&direct=down&offset=0&count=${limit}`;
  const j = await httpJson(url, { retries: 1 });
  const list = j && j.data && j.data.rank_list;
  if (!Array.isArray(list)) throw new Error('no sector data');
  return list.map((s) => ({
    code: s.code,
    name: s.name,
    changePct: num(s.zdf),
    change: num(s.zd),
    turnover: num(s.hsl),
    circMktCap: num(s.ltsz),
    amount: num(s.turnover),
    d5: num(s.zdf_d5),
    d20: num(s.zdf_d20),
    d60: num(s.zdf_d60),
    leader: s.lzg ? { code: s.lzg.code, name: s.lzg.name, changePct: num(s.lzg.zdf) } : null,
  }));
}

// ---------------------------------------------------------------- 新浪源

const sinaSymbol = (secid) => `${marketOf(secid)}${codeOf(secid)}`;

async function sinaQuotes(secids) {
  if (!secids.length) return [];
  const out = [];
  for (let i = 0; i < secids.length; i += 60) {
    const batch = secids.slice(i, i + 60);
    const q = batch.map(sinaSymbol).join(',');
    const txt = await httpGbk(`https://hq.sinajs.cn/list=${q}`, {
      headers: { Referer: 'https://finance.sina.com.cn' },
      retries: 1,
    });
    for (const line of txt.split('\n')) {
      const m = /hq_str_(\w+)="([^"]*)"/.exec(line);
      if (!m) continue;
      const sym = m[1];
      const f = m[2].split(',');
      if (f.length < 10) continue;
      const market = /^sh/.test(sym) ? MARKET.SH : /^sz/.test(sym) ? MARKET.SZ : MARKET.BJ;
      const code = sym.slice(2);
      const price = num(f[3]);
      const prevClose = num(f[2]);
      const limitPct = limitPctOf(code, f[0]);
      const limitUp = +(prevClose * (1 + limitPct / 100)).toFixed(2);
      const limitDown = +(prevClose * (1 - limitPct / 100)).toFixed(2);
      out.push({
        secid: `${market}.${code}`,
        code, market,
        name: f[0],
        board: boardOf(code),
        price, prevClose,
        open: num(f[1]),
        high: num(f[4]),
        low: num(f[5]),
        change: +(price - prevClose).toFixed(2),
        changePct: prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : 0,
        volume: Math.round(num(f[8]) / 100),   // 股 → 手
        amount: num(f[9]),
        turnover: 0,
        pe: 0, pb: 0,
        circMktCap: 0, mktCap: 0, marketCap: 0,
        limitUp, limitDown, limitPct,
        volRatio: 0,
        amplitude: prevClose ? +(((num(f[4]) - num(f[5])) / prevClose) * 100).toFixed(2) : 0,
        avgPrice: 0,
        suspended: price === 0,
        isLimitUp: limitUp > 0 && price > 0 && price >= limitUp - 1e-6,
        isLimitDown: limitDown > 0 && price > 0 && price <= limitDown + 1e-6,
        updatedAt: `${f[30] || ''} ${f[31] || ''}`.trim(),
      });
    }
  }
  return out;
}

/**
 * 新浪全市场排行（A股扫描的核心能力）
 * node: hs_a(全部A股) / sh_a / sz_a / cyb(创业板) / kcb(科创板)
 * sort: changepercent / turnoverratio / amount / trade / per / pb / mktcap
 */
// 注意：参数名不能用 num —— 会遮蔽模块顶部的 num() 工具函数
async function sinaRank({ node = 'hs_a', sort = 'changepercent', asc = 0, page = 1, size = 100 } = {}) {
  const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=${size}&sort=${sort}&asc=${asc ? 1 : 0}&node=${node}`;
  const txt = await httpGet(url, {
    headers: { Referer: 'https://finance.sina.com.cn' },
    retries: 1,
  });
  let arr;
  try { arr = JSON.parse(txt); } catch (e) { if (process.env.DSDBG) console.log('[rank parse]', e.message.slice(0, 60), String(txt).slice(0, 120)); return []; }
  if (!Array.isArray(arr)) { if (process.env.DSDBG) console.log('[rank not array]', String(txt).slice(0, 120)); return []; }
  return arr.map((d) => {
    const sym = d.symbol || '';
    const market = /^sh/.test(sym) ? MARKET.SH : /^sz/.test(sym) ? MARKET.SZ : MARKET.BJ;
    const code = d.code || sym.slice(2);
    const price = num(d.trade);
    const prevClose = num(d.settlement);
    const limitPct = limitPctOf(code, d.name);
    const limitUp = +(prevClose * (1 + limitPct / 100)).toFixed(2);
    const limitDown = +(prevClose * (1 - limitPct / 100)).toFixed(2);
    return {
      secid: `${market}.${code}`,
      code, market,
      name: d.name,
      board: boardOf(code),
      price, prevClose,
      open: num(d.open),
      high: num(d.high),
      low: num(d.low),
      change: num(d.pricechange),
      changePct: num(d.changepercent),
      volume: Math.round(num(d.volume) / 100),
      amount: num(d.amount),
      turnover: num(d.turnoverratio),
      pe: num(d.per),
      pb: num(d.pb),
      mktCap: +(num(d.mktcap) / 10000).toFixed(2),      // 万 → 亿
      marketCap: +(num(d.mktcap) / 10000).toFixed(2),
      circMktCap: +(num(d.nmc) / 10000).toFixed(2),
      limitUp, limitDown, limitPct,
      volRatio: 0,
      amplitude: prevClose ? +(((num(d.high) - num(d.low)) / prevClose) * 100).toFixed(2) : 0,
      avgPrice: 0,
      suspended: price === 0,
      isLimitUp: price > 0 && prevClose > 0 && num(d.changepercent) >= limitPct - 0.3,
      isLimitDown: price > 0 && prevClose > 0 && num(d.changepercent) <= -(limitPct - 0.3),
      updatedAt: d.ticktime || '',
    };
  });
}

async function sinaKline(secid, { period = 'day', limit = 320 } = {}) {
  const scale = period === 'week' ? 1200 : period === 'month' ? 7200 : 240;
  const sym = sinaSymbol(secid);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sym}&scale=${scale}&ma=5&datalen=${limit}`;
  const txt = await httpGet(url, { retries: 1 });
  let arr;
  try { arr = JSON.parse(txt); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.map((d) => ({
    t: String(d.day).slice(0, 10),
    o: num(d.open),
    h: num(d.high),
    l: num(d.low),
    c: num(d.close),
    v: Math.round(num(d.volume) / 100),
  })).filter((b) => b.c > 0);
}

/** 新浪指数 */
async function sinaIndexes() {
  const list = [
    ['sh000001', '上证指数'],
    ['sz399001', '深证成指'],
    ['sz399006', '创业板指'],
    ['sh000688', '科创50'],
    ['sh000300', '沪深300'],
    ['sh000016', '上证50'],
    ['sh000905', '中证500'],
    ['sz399005', '中小100'],
  ];
  const q = list.map(([s]) => `s_${s}`).join(',');
  const txt = await httpGbk(`https://hq.sinajs.cn/list=${q}`, {
    headers: { Referer: 'https://finance.sina.com.cn' },
    retries: 1,
  });
  const out = [];
  const bySym = new Map();
  for (const line of txt.split('\n')) {
    const m = /hq_str_s_(\w+)="([^"]*)"/.exec(line);
    if (m) bySym.set(m[1], m[2]);
  }
  for (const [sym, label] of list) {
    const f = (bySym.get(sym) || '').split(',');
    if (f.length < 6) continue;
    out.push({
      secid: `${sym.slice(0, 2)}.${sym.slice(2)}`,
      code: sym.slice(2),
      name: label,
      price: num(f[1]),
      change: num(f[2]),
      changePct: num(f[3]),
      volume: num(f[4]),
      amount: num(f[5]),
    });
  }
  return out;
}

// ---------------------------------------------------------------- 统一入口（自动降级）

async function withFallback(tasks) {
  const order = providerOrder();
  let lastErr;
  for (const p of order) {
    const fn = tasks[p];
    if (!fn) continue;
    try {
      const r = await fn();
      if (r && (!Array.isArray(r) || r.length)) {
        markOk(p);
        return r;
      }
      lastErr = new Error(`${p} empty`);
    } catch (e) {
      lastErr = e;
      markFail(p);
    }
  }
  throw lastErr || new Error('all providers failed');
}

async function quotes(secids, { ttl = 8000 } = {}) {
  const list = (secids || []).filter(Boolean);
  if (!list.length) return [];
  const key = `q:${list.join(',')}`;
  const hit = cacheGet(key, ttl);
  if (hit) return hit;
  const r = await withFallback({
    tx: () => txQuotes(list),
    sina: () => sinaQuotes(list),
  });
  cacheSet(key, r);
  return r;
}

async function quoteOne(secid) {
  const r = await quotes([secid]);
  return r[0] || null;
}

/**
 * K线：返回 { bars, secid, code } 包装对象（与 UI / 扫描任务约定一致）
 * bars: [{ t, o, h, l, c, v }]
 */
async function kline(secid, { period = 'day', limit = 320, fq = 1 } = {}) {
  const key = `k:${secid}:${period}:${fq}:${limit}`;
  const hit = cacheGet(key, 5 * 60 * 1000);
  if (hit && hit.bars && hit.bars.length) return hit;
  const bars = await withFallback({
    tx: () => txKline(secid, { period, limit, fq }),
    sina: () => sinaKline(secid, { period, limit }),
  });
  const wrapper = { bars, secid, code: codeOf(secid), period, fq };
  cacheSet(key, wrapper);
  return wrapper;
}

async function search(kw, limit = 12) {
  if (!kw) return [];
  const key = `s:${kw}`;
  const hit = cacheGet(key, 10 * 60 * 1000);
  if (hit) return hit;
  let r = [];
  try {
    r = await txSearch(kw, limit);
    if (r.length) markOk('tx');
  } catch {
    markFail('tx');
  }
  if (!r.length) {
    try {
      for (let p = 1; p <= 8 && r.length < limit; p++) {
        const one = await sinaRank({ node: 'hs_a', sort: 'symbol', asc: 1, page: p, size: 100 });
        if (!one.length) break;
        r.push(...one.filter((s) => s.code.includes(kw) || s.name.includes(kw)));
      }
      r = r.slice(0, limit);
    } catch { /* ignore */ }
  }
  cacheSet(key, r);
  return r;
}

/**
 * 全市场扫描
 * @param {object} opt { node, sort, asc, pages, size }
 */
async function rank(opt = {}) {
  const { node = 'hs_a', sort = 'changepercent', asc = 0, pages = 5, size = 100 } = opt;
  const out = [];
  const seen = new Set();
  for (let p = 1; p <= pages; p++) {
    try {
      const r = await sinaRank({ node, sort, asc, page: p, size });
      if (!r.length) break;
      for (const s of r) {
        if (seen.has(s.secid)) continue;
        seen.add(s.secid);
        out.push(s);
      }
    } catch (e) {
      if (process.env.DSDBG) console.log('[rank page error]', e && e.message);
      break;
    }
    if (p < pages) await sleep(150);
  }
  return out;
}

async function indexQuotes({ ttl = 10000 } = {}) {
  const key = 'idx:cn';
  const hit = cacheGet(key, ttl);
  if (hit && hit.length) return hit;
  const r = await sinaIndexes();
  cacheSet(key, r);
  return r;
}

async function sectors(type = 'hy', limit = 60) {
  const key = `sec:${type}:${limit}`;
  const hit = cacheGet(key, 60 * 1000);
  if (hit) return hit;
  let r = [];
  try {
    r = await txSectors(type, limit);
    markOk('tx');
  } catch {
    markFail('tx');
  }
  cacheSet(key, r);
  return r;
}

// ---------------------------------------------------------------- 周期聚合

function aggregate(bars, period) {
  if (!bars.length || period === 'day') return bars;
  if (period === 'week') return groupBars(bars, (t) => weekKey(t));
  if (period === 'month') return groupBars(bars, (t) => String(t).slice(0, 7));
  return bars;
}
function weekKey(t) {
  const d = new Date(t);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function groupBars(bars, keyFn) {
  const m = new Map();
  for (const b of bars) {
    const k = keyFn(b.t);
    const g = m.get(k);
    if (!g) m.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    else {
      g.h = Math.max(g.h, b.h);
      g.l = Math.min(g.l, b.l);
      g.c = b.c;
      g.v += b.v;
    }
  }
  return [...m.values()];
}

// ---------------------------------------------------------------- 导出

module.exports = {
  MARKET, MARKET_NAME,
  marketOfCode, makeSecid, codeOf, marketOf, boardOf, limitPctOf,
  initCache, activeSource,
  clearCache: () => memCache.clear(),
  search, quoteOne, quotes, kline, rank, indexQuotes, sectors,
  num, aggregate,
};
