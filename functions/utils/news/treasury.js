// U.S. Treasury Daily Par Yield Curve Rates - CONTEXT source, not news.
//
// Deliberately NOT an RSS/headline adapter: this is a numeric daily
// series, a different shape entirely, and it belongs in its own payload
// section (`rates_context`) rather than being shoehorned into the
// headline feed.
//
// SCOPE LIMIT, stated plainly: this is the official DAILY series. It is
// suitable for daily macro context only. Intraday yield moves would
// require a licensed real-time market-data source, which v1 does not
// have - so nothing here should ever be presented as a live yield.

const BASE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/";

/** Endpoint for a given year's daily par yield curve CSV. */
export function yieldCsvUrl(year) {
  return `${BASE}${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
}

/**
 * Parse Treasury's daily yield CSV. Header names have varied over time
 * ("10 Yr" vs "10 YR"), so matching is case/space-insensitive rather
 * than positional - a column-order change must not silently mis-assign
 * a maturity to the wrong field.
 */
export function parseYieldCsv(csvText) {
  const lines = String(csvText).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;

  const split = (line) => {
    const out = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const header = split(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, " "));
  const col = (...names) => {
    for (const n of names) {
      const i = header.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const iDate = col("date");
  const i2 = col("2 yr", "2yr");
  const i10 = col("10 yr", "10yr");
  const i30 = col("30 yr", "30yr");
  if (iDate < 0) return null;

  // Treasury dates are MM/DD/YYYY calendar dates with NO timezone.
  // Parsed explicitly as UTC: `new Date("09/04/2026")` would produce
  // LOCAL midnight, and a later .toISOString() would then shift the
  // date backwards a day on any machine west of UTC... or, as here,
  // forwards/backwards depending on offset - silently misreporting
  // as_of_date. A calendar date must never be round-tripped through a
  // local-time Date.
  const parseDate = (s) => {
    const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2]);
    const iso = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
    return NaN;
  };

  // Treasury lists newest first, but that is not guaranteed - pick the
  // maximum date rather than trusting row order.
  let best = null;
  for (const line of lines.slice(1)) {
    const cells = split(line);
    const t = parseDate(cells[iDate]);
    if (isNaN(t)) continue;
    if (!best || t > best.t) best = { t, cells };
  }
  if (!best) return null;

  const num = (i) => {
    if (i < 0 || i >= best.cells.length) return null;
    const v = parseFloat(best.cells[i]);
    return isNaN(v) ? null : v;
  };
  const y2 = num(i2), y10 = num(i10), y30 = num(i30);

  return {
    source: "U.S. Treasury",
    as_of_date: new Date(best.t).toISOString().slice(0, 10),
    yield_2y: y2,
    yield_10y: y10,
    yield_30y: y30,
    // 2s10s spread, in percentage points, only when both legs exist.
    curve_2s10s: y2 !== null && y10 !== null ? Number((y10 - y2).toFixed(4)) : null,
    freshness: "DAILY",
  };
}

/**
 * Fetch the rates context. NEVER throws - returns null on any failure so
 * the headline feed is unaffected by a Treasury outage.
 */
export async function fetchRatesContext(fetchImpl = fetch, now = new Date()) {
  const year = now.getUTCFullYear();
  const attempted = [yieldCsvUrl(year), yieldCsvUrl(year - 1)];
  for (const url of attempted) {
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": "PrimeViewFX/1.0 (member research feed)" },
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
      if (!res.ok) continue;
      const parsed = parseYieldCsv(await res.text());
      if (parsed) {
        return {
          ...parsed,
          source_url: url,
          last_fetch_success_utc: new Date().toISOString(),
          // Member-facing framing. Explicitly hedged - the relationship
          // is a tendency, never a guarantee, and this is context rather
          // than a signal.
          why_it_matters:
            "Rising US yields can increase the opportunity cost of holding Gold " +
            "and can support the Dollar, although the relationship is not guaranteed.",
          scope_note: "Official daily series - not an intraday or live yield.",
        };
      }
    } catch (_) { /* try the next year's file, then give up quietly */ }
  }
  return null;
}
