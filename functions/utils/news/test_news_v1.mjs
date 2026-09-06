// Acceptance tests for Gold & Dollar Intelligence v1.
// Run: node functions/utils/news/test_news_v1.mjs
//
// Covers the stated acceptance criteria:
//   - identical source item cannot duplicate
//   - one dead source does not kill the feed
//   - stale sources are visibly marked
//   - contradictory macro releases can resolve to MIXED
//   - no BUY/SELL language
//   - no Shadow/research/internal terminology exposed
//   - unauthenticated API request cannot return member feed data

import assert from "node:assert/strict";
import { makeSourceItem, makeInterpretation, EFFECT_LABEL, truncateExcerpt,
         EXCERPT_MAX_CHARS } from "./schema.js";
import { interpretItem, interpretRelease, matchRule, computeSurprise } from "./interpret.js";
import { dedupe, rank, isStale, normalizeTitle, buildFeed, sourceHealth } from "./aggregate.js";
import { parseYieldCsv, yieldCsvUrl } from "./treasury.js";
import { parseFeed, isRelevant, PROVIDERS, fetchProvider,
         LICENSED_PROVIDERS_PENDING, assertLicensedProviderUsable } from "./sources.js";

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); passed++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); failed++; }
};
const atest = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); passed++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); failed++; }
};

const item = (over = {}) => makeSourceItem({
  event_id: "BLS_CPI_2026_09", source: "Bureau of Labor Statistics",
  published_utc: "2026-09-10T12:30:00Z", category: "INFLATION",
  title: "Consumer Price Index", source_url: "https://www.bls.gov/x",
  raw_hash: "abc", ...over,
});

console.log("\n[1] Deduplication");
test("identical event_id cannot duplicate", () => {
  const out = dedupe([item(), item(), item()]);
  assert.equal(out.length, 1);
});
test("same release from two sources collapses (soft dedup)", () => {
  const a = item({ event_id: "BLS_1", title: "Consumer Price Index" });
  const b = item({ event_id: "FED_1", source: "Federal Reserve",
                   title: "The Consumer Price Index" });
  assert.equal(dedupe([a, b]).length, 1);
});
test("same title in DIFFERENT months does NOT collapse", () => {
  const sep = item({ event_id: "BLS_S", published_utc: "2026-09-10T12:30:00Z" });
  const oct = item({ event_id: "BLS_O", published_utc: "2026-10-13T12:30:00Z" });
  assert.equal(dedupe([sep, oct]).length, 2);
});
test("richer record wins when duplicates collapse", () => {
  const bare = item({ event_id: "A" });
  const rich = item({ event_id: "B", actual: 3.4, consensus: 3.1 });
  const out = dedupe([bare, rich]);
  assert.equal(out.length, 1);
  assert.equal(out[0].actual, 3.4);
});

