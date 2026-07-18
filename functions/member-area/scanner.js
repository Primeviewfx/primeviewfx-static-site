// GET /member-area/scanner
//
// Same gate as /member-area, serving the weighted-level scanner page.
// See functions/utils/gate.js.
//
// The underlying filename is deliberately unguessable (not just unlinked) -
// keep it in sync with PAGE_FILENAME in
// primeviewfx_weighted_level_dashboard_card_v1_3.py.
import { checkGate, redirectToPayment, serveGatedAsset } from "../utils/gate.js";

const ASSET_PATH = "/weighted-level-scanner-add58c89ce531e69.html";

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  const gate = await checkGate(request, env);
  if (!gate.ok) {
    return redirectToPayment(origin);
  }

  return serveGatedAsset(context, ASSET_PATH, gate);
}
