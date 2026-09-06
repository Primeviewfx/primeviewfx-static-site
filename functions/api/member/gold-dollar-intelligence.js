// GET /api/member/gold-dollar-intelligence
//
// Authenticated members-only JSON API for PrimeViewFX Gold & Dollar
// Intelligence v1. Same gate as every other member route
// (functions/utils/gate.js) - an unauthenticated request must never
// return feed data.
//
// NOT YET EXPOSED TO MEMBERS: no member page links to this route, and no
// UI is wired to it. Output must pass a Public Disclosure Standard
// review first (see PRIMEVIEWFX_PUBLIC_DISCLOSURE_STANDARD_v1.md).
//
// Key handling: all source fetching happens server-side in this Function.
// No API key is ever placed in frontend/browser assets. A future
// TRADING_ECONOMICS_API_KEY belongs in Pages encrypted secrets and is
// read from `env` here, never shipped to the client.
//
// Third-party content: we store and return TITLE, a short EXCERPT and a
// LINK. Full article bodies are never reproduced.
import { checkGate } from "../../utils/gate.js";
import { buildFeed } from "../../utils/news/aggregate.js";

const CACHE_SECONDS = 120;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // member-specific: never shared/public caches
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  // 1. AUTH FIRST - before any source fetch or data assembly.
  const gate = await checkGate(request, env);
  if (!gate.ok) {
    // Deliberately no feed data, no source list, no counts.
    return json({ error: "unauthorized" }, 401);
  }

  // 2. Short edge cache keyed on the ROUTE ONLY (feed content is
  //    identical for every member, so no member data can leak between
  //    them via the cache). Auth is checked above, before this.
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/member/gold-dollar-intelligence", request.url).toString(), { method: "GET" });

  let cached = null;
  try {
    cached = await cache.match(cacheKey);
  } catch (_) { /* cache unavailable - fall through to a live build */ }
  if (cached) {
    const body = await cached.json();
    return json({ ...body, served_from_cache: true });
  }

  let payload;
  try {
    payload = await buildFeed({ fetchImpl: fetch });
  } catch (e) {
    // A total failure still returns a well-formed, explicitly degraded
    // payload rather than a 500 with no explanation.
    return json({
      schema_version: "gdi-v1",
      generated_utc: new Date().toISOString(),
      feed_state: "UNAVAILABLE",
      feed_message: "News feed temporarily unavailable",
      sources: [],
      items: [],
      disclaimer:
        "Information and education only. Not investment advice, and not a recommendation to buy or sell any instrument.",
    }, 200);
  }

  const response = json(payload);
  if (payload.feed_state !== "UNAVAILABLE") {
    try {
      const toCache = new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json; charset=utf-8",
                   "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
      });
      context.waitUntil(cache.put(cacheKey, toCache));
    } catch (_) { /* caching is best-effort, never load-bearing */ }
  }
  return response;
}

// Any non-GET verb is rejected outright.
export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
  }
  return onRequestGet(context);
}
