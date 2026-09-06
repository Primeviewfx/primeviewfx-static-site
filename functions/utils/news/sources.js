// Source adapters. Each adapter is independent and MUST fail in
// isolation: one dead source can never take down the feed.
//
// Note on parsing: Cloudflare Workers have no DOMParser. RSS/Atom here
// is parsed with narrow tag extraction, which is adequate for the
// well-formed government feeds we consume and avoids pulling in a
// dependency. It is deliberately conservative - an item that does not
// yield a title and a link is dropped rather than guessed at.

import { makeSourceItem, stableHash, CATEGORIES } from "./schema.js";

export const PROVIDERS = Object.freeze({
  FED: {
    id: "FED",
    name: "Federal Reserve",
    urls: [
      "https://www.federalreserve.gov/feeds/press_monetary.xml",
      "https://www.federalreserve.gov/feeds/speeches.xml",
      "https://www.federalreserve.gov/feeds/testimony.xml",
    ],
    category: "FED_RATES",
    importance: "HIGH",
  },
  BLS: {
    id: "BLS",
    name: "Bureau of Labor Statistics",
    urls: ["https://www.bls.gov/feed/bls_latest.rss"],
    category: "LABOUR",
    importance: "HIGH",
  },
  BEA: {
    id: "BEA",
    name: "Bureau of Economic Analysis",
    urls: ["https://www.bea.gov/rss.xml"],
    category: "GROWTH",
    importance: "HIGH",
  },
  TREASURY: {
    id: "TREASURY",
    name: "U.S. Treasury",
    urls: [
      "https://home.treasury.gov/system/files/276/yield-curve-rates-1990-2023.csv",
    ],
    category: "FED_RATES",
    importance: "MEDIUM",
    kind: "yields",
  },
  CFTC: {
    id: "CFTC",
    name: "CFTC",
    urls: ["https://www.cftc.gov/RSS/RSSGP/rssgp.xml"],
    category: "GOLD_COMMODITIES",
    importance: "MEDIUM",
  },
});

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(stripCdata(m[1])).trim() : null;
};

function stripCdata(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ");
}

export function parseFeed(xml) {
  const out = [];
  const blocks = String(xml).match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const title = tag(b, "title");
    let link = tag(b, "link");
    if (!link) {
      const href = b.match(/<link[^>]*href="([^"]+)"/i);
      link = href ? href[1] : null;
    }
    const dateRaw = tag(b, "pubDate") || tag(b, "updated") || tag(b, "published") ||
                    tag(b, "dc:date");
    const desc = tag(b, "description") || tag(b, "summary") || null;
    if (!title || !link) continue;   // conservative: drop, never guess
    const d = dateRaw ? new Date(dateRaw) : null;
    out.push({
      title,
      link,
      published_utc: d && !isNaN(d) ? d.toISOString() : null,
      summary: desc,
    });
  }
  return out;
}

/**
 * Gold/USD relevance filter - deterministic keyword gate, applied before
 * anything reaches a member. Keeps the feed focused: no Apple earnings,
 * no crypto stories.
 */
const RELEVANT = [
  /\binflation\b/i, /\bcpi\b/i, /\bpce\b/i, /\bppi\b/i, /\bprice index\b/i,
  /\bpayroll/i, /\bemployment\b/i, /\bunemploy/i, /\bjobless\b/i, /\bjolts\b/i,
  /\blabor force\b/i, /\blabour\b/i, /\bwage/i, /\bearnings situation\b/i,
  /\bfomc\b/i, /\bfederal funds\b/i, /\binterest rate/i, /\bmonetary polic/i,
  /\byield/i, /\btreasury securit/i, /\bpowell\b/i,
  /\bgross domestic product\b/i, /\bgdp\b/i, /\bpersonal income\b/i,
  /\bretail sales\b/i, /\btrade balance\b/i,
  /\bgold\b/i, /\bprecious metal/i, /\bcommitments of traders\b/i, /\bcot\b/i,
];

export function isRelevant(text) {
  const s = String(text || "");
  return RELEVANT.some((r) => r.test(s));
}

function categorize(text, fallback) {
  const s = String(text || "");
  if (/\bcpi\b|\binflation\b|\bpce\b|\bppi\b|\bprice index\b/i.test(s)) return "INFLATION";
  if (/\bpayroll|\bunemploy|\bjobless\b|\bjolts\b|\bemployment\b|\bwage/i.test(s)) return "LABOUR";
  if (/\bfomc\b|\bfederal funds\b|\binterest rate|\bmonetary polic|\byield/i.test(s)) return "FED_RATES";
  if (/\bgdp\b|\bgross domestic product\b|\bretail sales\b|\bpersonal income\b/i.test(s)) return "GROWTH";
  if (/\bgold\b|\bprecious metal|\bcommitments of traders\b/i.test(s)) return "GOLD_COMMODITIES";
  return CATEGORIES.includes(fallback) ? fallback : "FED_RATES";
}

