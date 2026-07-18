(function () {
  'use strict';

  var DATA_URL = './data/charts/primeviewfx_members_chart_data_latest.json';
  var POLL_MS = 60000;

  var COLORS = {
    bg: '#0f1d2f',
    grid: '#24354d',
    text: '#d6e1ee',
    up: '#48c7a0',
    down: '#e66767',
    wick: '#8192a8'
  };

  var chart = null, candleSeries = null;

  function ensureChart(container) {
    if (chart) return chart;
    chart = LightweightCharts.createChart(container, {
      autoSize: true,
      layout: { background: { type: LightweightCharts.ColorType.Solid, color: COLORS.bg }, textColor: COLORS.text },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3d56' },
      rightPriceScale: { borderColor: '#2a3d56' },
      handleScroll: false,
      handleScale: false
    });
    candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: COLORS.up, downColor: COLORS.down, borderVisible: false,
      wickUpColor: COLORS.wick, wickDownColor: COLORS.wick
    });
    return chart;
  }

  function load(chartEl) {
    fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        ensureChart(chartEl);
        candleSeries.setData(data.candles || []);
      })
      .catch(function () {
        // Homepage teaser chart - fail quietly, no status line to update here.
      });
  }

  function init() {
    var chartEl = document.getElementById('pvfx-home-chart');
    if (!chartEl || typeof LightweightCharts === 'undefined') return;
    load(chartEl);
    setInterval(function () { load(chartEl); }, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
