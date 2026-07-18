// GET /member-area/static-chart
//
// Same gate as /member-area, serving the static chart preview page.
// See functions/utils/gate.js.
//
// The underlying filename is deliberately unguessable (not just unlinked) -
// keep it in sync with STATIC_PREVIEW_FILENAME in
// primeviewfx_members_visual_chart_generator_v2_5_3_9.py.
import { checkGate, redirectToPayment, serveGatedAsset } from "../utils/gate.js";

const ASSET_PATH = "/members-static-chart-preview-4597f9ea54ee5855.html";

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  const gate = await checkGate(request, env);
  if (!gate.ok) {
    return redirectToPayment(origin);
  }

  return serveGatedAsset(context, ASSET_PATH, gate);
}