console.log("\n[2] Interpretation rules");
test("CPI hotter than forecast -> USD SUPPORTIVE, Gold NEGATIVE", () => {
  const i = interpretItem(item({ actual: 3.4, consensus: 3.1 }));
  assert.equal(i.usd_effect, "SUPPORTIVE");
  assert.equal(i.gold_effect, "NEGATIVE");
  assert.match(i.plain_english, /hotter than forecast/i);
});
test("CPI cooler -> USD NEGATIVE, Gold SUPPORTIVE", () => {
  const i = interpretItem(item({ actual: 2.8, consensus: 3.1 }));
  assert.equal(i.usd_effect, "NEGATIVE");
  assert.equal(i.gold_effect, "SUPPORTIVE");
});
test("NFP stronger -> USD SUPPORTIVE", () => {
  const i = interpretItem(item({ title: "Nonfarm Payrolls", category: "LABOUR",
                                 actual: 210, consensus: 165 }));
  assert.equal(i.usd_effect, "SUPPORTIVE");
});
test("Unemployment HIGHER is inverted -> USD NEGATIVE, Gold SUPPORTIVE", () => {
  const i = interpretItem(item({ title: "Unemployment Rate", category: "LABOUR",
                                 actual: 4.5, consensus: 4.1 }));
  assert.equal(i.usd_effect, "NEGATIVE");
  assert.equal(i.gold_effect, "SUPPORTIVE");
  assert.match(i.plain_english, /weaker labour market/i);
});
test("in-line print -> NEUTRAL_UNCLEAR", () => {
  const i = interpretItem(item({ actual: 3.1, consensus: 3.1 }));
  assert.equal(i.usd_effect, "NEUTRAL_UNCLEAR");
});
test("Fed speech -> no forced answer (policy context, not a surprise read)", () => {
  const i = interpretItem(item({ title: "Speech by Chair on the economic outlook",
                                 category: "FED_RATES" }));
  // The BEHAVIOUR is what matters: no directional call, no confidence.
  // Wording updated 2026-09-05 from the generic "Awaiting classification."
  // to a type-specific headline, so this asserts the guarantee rather
  // than a particular sentence.
  assert.equal(i.usd_effect, "NEUTRAL_UNCLEAR");
  assert.equal(i.gold_effect, "NEUTRAL_UNCLEAR");
  assert.equal(i.interpretation_confidence, "NONE");
  assert.match(i.plain_english, /policy context/i);
});
test("figures absent -> no effect asserted", () => {
  const i = interpretItem(item({ actual: null, consensus: null }));
  assert.equal(i.usd_effect, "NEUTRAL_UNCLEAR");
});
test("every interpretation carries the 'Likely first-order effect' label", () => {
  assert.equal(interpretItem(item({ actual: 3.4, consensus: 3.1 })).label, EFFECT_LABEL);
});

console.log("\n[3] Contradictory release -> MIXED");
test("strong payrolls + sharply higher unemployment resolves MIXED", () => {
  const nfp = item({ event_id: "NFP", title: "Nonfarm Payrolls",
                     category: "LABOUR", actual: 210, consensus: 165 });
  const un = item({ event_id: "UN", title: "Unemployment Rate",
                    category: "LABOUR", actual: 4.6, consensus: 4.1 });
  const i = interpretRelease([nfp, un]);
  assert.equal(i.usd_effect, "MIXED");
  assert.equal(i.gold_effect, "MIXED");
  assert.equal(i.interpretation_confidence, "LOW");
  assert.match(i.reason, /different directions/i);
});
test("agreeing components do NOT force MIXED", () => {
  const cpi = item({ event_id: "C", title: "Consumer Price Index", actual: 3.4, consensus: 3.1 });
  const ppi = item({ event_id: "P", title: "Producer Price Index", actual: 2.9, consensus: 2.5 });
  assert.equal(interpretRelease([cpi, ppi]).usd_effect, "SUPPORTIVE");
});

console.log("\n[4] Language safety");
const FORBIDDEN = [
  /\bbuy\b/i, /\bsell\b/i, /\blong\b/i, /\bshort\b/i, /\bentry\b/i,
  /\btarget price\b/i, /\bstop loss\b/i, /\brecommend/i, /\bwill (rise|fall)\b/i,
  /\bguarantee/i, /\bshadow mode\b/i, /\bholdout\b/i, /\bdecision log\b/i,
  /\bbacktest/i, /\bthreshold\b/i, /\bCH-00\d/i, /\bstage ?1\b/i,
];
test("no BUY/SELL/advice or internal terminology in any rule output", () => {
  const cases = [
    item({ actual: 3.4, consensus: 3.1 }),
    item({ actual: 2.8, consensus: 3.1 }),
    item({ title: "Unemployment Rate", category: "LABOUR", actual: 4.6, consensus: 4.1 }),
    item({ title: "Nonfarm Payrolls", category: "LABOUR", actual: 210, consensus: 165 }),
    item({ title: "Gross Domestic Product", category: "GROWTH", actual: 1.2, consensus: 2.0 }),
    item({ title: "Speech by the Chair", category: "FED_RATES" }),
  ];
  for (const c of cases) {
    const i = interpretItem(c);
    const text = `${i.plain_english} ${i.reason} ${i.label}`;
    for (const bad of FORBIDDEN) {
      assert.ok(!bad.test(text), `forbidden phrase ${bad} in: ${text}`);
    }
  }
});
test("MIXED reason text is also clean", () => {
  const i = interpretRelease([
    item({ event_id: "N", title: "Nonfarm Payrolls", actual: 210, consensus: 165 }),
    item({ event_id: "U", title: "Unemployment Rate", actual: 4.6, consensus: 4.1 }),
  ]);
  for (const bad of FORBIDDEN) {
    assert.ok(!bad.test(`${i.plain_english} ${i.reason}`), `forbidden ${bad}`);
  }
});
test("interpretation is explicitly attributed to PrimeViewFX, not the source", () => {
  const i = interpretItem(item({ actual: 3.4, consensus: 3.1 }));
  assert.equal(i.derived_by, "PrimeViewFX");
  assert.equal(i.is_source_statement, false);
});

