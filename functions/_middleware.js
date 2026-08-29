// Site-wide Pages Functions middleware. Runs before every request,
// including plain static-asset serving, for the whole deployment.
//
// Closes the 2026-08-29 access-control bypass: each functions/member-
// area/*.js Function only intercepts the FRIENDLY route
// (/member-area/bearish-cascade, etc) - the raw hashed static file it
// ultimately serves (e.g. /bearish-cascade-0171dd2ecccd13fa.html) was
// never itself protected, so Cloudflare Pages served it directly,
// unauthenticated, to anyone who requested that exact path (both the
// .html form and the extensionless "clean URL" form). One discovery
// vector was itself public: data/primeviewfx_research_tools_nav_v1.json
// used to list every hashed filename in plaintext (fixed alongside this,
// see primeviewfx_research_tools_nav_injector_v1.py).
//
// Lesson (Decision Log, 2026-08-29): a protected friendly route does not
// protect the underlying static artefact. Access control must apply to
// the resource itself; obscurity of a generated filename is not an
// authentication mechanism. This file is that enforcement, applied to
// the resource rather than to any one route.
//
// PROTECTED_ASSET_PATHS must stay in sync with every ASSET_PATH constant
// in functions/member-area/*.js - each of those files carries a comment
// pointing back here, and primeviewfx_publish_data_gatekeeper_v1.py's
// --check-middleware-coverage mode fails the publish pipeline if they
// ever drift apart.
import { checkGate, redirectToPayment, serveGatedAsset } from "./utils/gate.js";

const PROTECTED_ASSET_PATHS = new Set([
  "/bearish-cascade-0171dd2ecccd13fa.html",
  "/bullish-cascade-1ddfa177ade539c0.html",
  "/cascade-research-summary-ff36f349b8cbb7d7.html",
  "/members-weekly-goldturns-5ca15a7d08b31d56.html",
  "/members-context-ff240cee9670dd32.html",
  "/members-research-a8502a7b66e839df.html",
  "/members/primeviewfx_members_integrated_map_v1-8d9ae95fd8353fae.html",
  "/members-market-structure-5ce258c419052da1.html",
  "/members-overview-7d9b11c44f3cde21.html",
  "/weighted-level-scanner-add58c89ce531e69.html",
  "/members-static-chart-preview-4597f9ea54ee5855.html",
  "/members-system-status-0c1af4ca8d3a36b5.html",
]);

// Cloudflare Pages serves "foo.html" at both "/foo.html" and the clean
// URL "/foo" - guard both forms explicitly rather than trust routing to
// always normalize onto one of them before this file runs.
function candidatePaths(pathname) {
  if (pathname.endsWith(".html")) {
    return [pathname];
  }
  return [pathname, `${pathname}.html`];
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  const isProtected = candidatePaths(url.pathname).some((p) => PROTECTED_ASSET_PATHS.has(p));
  if (!isProtected) {
    return next();
  }

  const gate = await checkGate(request, env);
  if (!gate.ok) {
    return redirectToPayment(url.origin);
  }

  // Same authentication + serving logic as the friendly /member-area/*
  // routes (checkGate + serveGatedAsset) - not a second, parallel gate
  // implementation.
  const assetPath = url.pathname.endsWith(".html") ? url.pathname : `${url.pathname}.html`;
  return serveGatedAsset(context, assetPath, gate);
}
