// GET /member-area/bullish-cascade
//
// Same gate as /member-area, serving the bullish cascade research page.
// See functions/utils/gate.js.
//
// The underlying filename is deliberately unguessable (not just unlinked) -
// keep it in sync with PAGE_FILENAME in
// primeviewfx_bullish_cascade_dashboard_card_v1.py.
import { checkGate, redirectToPayment, serveGatedAsset } from "../utils/gate.js";

const ASSET_PATH = "/bullish-cascade-1ddfa177ade539c0.html";

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  const gate = await checkGate(request, env);
  if (!gate.ok) {
    return redirectToPayment(origin);
  }

  return serveGatedAsset(context, ASSET_PATH, gate);
}
