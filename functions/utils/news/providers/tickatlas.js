// TickAtlas economic-calendar adapter.
//
// STATUS: GATED OFF. Registered, mapped and tested, but not enabled -
// see LICENSED_PROVIDERS_PENDING in ../sources.js. Enabling requires
// licence_status === "CONFIRMED", i.e. written confirmation that the
// Starter API licence permits displaying a filtered subset of calendar
// fields to authenticated paying members under our own UI.
//
// PROVENANCE TIER - the load-bearing design point:
//   TickAtlas is a CONVENIENCE/SPEED source, NOT a provenance-grade one.
//   Its live actuals derive from an MT5 calendar feed, with
//   forecast/previous potentially supplemented from third parties.
//   BLS / BEA / Federal Reserve remain the authoritative record.
//   Where the two disagree on a figure, PrimeViewFX FLAGS the conflict
//   (see reconcile.js) rather than silently preferring either number.
//
// RESPONSE SHAPE IS UNVERIFIED. The field mapping below follows the
// documented names (event, datetime, impact, forecast, previous, actual,
// currency) but has NOT been exercised against a live response - no key
// has been issued. `mapEvent` is deliberately tolerant of common key
// aliases and returns null on anything it cannot map, rather than
// fabricating a partial record.

import { makeSourceItem, stableHash } from "../schema.js";
import { matchRule } from "../interpret.js";

export const TICKATLAS = Object.freeze({
  id: "TICKATLAS",
  name: "TickAtlas",
  source_type: "aggregator",       // NOT "official"
  provenance_tier: "SECONDARY",    // official sources are PRIMARY
  secret_binding: "TICKATLAS_API_KEY", // Pages encrypted secret, server-side only
  base_url: "https://api.tickatlas.com/v1/economic-calendar",
});

const pick = (obj, ...names) => {
  for (const n of names) {
    if (obj && obj[n] !== undefined && obj[n] !== null && obj[n] !== "") return obj[n];
  }
  return null;
};

const toNumber = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  // Calendar feeds commonly carry "203K", "3.4%", "-0.2", "1.2M"
  const s = String(v).trim().replace(/,/g, "");
  const m = s.match(/^(-?\d*\.?\d+)\s*([KMB%])?$/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  const suffix = (m[2] || "").toUpperCase();
  if (suffix === "K") n *= 1_000;
  else if (suffix === "M") n *= 1_000_000;
  else if (suffix === "B") n *= 1_000_000_000;
  return n;
};

const IMPACT_MAP = { high: "HIGH", medium: "MEDIUM", moderate: "MEDIUM", low: "LOW" };

export function mapImpact(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (IMPACT_MAP[s]) return IMPACT_MAP[s];
  const n = parseInt(s, 10);            // some feeds use 1/2/3
  if (n === 3) return "HIGH";
  if (n === 2) return "MEDIUM";
  if (n === 1) return "LOW";
  return null;
}

const CATEGORY_RULES = [
  [/\bcpi\b|\binflation\b|\bpce\b|\bppi\b|\bprice index\b/i, "INFLATION"],
  [/\bpayroll|\bunemploy|\bjobless\b|\bjolts\b|\bemployment\b|\bearnings\b/i, "LABOUR"],
  [/\bfomc\b|\bfed\b|\bfunds rate\b|\binterest rate\b|\bpowell\b/i, "FED_RATES"],
  [/\bgdp\b|\bretail sales\b|\bpersonal (income|spending)\b|\bdurable goods\b/i, "GROWTH"],
];

export function categorizeEvent(title) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(String(title || ""))) return cat;
  return "GROWTH";
}

/**
 * Map ONE TickAtlas calendar row to the canonical schema.
 * Returns null (never a partial record) if the row lacks an event name
 * or a usable timestamp.
 */
