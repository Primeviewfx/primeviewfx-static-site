// PrimeViewFX Gold & Dollar Intelligence v1 - canonical schema.
//
// DESIGN RULE THAT EVERYTHING ELSE DEPENDS ON: source fact and
// PrimeViewFX interpretation live in SEPARATE fields and are produced by
// separate code paths. A source item is never mutated to carry an
// opinion; interpretation is attached as its own object. That way a
// wrong interpretation can never be mistaken for, or silently corrupt,
// what the source actually published.

export const CATEGORIES = Object.freeze([
  "INFLATION",
  "LABOUR",
  "FED_RATES",
  "GROWTH",
  "GOLD_COMMODITIES",
]);

// The ONLY permitted effect values. Deliberately not an open string
// field - an adapter or rule cannot invent "BULLISH", "STRONG BUY" etc.
export const EFFECTS = Object.freeze(["SUPPORTIVE", "NEGATIVE", "MIXED", "NEUTRAL_UNCLEAR"]);

export const IMPORTANCE = Object.freeze(["HIGH", "MEDIUM", "LOW"]);
export const CONFIDENCE = Object.freeze(["HIGH", "MEDIUM", "LOW", "NONE"]);

// Member-facing label required on every interpretation. Frozen here so
// no caller can weaken the wording.
export const EFFECT_LABEL = "Likely first-order effect";

// Stale after this long with no successful refresh. A stale item is
// still returned but flagged - the UI must show it as stale rather than
// let it masquerade as current news.
export const STALENESS_SECONDS = 30 * 60;

/**
 * Canonical source-fact record. No interpretation fields here, by design.
 */
// Display units for a figure, so the UI renders "3.0%" rather than "3".
// Event-native: a percentage stays a percentage, a jobs count stays a
// count. NEVER normalised across releases.
export const UNIT_TYPES = Object.freeze(["PERCENT", "COUNT", "INDEX", "UNKNOWN"]);

export function inferUnits(title) {
  const t = String(title || "");
  if (/\bunemployment rate\b|\bcpi\b|\bconsumer price index\b|\bpce\b|\bppi\b|\bproducer price index\b|\bgdp\b|\binflation\b|\bearnings\b|\brate\b/i.test(t)) {
    return { unit_type: "PERCENT", unit_suffix: "%", decimals: 1 };
  }
  if (/\bpayroll|\bjobless claims\b|\bjolts\b|\bjob openings\b/i.test(t)) {
    return { unit_type: "COUNT", unit_suffix: "", decimals: 0 };
  }
  return { unit_type: "UNKNOWN", unit_suffix: "", decimals: 1 };
}

export function makeSourceItem({
  event_id,
  source,
  source_type = "official",
  published_utc,
  category,
  title,
  summary = null,
  actual = null,
  consensus = null,
  previous = null,
  importance = "MEDIUM",
  source_url,
  raw_hash,
}) {
  if (!event_id) throw new Error("event_id required");
  if (!source) throw new Error("source required");
  if (!source_url) throw new Error("source_url required");
  if (!CATEGORIES.includes(category)) throw new Error(`bad category: ${category}`);
  if (!IMPORTANCE.includes(importance)) throw new Error(`bad importance: ${importance}`);

  return {
    event_id,
    source,
    source_type,
    published_utc,
    category,
    title,
    // Short excerpt only. NEVER the full third-party article body -
    // see acceptance criteria; we link out instead.
    summary: summary ? truncateExcerpt(summary) : null,
    actual,
    consensus,
    previous,
    importance,
    source_url,
    raw_hash,
    // Rendering hint so "3" displays as "3.0%" - event-native units only.
    units: inferUnits(title),
  };
}

export const EXCERPT_MAX_CHARS = 280;

export function truncateExcerpt(text) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean.length <= EXCERPT_MAX_CHARS) return clean;
  return clean.slice(0, EXCERPT_MAX_CHARS - 1).trimEnd() + "…";
}

/**
 * PrimeViewFX-derived interpretation. Separate object, separate producer.
 */
export function makeInterpretation({
  plain_english,
  usd_effect,
  gold_effect,
  interpretation_confidence,
  reason,
}) {
  if (!EFFECTS.includes(usd_effect)) throw new Error(`bad usd_effect: ${usd_effect}`);
  if (!EFFECTS.includes(gold_effect)) throw new Error(`bad gold_effect: ${gold_effect}`);
  if (!CONFIDENCE.includes(interpretation_confidence)) {
    throw new Error(`bad confidence: ${interpretation_confidence}`);
  }
  return {
    label: EFFECT_LABEL,
    plain_english,
    usd_effect,
    gold_effect,
    interpretation_confidence,
    reason,
    // Explicit provenance so the member UI can never present a
    // PrimeViewFX inference as something the source said.
    derived_by: "PrimeViewFX",
    is_source_statement: false,
  };
}

/**
 * Stable hash for dedup / change detection. FNV-1a: no crypto import,
 * deterministic, and adequate for identity of a text record (this is
 * not a security control).
 */
export function stableHash(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}