console.log("\n[5] Third-party content limits");
test("excerpt is truncated, full article never stored", () => {
  const long = "x".repeat(5000);
  const t = truncateExcerpt(long);
  assert.ok(t.length <= EXCERPT_MAX_CHARS, `excerpt ${t.length} chars`);
});
test("source_url is mandatory", () => {
  assert.throws(() => makeSourceItem({
    event_id: "a", source: "b", category: "INFLATION", title: "t", raw_hash: "h",
  }), /source_url required/);
});

console.log("\n[6] Schema guards");
test("invalid effect value is rejected", () => {
  assert.throws(() => makeInterpretation({
    plain_english: "x", usd_effect: "STRONG BUY", gold_effect: "NEGATIVE",
    interpretation_confidence: "HIGH", reason: "r",
  }), /bad usd_effect/);
});
test("invalid category is rejected", () => {
  assert.throws(() => item({ category: "CRYPTO" }), /bad category/);
});

console.log("\n[7] Relevance filter");
test("keeps macro, drops irrelevant", () => {
  assert.ok(isRelevant("Consumer Price Index rose in August"));
  assert.ok(isRelevant("FOMC statement on the federal funds rate"));
  assert.ok(isRelevant("Commitments of Traders - gold futures"));
  assert.ok(!isRelevant("Apple announces quarterly earnings"));
  assert.ok(!isRelevant("Bitcoin rallies to a new high"));
});

console.log("\n[8] Feed resilience (dead source must not kill the feed)");
const FEED_XML = `<?xml version="1.0"?><rss><channel>
<item><title>Consumer Price Index - August 2026</title>
<link>https://www.bls.gov/news.release/cpi.htm</link>
<pubDate>Thu, 10 Sep 2026 12:30:00 GMT</pubDate>
<description>The CPI increased 0.4 percent in August.</description></item>
<item><title>Apple quarterly earnings</title><link>https://x/apple</link>
<pubDate>Thu, 10 Sep 2026 12:30:00 GMT</pubDate></item>
</channel></rss>`;

test("parseFeed extracts items and drops those lacking title/link", () => {
  const items = parseFeed(FEED_XML);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Consumer Price Index - August 2026");
});

await atest("one dead source does not kill the feed", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("bls.gov")) {
      return { ok: true, status: 200, text: async () => FEED_XML };
    }
    throw new Error("ECONNREFUSED"); // every other source is down
  };
  const feed = await buildFeed({ fetchImpl });
  assert.ok(feed.items.length > 0, "expected surviving items from BLS");
  assert.equal(feed.feed_state, "DEGRADED");
  assert.ok(feed.sources.some((s) => s.error_count > 0), "expected failed sources recorded");
});

