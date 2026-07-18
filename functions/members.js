// GET /members
//
// Cookie/token gate for the members research hub. Reuses the same
// subscriber-token system as /api/download/:file - a subscriber's emailed
// link (?token=...) sets an HttpOnly cookie on first visit; subsequent
// visits (e.g. the homepage's plain "Members" link, with no token in the
// URL) are recognized via that cookie. The cookie is re-validated against
// KV on every request rather than trusted blindly, so a cancelled
// subscription loses access even with a stale cookie still in the browser.
import { getSubscriberByToken } from "./utils/kv.js";

const COOKIE_NAME = "pvfx_token";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function redirectToPayment(origin) {
  return Response.redirect(`${origin}/founder-beta.html`, 302);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = url.origin;

  const tokenFromUrl = url.searchParams.get("token");
  const tokenFromCookie = readCookie(request, COOKIE_NAME);
  const token = tokenFromUrl || tokenFromCookie;

  if (!token) {
    return redirectToPayment(origin);
  }

  const record = await getSubscriberByToken(env.PVFX_TOKENS, token);
  if (!record || record.status !== "active") {
    return redirectToPayment(origin);
  }

  const assetResponse = await env.ASSETS.fetch(new URL("/members-research.html", origin));
  if (!assetResponse.ok) {
    return new Response("Members content unavailable - contact support", { status: 500 });
  }

  const headers = new Headers(assetResponse.headers);
  headers.set("Cache-Control", "no-store");
  if (tokenFromUrl) {
    headers.append(
      "Set-Cookie",
      `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/`
    );
  }

  return new Response(assetResponse.body, { status: 200, headers });
}
