// GET /member-area
//
// Cookie/token gate for the members research hub. See functions/utils/gate.js
// for the shared auth logic (reused by every gated members-only route).
//
// The underlying filename is deliberately unguessable (not just unlinked) -
// keep it in sync with MEMBERS_RESEARCH_FILENAME in
// primeviewfx_website_publish_integration_v2_4_4.py.
import { checkGate, redirectToPayment, serveGatedAsset } from "../utils/gate.js";

const ASSET_PATH = "/members-research-a8502a7b66e839df.html";

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  const gate = await checkGate(request, env);
  if (!gate.ok) {
    return redirectToPayment(origin);
  }

  return serveGatedAsset(context, ASSET_PATH, gate);
}
