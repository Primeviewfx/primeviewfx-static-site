(function () {
  'use strict';

  // Absolute path - this page is served through /member-area/chart (a
  // Function proxying the real file), so a relative path would resolve
  // against the wrong URL and 404 silently, leaving the chart stuck on
  // "Connecting to live data..." forever.
  var DATA_URL = '/data/charts/primeviewfx_members_chart_data_latest.json';
  var POLL_MS = 45000;

  var COLORS = {
    bg: '#0f1d2f',
    grid: '#24354d',
    text: '#d6e1ee',
    up: '#48c7a0',
    down: '#e66767',
    wick: '#8192a8',
    ema: '#f59e0b',
    goldturn: '#ffd34d'
  };

  var LEVEL_COLORS = { CORE: '#f7c948', SECONDARY: '#93c5fd', REJECT: '#6b7c93' };

  function fmtPrice(p) {
    return Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  var chart = null, candleSeries = null, emaSeries = null, priceLines = [], levelLines = [];
  var currentGoldturnLevels = []; // read by the autoscale provider below — kept in
  // sync by renderGoldturns so the price scale always stretches to fit every
  // turn, not just whichever ones happen to fall inside the visible candles.
  var currentLadderLevels = []; // same idea, for the weighted ladder (data.levels)

  function ensureChart(container) {
    if (chart) return chart;
    chart = LightweightCharts.createChart(container, {
      autoSize: true,
      layout: { background: { type: LightweightCharts.ColorType.Solid, color: COLORS.bg }, textColor: COLORS.text },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3d56' },
      rightPriceScale: { borderColor: '#2a3d56' },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
    });
    candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: COLORS.up, downColor: COLORS.down, borderVisible: false,
      wickUpColor: COLORS.wick, wickDownColor: COLORS.wick,
      autoscaleInfoProvider: function (original) {
        var res = original();
        var extra = currentGoldturnLevels.concat(currentLadderLevels);
        if (res === null || !extra.length) return res;
        var minValue = res.priceRange.minValue;
        var maxValue = res.priceRange.maxValue;
        extra.forEach(function (lvl) {
          if (lvl < minValue) minValue = lvl;
          if (lvl > maxValue) maxValue = lvl;
        });
        res.priceRange.minValue = minValue;
        res.priceRange.maxValue = maxValue;
        return res;
      }
    });
    emaSeries = chart.addSeries(LightweightCharts.LineSeries, {
      color: COLORS.ema, lineWidth: 2, priceLineVisible: false, lastValueVisible: false
    });
    return chart;
  }

  function renderGoldturns(goldturns) {
    priceLines.forEach(function (pl) { candleSeries.removePriceLine(pl); });
    priceLines = [];
    currentGoldturnLevels = (goldturns || []).map(function (g) { return g.level; });
    (goldturns || []).forEach(function (g) {
      var touched = !!g.touched;
      priceLines.push(candleSeries.createPriceLine({
        price: g.level,
        color: COLORS.goldturn,
        lineWidth: touched ? 2 : 1,
        lineStyle: touched ? LightweightCharts.LineStyle.Dashed : LightweightCharts.LineStyle.SparseDotted,
        axisLabelVisible: true,
        title: (touched ? 'GZ ✓ ' : 'GZ ') + fmtPrice(g.level)
      }));
    });
  }

  function renderLevels(levels) {
    levelLines.forEach(function (pl) { candleSeries.removePriceLine(pl); });
    levelLines = [];
    currentLadderLevels = (levels || []).map(function (l) { return l.price; });
    (levels || []).forEach(function (l) {
      levelLines.push(candleSeries.createPriceLine({
        price: l.price,
        color: LEVEL_COLORS[l.label] || '#93c5fd',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true,
        title: l.label
      }));
    });
  }

  function arrow(direction) {
    if (direction === 'rising') return '▲';
    if (direction === 'falling') return '▼';
    return '→';
  }

  function pct(v) {
    return typeof v === 'number' ? Math.abs(v).toFixed(2) : '0.00';
  }

  function injectConfluenceStyles() {
    if (document.getElementById('pvfx-gt-confluence-style')) return;
    var style = document.createElement('style');
    style.id = 'pvfx-gt-confluence-style';
    style.textContent =
      '.gt-confluence{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}' +
      '.gt-badge{border:1px solid #2a3d56;border-radius:999px;padding:4px 12px;' +
      'font-size:.82rem;color:#d6e1ee;background:#0b1725}';
    document.head.appendChild(style);
  }

  function renderConfluence(statusEl, confluence, state) {
    var el = document.getElementById('pvfx-gt-confluence');
    if (!el) {
      injectConfluenceStyles();
      el = document.createElement('div');
      el.id = 'pvfx-gt-confluence';
      el.className = 'gt-confluence';
      statusEl.parentNode.insertBefore(el, statusEl.nextSibling);
    }
    if (!confluence) { el.innerHTML = ''; return; }

    var dxy = confluence.dxy || {};
    var xag = confluence.xagusd || {};
    var combined = 'NEUTRAL', combinedColor = '#8fa3bb';
    if (dxy.direction === 'falling' && xag.direction === 'rising') {
      combined = 'BULLISH'; combinedColor = '#48c7a0';
    } else if (dxy.direction === 'rising' && xag.direction === 'falling') {
      combined = 'BEARISH'; combinedColor = '#e66767';
    }

    var badges = [
      '<span class="gt-badge">' + (dxy.symbol || 'DXY') + ' ' + arrow(dxy.direction) + ' ' + pct(dxy.change_pct) + '%</span>',
      '<span class="gt-badge">' + (xag.symbol || 'XAGUSD') + ' ' + arrow(xag.direction) + ' ' + pct(xag.change_pct) + '%</span>',
      '<span class="gt-badge" style="color:' + combinedColor + ';border-color:' + combinedColor + '">Confluence: ' + combined + '</span>'
    ];
    if (state && state.weekly_bias) {
      badges.push('<span class="gt-badge">Bias: ' + state.weekly_bias + '</span>');
    }
    el.innerHTML = badges.join('');
  }

  function setStatus(el, text, isError) {
    el.textContent = text;
    el.classList.toggle('err', !!isError);
  }

  function load(chartEl, statusEl) {
    var url = DATA_URL + '?t=' + Date.now();
    fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        ensureChart(chartEl);
        // Levels set before setData() so the autoscale provider sees them on
        // the very first autoscale pass, not one render behind.
        currentGoldturnLevels = (data.goldturns || []).map(function (g) { return g.level; });
        currentLadderLevels = (data.levels || []).map(function (l) { return l.price; });
        candleSeries.setData(data.candles);
        emaSeries.setData(data.ema5);
        renderGoldturns(data.goldturns);
        renderLevels(data.levels);
        renderConfluence(statusEl, data.confluence, data.state);
        var gen = new Date(data.generated_utc);
        var stamp = isNaN(gen.getTime()) ? data.generated_utc : gen.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
        var touchedCount = (data.goldturns || []).filter(function (g) { return g.touched; }).length;
        var total = (data.goldturns || []).length;
        setStatus(statusEl, 'Live · data generated ' + stamp + ' · close ' + fmtPrice(data.latest_close) +
          ' · ' + touchedCount + '/' + total + ' turns touched this week · refreshes automatically', false);
      })
      .catch(function (err) {
        setStatus(statusEl, 'Could not load live data (' + err.message + ') — showing the last successful load, if any.', true);
      });
  }

  function init() {
    var chartEl = document.getElementById('pvfx-gt-chart');
    var statusEl = document.getElementById('pvfx-gt-status');
    if (!chartEl || !statusEl) return;
    if (typeof LightweightCharts === 'undefined') {
      setStatus(statusEl, 'Live chart library failed to load.', true);
      return;
    }
    load(chartEl, statusEl);
    setInterval(function () { load(chartEl, statusEl); }, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
