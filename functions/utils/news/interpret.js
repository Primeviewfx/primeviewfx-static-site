// Rule-based Gold/USD interpretation. NO AI, NO NLP in v1 - deliberately.
//
// Scope limit (important): rules fire ONLY for scheduled US macro
// releases where a numeric actual and consensus both exist. Fed speeches,
// geopolitical headlines and anything else return NEUTRAL_UNCLEAR with
// "awaiting classification" - better than introducing unreliable
// inference into v1.
//
// Wording rule: every output is a LIKELY FIRST-ORDER effect. Never
// "Gold will fall". Never BUY/SELL. Never a recommendation.

import { makeInterpretation } from "./schema.js";

// Direction of the first-order USD effect when ACTUAL exceeds CONSENSUS.
// Gold is then treated as the inverse of USD for these releases.
//
// "higher_is_usd" = a hotter/stronger-than-expected print is usually
// USD-supportive. Unemployment is the deliberate inverse: a HIGHER
// unemployment rate is a WEAKER labour market.
const RULES = [
  { match: /\bcore\s+cpi\b/i,                    key: "CORE_CPI",  higher_is_usd: true,  importance: "HIGH",   label: "Core inflation", basis: "inflation" },
  { match: /\bconsumer price index\b|\bcpi\b/i,  key: "CPI",       higher_is_usd: true,  importance: "HIGH",   label: "Inflation",      basis: "inflation" },
  { match: /\bcore\s+pce\b/i,                    key: "CORE_PCE",  higher_is_usd: true,  importance: "HIGH",   label: "Core inflation", basis: "inflation" },
  { match: /\bpce\b/i,                           key: "PCE",       higher_is_usd: true,  importance: "HIGH",   label: "Inflation",      basis: "inflation" },
  { match: /\bproducer price index\b|\bppi\b/i,  key: "PPI",       higher_is_usd: true,  importance: "MEDIUM", label: "Producer prices",basis: "inflation" },
  { match: /\bnonfarm payroll|\bnon-farm payroll|\bnfp\b/i, key: "NFP", higher_is_usd: true, importance: "HIGH", label: "Jobs growth", basis: "labour" },
  { match: /\bunemployment rate\b/i,             key: "UNEMP",     higher_is_usd: false, importance: "HIGH",   label: "Unemployment",   basis: "labour" },
  { match: /\baverage hourly earnings\b/i,       key: "AHE",       higher_is_usd: true,  importance: "MEDIUM", label: "Wage growth",    basis: "inflation" },
  { match: /\bgross domestic product\b|\bgdp\b/i,key: "GDP",       higher_is_usd: true,  importance: "HIGH",   label: "Growth",         basis: "growth" },
  { match: /\bretail sales\b/i,                  key: "RETAIL",    higher_is_usd: true,  importance: "MEDIUM", label: "Consumer spending", basis: "growth" },
  { match: /\bjolts\b|\bjob openings\b/i,        key: "JOLTS",     higher_is_usd: true,  importance: "MEDIUM", label: "Job openings",   basis: "labour" },
];

const REASONS = {
  inflation: {
    usd_up: "Stronger inflation can keep US interest rates higher for longer.",
    usd_dn: "Softer inflation can reduce pressure to keep US interest rates high.",
  },
  labour: {
    usd_up: "A stronger labour market can support higher US interest rates.",
    usd_dn: "A weaker labour market can reduce pressure to keep US interest rates high.",
  },
  growth: {
    usd_up: "Stronger growth can support higher US interest rates.",
    usd_dn: "Weaker growth can reduce pressure to keep US interest rates high.",
  },
};

export function matchRule(title) {
  return RULES.find((r) => r.match.test(String(title || ""))) || null;
}

