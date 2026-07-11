(function () {
  'use strict';

  var DATA_URL = './data/charts/primeviewfx_members_chart_data_latest.json';
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

  function fmtPrice(p) {
    return Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  var chart = null, candleSeries = null, emaSeries = null, priceLines = [];
  var currentGoldturnLevels = []; // read by the autoscale provider below — kept in
  // sync by renderGoldturns so the price scale always stretches to fit every
  // turn, not just whichever ones happen to fall inside the visible candles.

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
        if (res === null || !currentGoldturnLevels.length) return res;
        var minValue = res.priceRange.minValue;
        var maxValue = res.priceRange.maxValue;
        currentGoldturnLevels.forEach(function (lvl) {
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
        title: (touched ? 'GT ✓ ' : 'GT ') + fmtPrice(g.level)
      }));
    });
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
        candleSeries.setData(data.candles);
        emaSeries.setData(data.ema5);
        renderGoldturns(data.goldturns);
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
