// Shared cookie/token gate logic for members-only content Functions.
// A subscriber's emailed link (?token=...) sets an HttpOnly cookie on first
// visit; subsequent visits (e.g. a plain "Members" link with no token in the
// URL) are recognized via that cookie. The cookie is re-validated against KV
// on every request rather than trusted blindly, so a cancelled subscription
// loses access even with a stale cookie still in the browser.
import { getSubscriberByToken } from "./kv.js";

export const GATE_COOKIE_NAME = "pvfx_token";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Returns { ok: true, token, setCookie } if the request carries a valid,
// active subscriber token (via ?token= or the pvfx_token cookie), otherwise
// { ok: false }. `setCookie` is true only when the token came from the URL
// (a fresh click-through) - that's the one case the caller should Set-Cookie.
//
// env.ADMIN_TOKEN (a Cloudflare Pages secret, set via `wrangler pages secret
// put ADMIN_TOKEN`) is checked first as a standing bypass for the site
// owner - lets them reach any gated page without needing an active
// subscription or a fabricated KV record. Skipped entirely if the secret
// isn't configured.
export async function checkGate(request, env) {
  const url = new URL(request.url);
  const tokenFromUrl = url.searchParams.get("token");
  const tokenFromCookie = readCookie(request, GATE_COOKIE_NAME);
  const token = tokenFromUrl || tokenFromCookie;

  if (!token) return { ok: false };

  if (env.ADMIN_TOKEN && token === env.ADMIN_TOKEN) {
    return { ok: true, token, setCookie: Boolean(tokenFromUrl) };
  }

  const record = await getSubscriberByToken(env.PVFX_TOKENS, token);
  if (!record || record.status !== "active") return { ok: false };

  return { ok: true, token, setCookie: Boolean(tokenFromUrl) };
}

// ?locked=1 flags to founder-beta.html that this visit came from a blocked
// members-only link, so it can show a "subscribe to unlock" banner instead
// of the plain landing page.
export function redirectToPayment(origin) {
  return Response.redirect(`${origin}/founder-beta.html?locked=1`, 302);
}

// Fetches `assetPath` (e.g. "/members-research.html") from the same
// deployment's static assets and re-serves it with no-store caching and,
// if this request just authenticated via a fresh ?token=, a Set-Cookie.
export async function serveGatedAsset(context, assetPath, gateResult) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  const assetResponse = await env.ASSETS.fetch(new URL(assetPath, origin));
  if (!assetResponse.ok) {
    return new Response("Members content unavailable - contact support", { status: 500 });
  }

  const headers = new Headers(assetResponse.headers);
  headers.set("Cache-Control", "no-store");
  if (gateResult.setCookie) {
    headers.append(
      "Set-Cookie",
      `${GATE_COOKIE_NAME}=${encodeURIComponent(gateResult.token)}; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/`
    );
  }

  return new Response(assetResponse.body, { status: 200, headers });
}

// no-op touch to force a fresh Cloudflare Pages deployment (2026-07-19) -
// confirming ADMIN_TOKEN is actually read at request time by a genuinely
// new build, not a retried/cached one.
