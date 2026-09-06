// Tests for the TickAtlas adapter and provenance reconciliation.
// Run: node functions/utils/news/test_provider_v1.mjs

import assert from "node:assert/strict";
import { mapEvent, mapImpact, filterUsdRelevant, fetchTickAtlas, TICKATLAS }
  from "./providers/tickatlas.js";
import { reconcileItem, reconcileAll, figuresAgree, sameRelease, tierOf,
         shouldSuppressInterpretation } from "./reconcile.js";
import { LICENSED_PROVIDERS_PENDING, PROVIDERS } from "./sources.js";
import { PRIMARY_SOURCES } from "./reconcile.js";
import { makeSourceItem } from "./schema.js";

let passed = 0, failed = 0;
const test = (n, f) => { try { f(); console.log(`  ok   ${n}`); passed++; }
  catch (e) { console.log(`  FAIL ${n}\n       ${e.message}`); failed++; } };
const atest = async (n, f) => { try { await f(); console.log(`  ok   ${n}`); passed++; }
  catch (e) { console.log(`  FAIL ${n}\n       ${e.message}`); failed++; } };

console.log("\n[A] TickAtlas field mapping");
test("maps documented fields to the canonical schema", () => {
  const m = mapEvent({
    event: "Consumer Price Index YoY", datetime: "2026-09-10T12:30:00Z",
    impact: "high", forecast: "3.1", previous: "3.0", actual: "3.4",
    currency: "USD",
  });
  assert.equal(m.title, "Consumer Price Index YoY");
  assert.equal(m.consensus, 3.1);
  assert.equal(m.previous, 3.0);
  assert.equal(m.actual, 3.4);
  assert.equal(m.importance, "HIGH");
  assert.equal(m.currency, "USD");
  assert.equal(m.category, "INFLATION");
  assert.equal(m.is_released, true);
});
test("parses K/M suffixes used by calendar feeds", () => {
  const m = mapEvent({ event: "Nonfarm Payrolls", datetime: "2026-09-04T12:30:00Z",
                       impact: "high", forecast: "150K", actual: "203K", currency: "USD" });
  assert.equal(m.consensus, 150000);
  assert.equal(m.actual, 203000);
});
test("numeric impact levels map correctly", () => {
  assert.equal(mapImpact(3), "HIGH");
  assert.equal(mapImpact(2), "MEDIUM");
  assert.equal(mapImpact("Low"), "LOW");
  assert.equal(mapImpact("nonsense"), null);
});
test("unreleased event -> actual null, is_released false", () => {
  const m = mapEvent({ event: "US CPI", datetime: "2026-09-10T12:30:00Z",
                       impact: "high", forecast: "3.1", previous: "3.0",
                       actual: "", currency: "USD" });
  assert.equal(m.actual, null);
  assert.equal(m.is_released, false);
});
test("row without event or datetime returns null, never a partial record", () => {
  assert.equal(mapEvent({ datetime: "2026-09-10T12:30:00Z" }), null);
  assert.equal(mapEvent({ event: "CPI" }), null);
  assert.equal(mapEvent({ event: "CPI", datetime: "not-a-date" }), null);
});
test("is tagged SECONDARY provenance, not official", () => {
  const m = mapEvent({ event: "US CPI", datetime: "2026-09-10T12:30:00Z",
                       impact: "high", currency: "USD" });
  assert.equal(m.provenance_tier, "SECONDARY");
  assert.equal(m.source_type, "aggregator");
});

console.log("\n[B] USD / impact filtering");
test("non-USD dropped", () => {
  const eur = mapEvent({ event: "ECB Rate Decision", datetime: "2026-09-10T12:30:00Z",
                         impact: "high", currency: "EUR" });
  assert.equal(filterUsdRelevant([eur]).length, 0);
});
test("HIGH kept, unlisted MEDIUM dropped, allowed MEDIUM kept", () => {
  const mk = (event, impact) => mapEvent({ event, impact, currency: "USD",
                                           datetime: "2026-09-10T12:30:00Z" });
  const kept = filterUsdRelevant([
    mk("Nonfarm Payrolls", "high"),
    mk("Some Minor Survey", "medium"),
    mk("Producer Price Index", "medium"),
  ]).map((i) => i.title);
  assert.ok(kept.includes("Nonfarm Payrolls"));
  assert.ok(kept.includes("Producer Price Index"));
  assert.ok(!kept.includes("Some Minor Survey"));
});