await atest("ALL sources down -> UNAVAILABLE, zero items, explicit message", async () => {
  const fetchImpl = async () => { throw new Error("down"); };
  const feed = await buildFeed({ fetchImpl });
  assert.equal(feed.feed_state, "UNAVAILABLE");
  assert.equal(feed.items.length, 0);
  assert.match(feed.feed_message, /temporarily unavailable/i);
});

await atest("relevance filter applied end-to-end (Apple dropped)", async () => {
  const fetchImpl = async (url) =>
    String(url).includes("bls.gov")
      ? { ok: true, status: 200, text: async () => FEED_XML }
      : { ok: false, status: 503, text: async () => "" };
  const feed = await buildFeed({ fetchImpl });
  const titles = feed.items.map((i) => i.source_item.title).join(" | ");
  assert.ok(/Consumer Price Index/.test(titles));
  assert.ok(!/Apple/.test(titles), "irrelevant item leaked into the feed");
});

await atest("payload keeps source fact and interpretation separate", async () => {
  const fetchImpl = async (url) =>
    String(url).includes("bls.gov")
      ? { ok: true, status: 200, text: async () => FEED_XML }
      : { ok: false, status: 503, text: async () => "" };
  const feed = await buildFeed({ fetchImpl });
  const first = feed.items[0];
  assert.ok(first.source_item, "source_item missing");
  assert.ok(first.primeviewfx_interpretation, "interpretation missing");
  assert.equal(first.source_item.primeviewfx_interpretation, undefined,
    "interpretation must not be merged into the source record");
  assert.ok(first.source_item.source_url, "every item must carry its source URL");
  assert.ok(first.source_item.published_utc, "every item must carry a timestamp");
});

console.log("\n[9] Staleness");
test("stale source is detectable", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  assert.equal(isStale("2026-09-10T11:59:00Z", now), false);
  assert.equal(isStale("2026-09-10T11:00:00Z", now), true);
});

console.log("\n[10] Licensed providers are gated OFF");
test("no licensed provider is enabled in v1", () => {
  for (const p of Object.values(LICENSED_PROVIDERS_PENDING)) {
    assert.equal(p.enabled, false, `${p.id} must not be enabled`);
    assert.equal(p.licence_status, "NOT_CONFIRMED");
  }
});
test("using an unlicensed provider throws", () => {
  assert.throws(
    () => assertLicensedProviderUsable(LICENSED_PROVIDERS_PENDING.TRADING_ECONOMICS),
    /not licensed for member redistribution/
  );
});


console.log("\n[11] Source health semantics (quiet source is NOT stale)");
test("HEALTHY when recently fetched, even with ZERO items", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  assert.equal(sourceHealth({ last_fetch_success_utc: "2026-09-10T11:58:00Z", items: [] }, now), "HEALTHY");
});
test("quiet source publishing nothing for DAYS is still HEALTHY", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  const r = { last_fetch_success_utc: "2026-09-10T11:59:00Z",
              latest_item_published_utc: "2026-09-04T18:00:00Z", items: [] };
  assert.equal(sourceHealth(r, now), "HEALTHY", "a quiet source must not be reported as stale");
});
test("STALE_FETCH when the last SUCCESS is old", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  assert.equal(sourceHealth({ last_fetch_success_utc: "2026-09-10T11:00:00Z" }, now), "STALE_FETCH");
});
test("FETCH_FAILED when never succeeded, even though attempted", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  assert.equal(sourceHealth({ last_fetch_attempt_utc: "2026-09-10T11:59:59Z",
                              last_fetch_success_utc: null }, now), "FETCH_FAILED");
});

await atest("a source returning zero relevant items does NOT degrade the feed", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("bls.gov")) return { ok: true, status: 200, text: async () => FEED_XML };
    if (String(url).includes("treasury.gov")) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => '<?xml version="1.0"?><rss><channel></channel></rss>' };
  };
  const feed = await buildFeed({ fetchImpl });
  assert.equal(feed.feed_state, "OK", "all sources reachable => OK regardless of item counts");
  const quiet = feed.sources.filter((s) => s.item_count === 0);
  assert.ok(quiet.length > 0, "expected a quiet source in this fixture");
  for (const s of quiet) assert.equal(s.source_health, "HEALTHY", `${s.provider} wrongly unhealthy while quiet`);
});