/**
 * Fetch one provider. NEVER throws - returns a status envelope so a dead
 * source degrades the feed instead of killing it.
 */
export async function fetchProvider(provider, fetchImpl = fetch) {
  const items = [];
  const errors = [];
  const attempt_utc = new Date().toISOString();
  let anySuccess = false;
  for (const url of provider.urls) {
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": "PrimeViewFX/1.0 (member research feed)" },
        cf: { cacheTtl: 120, cacheEverything: true },
      });
      if (!res.ok) {
        errors.push(`${url} -> HTTP ${res.status}`);
        continue;
      }
      const body = await res.text();
      // Contacted AND parsed successfully. Zero relevant items is a
      // perfectly healthy outcome - a quiet source is not a broken one.
      anySuccess = true;
      for (const raw of parseFeed(body)) {
        const haystack = `${raw.title} ${raw.summary || ""}`;
        if (!isRelevant(haystack)) continue;
        items.push(
          makeSourceItem({
            event_id: `${provider.id}_${stableHash(raw.link)}`,
            source: provider.name,
            source_type: "official",
            published_utc: raw.published_utc,
            category: categorize(haystack, provider.category),
            title: raw.title,
            summary: raw.summary,
            importance: provider.importance,
            source_url: raw.link,
            raw_hash: stableHash(`${raw.title}|${raw.link}`),
          })
        );
      }
    } catch (e) {
      errors.push(`${url} -> ${e && e.message ? e.message : String(e)}`);
    }
  }
  // Latest PUBLICATION time among returned items - reported for context,
  // never used to judge source health (see aggregate.js).
  const publishedTimes = items
    .map((i) => (i.published_utc ? Date.parse(i.published_utc) : NaN))
    .filter((t) => !isNaN(t));
  const latest_item_published_utc = publishedTimes.length
    ? new Date(Math.max(...publishedTimes)).toISOString()
    : null;

  return {
    provider: provider.id,
    ok: errors.length === 0,
    partial: errors.length > 0 && anySuccess,
    items,
    errors,
    // THREE DISTINCT TIMES - conflating them was the bug this replaces.
    //   attempt : we tried, success or not
    //   success : we actually contacted AND parsed the source
    //   published: when the source last published something
    last_fetch_attempt_utc: attempt_utc,
    last_fetch_success_utc: anySuccess ? new Date().toISOString() : null,
    latest_item_published_utc,
  };
}

/**
 * Provider interface for FUTURE licensed feeds (Trading Economics,
 * Bloomberg, FinancialJuice). Registered but NOT enabled - v1 ships
 * official sources only, and no licensed provider may be switched on
 * until redistribution rights are confirmed in writing.
 */
export const LICENSED_PROVIDERS_PENDING = Object.freeze({
  // Front-runner: documented commercial-use/white-label wording on their
  // pricing page, ~$29/mo Starter. Still gated - website wording is not
  // the same as written confirmation for OUR specific use.
  TICKATLAS: {
    id: "TICKATLAS",
    name: "TickAtlas",
    enabled: false,
    licence_status: "NOT_CONFIRMED",
    requires:
      "Written confirmation that the Starter API licence permits displaying a " +
      "filtered subset of economic-calendar fields to authenticated paying " +
      "members under our own UI",
    evidence_required: "Saved copy of the pricing/terms wording, or a written reply",
    secret_binding: "TICKATLAS_API_KEY",
    provenance_tier: "SECONDARY",
    note:
      "Live actuals derive from an MT5 calendar feed; forecast/previous may be " +
      "supplemented from third parties. NOT provenance-equivalent to BLS/BEA/Fed - " +
      "figures are reconciled against the official sources (see reconcile.js).",
  },
  TRADING_ECONOMICS: {
    id: "TRADING_ECONOMICS",
    name: "Trading Economics",
    enabled: false,
    licence_status: "NOT_CONFIRMED",
    requires: "Enterprise redistribution/white-label licence for authenticated paying members",
    secret_binding: "TRADING_ECONOMICS_API_KEY", // Pages secret, server-side only
    status_note: "DEFERRED 2026-09-05 - registered as a future premium option only. " +
                 "TickAtlas is the current candidate at materially lower cost.",
  },
  BLOOMBERG: {
    id: "BLOOMBERG", name: "Bloomberg", enabled: false,
    licence_status: "NOT_CONFIRMED", requires: "Data License agreement",
  },
  FINANCIAL_JUICE: {
    id: "FINANCIAL_JUICE", name: "FinancialJuice", enabled: false,
    licence_status: "NOT_CONFIRMED",
    requires: "Written permission - their terms prohibit unlicensed aggregation/display",
  },
});

export function assertLicensedProviderUsable(p) {
  if (!p.enabled || p.licence_status !== "CONFIRMED") {
    throw new Error(
      `Provider ${p.id} is not licensed for member redistribution (${p.licence_status}). ` +
      `Refusing to serve its data.`
    );
  }
}
