// Auth acceptance test for /api/member/gold-dollar-intelligence:
//   "unauthenticated API request cannot return member feed data"
//
// Exercises the real endpoint module against a stubbed env/KV.
import assert from "node:assert/strict";

// Minimal Workers-ish globals the endpoint touches.
globalThis.caches = { default: { match: async () => null, put: async () => {} } };

const { onRequestGet, onRequest } =
  await import("../../api/member/gold-dollar-intelligence.js");

// KV keys are prefixed `token:` - see functions/utils/kv.js
// (getSubscriberByToken). The stub must match the real layout, or the
// test proves nothing about the real gate.
const envWith = (records) => ({
  PVFX_TOKENS: {
    get: async (k) => {
      const rec = records[String(k).replace(/^token:/, "")];
      return rec ? JSON.stringify(rec) : null;
    },
  },
});
const ctx = (url, env, headers = {}) => ({
  request: new Request(url, { headers }),
  env,
  waitUntil: () => {},
});

let passed = 0, failed = 0;
const t = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); passed++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); failed++; }
};

console.log("\n[AUTH] /api/member/gold-dollar-intelligence");

await t("no token -> 401 and NO feed data", async () => {
  const res = await onRequestGet(ctx(
    "https://x.test/api/member/gold-dollar-intelligence", envWith({})));
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, "unauthorized");
  assert.equal(body.items, undefined, "items must not be present");
  assert.equal(body.sources, undefined, "source list must not leak");
  assert.equal(body.feed_state, undefined, "feed state must not leak");
});

await t("invalid token -> 401", async () => {
  const res = await onRequestGet(ctx(
    "https://x.test/api/member/gold-dollar-intelligence?token=nope", envWith({})));
  assert.equal(res.status, 401);
});

await t("cancelled subscriber -> 401", async () => {
  const env = envWith({ tok1: { status: "cancelled", email: "a@b.c" } });
  const res = await onRequestGet(ctx(
    "https://x.test/api/member/gold-dollar-intelligence?token=tok1", env));
  assert.equal(res.status, 401);
});

await t("active subscriber -> 200 with a well-formed payload", async () => {
  const env = envWith({ tok2: { status: "active", email: "a@b.c" } });
  globalThis.fetch = async () => { throw new Error("offline in test"); };
  const res = await onRequestGet(ctx(
    "https://x.test/api/member/gold-dollar-intelligence?token=tok2", env));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.schema_version, "gdi-v1");
  assert.ok("feed_state" in body);
  assert.ok(Array.isArray(body.items));
  assert.match(body.disclaimer, /not investment advice/i);
});

await t("responses are never publicly cacheable", async () => {
  const env = envWith({ tok3: { status: "active" } });
  globalThis.fetch = async () => { throw new Error("offline"); };
  const res = await onRequestGet(ctx(
    "https://x.test/api/member/gold-dollar-intelligence?token=tok3", env));
  assert.match(res.headers.get("Cache-Control"), /private/);
  assert.match(res.headers.get("Cache-Control"), /no-store/);
});

await t("non-GET verbs rejected", async () => {
  const res = await onRequest({
    request: new Request("https://x.test/api/member/gold-dollar-intelligence", { method: "POST" }),
    env: envWith({}), waitUntil: () => {},
  });
  assert.equal(res.status, 405);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