console.log("\n[C] Licence gate");
test("TickAtlas registered but NOT enabled", () => {
  const p = LICENSED_PROVIDERS_PENDING.TICKATLAS;
  assert.equal(p.enabled, false);
  assert.equal(p.licence_status, "NOT_CONFIRMED");
  assert.equal(p.provenance_tier, "SECONDARY");
});
await atest("fetch refuses while unlicensed, even with a key present", async () => {
  const r = await fetchTickAtlas({
    env: { TICKATLAS_API_KEY: "secret" },
    provider: LICENSED_PROVIDERS_PENDING.TICKATLAS,
    fetchImpl: async () => { throw new Error("should never be called"); },
  });
  assert.equal(r.ok, false);
  assert.equal(r.items.length, 0);
  assert.match(r.errors[0], /not licensed/i);
});
await atest("fetch refuses when licensed but key missing", async () => {
  const r = await fetchTickAtlas({
    env: {},
    provider: { ...LICENSED_PROVIDERS_PENDING.TICKATLAS, enabled: true, licence_status: "CONFIRMED" },
    fetchImpl: async () => { throw new Error("should never be called"); },
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /missing secret/i);
});
await atest("fetches once licensed AND keyed", async () => {
  const r = await fetchTickAtlas({
    env: { TICKATLAS_API_KEY: "k" },
    provider: { ...LICENSED_PROVIDERS_PENDING.TICKATLAS, enabled: true, licence_status: "CONFIRMED" },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ([
      { event: "Nonfarm Payrolls", datetime: "2026-09-04T12:30:00Z",
        impact: "high", forecast: "150K", actual: "203K", currency: "USD" },
    ])}),
  });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.ok(r.last_fetch_success_utc);
});

console.log("\n[D] Provenance reconciliation");
const official = (over = {}) => makeSourceItem({
  event_id: "BLS_1", source: "Bureau of Labor Statistics",
  published_utc: "2026-09-04T12:30:00Z", category: "LABOUR",
  title: "Employment Situation - Nonfarm Payrolls", source_url: "https://bls.gov/x",
  raw_hash: "h", actual: 203000, ...over,
});
const fast = (over = {}) => ({
  ...mapEvent({ event: "Nonfarm Payrolls", datetime: "2026-09-04T12:30:00Z",
                impact: "high", actual: "203K", forecast: "150K", currency: "USD" }),
  ...over,
});

test("official item is OFFICIAL_ONLY", () => {
  const v = reconcileItem(official(), []);
  assert.equal(v.verification_state, "OFFICIAL_ONLY");
  assert.equal(v.provenance_tier, "PRIMARY");
});
test("fast item with no official counterpart is UNVERIFIED", () => {
  const v = reconcileItem(fast(), []);
  assert.equal(v.verification_state, "UNVERIFIED");
});
test("agreeing figures -> VERIFIED, names the official source", () => {
  const v = reconcileItem(fast(), [official()]);
  assert.equal(v.verification_state, "VERIFIED");
  assert.equal(v.authoritative_source, "Bureau of Labor Statistics");
});
test("DISAGREEING figures -> CONFLICT, both values retained", () => {
  const v = reconcileItem(fast({ actual: 185000 }), [official({ actual: 203000 })]);
  assert.equal(v.verification_state, "CONFLICT");
  assert.equal(v.conflict.secondary_value, 185000);
  assert.equal(v.conflict.primary_value, 203000);
  assert.equal(v.conflict.primary_source, "Bureau of Labor Statistics");
  assert.match(v.note, /official source is authoritative/i);
});
test("scheduled-but-unreleased -> AWAITING_RELEASE", () => {
  const v = reconcileItem(fast({ actual: null }), [official()]);
  assert.equal(v.verification_state, "AWAITING_RELEASE");
});
test("a CONFLICT suppresses interpretation", () => {
  const v = reconcileItem(fast({ actual: 185000 }), [official({ actual: 203000 })]);
  assert.equal(shouldSuppressInterpretation(v), true);
  assert.equal(shouldSuppressInterpretation(reconcileItem(fast(), [official()])), false);
});
test("figuresAgree uses relative tolerance, not naive equality", () => {
  assert.equal(figuresAgree(203000, 203000), true);
  assert.equal(figuresAgree(203000, 185000), false);
  assert.equal(figuresAgree(3.4, 3.4), true);
  assert.equal(figuresAgree(3.4, 3.5), false);
  assert.equal(figuresAgree(3.4, null), null, "non-comparable must be null, not false");
});
test("sameRelease pairs differing titles for one release", () => {
  assert.ok(sameRelease({ title: "Nonfarm Payrolls" },
                        { title: "Employment Situation - Nonfarm Payrolls" }));
  assert.ok(!sameRelease({ title: "Nonfarm Payrolls" }, { title: "Consumer Price Index" }));
});
test("tierOf classifies official vs aggregator", () => {
  assert.equal(tierOf(official()), "PRIMARY");
  assert.equal(tierOf(fast()), "SECONDARY");
});
test("reconcileAll attaches verification without mutating the source record", () => {
  const f = fast({ actual: 185000 });
  const out = reconcileAll([official({ actual: 203000 }), f]);
  const sec = out.find((o) => o.item.source === "TickAtlas");
  assert.equal(sec.verification.verification_state, "CONFLICT");
  assert.equal(sec.item.actual, 185000, "source figure must not be overwritten");
  assert.equal(sec.item.verification, undefined, "verification must not be merged in");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