export function mapEvent(raw) {
  const title = pick(raw, "event", "title", "name");
  const when = pick(raw, "datetime", "date", "time", "timestamp", "release_time");
  if (!title || !when) return null;

  const d = new Date(when);
  if (isNaN(d)) return null;

  const currency = pick(raw, "currency", "country_currency", "ccy");
  const impact = mapImpact(pick(raw, "impact", "importance", "volatility"));

  const item = makeSourceItem({
    event_id: `TICKATLAS_${stableHash(`${title}|${d.toISOString()}|${currency || ""}`)}`,
    source: TICKATLAS.name,
    source_type: TICKATLAS.source_type,
    published_utc: d.toISOString(),
    category: categorizeEvent(title),
    title: String(title),
    actual: toNumber(pick(raw, "actual")),
    consensus: toNumber(pick(raw, "forecast", "consensus", "estimate")),
    previous: toNumber(pick(raw, "previous", "prior")),
    importance: impact || "MEDIUM",
    source_url: pick(raw, "url", "source_url") || TICKATLAS.base_url,
    raw_hash: stableHash(JSON.stringify(raw)),
  });

  // Calendar-specific extras the RSS path has no equivalent for.
  return {
    ...item,
    currency: currency ? String(currency).toUpperCase() : null,
    scheduled_utc: d.toISOString(),
    provenance_tier: TICKATLAS.provenance_tier,
    // true once a figure has actually been released
    is_released: toNumber(pick(raw, "actual")) !== null,
  };
}

/**
 * USD-only, high + selected-medium impact.
 *
 * Medium impact is admitted ONLY where the rule engine can actually
 * interpret the event - otherwise it is noise on a Gold/USD feed.
 *
 * That test is delegated to `matchRule` rather than duplicated as a
 * second keyword list here. A hand-maintained copy drifts: the first
 * version of this filter listed "ppi" and so silently dropped
 * "Producer Price Index", which the rule engine handles perfectly well.
 * One source of truth for "can we interpret this?".
 */
export function filterUsdRelevant(items) {
  return items.filter((it) => {
    if (it.currency && it.currency !== "USD") return false;
    if (it.importance === "HIGH") return true;
    if (it.importance === "MEDIUM") return matchRule(it.title) !== null;
    return false;
  });
}

/**
 * Fetch the calendar. Refuses to run unless explicitly licensed AND a
 * key is present. Never throws - returns the same envelope shape as the
 * official adapters so aggregate.js needs no special-casing.
 */
export async function fetchTickAtlas({ env, fetchImpl = fetch, provider }) {
  const attempt_utc = new Date().toISOString();
  const fail = (reason) => ({
    provider: TICKATLAS.id, ok: false, partial: false, items: [],
    errors: [reason],
    last_fetch_attempt_utc: attempt_utc,
    last_fetch_success_utc: null,
    latest_item_published_utc: null,
  });

  if (!provider || !provider.enabled || provider.licence_status !== "CONFIRMED") {
    return fail(`TickAtlas not licensed for member redistribution (${provider ? provider.licence_status : "UNREGISTERED"})`);
  }
  const key = env && env[TICKATLAS.secret_binding];
  if (!key) return fail(`missing secret ${TICKATLAS.secret_binding}`);

  try {
    const url = `${TICKATLAS.base_url}?currency=USD&impact=high,medium`;
    const res = await fetchImpl(url, {
      headers: { "Authorization": `Bearer ${key}`, "Accept": "application/json" },
    });
    if (!res.ok) return fail(`HTTP ${res.status}`);
    const body = await res.json();
    const rows = Array.isArray(body) ? body : (body.data || body.events || body.results || []);
    const mapped = rows.map(mapEvent).filter(Boolean);
    const items = filterUsdRelevant(mapped);
    const times = items.map((i) => Date.parse(i.published_utc)).filter((t) => !isNaN(t));
    return {
      provider: TICKATLAS.id, ok: true, partial: false, items, errors: [],
      last_fetch_attempt_utc: attempt_utc,
      last_fetch_success_utc: new Date().toISOString(),
      latest_item_published_utc: times.length ? new Date(Math.max(...times)).toISOString() : null,
    };
  } catch (e) {
    return fail(e && e.message ? e.message : String(e));
  }
}