// ---------------------------------------------------------------------------
// RELEASE CONTAINERS
//
// Official agencies publish a NAMED RELEASE that contains several
// figures. "Employment Situation" is the BLS container carrying
// Nonfarm Payrolls, the Unemployment Rate and Average Hourly Earnings.
//
// The first version matched only component names, so the official BLS
// headline fell through to "not a scheduled release covered by the
// current rule set" - wrong, and visible in the preview. A container is
// a scheduled macro release; it simply carries no single figure of its
// own, and its components can CONFLICT with each other (strong payrolls
// + rising unemployment), which is exactly why the container must be
// recognised rather than reduced to its headline component.
// ---------------------------------------------------------------------------
export const RELEASE_CONTAINERS = [
  {
    key: "EMPLOYMENT_SITUATION",
    match: /\bemployment situation\b/i,
    label: "Employment Situation",
    category: "LABOUR",
    component_keys: ["NFP", "UNEMP", "AHE"],
    component_labels: ["Nonfarm Payrolls", "Unemployment Rate", "Average Hourly Earnings"],
  },
  {
    key: "CPI_RELEASE",
    match: /\bconsumer price index\b/i,
    label: "Consumer Price Index",
    category: "INFLATION",
    component_keys: ["CPI", "CORE_CPI"],
    component_labels: ["Headline CPI", "Core CPI"],
  },
  {
    key: "PCE_RELEASE",
    match: /\bpersonal income (and )?outlays\b/i,
    label: "Personal Income and Outlays",
    category: "INFLATION",
    component_keys: ["PCE", "CORE_PCE"],
    component_labels: ["PCE Price Index", "Core PCE"],
  },
];

export function matchContainer(title) {
  return RELEASE_CONTAINERS.find((c) => c.match.test(String(title || ""))) || null;
}

// ---------------------------------------------------------------------------
// PRESENTATION TYPE
//
// Not every item is an economic surprise. Rendering a Fed speech or a
// COT positioning report with the same "Likely first-order effect"
// template as a CPI print overstates what we know about it.
// ---------------------------------------------------------------------------
export const PRESENTATION_TYPES = Object.freeze([
  "SCHEDULED_DATA",   // Actual/Forecast/Previous + surprise + effect
  "CENTRAL_BANK",     // policy relevance; effect only once classified
  "POSITIONING",      // COT context; no forced directional call
  "GENERAL_MACRO",    // factual summary; effect only if clear
]);

export function presentationType(item) {
  const t = String(item.title || "");
  if (/\bcommitments of traders\b|\bcot\b|\bpositioning\b/i.test(t)) return "POSITIONING";
  if (/\bspeech\b|\btestimony\b|\bremarks\b|\bfomc\b|\bminutes\b|\bstatement\b/i.test(t)
      || item.category === "FED_RATES") {
    // A rate DECISION with figures is scheduled data; commentary is not.
    if (matchRule(t) && typeof item.actual === "number") return "SCHEDULED_DATA";
    return "CENTRAL_BANK";
  }
  if (matchRule(t) || matchContainer(t)) return "SCHEDULED_DATA";
  return "GENERAL_MACRO";
}

/**
 * Explicit surprise, alongside the raw facts (never replacing them).
 *
 * DELIBERATELY NO universal percentage "strength" score. A 0.2-point CPI
 * miss and a 35k payroll miss are not comparable just because both are
 * ~20% of consensus - a normalised score would imply a false equivalence.
 * Absolute difference and direction only, in the release's own units,
 * until something better is validated.
 */
export function computeSurprise(item) {
  if (typeof item.actual !== "number" || typeof item.consensus !== "number") {
    return { surprise_absolute: null, surprise_direction: null, surprise_units: null };
  }
  const diff = Number((item.actual - item.consensus).toFixed(6));
  return {
    surprise_absolute: diff,
    surprise_direction: diff > 0 ? "ABOVE" : diff < 0 ? "BELOW" : "IN_LINE",
    // Units are the release's own - not normalised across releases.
    surprise_units: "release_native",
  };
}

function invert(effect) {
  if (effect === "SUPPORTIVE") return "NEGATIVE";
  if (effect === "NEGATIVE") return "SUPPORTIVE";
  return effect;
}

// `headline` is what the member reads first; `why` is the explanation
// underneath. The first version hardcoded "Awaiting classification." as
// the headline for every non-interpreted item, which made a Fed speech,
// a COT report and a pre-release CPI all read identically.
const unclassified = (why, headline = "Awaiting classification.") =>
  makeInterpretation({
    plain_english: headline,
    usd_effect: "NEUTRAL_UNCLEAR",
    gold_effect: "NEUTRAL_UNCLEAR",
    interpretation_confidence: "NONE",
    reason: why,
  });

/**
 * Interpret ONE source item. Returns an interpretation object, always -
 * never null - so the UI always has something explicit to show.
 */
