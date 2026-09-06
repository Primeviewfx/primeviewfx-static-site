// Tests for release containers and presentation types (2026-09-05).
import assert from "node:assert/strict";
import { interpretItem, presentationType, matchContainer } from "./interpret.js";
import { makeSourceItem } from "./schema.js";

let passed = 0, failed = 0;
const test = (n, f) => { try { f(); console.log(`  ok   ${n}`); passed++; }
  catch (e) { console.log(`  FAIL ${n}\n       ${e.message}`); failed++; } };

const it = (over = {}) => makeSourceItem({
  event_id: "x", source: "Bureau of Labor Statistics",
  published_utc: "2026-09-04T12:30:00Z", category: "LABOUR",
  title: "Employment Situation - August 2026",
  source_url: "https://bls.gov/x", raw_hash: "h", ...over,
});

console.log("\n[14] Release containers");
test("Employment Situation is recognised as a labour release container", () => {
  const c = matchContainer("Employment Situation - August 2026");
  assert.ok(c, "container not matched - this was the preview bug");
  assert.equal(c.key, "EMPLOYMENT_SITUATION");
  assert.equal(c.category, "LABOUR");
  assert.deepEqual(c.component_labels,
    ["Nonfarm Payrolls", "Unemployment Rate", "Average Hourly Earnings"]);
});
test("Employment Situation NO LONGER says 'not covered by the rule set'", () => {
  const i = interpretItem(it());
  const all = `${i.plain_english} ${i.reason}`;
  assert.ok(!/not a scheduled release covered/i.test(all),
    `still falling through: ${all}`);
  assert.match(i.plain_english, /Awaiting release/i);   // headline
  assert.match(i.reason, /Employment Situation/i);      // explanation
  assert.match(i.reason, /Nonfarm Payrolls/i);
  assert.match(i.reason, /Unemployment Rate/i);
  assert.match(i.reason, /Average Hourly Earnings/i);
});
test("container is classified SCHEDULED_DATA, not GENERAL_MACRO", () => {
  assert.equal(presentationType(it()), "SCHEDULED_DATA");
});
test("CPI release container also recognised", () => {
  const c = matchContainer("Consumer Price Index - August 2026");
  assert.ok(c);
  assert.equal(c.category, "INFLATION");
});

console.log("\n[15] Presentation types");
test("Fed speech -> CENTRAL_BANK with policy-context wording", () => {
  const i2 = it({ title: "Speech by the Chair on monetary policy", category: "FED_RATES" });
  assert.equal(presentationType(i2), "CENTRAL_BANK");
  const i = interpretItem(i2);
  assert.match(i.plain_english, /Policy context/i);
  assert.ok(!/not a scheduled release covered/i.test(i.plain_english));
});
test("CFTC COT -> POSITIONING with positioning wording", () => {
  const i2 = it({ title: "Commitments of Traders report - gold futures positioning",
                  source: "CFTC", category: "GOLD_COMMODITIES", importance: "MEDIUM" });
  assert.equal(presentationType(i2), "POSITIONING");
  const i = interpretItem(i2);
  assert.match(i.plain_english, /Positioning context/i);
  assert.ok(!/not a scheduled release covered/i.test(i.plain_english));
});
test("CPI with figures -> SCHEDULED_DATA and a real effect", () => {
  const i2 = it({ title: "Consumer Price Index", category: "INFLATION",
                  actual: 3.4, consensus: 3.1 });
  assert.equal(presentationType(i2), "SCHEDULED_DATA");
  assert.equal(interpretItem(i2).usd_effect, "SUPPORTIVE");
});
test("pre-release wording is 'Awaiting release', not bare 'not published'", () => {
  const i = interpretItem(it({ title: "Consumer Price Index", actual: null, consensus: null,
                               category: "INFLATION" }));
  assert.match(i.plain_english, /Awaiting release/i);
});
test("unrelated item still GENERAL_MACRO", () => {
  assert.equal(presentationType(it({ title: "Trade balance widened", category: "GROWTH" })),
               "GENERAL_MACRO");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
