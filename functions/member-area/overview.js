// GET /member-area/overview
//
// PrimeViewFX Member UI v1 shell - landing page. Same gate as
// /member-area, see functions/utils/gate.js.
//
// The underlying filename is deliberately unguessable (not just unlinked) -
// keep it in sync with the filename in this file's ASSET_PATH.
import { checkGate, redirectToPayment, serveGatedAsset } from "../utils/gate.js";

const ASSET_PATH = "/members-overview-7d9b11c44f3cde21.html";

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  const gate = await checkGate(request, env);
  if (!gate.ok) {
    return redirectToPayment(origin);
  }

  return serveGatedAsset(context, ASSET_PATH, gate);
}
