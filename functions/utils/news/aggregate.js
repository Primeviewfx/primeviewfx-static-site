// Deduplication, ranking, staleness, and assembly of the member payload.

import { STALENESS_SECONDS, stableHash, EFFECT_LABEL } from "./schema.js";
import { reconcileAll, shouldSuppressInterpretation } from "./reconcile.js";
import { interpretItem, computeSurprise, presentationType, matchContainer } from "./interpret.js";
import { PROVIDERS, fetchProvider } from "./sources.js";
import { fetchRatesContext } from "./treasury.js";

/**
 * Two-stage dedup, in the required order:
 *   1. exact source id (event_id)  - the authoritative identity
 *   2. normalized title + time bucket + source relationship
 *
 * Stage 2 catches the same release appearing twice (e.g. a BLS item also
 * carried in a Fed feed) without collapsing genuinely distinct releases
 * that happen to share a title across months - the time bucket prevents
 * that.
 */
export function normalizeTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|for|of|in|on|and|a|an|us|u s)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const HOUR_MS = 3600 * 1000;

export function dedupe(items, bucketHours = 6) {
  const byId = new Map();
  for (const it of items) {
    if (!byId.has(it.event_id)) byId.set(it.event_id, it);
  }
  const seenSoft = new Map();
  const out = [];
  for (const it of byId.values()) {
    const t = it.published_utc ? Date.parse(it.published_utc) : NaN;
    const bucket = isNaN(t) ? "nodate" : Math.floor(t / (bucketHours * HOUR_MS));
    const key = `${normalizeTitle(it.title)}|${bucket}`;
    const prior = seenSoft.get(key);
    if (!prior) {
      seenSoft.set(key, it);
      out.push(it);
      continue;
    }
    // Keep the richer record (one carrying figures beats a bare headline).
    const score = (x) => (x.actual !== null ? 2 : 0) + (x.summary ? 1 : 0);
    if (score(it) > score(prior)) {
      const idx = out.indexOf(prior);
      if (idx >= 0) out[idx] = it;
      seenSoft.set(key, it);
    }
  }
  return out;
}

const IMPORTANCE_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export function rank(items, now = Date.now()) {
  return [...items].sort((a, b) => {
    const ia = IMPORTANCE_RANK[a.importance] || 0;
    const ib = IMPORTANCE_RANK[b.importance] || 0;
    if (ia !== ib) return ib - ia;
    const ta = a.published_utc ? Date.parse(a.published_utc) : 0;
    const tb = b.published_utc ? Date.parse(b.published_utc) : 0;
    return tb - ta;
  });
}

/**
 * Source health. Measures TIME SINCE WE LAST SUCCESSFULLY CONTACTED AND
 * PARSED the source - never time since the source last published.
 *
 * The Fed, BLS and especially CFTC can legitimately publish nothing for
 * hours or days. A quiet source is HEALTHY. Conflating "no new articles"
 * with "feed broken" would produce exactly the kind of false alarm this
 * module is supposed to avoid.
 *
 *   HEALTHY      - contacted and parsed within the window (any item count,
 *                  including zero)
 *   STALE_FETCH  - last SUCCESS is older than the window
 *   FETCH_FAILED - never succeeded this run
 */
export function sourceHealth(result, now = Date.now()) {
  if (!result.last_fetch_success_utc) return "FETCH_FAILED";
  const t = Date.parse(result.last_fetch_success_utc);
  if (isNaN(t)) return "FETCH_FAILED";
  return (now - t) / 1000 > STALENESS_SECONDS ? "STALE_FETCH" : "HEALTHY";
}

export function isStale(fetchSuccessUtc, now = Date.now()) {
  if (!fetchSuccessUtc) return true;
  const t = Date.parse(fetchSuccessUtc);
  if (isNaN(t)) return true;
  return (now - t) / 1000 > STALENESS_SECONDS;
}

/**
 * Build the full member payload. Never throws on source failure.
 */
export async function buildFeed({ fetchImpl = fetch, now = Date.now(), limit = 40 } = {}) {
  // Headline sources and the Treasury rates context are fetched in
  // parallel but kept in SEPARATE payload sections: Treasury is daily
  // numeric context, not news, and a Treasury outage must not affect
  // the headline feed's health verdict.
  const [results, ratesContext] = await Promise.all([
    Promise.all(
      Object.values(PROVIDERS)
        .filter((p) => p.kind !== "yields")
        .map((p) => fetchProvider(p, fetchImpl))
    ),
    fetchRatesContext(fetchImpl).catch(() => null),
  ]);

  const allItems = results.flatMap((r) => r.items);
  const deduped = rank(dedupe(allItems), now);

  // Reconcile fast/secondary figures against the official record BEFORE
  // interpreting. A disputed number must not produce a confident-looking
  // Gold/USD read.
  const reconciled = reconcileAll(deduped.slice(0, limit));

  const withInterp = reconciled.map(({ item, verification }) => ({
    // source fact, verification and interpretation are THREE separate
    // objects - none is ever merged into another
    source_item: item,
    // How the UI should RENDER this item. A Fed speech and a CPI print
    // must not share the economic-surprise template.
    presentation_type: presentationType(item),
    release_container: (() => {
      const c = matchContainer(item.title);
      return c ? { key: c.key, label: c.label, components: c.component_labels } : null;
    })(),
    verification,
    // surprise is DERIVED arithmetic on the source's own numbers, so it
    // sits beside the fact rather than inside the interpretation
    surprise: computeSurprise(item),
    primeviewfx_interpretation: shouldSuppressInterpretation(verification)
      ? {
          label: EFFECT_LABEL,
          plain_english: "Reported figures disagree between sources.",
          usd_effect: "NEUTRAL_UNCLEAR",
          gold_effect: "NEUTRAL_UNCLEAR",
          interpretation_confidence: "NONE",
          reason:
            "The published figure differs between the fast calendar source and the " +
            "official release, so no first-order effect is estimated until it is resolved.",
          derived_by: "PrimeViewFX",
          is_source_statement: false,
        }
      : interpretItem(item),
  }));

  const sourceStatus = results.map((r) => ({
    provider: r.provider,
    source_health: sourceHealth(r, now),
    ok: r.ok,
    partial: r.partial,
    item_count: r.items.length,
    last_fetch_attempt_utc: r.last_fetch_attempt_utc,
    last_fetch_success_utc: r.last_fetch_success_utc,
    // Context only. A source that published nothing today is still
    // HEALTHY - this field must never drive the health verdict.
    latest_item_published_utc: r.latest_item_published_utc,
    // error strings are internal detail - surfaced as a count only
    error_count: r.errors.length,
  }));

  // Health is judged on REACHABILITY, not on whether anything was
  // published. item_count is deliberately absent from this test.
  const healthyCount = sourceStatus.filter((s) => s.source_health === "HEALTHY").length;
  const allDown = healthyCount === 0;

  return {
    schema_version: "gdi-v1",
    generated_utc: new Date(now).toISOString(),
    // Explicit degradation states - a stale headline must never
    // masquerade as current news.
    feed_state: allDown ? "UNAVAILABLE" : (healthyCount < sourceStatus.length ? "DEGRADED" : "OK"),
    feed_message: allDown
      ? "News feed temporarily unavailable"
      : (healthyCount < sourceStatus.length
          ? "Some sources are unavailable; showing what is currently reachable."
          : null),
    sources: sourceStatus,
    rates_context: ratesContext,
    items: allDown ? [] : withInterp,
    disclaimer:
      "Information and education only. Not investment advice, and not a recommendation to buy or sell any instrument.",
  };
}