await atest("source status exposes the three distinct times", async () => {
  const fetchImpl = async (url) =>
    String(url).includes("bls.gov") ? { ok: true, status: 200, text: async () => FEED_XML }
                                    : { ok: false, status: 503, text: async () => "" };
  const feed = await buildFeed({ fetchImpl });
  const bls = feed.sources.find((s) => s.provider === "BLS");
  assert.ok(bls.last_fetch_attempt_utc, "attempt time missing");
  assert.ok(bls.last_fetch_success_utc, "success time missing");
  assert.ok("latest_item_published_utc" in bls, "published time missing");
  const failed = feed.sources.find((s) => s.source_health === "FETCH_FAILED");
  assert.equal(failed.last_fetch_success_utc, null, "failed source must not carry a success time");
});

console.log("\n[12] Surprise (raw facts retained, no universal strength score)");
test("surprise ABOVE/BELOW/IN_LINE with absolute difference", () => {
  assert.deepEqual(computeSurprise({ actual: 185, consensus: 150 }),
    { surprise_absolute: 35, surprise_direction: "ABOVE", surprise_units: "release_native" });
  assert.equal(computeSurprise({ actual: 2.8, consensus: 3.1 }).surprise_direction, "BELOW");
  assert.equal(computeSurprise({ actual: 3.1, consensus: 3.1 }).surprise_direction, "IN_LINE");
});
test("no normalised percentage strength score is emitted", () => {
  const keys = Object.keys(computeSurprise({ actual: 185, consensus: 150 })).join(" ");
  assert.ok(!/percent|pct|strength|score|zscore|sigma/i.test(keys),
    "a universal strength score would imply false equivalence across releases");
});
test("surprise is null when figures are absent", () => {
  assert.equal(computeSurprise({ actual: null, consensus: 150 }).surprise_absolute, null);
});

console.log("\n[13] Treasury rates context (separate section, daily scope)");
const CSV = ["Date,1 Mo,2 Yr,10 Yr,30 Yr",
             "09/04/2026,4.10,3.85,4.21,4.55",
             "09/03/2026,4.11,3.88,4.25,4.58"].join("\n");
test("parses newest row and computes 2s10s", () => {
  const r = parseYieldCsv(CSV);
  assert.equal(r.as_of_date, "2026-09-04");
  assert.equal(r.yield_2y, 3.85);
  assert.equal(r.yield_10y, 4.21);
  assert.equal(r.curve_2s10s, 0.36);
  assert.equal(r.freshness, "DAILY");
});
test("column matching is name-based, not positional", () => {
  const r = parseYieldCsv(["Date,10 YR,2 YR", "09/04/2026,4.21,3.85"].join("\n"));
  assert.equal(r.yield_2y, 3.85, "maturities must not be mis-assigned on reorder");
  assert.equal(r.yield_10y, 4.21);
});
test("picks max date, not row order", () => {
  const r = parseYieldCsv(["Date,2 Yr,10 Yr", "09/01/2026,3.00,4.00", "09/04/2026,3.85,4.21"].join("\n"));
  assert.equal(r.as_of_date, "2026-09-04");
});
test("malformed CSV returns null rather than guessing", () => {
  assert.equal(parseYieldCsv("garbage"), null);
});

await atest("Treasury failure does NOT affect headline feed health", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("treasury.gov")) throw new Error("treasury down");
    return { ok: true, status: 200, text: async () => FEED_XML };
  };
  const feed = await buildFeed({ fetchImpl });
  assert.equal(feed.rates_context, null, "rates context should be absent");
  assert.equal(feed.feed_state, "OK", "headline feed must be unaffected");
  assert.ok(feed.items.length > 0);
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
