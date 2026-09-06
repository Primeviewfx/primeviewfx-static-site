// Provenance reconciliation: fast aggregator vs. official source.
//
// THE RULE: where a secondary (fast) source and a primary (official)
// source disagree on a released figure, PrimeViewFX FLAGS the conflict.
// It never silently prefers whichever number looks convenient, and it
// never suppresses the disagreement to keep the UI tidy.
//
// Tiers:
//   PRIMARY   - BLS, BEA, Federal Reserve, U.S. Treasury (official)
//   SECONDARY - TickAtlas and any other aggregator
//
// Verification states:
//   UNVERIFIED         - only a secondary source has reported it
//   VERIFIED           - primary agrees within tolerance
//   CONFLICT           - primary and secondary disagree -> FLAG
//   OFFICIAL_ONLY      - only the official source has it
//   AWAITING_RELEASE   - scheduled, no actual published yet

// Must list EVERY official source by the exact `name` used in
// PROVIDERS (sources.js). An official source missing from this set is
// silently demoted to SECONDARY and mis-labelled - CFTC was omitted in
// the first version and showed as AWAITING_RELEASE on a published
// headline, which is why the test below asserts parity with PROVIDERS
// rather than just spot-checking a few names.
export const PRIMARY_SOURCES = new Set([
  "Bureau of Labor Statistics",
  "Bureau of Economic Analysis",
  "Federal Reserve",
  "U.S. Treasury",
  "CFTC",
]);

export function tierOf(item) {
  if (item.provenance_tier) return item.provenance_tier;
  return PRIMARY_SOURCES.has(item.source) ? "PRIMARY" : "SECONDARY";
}

/**
 * Do two figures agree? Compared with a relative tolerance because
 * releases carry wildly different magnitudes (a 0.1 CPI difference is
 * material; a 100-unit payroll difference is rounding). An absolute
 * floor prevents false conflicts on values near zero.
 */
export function figuresAgree(a, b, { relTol = 0.001, absFloor = 1e-9 } = {}) {
  if (typeof a !== "number" || typeof b !== "number") return null; // not comparable
  const diff = Math.abs(a - b);
  if (diff <= absFloor) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return diff / scale <= relTol;
}

/** Loose title match for pairing the same release across sources. */
export function sameRelease(a, b) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const na = norm(a.title), nb = norm(b.title);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // one title containing the other covers "CPI" vs "Consumer Price Index - August"
  return na.includes(nb) || nb.includes(na);
}

/**
 * Reconcile a secondary item against available primary items.
 * Returns a verification block to be attached ALONGSIDE the source
 * record - never merged into it, so the source's own figure is never
 * overwritten.
 */
export function reconcileItem(item, primaryItems = []) {
  const tier = tierOf(item);

  if (tier === "PRIMARY") {
    return {
      verification_state: "OFFICIAL_ONLY",
      provenance_tier: "PRIMARY",
      authoritative_source: item.source,
      conflict: null,
      note: "Figure taken directly from the official source.",
    };
  }

  if (item.actual === null || item.actual === undefined) {
    return {
      verification_state: "AWAITING_RELEASE",
      provenance_tier: tier,
      authoritative_source: null,
      conflict: null,
      note: "Scheduled event; no published figure yet.",
    };
  }

  const match = primaryItems.find(
    (p) => tierOf(p) === "PRIMARY" && p.actual !== null && sameRelease(p, item)
  );
  if (!match) {
    return {
      verification_state: "UNVERIFIED",
      provenance_tier: tier,
      authoritative_source: null,
      conflict: null,
      note: "Reported by a fast calendar source; not yet confirmed against the official release.",
    };
  }

  const agree = figuresAgree(item.actual, match.actual);
  if (agree === true) {
    return {
      verification_state: "VERIFIED",
      provenance_tier: tier,
      authoritative_source: match.source,
      conflict: null,
      note: `Confirmed against ${match.source}.`,
    };
  }

  // Disagreement: surface BOTH numbers and name the authoritative one.
  // Deliberately does NOT pick a winner for display.
  return {
    verification_state: "CONFLICT",
    provenance_tier: tier,
    authoritative_source: match.source,
    conflict: {
      secondary_source: item.source,
      secondary_value: item.actual,
      primary_source: match.source,
      primary_value: match.actual,
    },
    note:
      `Reported figure differs from ${match.source}. ` +
      `Both values are shown; the official source is authoritative.`,
  };
}

/**
 * Apply reconciliation across a mixed list.
 *
 * IMPORTANT: a CONFLICT suppresses interpretation. Interpreting a
 * disputed number would give a confident-looking Gold/USD read built on
 * a figure we do not trust.
 */
export function reconcileAll(items) {
  const primary = items.filter((i) => tierOf(i) === "PRIMARY");
  return items.map((item) => ({
    item,
    verification: reconcileItem(item, primary),
  }));
}

export function shouldSuppressInterpretation(verification) {
  return verification.verification_state === "CONFLICT";
}
