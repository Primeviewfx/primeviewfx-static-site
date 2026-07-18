// GET /member-area/chart
//
// Same gate as /member-area, serving the live weighted-levels chart page
// instead of the research hub. See functions/utils/gate.js.
import { checkGate, redirectToPayment, serveGatedAsset } from "../utils/gate.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  const gate = await checkGate(request, env);
  if (!gate.ok) {
    return redirectToPayment(origin);
  }

  return serveGatedAsset(context, "/members-weekly-goldturns.html", gate);
}
