(function () {
  'use strict';

  var DATA_URL = './data/charts/primeviewfx_members_chart_data_latest.json';
  var POLL_MS = 45000;

  var COLORS = {
    bg: '#0f1d2f',
    grid: '#24354d',
    text: '#d6e1ee',
    muted: '#8fa3bb',
    up: '#48c7a0',
    down: '#e66767',
    wick: '#8192a8',
    ema: '#f59e0b',
    core: '#73d9c6',
    secondary: '#a8b3c3',
    reject: '#ef8f8f',
    current: '#eef4fb',
    goldturn: '#ffd34d'
  };

  var LABEL_COLOR = { CORE: COLORS.core, SECONDARY: COLORS.secondary, REJECT: COLORS.reject };
  var SHORT_LABEL = { CORE: 'CORE', SECONDARY: 'SEC', REJECT: 'REJ' };

  function fmtPrice(p) {
    return Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function humanState(s) {
    if (!s) return '—';
    return String(s).replace(/_/g, ' ').replace(/\w\S*/g, function (t) {
      return t.charAt(0).toUpperCase() + t.substr(1).toLowerCase();
    });
  }

  var chart = null, candleSeries = null, emaSeries = null, priceLines = [];

  function ensureChart(container) {
    if (chart) return chart;
    chart = LightweightCharts.createChart(container, {
      autoSize: true,
      layout: {
        background: { type: LightweightCharts.ColorType.Solid, color: COLORS.bg },
        textColor: COLORS.text
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid }
      },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3d56' },
      rightPriceScale: { borderColor: '#2a3d56' },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
    });
    candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderVisible: false,
      wickUpColor: COLORS.wick,
      wickDownColor: COLORS.wick
    });
    emaSeries = chart.addSeries(LightweightCharts.LineSeries, {
      color: COLORS.ema,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false
    });
    return chart;
  }

  function renderLevels(levels, latestClose, goldturns) {
    priceLines.forEach(function (pl) { candleSeries.removePriceLine(pl); });
    priceLines = [];
    levels.forEach(function (lv) {
      var color = LABEL_COLOR[lv.label] || COLORS.muted;
      var tag = SHORT_LABEL[lv.label] || 'LVL';
      priceLines.push(candleSeries.createPriceLine({
        price: lv.price,
        color: color,
        lineWidth: lv.label === 'CORE' ? 2 : 1,
        lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true,
        title: tag + ' ' + fmtPrice(lv.price)
      }));
    });
    // Weekly Gold Zones — EMA5 slope-reversal pivots frozen for the week,
    // dashed and colour-distinct so they never read as a published level.
    (goldturns || []).forEach(function (g) {
      priceLines.push(candleSeries.createPriceLine({
        price: g.level,
        color: COLORS.goldturn,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'GZ ' + fmtPrice(g.level)
      }));
    });
    priceLines.push(candleSeries.createPriceLine({
      price: latestClose,
      color: COLORS.current,
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'CURRENT'
    }));
  }

  function row(prefix, lv, latestClose) {
    var color = LABEL_COLOR[lv.label] || COLORS.muted;
    var tag = SHORT_LABEL[lv.label] || 'LVL';
    var dist = Math.abs(lv.price - latestClose).toFixed(1);
    return '<div class="pvfx-live-row">' +
      '<span class="pvfx-live-tag" style="color:' + color + '">' + prefix + ' ' + tag + '</span>' +
      '<span class="pvfx-live-price" style="color:' + color + '">' + fmtPrice(lv.price) + '</span>' +
      '<span class="pvfx-live-gap">' + dist + '</span>' +
      '</div>';
  }

  var DIR_ARROW = { rising: '▲', falling: '▼', flat: '▬', unknown: '' };
  var DIR_COLOR = { rising: COLORS.up, falling: COLORS.down, flat: COLORS.muted, unknown: COLORS.muted };

  function confluenceRow(label, inst) {
    if (!inst) return '';
    var arrow = DIR_ARROW[inst.direction] || '';
    var color = DIR_COLOR[inst.direction] || COLORS.muted;
    var pct = (inst.change_pct === null || inst.change_pct === undefined)
      ? '' : (inst.change_pct >= 0 ? '+' : '') + inst.change_pct.toFixed(2) + '%';
    return '<div class="pvfx-live-confluence-row">' +
      '<span class="pvfx-live-confluence-label">' + label + '</span>' +
      '<span class="pvfx-live-confluence-value" style="color:' + color + '">' +
      fmtPrice(inst.latest) + ' ' + arrow + ' ' + pct + '</span>' +
      '</div>' +
      '<div class="pvfx-live-confluence-note">' + inst.note + '</div>';
  }

  function renderLadder(container, data) {
    var levels = data.levels.slice();
    var above = levels.filter(function (l) { return l.price >= data.latest_close; })
      .sort(function (a, b) { return a.price - b.price; }).slice(0, 4);
    var below = levels.filter(function (l) { return l.price < data.latest_close; })
      .sort(function (a, b) { return b.price - a.price; }).slice(0, 4);

    var html = '<div class="pvfx-live-section-title">Level ladder</div>' +
      '<div class="pvfx-live-section-sub">Above / current / below</div>' +
      '<div class="pvfx-live-group-title">ABOVE</div>';
    above.forEach(function (lv) { html += row('▲', lv, data.latest_close); });
    html += '<div class="pvfx-live-current"><span>● PRICE</span><span>' + fmtPrice(data.latest_close) + '</span></div>';
    html += '<div class="pvfx-live-group-title">BELOW</div>';
    below.forEach(function (lv) { html += row('▼', lv, data.latest_close); });

    html += '<div class="pvfx-live-state">' +
      '<div class="pvfx-live-state-title">State</div>' +
      '<div class="pvfx-live-state-row"><span>Bias</span><span>' + humanState(data.state.weekly_bias) + '</span></div>' +
      '<div class="pvfx-live-state-row"><span>Zone</span><span>' + humanState(data.state.channel_zone) + '</span></div>' +
      '<div class="pvfx-live-state-row"><span>EMA5</span><span>' + fmtPrice(data.latest_ema5) + '</span></div>' +
      '</div>';

    if (data.confluence && (data.confluence.dxy || data.confluence.xagusd)) {
      html += '<div class="pvfx-live-confluence">' +
        '<div class="pvfx-live-confluence-title">Confluence</div>' +
        confluenceRow('DXY', data.confluence.dxy) +
        confluenceRow('XAGUSD', data.confluence.xagusd) +
        '</div>';
    }

    container.innerHTML = html;
  }

  function setStatus(el, text, isError) {
    el.textContent = text;
    el.classList.toggle('pvfx-live-status-error', !!isError);
  }

  function load(chartEl, ladderEl, statusEl) {
    var url = DATA_URL + '?t=' + Date.now();
    fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        ensureChart(chartEl);
        candleSeries.setData(data.candles);
        emaSeries.setData(data.ema5);
        // Goldturns intentionally not rendered here — see pvfx-goldturns-chart.js
        // and members-weekly-goldturns.html for the dedicated view.
        renderLevels(data.levels, data.latest_close);
        renderLadder(ladderEl, data);
        var gen = new Date(data.generated_utc);
        var stamp = isNaN(gen.getTime()) ? data.generated_utc : gen.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
        setStatus(statusEl, 'Live · data generated ' + stamp + ' · close ' + fmtPrice(data.latest_close) + ' · refreshes automatically', false);
      })
      .catch(function (err) {
        setStatus(statusEl, 'Could not load live data (' + err.message + ') — showing the last successful load, if any.', true);
      });
  }

  function init() {
    var chartEl = document.getElementById('pvfx-live-chart');
    var ladderEl = document.getElementById('pvfx-live-ladder');
    var statusEl = document.getElementById('pvfx-live-status');
    if (!chartEl || !ladderEl || !statusEl) return;
    if (typeof LightweightCharts === 'undefined') {
      setStatus(statusEl, 'Live chart library failed to load — showing the static image instead.', true);
      return;
    }
    load(chartEl, ladderEl, statusEl);
    setInterval(function () { load(chartEl, ladderEl, statusEl); }, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
