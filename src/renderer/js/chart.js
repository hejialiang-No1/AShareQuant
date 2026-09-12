/**
 * chart.js —— Canvas 图表引擎（K线 / 成交量 / 副图指标 / 权益曲线）
 * 纯手写，不依赖任何图表库。支持高 DPI、十字光标、滚轮缩放、拖拽平移。
 */
(function () {
  // Apple 系统色板（涨=红 / 跌=绿，符合国内习惯）
  const C = {
    up: '#ff453a',      // 涨：红
    down: '#30d158',    // 跌：绿
    flat: '#98989d',
    grid: 'rgba(255,255,255,.06)',
    axis: 'rgba(235,235,245,.4)',
    text: 'rgba(235,235,245,.62)',
    panel: 'rgba(28,28,30,.5)',
    level: '#64d2ff',
    ma: { 5: '#ffd60a', 10: '#0a84ff', 20: '#bf5af2', 60: '#30d158', 120: '#ff9f0a' },
  };

  /** 按当前主题刷新网格/坐标/文字色（图表要能同时适配深色与亮色） */
  function applyTheme() {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    C.grid = light ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.06)';
    C.axis = light ? 'rgba(60,60,67,.5)' : 'rgba(235,235,245,.4)';
    C.text = light ? 'rgba(60,60,67,.7)' : 'rgba(235,235,245,.62)';
    C.panel = light ? 'rgba(255,255,255,.7)' : 'rgba(28,28,30,.5)';
    C.level = light ? '#007aff' : '#64d2ff';
  }

  function fmt(v, d) {
    if (v == null || !isFinite(v)) return '--';
    return Number(v).toFixed(d == null ? 2 : d);
  }

  /** 双字段名归一化：数据源为短名 {t,o,h,l,c,v}，内部统一用 {date,open,high,low,close,volume} */
  function nb(b) {
    if (!b) return { date: '', open: 0, high: 0, low: 0, close: 0, volume: 0 };
    return {
      date: b.date != null ? b.date : (b.t || ''),
      open: b.open != null ? b.open : b.o,
      high: b.high != null ? b.high : b.h,
      low: b.low != null ? b.low : b.l,
      close: b.close != null ? b.close : b.c,
      volume: b.volume != null ? b.volume : (b.v || 0),
    };
  }

  function fmtBig(v) {
    if (v == null || !isFinite(v)) return '--';
    const a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(2) + '万亿';
    if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(2) + '万';
    return v.toFixed(0);
  }

  class KLineChart {
    constructor(canvas, tipEl) {
      this.canvas = canvas;
      this.tip = tipEl;
      this.ctx = canvas.getContext('2d');
      this.bars = [];
      this.ind = {};
      this.sub = 'macd';
      this.count = 120;
      this.offset = 0; // 右侧偏移（0 = 贴最新）
      this.hover = -1;
      this.onHover = null;
      this.signals = [];        // 买卖点数组
      this.patterns = [];       // K线形态
      this.levels = null;       // 支撑/压力位
      this.showSignals = true;  // K线标注开关
      this.showLevels = true;   // 支撑压力线开关
      this.pad = { l: 8, r: 62, t: 12, b: 22 };
      this._bind();
    }

    setData(bars, ind, sub) {
      // 归一化：数据源可能给短字段名（t/o/h/l/c/v），统一成标准名后再绘图
      this.bars = (bars || []).map(nb);
      this.ind = ind || {};
      if (sub) this.sub = sub;
      this.count = Math.min(this.count || 120, this.bars.length);
      this.offset = 0;
      this.render();
    }

    /** 设置买卖点（来自 signals.detect） */
    setSignals(arr) {
      this.signals = arr || [];
      this.render();
    }

    /** 设置 K 线形态（来自 patterns.detect） */
    setPatterns(arr) {
      this.patterns = arr || [];
      this.render();
    }

    /** 设置支撑/压力位（来自 levels.compute） */
    setLevels(lv) {
      this.levels = lv || null;
      this.render();
    }

    _bind() {
      const cv = this.canvas;
      cv.addEventListener('mousemove', (e) => {
        const r = cv.getBoundingClientRect();
        const x = e.clientX - r.left;
        const { i } = this._hit(x);
        this.hover = i;
        this.render();
        if (this.onHover) this.onHover(i, e.clientX - r.left, e.clientY - r.top);
      });
      cv.addEventListener('mouseleave', () => {
        this.hover = -1;
        this.render();
        if (this.tip) this.tip.style.display = 'none';
        if (this.onHover) this.onHover(-1);
      });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const d = e.deltaY > 0 ? 1 : -1;
        this.count = Math.max(30, Math.min(this.bars.length, this.count + d * 8));
        this.offset = Math.max(0, Math.min(this.offset, this.bars.length - this.count));
        this.render();
      }, { passive: false });

      let dragging = false;
      let lastX = 0;
      cv.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; });
      window.addEventListener('mouseup', () => { dragging = false; });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        if (Math.abs(dx) > 6) {
          const step = Math.max(1, Math.round(this.count / 40));
          this.offset = Math.max(0, Math.min(this.bars.length - this.count, this.offset + (dx > 0 ? step : -step)));
          lastX = e.clientX;
          this.render();
        }
      });
    }

    _hit(px) {
      const n = this.bars.length;
      const end = n - this.offset;
      const start = Math.max(0, end - this.count);
      const vis = end - start;
      const geo = this._geo();
      const bw = geo.w / Math.max(vis, 1);
      let i = start + Math.floor((px - this.pad.l) / bw);
      i = Math.max(start, Math.min(end - 1, i));
      return { i, start, end };
    }

    _geo() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const innerW = w - this.pad.l - this.pad.r;
      const innerH = h - this.pad.t - this.pad.b;
      const volH = Math.max(38, innerH * 0.13);
      const subH = Math.max(46, innerH * 0.2);
      const mainH = innerH - volH - subH - 16;
      return {
        w, h, innerW, innerH,
        main: { y: this.pad.t, h: mainH },
        vol: { y: this.pad.t + mainH + 8, h: volH },
        sub: { y: this.pad.t + mainH + 8 + volH + 8, h: subH },
      };
    }

    render() {
      applyTheme();
      const { bars, ind } = this;
      const ctx = this.ctx;
      const geo = this._geo();
      ctx.clearRect(0, 0, geo.w, geo.h);
      if (!bars.length) return;

      const n = bars.length;
      const end = n - this.offset;
      const start = Math.max(0, end - this.count);
      const vis = bars.slice(start, end);
      if (!vis.length) return;

      // ---- 主图价格区间（含 MA 与 BOLL）
      let lo = Infinity;
      let hi = -Infinity;
      for (const b of vis) {
        if (b.low < lo) lo = b.low;
        if (b.high > hi) hi = b.high;
      }
      for (const key of ['ma5', 'ma10', 'ma20', 'ma60']) {
        const arr = ind[key];
        if (!arr) continue;
        for (let i = start; i < end; i++) {
          const v = arr[i];
          if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
        }
      }
      if (ind.bollUp) {
        for (let i = start; i < end; i++) {
          if (ind.bollUp[i] != null) hi = Math.max(hi, ind.bollUp[i]);
          if (ind.bollLow[i] != null) lo = Math.min(lo, ind.bollLow[i]);
        }
      }
      const range = hi - lo || 1;
      lo -= range * 0.04;
      hi += range * 0.04;

      const bw = geo.innerW / vis.length;
      const cw = Math.max(1.2, bw * 0.68);

      const yOf = (p, box) => box.y + box.h - ((p - lo) / (hi - lo)) * box.h;
      const xOf = (i) => this.pad.l + (i - start) * bw + bw / 2;

      // ---- 网格 + 价格轴
      ctx.strokeStyle = C.grid;
      ctx.fillStyle = C.axis;
      ctx.font = '10px SF Mono, Menlo, monospace';
      ctx.lineWidth = 1;
      ctx.textAlign = 'left';
      for (let k = 0; k <= 4; k++) {
        const p = lo + ((hi - lo) * k) / 4;
        const y = yOf(p, geo.main);
        ctx.beginPath();
        ctx.moveTo(this.pad.l, y);
        ctx.lineTo(this.pad.l + geo.innerW, y);
        ctx.strokeStyle = C.grid;
        ctx.stroke();
        ctx.fillText(fmt(p), this.pad.l + geo.innerW + 6, y + 3.5);
      }

      // ---- 日期轴
      ctx.textAlign = 'center';
      const stepD = Math.max(1, Math.floor(vis.length / 6));
      for (let j = 0; j < vis.length; j += stepD) {
        const i = start + j;
        const x = xOf(i);
        ctx.fillText(String(bars[i].date).slice(2), x, geo.h - 6);
      }
      ctx.textAlign = 'left';

      // ---- BOLL 填充
      if (ind.bollUp && ind.bollLow) {
        ctx.beginPath();
        let started = false;
        for (let i = start; i < end; i++) {
          if (ind.bollUp[i] == null) continue;
          const x = xOf(i);
          const y = yOf(ind.bollUp[i], geo.main);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        for (let i = end - 1; i >= start; i--) {
          if (ind.bollLow[i] == null) continue;
          ctx.lineTo(xOf(i), yOf(ind.bollLow[i], geo.main));
        }
        if (started) {
          ctx.closePath();
          ctx.fillStyle = 'rgba(10,132,255,.05)';
          ctx.fill();
        }
      }

      // ---- 支撑 / 压力位横线
      if (this.showLevels && this.levels) {
        const lv = this.levels;
        const drawLevel = (price, color, label) => {
          if (price == null || price < lo || price > hi) return;
          const y = yOf(price, geo.main);
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(this.pad.l, y);
          ctx.lineTo(this.pad.l + geo.innerW, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = color;
          ctx.font = '9px SF Mono, Menlo, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(label, this.pad.l + 4, y - 3);
        };
        for (const s of (lv.supports || []).slice(0, 3)) drawLevel(s.price, 'rgba(48,209,88,.55)', 'S ' + fmt(s.price));
        for (const r of (lv.resistances || []).slice(0, 3)) drawLevel(r.price, 'rgba(255,69,58,.55)', 'R ' + fmt(r.price));
      }

      // ---- 蜡烛
      for (let i = start; i < end; i++) {
        const b = bars[i];
        const up = b.close >= b.open;
        const col = up ? C.up : C.down;
        const x = xOf(i);
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, yOf(b.high, geo.main));
        ctx.lineTo(Math.round(x) + 0.5, yOf(b.low, geo.main));
        ctx.stroke();
        const yo = yOf(b.open, geo.main);
        const yc = yOf(b.close, geo.main);
        const top = Math.min(yo, yc);
        const hgt = Math.max(1, Math.abs(yc - yo));
        ctx.fillRect(x - cw / 2, top, cw, hgt);
      }

      // ---- 均线
      ctx.lineWidth = 1.2;
      for (const key of ['ma5', 'ma10', 'ma20', 'ma60']) {
        const arr = ind[key];
        if (!arr) continue;
        ctx.strokeStyle = C.ma[key.replace('ma', '')] || '#888';
        ctx.beginPath();
        let started = false;
        for (let i = start; i < end; i++) {
          const v = arr[i];
          if (v == null) continue;
          const x = xOf(i);
          const y = yOf(v, geo.main);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // 最新价虚线 + 标签
      const last = bars[end - 1];
      if (last) {
        const y = yOf(last.close, geo.main);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = last.close >= last.open ? C.up : C.down;
        ctx.beginPath();
        ctx.moveTo(this.pad.l, y);
        ctx.lineTo(this.pad.l + geo.innerW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = last.close >= last.open ? C.up : C.down;
        ctx.fillRect(this.pad.l + geo.innerW + 2, y - 8, 56, 15);
        ctx.fillStyle = '#fff';
        ctx.font = '10px SF Mono, Menlo, monospace';
        ctx.fillText(fmt(last.close), this.pad.l + geo.innerW + 6, y + 4);
      }

      // ---- 买卖点标记（红↑买 / 绿↓卖）----
      if (this.showSignals && this.signals.length) {
        const C_UP = '#f6465d';
        const C_DN = '#0ecb81';
        for (const s of this.signals) {
          if (s.index < start || s.index >= end) continue;
          const x = xOf(s.index);
          const b = bars[s.index];
          if (!b) continue;
          if (s.type === 'buy') {
            const y = yOf(b.low, geo.main) + 6;
            ctx.fillStyle = C_UP;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - 4.6, y + 9);
            ctx.lineTo(x + 4.6, y + 9);
            ctx.closePath();
            ctx.fill();
          } else {
            const y = yOf(b.high, geo.main) - 6;
            ctx.fillStyle = C_DN;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - 4.6, y - 9);
            ctx.lineTo(x + 4.6, y - 9);
            ctx.closePath();
            ctx.fill();
          }
        }
      }

      // ---- K线形态标记（小空心圈，仅强度≥2）
      if (this.patterns.length) {
        for (const p of this.patterns) {
          if (p.index < start || p.index >= end || (p.strength || 1) < 2) continue;
          const x = xOf(p.index);
          const b = bars[p.index];
          if (!b) continue;
          const isBull = p.type === 'bull';
          const col = isBull ? C.up : p.type === 'bear' ? C.down : C.flat;
          const y = isBull ? yOf(b.low, geo.main) + 17 : yOf(b.high, geo.main) - 17;
          ctx.beginPath();
          ctx.arc(x, y, 3.2, 0, Math.PI * 2);
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.3;
          ctx.stroke();
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(x, y, 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ---- 成交量
      let vmax = 0;
      for (let i = start; i < end; i++) vmax = Math.max(vmax, bars[i].volume || 0);
      const vbox = geo.vol;
      for (let i = start; i < end; i++) {
        const b = bars[i];
        const up = b.close >= b.open;
        const h = ((b.volume || 0) / (vmax || 1)) * vbox.h;
        ctx.fillStyle = up ? 'rgba(255,69,58,.6)' : 'rgba(48,209,88,.6)';
        ctx.fillRect(xOf(i) - cw / 2, vbox.y + vbox.h - h, cw, h);
      }
      if (ind.volMa5) {
        ctx.strokeStyle = '#ffd60a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        let st = false;
        for (let i = start; i < end; i++) {
          const v = ind.volMa5[i];
          if (v == null) continue;
          const y = vbox.y + vbox.h - (v / (vmax || 1)) * vbox.h;
          if (!st) { ctx.moveTo(xOf(i), y); st = true; } else ctx.lineTo(xOf(i), y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = C.axis;
      ctx.font = '9.5px SF Mono, Menlo, monospace';
      ctx.fillText('VOL ' + fmtBig(vmax), this.pad.l + 4, vbox.y + 11);

      // ---- 副图
      const sbox = geo.sub;
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      ctx.moveTo(this.pad.l, sbox.y);
      ctx.lineTo(this.pad.l + geo.innerW, sbox.y);
      ctx.stroke();

      if (this.sub === 'macd' && ind.macd) {
        let m = 0;
        for (let i = start; i < end; i++) {
          const v = ind.macd.hist[i];
          if (v != null) m = Math.max(m, Math.abs(v));
        }
        m = m || 1;
        const zeroY = sbox.y + sbox.h / 2;
        for (let i = start; i < end; i++) {
          const v = ind.macd.hist[i];
          if (v == null) continue;
          const h = (Math.abs(v) / m) * (sbox.h / 2 - 2);
          ctx.fillStyle = v >= 0 ? 'rgba(255,69,58,.8)' : 'rgba(48,209,88,.8)';
          ctx.fillRect(xOf(i) - cw / 2, v >= 0 ? zeroY - h : zeroY, cw, h);
        }
        const line = (arr, color) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          let st = false;
          for (let i = start; i < end; i++) {
            const v = arr[i];
            if (v == null) continue;
            const y = zeroY - (v / m) * (sbox.h / 2 - 2);
            if (!st) { ctx.moveTo(xOf(i), y); st = true; } else ctx.lineTo(xOf(i), y);
          }
          ctx.stroke();
        };
        line(ind.macd.dif, '#ffd60a');
        line(ind.macd.dea, '#0a84ff');
        ctx.fillStyle = C.axis;
        ctx.font = '9.5px SF Mono, Menlo, monospace';
        ctx.fillText('MACD(12,26,9)', this.pad.l + 4, sbox.y + 11);
      } else if (this.sub === 'rsi' && ind.rsi) {
        const yFor = (v) => sbox.y + sbox.h - ((v - 10) / 80) * sbox.h;
        ctx.setLineDash([2, 3]);
        for (const lv of [30, 50, 70]) {
          ctx.strokeStyle = lv === 50 ? 'rgba(255,255,255,.08)' : 'rgba(255,214,10,.32)';
          ctx.beginPath();
          ctx.moveTo(this.pad.l, yFor(lv));
          ctx.lineTo(this.pad.l + geo.innerW, yFor(lv));
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.fillStyle = C.axis;
        ctx.font = '9.5px SF Mono, Menlo, monospace';
        ctx.fillText('70', this.pad.l + geo.innerW + 6, yFor(70) + 3);
        ctx.fillText('30', this.pad.l + geo.innerW + 6, yFor(30) + 3);
        for (const [arr, col] of [[ind.rsi, '#bf5af2']]) {
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          let st = false;
          for (let i = start; i < end; i++) {
            const v = arr[i];
            if (v == null) continue;
            const y = yFor(Math.max(10, Math.min(90, v)));
            if (!st) { ctx.moveTo(xOf(i), y); st = true; } else ctx.lineTo(xOf(i), y);
          }
          ctx.stroke();
        }
        ctx.fillStyle = C.axis;
        ctx.fillText('RSI(14)', this.pad.l + 4, sbox.y + 11);
      } else if (this.sub === 'kdj' && ind.kdj) {
        const yFor = (v) => sbox.y + sbox.h - ((v - 0) / 100) * sbox.h;
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = 'rgba(255,255,255,.1)';
        ctx.beginPath();
        ctx.moveTo(this.pad.l, yFor(50));
        ctx.lineTo(this.pad.l + geo.innerW, yFor(50));
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [arr, col] of [[ind.kdj.k, '#ffd60a'], [ind.kdj.d, '#0a84ff'], [ind.kdj.j, '#bf5af2']]) {
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          let st = false;
          for (let i = start; i < end; i++) {
            const v = arr[i];
            if (v == null) continue;
            const y = yFor(Math.max(0, Math.min(100, v)));
            if (!st) { ctx.moveTo(xOf(i), y); st = true; } else ctx.lineTo(xOf(i), y);
          }
          ctx.stroke();
        }
        ctx.fillStyle = C.axis;
        ctx.font = '9.5px SF Mono, Menlo, monospace';
        ctx.fillText('KDJ(9,3,3)', this.pad.l + 4, sbox.y + 11);
      } else {
        // 纯成交量放大版
        ctx.fillStyle = C.axis;
        ctx.font = '9.5px SF Mono, Menlo, monospace';
        ctx.fillText('VOLUME', this.pad.l + 4, sbox.y + 11);
      }

      // ---- 十字光标
      if (this.hover >= start && this.hover < end) {
        const x = xOf(this.hover);
        const b = bars[this.hover];
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = 'rgba(255,255,255,.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, this.pad.t);
        ctx.lineTo(x, geo.sub.y + geo.sub.h);
        ctx.stroke();
        const y = yOf(b.close, geo.main);
        ctx.beginPath();
        ctx.moveTo(this.pad.l, y);
        ctx.lineTo(this.pad.l + geo.innerW, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    /** 供 tooltip 使用：返回当前 hover 的 bar 下标 */
    hoverIndex() {
      return this.hover;
    }
  }

  /** 权益曲线：strategy 与 buy&hold 对比 */
  function drawEquity(canvas, equity, benchmarkPct, initial) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!equity || equity.length < 2) return;
    applyTheme();

    const pad = { l: 8, r: 66, t: 14, b: 22 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;

    const values = equity.map((e) => e.value);
    const bhEnd = initial * (1 + (benchmarkPct || 0) / 100);
    let lo = Math.min(...values, initial, bhEnd);
    let hi = Math.max(...values, initial, bhEnd);
    const rg = hi - lo || 1;
    lo -= rg * 0.08;
    hi += rg * 0.08;

    const xOf = (i) => pad.l + (i / (equity.length - 1)) * iw;
    const yOf = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;

    // 网格
    ctx.font = '10px SF Mono, Menlo, monospace';
    ctx.textAlign = 'left';
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      const y = yOf(v);
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + iw, y);
      ctx.stroke();
      ctx.fillStyle = C.axis;
      ctx.fillText((v / 1000).toFixed(1) + 'k', pad.l + iw + 6, y + 3.5);
    }

    // 初始资金参考线
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.beginPath();
    ctx.moveTo(pad.l, yOf(initial));
    ctx.lineTo(pad.l + iw, yOf(initial));
    ctx.stroke();
    ctx.setLineDash([]);

    // 基准线
    ctx.strokeStyle = '#98989d';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(pad.l, yOf(initial));
    ctx.lineTo(pad.l + iw, yOf(bhEnd));
    ctx.stroke();

    // 策略曲线 + 面积
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(values[0]));
    for (let i = 1; i < values.length; i++) ctx.lineTo(xOf(i), yOf(values[i]));
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    grad.addColorStop(0, 'rgba(10,132,255,.26)');
    grad.addColorStop(1, 'rgba(10,132,255,0)');
    ctx.lineTo(xOf(values.length - 1), pad.t + ih);
    ctx.lineTo(xOf(0), pad.t + ih);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(values[0]));
    for (let i = 1; i < values.length; i++) ctx.lineTo(xOf(i), yOf(values[i]));
    ctx.strokeStyle = '#0a84ff';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 持仓区间高亮
    ctx.fillStyle = 'rgba(255,214,10,.1)';
    let segStart = null;
    for (let i = 0; i < equity.length; i++) {
      if (equity[i].position && segStart === null) segStart = i;
      if ((!equity[i].position || i === equity.length - 1) && segStart !== null) {
        ctx.fillRect(xOf(segStart), pad.t, Math.max(1, xOf(i) - xOf(segStart)), ih);
        segStart = null;
      }
    }

    // 日期轴
    ctx.fillStyle = C.axis;
    ctx.textAlign = 'center';
    const st = Math.max(1, Math.floor(equity.length / 6));
    for (let i = 0; i < equity.length; i += st) {
      ctx.fillText(String(equity[i].date).slice(2), xOf(i), h - 6);
    }
    ctx.textAlign = 'left';
  }

  /**
   * 筹码分布图：价格纵向（低→高），横向柱长=该价位的筹码占比。
   * 现价下方的筹码（获利盘）用红，上方（套牢盘）用绿；
   * 另标出平均成本线与现价线。
   */
  function drawChips(canvas, chip) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!chip || !chip.bins || !chip.bins.length) return;
    applyTheme();

    const pad = { l: 46, r: 14, t: 16, b: 18 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const bins = chip.bins;
    const n = bins.length;
    const lo = chip.range.low;
    const hi = chip.range.high;
    const maxW = chip.maxWeight || 1;
    const bh = ih / n;

    const yOf = (price) => pad.t + ih - ((price - lo) / ((hi - lo) || 1)) * ih;

    // 柱体
    for (let i = 0; i < n; i++) {
      const b = bins[i];
      const y = pad.t + ih - (i + 1) * bh;
      const len = (b.weight / maxW) * (iw - 8);
      const profit = b.price <= chip.price;
      ctx.fillStyle = profit ? 'rgba(255,69,58,.5)' : 'rgba(48,209,88,.45)';
      ctx.fillRect(pad.l, y + bh * 0.08, Math.max(0.5, len), Math.max(1, bh * 0.84));
    }

    // 价格刻度
    ctx.fillStyle = C.axis;
    ctx.font = '9.5px SF Mono, Menlo, monospace';
    ctx.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
      const p = lo + ((hi - lo) * k) / 4;
      ctx.fillText(fmt(p), pad.l - 5, yOf(p) + 3);
    }
    ctx.textAlign = 'left';

    // 平均成本线
    const yAvg = yOf(chip.avgCost);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(255,214,10,.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, yAvg);
    ctx.lineTo(pad.l + iw, yAvg);
    ctx.stroke();

    // 现价线
    const yPx = yOf(chip.price);
    ctx.strokeStyle = C.level;
    ctx.beginPath();
    ctx.moveTo(pad.l, yPx);
    ctx.lineTo(pad.l + iw, yPx);
    ctx.stroke();
    ctx.setLineDash([]);

    // 标注
    ctx.font = '9.5px SF Mono, Menlo, monospace';
    ctx.fillStyle = 'rgba(255,214,10,.95)';
    ctx.fillText('均价 ' + fmt(chip.avgCost), pad.l + iw - 74, yAvg - 3);
    ctx.fillStyle = C.level;
    ctx.fillText('现价 ' + fmt(chip.price), pad.l + iw - 74, yPx + 11);
  }

  window.KLineChart = KLineChart;
  window.drawEquity = drawEquity;
  window.drawChips = drawChips;
  window.ChartUtil = { fmt, fmtBig };
})();