export function interpretItem(item) {
  const type = presentationType(item);

  // Non-data items get their own honest wording rather than being run
  // through the economic-surprise template.
  if (type === "POSITIONING") {
    return unclassified(
      "This report shows how traders were positioned, not a scheduled " +
      "economic figure, so no first-order effect is estimated.",
      "Positioning context."
    );
  }
  if (type === "CENTRAL_BANK") {
    return unclassified(
      "Interpretation of central-bank commentary is not automated, so no " +
      "first-order effect is estimated.",
      "Policy context."
    );
  }

  const container = matchContainer(item.title);
  const rule = matchRule(item.title);

  if (!rule && !container) {
    return unclassified(
      "This item is not a scheduled release covered by the current rule set."
    );
  }

  // A recognised release container with no figures yet: name what it
  // contains instead of claiming it is uncovered.
  if (!rule && container) {
    if (item.actual === null || typeof item.actual !== "number") {
      return unclassified(
        `Scheduled ${container.label} release, containing ` +
        `${container.component_labels.join(", ")}. Component figures are ` +
        `interpreted individually once published.`,
        "Awaiting release."
      );
    }
  }

  if (!rule) {
    return unclassified(
      `Component figures for the ${container.label} release are not yet available.`,
      "Awaiting release."
    );
  }

  if (item.actual === null || item.consensus === null ||
      typeof item.actual !== "number" || typeof item.consensus !== "number") {
    return unclassified(
      "Figures are not yet published, so no first-order effect is estimated.",
      "Awaiting release."
    );
  }

  const diff = item.actual - item.consensus;
  if (diff === 0) {
    return makeInterpretation({
      plain_english: `${rule.label} came in exactly as forecast.`,
      usd_effect: "NEUTRAL_UNCLEAR",
      gold_effect: "NEUTRAL_UNCLEAR",
      interpretation_confidence: "MEDIUM",
      reason: "An in-line result gives little new information on its own.",
    });
  }

  const above = diff > 0;
  // "Stronger than expected" in the sense the rule cares about.
  const strongerForUsd = above === rule.higher_is_usd;
  const usd_effect = strongerForUsd ? "SUPPORTIVE" : "NEGATIVE";
  const reasons = REASONS[rule.basis];

  let plain;
  if (rule.key === "UNEMP") {
    plain = above
      ? "Unemployment was higher than forecast, pointing to a weaker labour market."
      : "Unemployment was lower than forecast, pointing to a stronger labour market.";
  } else if (rule.basis === "inflation") {
    plain = above
      ? `${rule.label} came in hotter than forecast.`
      : `${rule.label} came in cooler than forecast.`;
  } else {
    plain = above
      ? `${rule.label} came in stronger than forecast.`
      : `${rule.label} came in weaker than forecast.`;
  }

  return makeInterpretation({
    plain_english: plain,
    usd_effect,
    gold_effect: invert(usd_effect),
    interpretation_confidence: rule.importance === "HIGH" ? "HIGH" : "MEDIUM",
    reason: strongerForUsd ? reasons.usd_up : reasons.usd_dn,
  });
}

/**
 * Resolve a set of releases published together (same source, same
 * release window) into ONE view.
 *
 * Required behaviour: an internally contradictory release - e.g. strong
 * payrolls AND a sharply higher unemployment rate - must resolve to
 * MIXED rather than forcing an answer.
 */
export function interpretRelease(items) {
  const parts = items
    .map((it) => ({ item: it, interp: interpretItem(it) }))
    .filter((p) => p.interp.usd_effect !== "NEUTRAL_UNCLEAR");

  if (parts.length === 0) {
    return unclassified("No scheduled release in this group could be classified.");
  }
  if (parts.length === 1) return parts[0].interp;

  const usd = new Set(parts.map((p) => p.interp.usd_effect));
  if (usd.size > 1) {
    const detail = parts
      .map((p) => `${p.item.title}: ${p.interp.usd_effect === "SUPPORTIVE" ? "USD-supportive" : "USD-negative"}`)
      .join("; ");
    return makeInterpretation({
      plain_english: "This release sent conflicting signals.",
      usd_effect: "MIXED",
      gold_effect: "MIXED",
      interpretation_confidence: "LOW",
      reason:
        "Components of the same release point in different directions (" +
        detail +
        "), so a single first-order effect cannot be identified.",
    });
  }

  const agreed = parts[0].interp;
  return makeInterpretation({
    plain_english: agreed.plain_english,
    usd_effect: agreed.usd_effect,
    gold_effect: agreed.gold_effect,
    interpretation_confidence: agreed.interpretation_confidence,
    reason: agreed.reason,
  });
}
