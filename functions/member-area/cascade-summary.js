// GET /member-area/cascade-summary
//
// Same gate as /member-area, serving the combined cascade research summary
// page. See functions/utils/gate.js.
//
// The underlying filename is deliberately unguessable (not just unlinked) -
// keep it in sync with PAGE_FILENAME in
// primeviewfx_combined_cascade_research_summary_v1_2.py.
import { checkGate, redirectToPayment, serveGatedAsset } from "../utils/gate.js";

const ASSET_PATH = "/cascade-research-summary-ff36f349b8cbb7d7.html";

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  const gate = await checkGate(request, env);
  if (!gate.ok) {
    return redirectToPayment(origin);
  }

  return serveGatedAsset(context, ASSET_PATH, gate);
}
