/**
 * app.js —— 界面主控
 * 依赖 window.qd（preload 暴露）与 chart.js
 */
(function () {
  const { ind, factors, bt, signals, chip, patterns, levels } = window.qd;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const DEFAULT_WATCH = [
    { code: '600519', name: '贵州茅台', market: 'sh', secid: 'sh.600519', group: '消费' },
    { code: '300750', name: '宁德时代', market: 'sz', secid: 'sz.300750', group: '新能源' },
    { code: '002594', name: '比亚迪', market: 'sz', secid: 'sz.002594', group: '新能源' },
    { code: '000001', name: '平安银行', market: 'sz', secid: 'sz.000001', group: '金融' },
    { code: '688981', name: '中芯国际', market: 'sh', secid: 'sh.688981', group: '半导体' },
    { code: '300059', name: '东方财富', market: 'sz', secid: 'sz.300059', group: '金融' },
    { code: '688256', name: '寒武纪', market: 'sh', secid: 'sh.688256', group: '半导体' },
    { code: '601899', name: '紫金矿业', market: 'sh', secid: 'sh.601899', group: '资源' },
    { code: '300308', name: '中际旭创', market: 'sz', secid: 'sz.300308', group: 'AI算力' },
    { code: '600036', name: '招商银行', market: 'sh', secid: 'sh.600036', group: '金融' },
  ];

  const SECTOR_TYPE = { hy: '行业', gn: '概念', dy: '地域' };

  const state = {
    config: null,
    watchlist: [],
    alerts: [],
    quotes: new Map(),
    scanResults: [],
    scanSort: { key: 'score', dir: -1 },
    watchSort: { key: 'changePct', dir: -1 },
    current: null, // 当前分析的 secid
    currentPeriod: 'day',
      chart: null,
    btResult: null,
    signals: [],
    chip: null,
    levels: null,
    portfolio: [],
    timers: {},
    sectorType: 'hy',
    sectors: [],
    indexes: [],
  };

  // ------------------------------------------------------------ 工具

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function setStatus(busy, text) {
    const d = $('#statusDot');
    d.className = 'dot' + (busy ? ' busy' : '');
    $('#statusText').textContent = text || (busy ? '请求中…' : '就绪');
  }

  const f2 = (v) => (v == null || !isFinite(v) ? '--' : Number(v).toFixed(2));
  const f0 = (v) => (v == null || !isFinite(v) ? '--' : Number(v).toLocaleString('en-US'));
  function pct(v) {
    if (v == null || !isFinite(v)) return '--';
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  function cls(v) {
    if (v == null || !isFinite(v) || v === 0) return 'flat';
    return v > 0 ? 'up' : 'down';
  }
  /** 美元市值：T / B / M */
  function cap(v) {
    if (v == null || !isFinite(v) || v === 0) return '--';
    const a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    return v.toFixed(0);
  }
  function amount(v) {
    if (v == null || !isFinite(v)) return '--';
    const a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(2) + '万';
    return v.toFixed(0);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ------------------------------------------------------------ 启动

  async function boot() {
    bindNav();
    bindSearch();
    bindWatch();
    bindAnalyze();
    bindScan();
    bindSector();
    bindPortfolio();
    bindBacktest();
    bindAlerts();
    bindSettings();
    bindTheme();
    startClock();

    state.config = await qd.storeGet('config');
    let wl = await qd.storeGet('watchlist');
    if (!wl || !wl.length) {
      wl = DEFAULT_WATCH.slice();
      await qd.storeSet('watchlist', wl);
    }
    state.watchlist = wl;
    state.alerts = (await qd.storeGet('alerts')) || [];
    state.portfolio = (await qd.storeGet('portfolio')) || [];
    applyTheme(state.config.theme || 'dark');

    // 配置回填
    $('#refreshRate').value = String(state.config.refreshInterval || 15000);
    $('#setFq').value = String(state.config.fq);
    $('#setPeriod').value = state.config.period || 'day';
    state.currentPeriod = state.config.period || 'day';
    setPeriodUI(state.currentPeriod);
    $('#btCapital').value = state.config.initialCapital || 100000;

    const info = await qd.appInfo();
    $('#footVer').textContent = `Electron ${info.electron}`;
    $('#aboutKpi').innerHTML = [
      ['版本', 'v' + info.version],
      ['Electron', info.electron],
      ['Node', info.node],
      ['架构', info.arch],
    ]
      .map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v sm">${esc(v)}</div></div>`)
      .join('');

    renderWatch();
    renderAlerts();
    renderPortfolio();
    renderPool();
    loadIndexes();
    loadSectors();
    refreshQuotes();
    refreshPortfolio();
    scheduleRefresh();
    scheduleAlerts();

    // 默认分析第一只
    if (state.watchlist.length) {
      $('#anaCode').value = state.watchlist[0].code;
      analyze(state.watchlist[0].secid, true);
    }

    // 策略下拉
    $('#btStrategy').innerHTML = Object.entries(bt.STRATEGIES)
      .map(([k, v]) => `<option value="${k}">${v.name}</option>`)
      .join('');
    renderBtParams();
    $('#btDesc').innerHTML = `<b>${esc(bt.STRATEGIES.ma_cross.name)}</b>：${esc(bt.STRATEGIES.ma_cross.desc)}`;
  }

  function startClock() {
    const tick = () => {
      const d = new Date();
      $('#clock').textContent = d.toTimeString().slice(0, 8);
    };
    tick();
    setInterval(tick, 1000);
  }

  function bindNav() {
    $$('.nav-item').forEach((it) => {
      it.addEventListener('click', () => {
        $$('.nav-item').forEach((x) => x.classList.remove('active'));
        it.classList.add('active');
        const v = it.dataset.view;
        $$('.view').forEach((x) => x.classList.remove('active'));
        $('#view-' + v).classList.add('active');
        if (v === 'analyze' && state.chart) state.chart.render();
        if (v === 'analyze' && state.chip) renderChipPanel(state.chip);
        if (v === 'backtest' && state.btResult) drawEquityPanel();
      });
    });
  }

  // ------------------------------------------------------------ 搜索

  function bindSearch() {
    const input = $('#searchInput');
    const pop = $('#searchPop');
    let timer = null;
    let items = [];
    let activeIdx = -1;

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const kw = input.value.trim();
      if (!kw) {
        pop.classList.remove('show');
        return;
      }
      timer = setTimeout(async () => {
        try {
          items = await qd.search(kw);
          activeIdx = -1;
          if (!items.length) {
            pop.innerHTML = '<div class="item"><span class="n">未找到相关标的</span></div>';
          } else {
            pop.innerHTML = items
              .map(
                (r, i) =>
                  `<div class="item" data-i="${i}"><span class="c">${esc(r.code)}</span><span class="n">${esc(
                    r.name
                  )}</span><span class="m">${esc(r.marketName || '')}</span></div>`
              )
              .join('');
          }
          pop.classList.add('show');
          $$('.item', pop).forEach((el) => {
            el.addEventListener('click', () => pick(items[Number(el.dataset.i)]));
          });
        } catch {
          pop.classList.remove('show');
        }
      }, 260);
    });

    function pick(r) {
      if (!r) return;
      pop.classList.remove('show');
      input.value = '';
      openAnalyze(r.secid, r.code);
    }

    input.addEventListener('keydown', (e) => {
      if (!pop.classList.contains('show') || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        $$('.item', pop).forEach((el, i) => el.classList.toggle('active', i === activeIdx));
      } else if (e.key === 'Enter') {
        pick(items[activeIdx >= 0 ? activeIdx : 0]);
      } else if (e.key === 'Escape') {
        pop.classList.remove('show');
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) pop.classList.remove('show');
    });
  }

  function openAnalyze(secid, code) {
    $$('.nav-item').forEach((x) => x.classList.toggle('active', x.dataset.view === 'analyze'));
    $$('.view').forEach((x) => x.classList.toggle('active', x.id === 'view-analyze'));
    $('#anaCode').value = code || '';
    analyze(secid);
  }

  // ------------------------------------------------------------ 指数

  async function loadIndexes() {
    try {
      const list = await qd.indexes();
      if (!list.length) return;
      state.indexes = list;
      $('#indexStrip').innerHTML = list
        .slice(0, 5)
        .map((q) => {
          const c = cls(q.changePct);
          return `<div class="idx"><span class="nm">${esc(q.name)}</span><span class="pv">${f2(
            q.price
          )}</span><span class="pc ${c}">${pct(q.changePct)}</span></div>`;
        })
        .join('');
      updateSentiment();
    } catch {
      /* 指数失败不阻塞 */
    }
  }

  /** 市场情绪温度计：指数涨跌 + 行业板块涨跌家数加权为 0-100 */
  function updateSentiment() {
    const idx = state.indexes || [];
    const sec = state.sectors || [];
    if (!idx.length && !sec.length) return;
    let score = 50;
    // 指数维度（占 50%）：主要指数涨跌幅映射
    const idxAvg = idx.length ? idx.reduce((a, q) => a + (q.changePct || 0), 0) / idx.length : 0;
    let idxScore = 50 + idxAvg * 12;
    // 板块维度（占 50%）：上涨板块占比
    let secScore = 50;
    if (sec.length) {
      const up = sec.filter((s) => (s.changePct || 0) > 0).length;
      secScore = (up / sec.length) * 100;
    }
    const hasIdx = idx.length > 0;
    const hasSec = sec.length > 0;
    if (hasIdx && hasSec) score = idxScore * 0.5 + secScore * 0.5;
    else if (hasIdx) score = idxScore;
    else score = secScore;
    score = Math.max(0, Math.min(100, Math.round(score)));

    const bar = $('#sentBar');
    const val = $('#sentVal');
    if (!bar || !val) return;
    bar.style.width = score + '%';
    val.textContent = score;
    const col = score >= 70 ? 'var(--up)' : score >= 55 ? 'var(--orange)' : score >= 45 ? 'var(--gray)' : 'var(--down)';
    val.style.color = col;
    const box = $('#sentiment');
    if (box) box.title = `市场情绪 ${score}/100（指数 ${Math.round(idxScore)} · 板块 ${Math.round(secScore)}）`;
  }

  // ------------------------------------------------------------ 自选行情

  function bindWatch() {
    $('#btnAdd').addEventListener('click', () => addByCode($('#addCode').value));
    $('#addCode').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addByCode($('#addCode').value);
    });
    $('#btnRefresh').addEventListener('click', () => refreshQuotes(true));
    $('#refreshRate').addEventListener('change', async () => {
      state.config = await qd.configUpdate({ refreshInterval: Number($('#refreshRate').value) });
      scheduleRefresh();
      toast('刷新间隔已更新');
    });
    $('#autoRefresh').addEventListener('change', () => scheduleRefresh());

    $$('#watchTable th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        state.watchSort.dir = state.watchSort.key === k ? -state.watchSort.dir : -1;
        state.watchSort.key = k;
        renderWatch();
      });
    });
  }

  async function addByCode(raw) {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) return;
    setStatus(true, '查询中…');
    try {
      const r = await qd.search(code);
      const hit = r.find((x) => x.code.toUpperCase() === code) || r[0];
      if (!hit) {
        toast('未找到该代码');
        return;
      }
      await addWatch({ secid: hit.secid, code: hit.code, name: hit.name, market: hit.market });
      $('#addCode').value = '';
    } catch {
      toast('查询失败，请稍后重试');
    } finally {
      setStatus(false);
    }
  }

  async function addWatch(item) {
    const list = await qd.watchlistAdd(item);
    state.watchlist = list;
    renderWatch();
    refreshQuotes(true);
    toast(`已添加 ${item.code}`);
  }

  async function removeWatch(secid) {
    state.watchlist = await qd.watchlistRemove(secid);
    renderWatch();
    toast('已移除');
  }

  async function refreshQuotes(force) {
    if (!state.watchlist.length) return;
    setStatus(true, '拉取行情…');
    try {
      const list = await qd.quotes(
        state.watchlist.map((w) => w.secid),
        { maxAge: force ? 0 : 8000 }
      );
      state.quotes = new Map(list.map((q) => [q.secid, q]));
      renderWatch();
      const t = new Date().toTimeString().slice(0, 8);
      setStatus(false, `已更新 ${t}`);
    } catch (e) {
      setStatus(false, '行情获取失败');
    }
  }

  function scheduleRefresh() {
    clearInterval(state.timers.refresh);
    if (!$('#autoRefresh').checked) return;
    const ms = Number($('#refreshRate').value) || 15000;
    state.timers.refresh = setInterval(() => refreshQuotes(true), ms);
  }

  function renderWatch() {
    const tb = $('#watchTable tbody');
    const rows = state.watchlist.map((w) => ({ ...w, q: state.quotes.get(w.secid) }));
    const { key, dir } = state.watchSort;
    rows.sort((a, b) => {
      const va = a.q ? a.q[key] : null;
      const vb = b.q ? b.q[key] : null;
      if (key === 'code') return dir * String(a.code).localeCompare(String(b.code));
      if (va == null) return 1;
      if (vb == null) return -1;
      return dir * (va - vb);
    });

    $('#watchEmpty').style.display = rows.length ? 'none' : 'block';
    tb.innerHTML = rows
      .map((r) => {
        const q = r.q;
        if (!q) {
          return `<tr><td><span class="code">${esc(r.code)}</span> <span class="name">${esc(
            r.name || ''
          )}</span></td><td colspan="10" class="muted">--</td>
          <td><button class="btn sm danger" data-del="${esc(r.secid)}">删除</button></td></tr>`;
        }
        return `<tr>
          <td><span class="code" data-open="${esc(q.secid)}" data-code="${esc(q.code)}">${esc(
          q.code
        )}</span> <span class="name">${esc(q.name)}</span></td>
          <td class="${cls(q.changePct)}"><b>${f2(q.price)}</b></td>
          <td class="${cls(q.changePct)}"><b>${pct(q.changePct)}</b></td>
          <td class="${cls(q.change)}">${q.change == null ? '--' : (q.change > 0 ? '+' : '') + f2(q.change)}</td>
          <td>${f2(q.open)}</td>
          <td class="up">${f2(q.high)}</td>
          <td class="down">${f2(q.low)}</td>
          <td>${f2(q.prevClose)}</td>
          <td>${amount(q.amount)}</td>
          <td>${cap(q.marketCap)}</td>
          <td>${q.pe == null ? '--' : f2(q.pe)}</td>
          <td><button class="btn sm danger" data-del="${esc(q.secid)}">删除</button></td>
        </tr>`;
      })
      .join('');

    tb.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => removeWatch(b.dataset.del))
    );
    tb.querySelectorAll('[data-open]').forEach((b) =>
      b.addEventListener('click', () => openAnalyze(b.dataset.open, b.dataset.code))
    );
  }

  async function renderPool() {
    const groups = [
      ['tech', 'AI算力'],
      ['semi', '半导体'],
      ['newenergy', '新能源'],
      ['blue', '核心蓝筹'],
      ['consumer', '消费医药'],
    ];
    try {
      const pool = await qd.pool();
      const box = $('#poolChips');
      if (!pool || !pool.length) {
        box.innerHTML = '<div class="empty" style="padding:18px">股票池为空</div>';
        return;
      }
      box.innerHTML = groups
        .map(([key, label]) => {
          const items = pool.filter((p) => p.group === key);
          if (!items.length) return '';
          const chips = items
            .map((p) => {
              const payload = { secid: p.secid, code: p.code, name: p.name, market: String(p.secid).split('.')[0] };
              return `<button class="btn sm" data-add='${esc(JSON.stringify(payload))}' title="${esc(p.name)}">${esc(p.code)}</button>`;
            })
            .join('');
          return `<div class="pool-group"><span class="pg-label">${esc(label)}</span><div class="pg-chips">${chips}</div></div>`;
        })
        .join('');
      box.querySelectorAll('[data-add]').forEach((b) =>
        b.addEventListener('click', () => {
          const p = JSON.parse(b.dataset.add);
          addWatch({ secid: p.secid, code: p.code, name: p.name, market: p.market });
        })
      );
    } catch {
      /* 股票池失败不阻塞 */
    }
  }

  // ------------------------------------------------------------ 个股分析

  function bindAnalyze() {
    $('#btnAnalyze').addEventListener('click', async () => {
      const code = $('#anaCode').value.trim().toUpperCase();
      if (!code) return;
      const r = await qd.search(code);
      const hit = r.find((x) => x.code.toUpperCase() === code) || r[0];
      if (!hit) return toast('未找到该代码');
      analyze(hit.secid);
    });
    $('#anaCode').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#btnAnalyze').click();
    });
    $$('#periodSeg button').forEach((b) => {
      b.addEventListener('click', () => {
        setPeriodUI(b.dataset.p);
        if (state.current) analyze(state.current);
      });
    });
    $('#subInd').addEventListener('change', () => {
      if (state.chart) {
        state.chart.sub = $('#subInd').value;
        state.chart.render();
      }
    });
    $('#sigToggle').addEventListener('change', () => {
      if (state.chart) {
        state.chart.showSignals = $('#sigToggle').checked;
        state.chart.render();
      }
    });
    window.addEventListener('resize', () => {
      if (state.chart) state.chart.render();
      if (state.btResult) drawEquityPanel();
      if (state.chip) renderChipPanel(state.chip);
    });
  }

  function setPeriodUI(p) {
    state.currentPeriod = p;
    $$('#periodSeg button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
    qd.configUpdate({ period: p });
  }

  async function analyze(secid, silent) {
    state.current = secid;
    setStatus(true, '加载K线…');
    try {
      const k = await qd.kline(secid, {
        period: state.currentPeriod,
        limit: 400,
        fq: Number(state.config.fq || 1),
      });
      if (!k || !k.bars || k.bars.length < 30) {
        toast('K线数据不足');
        return;
      }
      const bars = k.bars;
      // 数据源使用短字段名 {t,o,h,l,c,v}，此处做双字段名兼容
      const bOpen = (b) => (b.open != null ? b.open : b.o);
      const bHigh = (b) => (b.high != null ? b.high : b.h);
      const bLow = (b) => (b.low != null ? b.low : b.l);
      const bClose = (b) => (b.close != null ? b.close : b.c);
      const bVol = (b) => (b.volume != null ? b.volume : (b.v || 0));
      const closes = bars.map(bClose);
      const highs = bars.map(bHigh);
      const lows = bars.map(bLow);
      const vols = bars.map(bVol);

      const indicators = {
        ma5: ind.sma(closes, 5),
        ma10: ind.sma(closes, 10),
        ma20: ind.sma(closes, 20),
        ma60: ind.sma(closes, 60),
        macd: ind.macd(closes),
        rsi: ind.rsi(closes, 14),
        kdj: ind.kdj(highs, lows, closes),
        volMa5: ind.volMa(vols, 5),
      };
      const boll = ind.boll(closes, 20, 2);
      indicators.bollUp = boll.upper;
      indicators.bollLow = boll.lower;

      // 图表
      const cv = $('#klineCanvas');
      cv.style.height = '460px';
      if (!state.chart) state.chart = new window.KLineChart(cv, $('#klineTip'));
      state.chart.sub = $('#subInd').value;
      state.chart.setData(bars, indicators, $('#subInd').value);
      state.chart.onHover = (i, x, y) => showTip(i, bars, indicators, x, y);

      // 买卖点信号
      const sigs = signals.detect(bars, { minGap: 8 });
      state.signals = sigs;
      state.chart.setSignals(sigs);
      renderSignalsPanel(sigs);

      // 支撑 / 压力位
      const lv = levels.compute(bars, { price: bars[bars.length - 1].close });
      state.levels = lv;
      state.chart.setLevels(lv);
      renderLevelsPanel(lv);

      // K线形态
      const pats = patterns.detect(bars);
      state.patterns = pats;
      state.chart.setPatterns(pats);
      renderPatternsPanel(pats, bars);

      // 筹码分布
      const qt = state.quotes.get(secid);
      const cp = chip.compute(bars, { turnover: qt ? qt.turnover : 0 });
      state.chip = cp;
      renderChipPanel(cp);

      // 图例
      const last = bars[bars.length - 1];
      const lastO = last.open != null ? last.open : last.o;
      const lastC = last.close != null ? last.close : last.c;
      const m = indicators;
      $('#klineLegend').innerHTML = [
        `<span><i style="background:${lastC >= lastO ? '#ff453a' : '#30d158'}"></i>${esc(
          k.name || secid
        )} ${f2(lastC)}</span>`,
        ['ma5', 'MA5'], ['ma10', 'MA10'], ['ma20', 'MA20'], ['ma60', 'MA60'],
      ]
        .map((x) => {
          if (typeof x === 'string') return `<span>${x}</span>`;
          const v = m[x[0]] ? m[x[0]][m[x[0]].length - 1] : null;
          return `<span><i style="background:${
            { ma5: '#ffd60a', ma10: '#0a84ff', ma20: '#bf5af2', ma60: '#30d158' }[x[0]]
          }"></i>${x[1]} ${f2(v)}</span>`;
        })
        .join('');

      // 因子评分
      const a = factors.analyze(bars, state.quotes.get(secid));
      if (a) renderAnalysisPanel(a, secid);

      // 标题
      const q = state.quotes.get(secid);
      if (q) $('#anaCode').value = q.code;
      if (!silent) toast(`已加载 ${k.name || secid}（${bars.length} 根K线）`);
      setStatus(false, '就绪');
    } catch (e) {
      setStatus(false, '加载失败');
      toast('K线加载失败：' + (e.message || '数据源限流，请稍后重试'));
    }
  }

  function showTip(i, bars, inds, x, y) {
    const tip = $('#klineTip');
    if (i < 0 || !bars[i]) {
      tip.style.display = 'none';
      return;
    }
    const b = bars[i];
    const bO = b.open != null ? b.open : b.o;
    const bC = b.close != null ? b.close : b.c;
    const bH = b.high != null ? b.high : b.h;
    const bL = b.low != null ? b.low : b.l;
    const bV = b.volume != null ? b.volume : (b.v || 0);
    const c = bC >= bO ? 'up' : 'down';
    const ma = (arr) => (arr && arr[i] != null ? f2(arr[i]) : '--');
    let html = `<div>${esc(b.date != null ? b.date : b.t)}</div>
      <div>开 <span class="${c}">${f2(bO)}</span> 高 <span class="${c}">${f2(bH)}</span></div>
      <div>收 <span class="${c}">${f2(bC)}</span> 低 <span class="${c}">${f2(bL)}</span></div>
      <div>量 ${amount(bV)}</div>
      <div style="margin-top:4px;color:#ffd60a">MA5 ${ma(inds.ma5)}  MA20 ${ma(inds.ma20)}</div>
      <div style="color:#bf5af2">RSI ${inds.rsi[i] != null ? inds.rsi[i].toFixed(1) : '--'}</div>`;
    const s = (state.signals || []).find((x) => x.index === i);
    if (s) {
      const col = s.type === 'buy' ? '#ff453a' : '#30d158';
      const tag = s.type === 'buy' ? '买点' : '卖点';
      html += `<div style="margin-top:4px;color:${col}">▸ ${tag}：${esc(s.reason)}</div>`;
    }
    const pt = (state.patterns || []).find((x) => x.index === i && (x.strength || 1) >= 2);
    if (pt) {
      const col = pt.type === 'bull' ? '#ff453a' : pt.type === 'bear' ? '#30d158' : '#98989d';
      html += `<div style="color:${col}">◆ 形态：${esc(pt.name)}</div>`;
    }
    tip.innerHTML = html;
    tip.style.display = 'block';
    const wrapW = tip.parentElement.clientWidth;
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(4, Math.min(wrapW - tw - 4, x + 14)) + 'px';
    tip.style.top = Math.max(4, y - 40) + 'px';
  }

  function renderAnalysisPanel(a, secid) {
    const rt = factors.rating(a.score);
    $('#anaScore').innerHTML = `
      <div class="big-score">
        <div class="num-big rating ${rt.cls}">${a.score.toFixed(1)}</div>
        <div class="meta">
          <div class="rating ${rt.cls}" style="font-size:14px;font-weight:600">${rt.label}</div>
          <div>看多信号 ${a.bullCount} 个 · 看空信号 ${a.bearCount} 个</div>
          <div>现价 ${f2(a.price)} <span class="${cls(a.changePct)}">${pct(a.changePct)}</span></div>
        </div>
      </div>`;

    $('#anaSignals').innerHTML = a.signals.length
      ? a.signals.map((s) => `<span class="tag ${s.type}">${esc(s.text)}</span>`).join('')
      : '<span class="tag gray">无明显信号</span>';

    const FN = {
      momentum: ['动量', 25],
      trend: ['趋势', 25],
      reversion: ['均值回归', 15],
      volume: ['量能', 15],
      volatility: ['波动', 10],
      position: ['位置', 10],
    };
    $('#anaFactors').innerHTML = Object.entries(FN)
      .map(([k, [label, max]]) => {
        const v = a.factors[k] || 0;
        return `<div class="factor-row">
          <span class="fn">${label}</span>
          <span class="ft"><span class="ff" style="width:${(v / max) * 100}%"></span></span>
          <span class="fv">${v.toFixed(1)}</span>
        </div>`;
      })
      .join('');

    const m = a.metrics;
    const px = a.price;
    const kpi = [
      ['RSI(14)', m.rsi == null ? '--' : m.rsi.toFixed(1), m.rsi > 70 ? 'up' : m.rsi < 30 ? 'down' : ''],
      ['MA20', f2(m.ma20), m.ma20 == null ? '' : px > m.ma20 ? 'up' : 'down'],
      ['MA60', f2(m.ma60), m.ma60 == null ? '' : px > m.ma60 ? 'up' : 'down'],
      ['MA120', f2(m.ma120), m.ma120 == null ? '' : px > m.ma120 ? 'up' : 'down'],
      ['MACD柱', m.macdHist == null ? '--' : m.macdHist.toFixed(3), m.macdHist > 0 ? 'up' : 'down'],
      ['KDJ-K', m.kdjK == null ? '--' : m.kdjK.toFixed(1), ''],
      ['5日涨幅', pct(m.r5), cls(m.r5)],
      ['20日涨幅', pct(m.r20), cls(m.r20)],
      ['60日涨幅', pct(m.r60), cls(m.r60)],
      ['距52周高', m.distHigh52 == null ? '--' : m.distHigh52.toFixed(1) + '%', cls(m.distHigh52)],
      ['量比(5/20)', m.volRatio == null ? '--' : m.volRatio.toFixed(2), m.volRatio > 1.2 ? 'up' : ''],
      ['ATR%', m.atrPct == null ? '--' : m.atrPct.toFixed(2) + '%', ''],
      ['年化波动', m.volatility == null ? '--' : m.volatility.toFixed(1) + '%', ''],
      ['52周高/低', `${f2(m.hi52)} / ${f2(m.lo52)}`, ''],
    ];
    $('#anaKpi').innerHTML = kpi
      .map(
        ([k, v, c]) =>
          `<div class="kpi"><div class="k">${k}</div><div class="v sm ${c}">${esc(v)}</div></div>`
      )
      .join('');

    // 加入自选按钮
    if (!$('#btnAddCurrent')) {
      const b = document.createElement('button');
      b.className = 'btn sm';
      b.id = 'btnAddCurrent';
      b.style.margin = '12px 14px 14px';
      b.textContent = '＋ 加入自选';
      $('#anaKpi').parentElement.appendChild(b);
      b.addEventListener('click', () => {
        const q = state.quotes.get(secid);
        addWatch({ secid, code: q ? q.code : secid.split('.')[1], name: q ? q.name : '', market: Number(secid.split('.')[0]) });
      });
    }
  }

  // ------------------------------------------------------------ 买卖点面板

  function renderSignalsPanel(sigs) {
    const buys = sigs.filter((s) => s.type === 'buy');
    const sells = sigs.filter((s) => s.type === 'sell');
    const lastBuy = buys[buys.length - 1];
    const lastSell = sells[sells.length - 1];
    const f2b = (v) => (v == null ? '--' : Number(v).toFixed(2));
    const sumCard = (k, v, sub, cls2) =>
      `<div class="sig-card ${cls2}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
    $('#sigSummary').innerHTML = [
      sumCard('最新买点', lastBuy ? `${lastBuy.date}` : '—', lastBuy ? `${f2b(lastBuy.price)} · ${esc(lastBuy.reason)}` : '近250根K线内无', 'buy'),
      sumCard('最新卖点', lastSell ? `${lastSell.date}` : '—', lastSell ? `${f2b(lastSell.price)} · ${esc(lastSell.reason)}` : '近250根K线内无', 'sell'),
      sumCard('买点 / 卖点', `${buys.length} / ${sells.length}`, '近250根K线信号数', ''),
    ].join('');

    const recent = sigs.slice(-20).reverse();
    $('#sigBox').innerHTML = recent.length
      ? recent
          .map((s) => {
            const col = s.type === 'buy' ? '#ff453a' : '#30d158';
            const tagCls = s.type === 'buy' ? 'bull' : 'bear';
            const star = s.strength >= 3 ? '★' : s.strength >= 2 ? '✦' : '';
            return `<div class="sig-row">
              <span class="sig-dot" style="background:${col}"></span>
              <span class="dt">${esc(s.date)}</span>
              <span class="tag ${tagCls}">${s.type === 'buy' ? '买' : '卖'}</span>
              <span class="pr" style="color:${col}">${f2b(s.price)}</span>
              <span class="rs">${esc(s.reason)} ${star ? `<span style="color:${col}">${star}</span>` : ''}</span>
            </div>`;
          })
          .join('')
      : '<div class="empty">近250根K线内未识别到买卖点</div>';
  }

  // ------------------------------------------------------------ 支撑压力 / 形态 / 筹码

  function renderLevelsPanel(lv) {
    const box = $('#levelBox');
    if (!box) return;
    if (!lv) {
      box.innerHTML = '<div class="empty">数据不足</div>';
      return;
    }
    const px = lv.price;
    const rows = [];
    (lv.resistances || []).forEach((r) => rows.push({ price: r.price, strength: r.strength, res: true }));
    (lv.supports || []).forEach((s) => rows.push({ price: s.price, strength: s.strength, res: false }));
    if (!rows.length) {
      box.innerHTML = '<div class="empty">暂无有效位</div>';
      return;
    }
    rows.sort((a, b) => b.price - a.price);
    const maxS = Math.max(1, ...rows.map((r) => r.strength));
    box.innerHTML = rows
      .map((r) => {
        const dist = (r.price / px - 1) * 100;
        const col = r.res ? 'var(--up)' : 'var(--down)';
        const bg = r.res ? 'rgba(255,69,58,.16)' : 'rgba(48,209,88,.16)';
        return `<div class="level-row">
          <span class="lv-tag" style="background:${bg};color:${col}">${r.res ? '压力' : '支撑'}</span>
          <span class="pr" style="color:${col}">${f2(r.price)}</span>
          <span class="muted" style="flex:1;font-size:11px;text-align:right">距现价 ${dist > 0 ? '+' : ''}${dist.toFixed(1)}%</span>
          <span class="bar"><i style="width:${(r.strength / maxS) * 100}%;background:${col}"></i></span>
        </div>`;
      })
      .join('');
  }

  function renderPatternsPanel(pats, bars) {
    const box = $('#patBox');
    if (!box) return;
    const rec = patterns.recent(pats, bars, 60).slice().reverse();
    if (!rec.length) {
      box.innerHTML = '<div class="empty">近 60 根无显著形态</div>';
      return;
    }
    const typeCls = { bull: 'bull', bear: 'bear', neutral: 'gray' };
    const typeName = { bull: '看涨', bear: '看跌', neutral: '中性' };
    box.innerHTML = rec
      .slice(0, 24)
      .map((p) => {
        const col = p.type === 'bull' ? 'var(--up)' : p.type === 'bear' ? 'var(--down)' : 'var(--muted)';
        const star = p.strength >= 3 ? '★★★' : p.strength >= 2 ? '★★' : '★';
        return `<div class="pat-row">
          <span class="dt">${esc(p.date)}</span>
          <span class="nm">${esc(p.name)}</span>
          <span class="tag ${typeCls[p.type]}">${typeName[p.type]}</span>
          <span class="pr" style="color:${col};font-size:10.5px">${star}</span>
        </div>`;
      })
      .join('');
  }

  function renderChipPanel(cp) {
    const box = $('#chipKpi');
    const vd = $('#chipVerdict');
    if (!box) return;
    if (!cp) {
      box.innerHTML = '<div class="empty" style="grid-column:1/-1">数据不足</div>';
      if (vd) vd.textContent = '';
      return;
    }
    const v = chip.verdict(cp);
    if (vd) vd.innerHTML = `<span class="tag ${v.cls || 'gray'}">${esc(v.label)}</span>`;
    const items = [
      ['获利比例', cp.profitRatio + '%', cp.profitRatio > 80 ? 'var(--up)' : cp.profitRatio < 20 ? 'var(--down)' : ''],
      ['平均成本', f2(cp.avgCost), ''],
      ['集中度', cp.concentration + '%', ''],
      ['筹码峰', f2(cp.peakPrice), ''],
      ['90%下沿', f2(cp.costLow90), ''],
      ['90%上沿', f2(cp.costHigh90), ''],
    ];
    box.innerHTML = items
      .map(([k, val, c]) => `<div class="item"><div class="k">${k}</div><div class="v" style="${c ? `color:${c}` : ''}">${val}</div></div>`)
      .join('');
    const cv = $('#chipCanvas');
    if (cv && window.drawChips) {
      cv.style.height = '230px';
      window.drawChips(cv, cp);
    }
  }

  // ------------------------------------------------------------ 量化选股

  function bindScan() {
    $('#btnScan').addEventListener('click', runScan);
    $('#btnExport').addEventListener('click', exportCsv);
    $('#scanFilter').addEventListener('change', renderScan);
    $$('#scanTable th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        state.scanSort.dir = state.scanSort.key === k ? -state.scanSort.dir : -1;
        state.scanSort.key = k;
        renderScan();
      });
    });
  }

  async function runScan() {
    const btn = $('#btnScan');
    btn.disabled = true;
    setStatus(true, '扫描中…');
    const off = qd.onScanProgress((p) => {
      const pctv = Math.round((p.done / p.total) * 100);
      $('#scanBar').style.width = pctv + '%';
      $('#scanText').textContent = `${p.done}/${p.total} · ${p.current || ''}`;
    });
    try {
      const res = await qd.scan({
        source: $('#scanSource').value,
        limit: Number($('#scanLimit').value),
      });
      if (res.error) return toast(res.error);
      state.scanResults = res.results || [];
      $('#scanMeta').textContent = `共 ${state.scanResults.length} 只 · 耗时 ${(res.costMs / 1000).toFixed(
        1
      )}s · ${new Date(res.scannedAt).toLocaleString('zh-CN')}`;
      renderScan();
      toast(`扫描完成，命中 ${state.scanResults.length} 只`);
    } catch (e) {
      toast('扫描失败：' + (e.message || '请稍后重试'));
    } finally {
      off();
      btn.disabled = false;
      setStatus(false, '就绪');
    }
  }

  function renderScan() {
    const minScore = Number($('#scanFilter').value);
    let rows = state.scanResults.filter((r) => r.score >= minScore);
    const { key, dir } = state.scanSort;
    const getter = (r) => {
      if (key === 'rsi') return r.metrics.rsi;
      if (key === 'ret20') return r.metrics.ret20;
      if (key === 'volRatio') return r.metrics.volRatio;
      return r[key];
    };
    rows = rows.slice().sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return dir * (va - vb);
    });

    const tb = $('#scanTable tbody');
    $('#scanEmpty').style.display = rows.length ? 'none' : 'block';
    tb.innerHTML = rows
      .map((r, i) => {
        const rt = factors.rating(r.score);
        const color = r.score >= 66 ? '#ff453a' : r.score >= 52 ? '#ffd60a' : '#98989d';
        return `<tr>
          <td class="muted">${i + 1}</td>
          <td><span class="code" data-open="${esc(r.secid)}" data-code="${esc(r.code)}">${esc(
          r.code
        )}</span> <span class="name">${esc(r.name || '')}</span></td>
          <td><span class="score-bar"><b class="${rt.cls}" style="color:${color}">${r.score.toFixed(
          1
        )}</b><span class="track"><span class="fill" style="width:${r.score}%;background:${color}"></span></span></span></td>
          <td><span class="rating ${rt.cls}">${rt.label}</span></td>
          <td>${f2(r.price)}</td>
          <td class="${cls(r.changePct)}">${pct(r.changePct)}</td>
          <td>${r.metrics.rsi == null ? '--' : r.metrics.rsi.toFixed(1)}</td>
          <td class="${cls(r.metrics.r20)}">${pct(r.metrics.r20)}</td>
          <td>${r.metrics.volRatio == null ? '--' : r.metrics.volRatio.toFixed(2)}</td>
          <td style="text-align:left">${(r.signals || [])
            .slice(0, 3)
            .map((s) => `<span class="tag ${s.type}">${esc(s.text)}</span>`)
            .join('')}</td>
          <td><button class="btn sm" data-add="${esc(r.secid)}|${esc(r.code)}|${esc(
          r.name || ''
        )}">加自选</button></td>
        </tr>`;
      })
      .join('');

    tb.querySelectorAll('[data-open]').forEach((b) =>
      b.addEventListener('click', () => openAnalyze(b.dataset.open, b.dataset.code))
    );
    tb.querySelectorAll('[data-add]').forEach((b) =>
      b.addEventListener('click', () => {
        const [secid, code, name] = b.dataset.add.split('|');
        addWatch({ secid, code, name, market: Number(secid.split('.')[0]) });
      })
    );
  }

  function exportCsv() {
    if (!state.scanResults.length) return toast('没有可导出的结果');
    const head = ['排名', '代码', '名称', '评分', '评级', '现价', '涨跌幅', 'RSI', '20日涨幅', '60日涨幅', '量比', '距高点', '信号'];
    const lines = [head.join(',')];
    state.scanResults.forEach((r, i) => {
      lines.push(
        [
          i + 1,
          r.code,
          `"${(r.name || '').replace(/"/g, '')}"`,
          r.score.toFixed(1),
          factors.rating(r.score).label,
          f2(r.price),
          r.changePct == null ? '' : r.changePct.toFixed(2),
          r.metrics.rsi == null ? '' : r.metrics.rsi.toFixed(1),
          r.metrics.r20 == null ? '' : r.metrics.r20.toFixed(2),
          r.metrics.r60 == null ? '' : r.metrics.r60.toFixed(2),
          r.metrics.volRatio == null ? '' : r.metrics.volRatio.toFixed(2),
          r.metrics.distHigh == null ? '' : r.metrics.distHigh.toFixed(2),
          `"${(r.signals || []).map((s) => s.text).join(' / ')}"`,
        ].join(',')
      );
    });
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `asharequant_scan_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast('已导出 CSV');
  }

  // ------------------------------------------------------------ 回测

  function bindBacktest() {
    $('#btStrategy').addEventListener('change', () => {
      renderBtParams();
      const s = bt.STRATEGIES[$('#btStrategy').value];
      $('#btDesc').innerHTML = `<b>${esc(s.name)}</b>：${esc(s.desc)}`;
    });
    $('#btnBacktest').addEventListener('click', runBacktest);
  }

  function renderBtParams() {
    const key = $('#btStrategy').value;
    const s = bt.STRATEGIES[key];
    $('#btParams').innerHTML = (s.params || [])
      .map(
        (p) =>
          `<label class="fld">${esc(p.label)}<input class="input num" data-pk="${p.key}" value="${p.def}" style="width:72px" /></label>`
      )
      .join('');
  }

  async function runBacktest() {
    const code = $('#btCode').value.trim().toUpperCase();
    if (!code) return toast('请输入代码');
    setStatus(true, '回测计算中…');
    $('#btnBacktest').disabled = true;
    try {
      const r = await qd.search(code);
      const hit = r.find((x) => x.code.toUpperCase() === code) || r[0];
      if (!hit) return toast('未找到该代码');
      const k = await qd.kline(hit.secid, {
        period: 'day',
        limit: Number($('#btRange').value),
        fq: Number(state.config.fq || 1),
      });
      if (!k || k.bars.length < 60) return toast('历史数据不足');

      const params = {};
      $$('#btParams [data-pk]').forEach((i) => (params[i.dataset.pk] = Number(i.value)));

      const res = bt.run({
        bars: k.bars,
        strategy: $('#btStrategy').value,
        params,
        initialCapital: Number($('#btCapital').value) || 100000,
        commission: (Number($('#btFee').value) || 0.05) / 100,
        slippage: 0.0005,
      });
      if (res.error) return toast(res.error);
      state.btResult = res;
      renderBacktest(res, k);
      toast('回测完成');
    } catch (e) {
      toast('回测失败：' + (e.message || '请稍后重试'));
    } finally {
      $('#btnBacktest').disabled = false;
      setStatus(false, '就绪');
    }
  }

  function renderBacktest(r, k) {
    $('#btResult').style.display = 'block';
    $('#btMeta').textContent = `${esc(k.name || r.strategy)} ${r.start} → ${r.end} · ${r.strategyName}`;

    const cards = [
      ['总收益率', pct(r.totalReturn), cls(r.totalReturn), `基准 ${pct(r.benchmark)}`],
      ['超额收益(α)', pct(r.alpha), cls(r.alpha), '相对买入持有'],
      ['年化收益', pct(r.annualized), cls(r.annualized), '复利折算'],
      ['最大回撤', '-' + r.maxDrawdown.toFixed(2) + '%', 'down', '峰值到谷底'],
      ['夏普比率', r.sharpe.toFixed(2), r.sharpe > 1 ? 'up' : '', '年化，无风险利率0'],
      ['胜率', r.winRate.toFixed(1) + '%', r.winRate > 50 ? 'up' : '', `共 ${r.tradeCount} 笔交易`],
      ['盈亏比', r.profitFactor === 99 ? '∞' : r.profitFactor.toFixed(2), r.profitFactor > 1 ? 'up' : 'down', '总盈利/总亏损'],
      ['平均持有', r.avgHoldDays.toFixed(1) + '天', '', `期末 ${'$' + f0(r.finalCapital)}`],
    ];
    $('#btMetrics').innerHTML = cards
      .map(
        ([k2, v, c, s]) =>
          `<div class="metric-card"><div class="k">${k2}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`
      )
      .join('');

    drawEquityPanel();

    const tb = $('#btTrades tbody');
    tb.innerHTML = (r.trades || [])
      .map(
        (t, i) =>
          `<tr><td class="muted">${i + 1}</td><td>${esc(t.date)}</td>
        <td class="${t.type === 'buy' ? 'up' : 'down'}">${t.type === 'buy' ? '买入' : '卖出'}${
            t.forced ? '(期末)' : ''
          }</td>
        <td>${f2(t.price)}</td><td>${f0(t.shares)}</td><td>${f0(t.amount)}</td>
        <td class="${t.profit == null ? '' : cls(t.profit)}">${
            t.profit == null ? '--' : (t.profit > 0 ? '+' : '') + f0(t.profit.toFixed(0))
          }</td>
        <td class="${t.profitPct == null ? '' : cls(t.profitPct)}">${
            t.profitPct == null ? '--' : pct(t.profitPct)
          }</td>
        <td>${t.holdDays == null ? '--' : t.holdDays}</td></tr>`
      )
      .join('');
    $('#btTradeMeta').textContent = `${r.trades.length} 笔记录`;
  }

  function drawEquityPanel() {
    if (!state.btResult) return;
    const cv = $('#equityCanvas');
    cv.style.height = '240px';
    window.drawEquity(cv, state.btResult.equity, state.btResult.benchmark, state.btResult.initialCapital);
  }

  // ------------------------------------------------------------ 预警

  function bindAlerts() {
    $('#btnAddAlert').addEventListener('click', async () => {
      const code = $('#alCode').value.trim().toUpperCase();
      const value = Number($('#alValue').value);
      if (!code || !isFinite(value)) return toast('请填写代码与阈值');
      const r = await qd.search(code);
      const hit = r.find((x) => x.code.toUpperCase() === code) || r[0];
      if (!hit) return toast('未找到该代码');
      state.alerts = await qd.alertsAdd({
        secid: hit.secid,
        code: hit.code,
        name: hit.name,
        type: $('#alType').value,
        value,
      });
      $('#alCode').value = '';
      $('#alValue').value = '';
      renderAlerts();
      toast('预警已添加');
    });
  }

  function renderAlerts() {
    const box = $('#alertList');
    const TYPE = {
      above: (v) => `价格上破 ${v}`,
      below: (v) => `价格下破 ${v}`,
      pct_up: (v) => `当日涨幅超过 ${v}%`,
      pct_down: (v) => `当日跌幅超过 ${v}%`,
    };
    $('#alertMeta').textContent = `${state.alerts.length} 条`;
    if (!state.alerts.length) {
      box.innerHTML = '<div class="empty">暂无预警</div>';
      return;
    }
    box.innerHTML = state.alerts
      .map(
        (a) => `<div class="alert-item ${a.lastFire ? 'fired' : ''}">
        <span class="a-code">${esc(a.code)}</span>
        <span class="a-cond">${esc(TYPE[a.type] ? TYPE[a.type](a.value) : a.type)} <span class="muted">${
          a.lastFire ? '· 已于 ' + new Date(a.lastFire).toLocaleString('zh-CN') + ' 触发' : '· 监控中'
        }</span></span>
        <button class="btn sm danger" data-del="${esc(a.id)}">删除</button>
      </div>`
      )
      .join('');
    box.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        state.alerts = await qd.alertsRemove(b.dataset.del);
        renderAlerts();
      })
    );
  }

  function scheduleAlerts() {
    clearInterval(state.timers.alerts);
    state.timers.alerts = setInterval(checkAlerts, 30000);
  }

  async function checkAlerts() {
    if (!$('#alarmOn').checked || !state.alerts.length) return;
    const ids = [...new Set(state.alerts.map((a) => a.secid))];
    let quotes = [];
    try {
      quotes = await qd.quotes(ids, { maxAge: 20000, concurrency: 2 });
    } catch {
      return;
    }
    const map = new Map(quotes.map((q) => [q.secid, q]));
    const now = Date.now();
    for (const a of state.alerts) {
      const q = map.get(a.secid);
      if (!q || q.price == null) continue;
      let hit = false;
      let msg = '';
      if (a.type === 'above' && q.price > a.value) {
        hit = true;
        msg = `${a.code} 现价 ${f2(q.price)}，上破 ${a.value}`;
      } else if (a.type === 'below' && q.price < a.value) {
        hit = true;
        msg = `${a.code} 现价 ${f2(q.price)}，下破 ${a.value}`;
      } else if (a.type === 'pct_up' && q.changePct != null && q.changePct > a.value) {
        hit = true;
        msg = `${a.code} 涨幅 ${pct(q.changePct)}，超过 ${a.value}%`;
      } else if (a.type === 'pct_down' && q.changePct != null && q.changePct < -a.value) {
        hit = true;
        msg = `${a.code} 跌幅 ${pct(q.changePct)}，超过 ${a.value}%`;
      }
      // 同一预警 10 分钟内不重复提醒
      if (hit && (!a.lastFire || now - a.lastFire > 600000)) {
        qd.notify('AShareQuant 预警触发', msg);
        state.alerts = await qd.alertsUpdate(a.id, { lastFire: now });
        renderAlerts();
      }
    }
  }

  // ------------------------------------------------------------ 板块热力

  function bindSector() {
    $$('#sectorSeg button').forEach((b) => {
      b.addEventListener('click', () => {
        $$('#sectorSeg button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        state.sectorType = b.dataset.t;
        loadSectors();
      });
    });
    $('#btnSectorRefresh').addEventListener('click', () => loadSectors());
  }

  async function loadSectors() {
    const type = state.sectorType || 'hy';
    const body = $('#sectorTable').querySelector('tbody');
    const empty = $('#sectorEmpty');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="8" class="muted">加载中…</td></tr>';
    try {
      const rows = await qd.sectors(type);
      state.sectors = rows || [];
      updateSentiment();
      if (!state.sectors.length) {
        body.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      body.innerHTML = state.sectors
        .slice()
        .sort((a, b) => (b.changePct || 0) - (a.changePct || 0))
        .map((s) => {
          const up = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
          const lead = s.leader
            ? `${esc(s.leader.name)} <span class="${up(s.leader.changePct)}">${pct(s.leader.changePct)}</span>`
            : '-';
          return `<tr>
            <td>${esc(s.name)}</td>
            <td class="num ${up(s.changePct)}">${pct(s.changePct)}</td>
            <td>${lead}</td>
            <td class="num ${up(s.d5)}">${pct(s.d5)}</td>
            <td class="num ${up(s.d20)}">${pct(s.d20)}</td>
            <td class="num ${up(s.d60)}">${pct(s.d60)}</td>
            <td class="num">${s.turnover ? s.turnover.toFixed(2) + '%' : '-'}</td>
            <td class="num">${s.circMktCap ? s.circMktCap.toFixed(0) : '-'}</td>
          </tr>`;
        })
        .join('');
    } catch (e) {
      body.innerHTML = '';
      toast('板块加载失败：' + (e.message || e));
    }
  }

  // ------------------------------------------------------------ 持仓管理

  function bindPortfolio() {
    $('#btnPfAdd').addEventListener('click', addPosition);
    $('#pfCost').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addPosition();
    });
    $('#btnPfRefresh').addEventListener('click', () => refreshPortfolio(true));
  }

  async function addPosition() {
    const code = $('#pfCode').value.trim().toUpperCase();
    const shares = Number($('#pfShares').value);
    const cost = Number($('#pfCost').value);
    if (!code) return toast('请输入代码');
    if (!(shares > 0)) return toast('请输入持仓股数');
    if (!(cost > 0)) return toast('请输入成本价');
    setStatus(true, '查询中…');
    try {
      const r = await qd.search(code);
      const hit = r.find((x) => x.code.toUpperCase() === code) || r[0];
      if (!hit) {
        toast('未找到该代码');
        return;
      }
      const list = state.portfolio.slice();
      const exist = list.find((p) => p.secid === hit.secid);
      if (exist) {
        // 已存在：合并加权成本
        const totalShares = exist.shares + shares;
        exist.cost = (exist.cost * exist.shares + cost * shares) / totalShares;
        exist.shares = totalShares;
        for (const k of ['code', 'name', 'market']) exist[k] = hit[k];
      } else {
        list.push({ secid: hit.secid, code: hit.code, name: hit.name, market: hit.market, shares, cost });
      }
      state.portfolio = list;
      await qd.storeSet('portfolio', list);
      $('#pfCode').value = '';
      $('#pfShares').value = '';
      $('#pfCost').value = '';
      renderPortfolio();
      await refreshPortfolio(true);
      toast(`已添加 ${hit.code}`);
    } catch {
      toast('添加失败，请稍后重试');
    } finally {
      setStatus(false);
    }
  }

  async function removePosition(secid) {
    state.portfolio = state.portfolio.filter((p) => p.secid !== secid);
    await qd.storeSet('portfolio', state.portfolio);
    renderPortfolio();
    toast('已移除');
  }

  async function refreshPortfolio(force) {
    if (!state.portfolio.length) return;
    try {
      const list = await qd.quotes(
        state.portfolio.map((p) => p.secid),
        { maxAge: force ? 0 : 8000 }
      );
      for (const q of list) state.quotes.set(q.secid, q);
      renderPortfolio();
    } catch {
      /* 忽略 */
    }
  }

  function renderPortfolio() {
    const tb = $('#pfTable tbody');
    const empty = $('#pfEmpty');
    if (!tb) return;
    const rows = state.portfolio.map((p) => {
      const q = state.quotes.get(p.secid);
      const price = q ? q.price : null;
      const mv = price != null ? price * p.shares : null;
      const cv = p.cost * p.shares;
      const pnl = mv != null ? mv - cv : null;
      const pnlPct = price != null && p.cost > 0 ? (price / p.cost - 1) * 100 : null;
      const dayPnl = q && q.change != null ? q.change * p.shares : null;
      return { ...p, q, price, mv, cv, pnl, pnlPct, dayPnl };
    });

    const totalMv = rows.reduce((a, r) => a + (r.mv || 0), 0);
    const totalCv = rows.reduce((a, r) => a + r.cv, 0);
    const totalPnl = totalMv - totalCv;
    const totalPnlPct = totalCv > 0 ? (totalMv / totalCv - 1) * 100 : 0;
    const totalDay = rows.reduce((a, r) => a + (r.dayPnl || 0), 0);

    $('#pfSummary').innerHTML = [
      ['总市值', '¥' + f0(Math.round(totalMv)), `成本 ¥${f0(Math.round(totalCv))}`, ''],
      ['总浮动盈亏', (totalPnl >= 0 ? '+' : '') + f0(Math.round(totalPnl)), `收益率 ${pct(totalPnlPct)}`, cls(totalPnl)],
      ['当日盈亏', (totalDay >= 0 ? '+' : '') + f0(Math.round(totalDay)), '按最新价 vs 昨收', cls(totalDay)],
      ['持仓数量', String(rows.length), '只标的', ''],
    ]
      .map(
        ([k, v, s, c]) =>
          `<div class="pf-card"><div class="k">${k}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`
      )
      .join('');

    empty.style.display = rows.length ? 'none' : 'block';
    $('#pfMeta').textContent = rows.length ? `共 ${rows.length} 只 · ${new Date().toLocaleTimeString('zh-CN')}` : '';

    tb.innerHTML = rows
      .map((r) => {
        const q = r.q;
        const posPct = totalMv > 0 && r.mv != null ? (r.mv / totalMv) * 100 : 0;
        return `<tr>
          <td><span class="code" data-open="${esc(r.secid)}" data-code="${esc(r.code)}">${esc(r.code)}</span> <span class="name">${esc(r.name || '')}</span></td>
          <td>${f0(r.shares)}</td>
          <td>${f2(r.cost)}</td>
          <td>${r.price == null ? '--' : f2(r.price)}</td>
          <td class="${cls(q ? q.changePct : null)}">${q ? pct(q.changePct) : '--'}</td>
          <td>${r.mv == null ? '--' : f0(Math.round(r.mv))}</td>
          <td class="${cls(r.pnl)}">${r.pnl == null ? '--' : (r.pnl >= 0 ? '+' : '') + f0(Math.round(r.pnl))}</td>
          <td class="${cls(r.pnlPct)}">${r.pnlPct == null ? '--' : pct(r.pnlPct)}</td>
          <td class="${cls(r.dayPnl)}">${r.dayPnl == null ? '--' : (r.dayPnl >= 0 ? '+' : '') + f0(Math.round(r.dayPnl))}</td>
          <td><span class="pos-bar"><i style="width:${posPct.toFixed(1)}%"></i></span> <span class="num" style="font-size:11px">${posPct.toFixed(1)}%</span></td>
          <td><button class="btn sm danger" data-del="${esc(r.secid)}">删除</button></td>
        </tr>`;
      })
      .join('');

    tb.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => removePosition(b.dataset.del))
    );
    tb.querySelectorAll('[data-open]').forEach((b) =>
      b.addEventListener('click', () => openAnalyze(b.dataset.open, b.dataset.code))
    );
  }

  // ------------------------------------------------------------ 主题

  function bindTheme() {
    $$('#themeSeg button').forEach((b) => {
      b.addEventListener('click', async () => {
        const t = b.dataset.th;
        state.config = await qd.configUpdate({ theme: t });
        applyTheme(t);
      });
    });
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if ((state.config && state.config.theme) === 'auto') applyTheme('auto');
      });
    }
  }

  function applyTheme(t) {
    let theme = t || 'dark';
    if (theme === 'auto') {
      const light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      theme = light ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', theme);
    $$('#themeSeg button').forEach((b) =>
      b.classList.toggle('on', b.dataset.th === (t || 'dark'))
    );
    if (state.chart) state.chart.render();
    if (state.chip) renderChipPanel(state.chip);
    if (state.btResult) drawEquityPanel();
  }

  // ------------------------------------------------------------ 设置

  function bindSettings() {
    $('#setFq').addEventListener('change', async () => {
      state.config = await qd.configUpdate({ fq: Number($('#setFq').value) });
      if (state.current) analyze(state.current, true);
      toast('复权方式已更新');
    });
    $('#setPeriod').addEventListener('change', () => {
      setPeriodUI($('#setPeriod').value);
      if (state.current) analyze(state.current, true);
    });
    $('#btnClearCache').addEventListener('click', async () => {
      await qd.clearCache();
      toast('缓存已清理');
    });
    $('#btnReset').addEventListener('click', async () => {
      if (!confirm('确定清空所有自选、预警与扫描结果？此操作不可恢复。')) return;
      await qd.storeSet('watchlist', DEFAULT_WATCH.slice());
      await qd.storeSet('alerts', []);
      await qd.storeSet('scanResults', null);
      state.watchlist = DEFAULT_WATCH.slice();
      state.alerts = [];
      state.scanResults = [];
      renderWatch();
      renderAlerts();
      renderScan();
      toast('已重置');
    });
  }

  // ------------------------------------------------------------ go

  document.addEventListener('DOMContentLoaded', boot);
})();
