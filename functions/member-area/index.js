// GET /member-area
//
// Cookie/token gate for the members research hub. See functions/utils/gate.js
// for the shared auth logic (reused by every gated members-only route).
import { checkGate, redirectToPayment, serveGatedAsset } from "../utils/gate.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  const gate = await checkGate(request, env);
  if (!gate.ok) {
    return redirectToPayment(origin);
  }

  return serveGatedAsset(context, "/members-research.html", gate);
}
