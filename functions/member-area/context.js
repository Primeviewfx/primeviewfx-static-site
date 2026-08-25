// GET /member-area/context
//
// PrimeViewFX Member UI v1 shell. Same gate as /member-area, see
// functions/utils/gate.js.
//
// The underlying filename is deliberately unguessable (not just unlinked) -
// keep it in sync with the filename in this file's ASSET_PATH.
import { checkGate, redirectToPayment, serveGatedAsset } from "../utils/gate.js";

const ASSET_PATH = "/members-context-ff240cee9670dd32.html";

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  const gate = await checkGate(request, env);
  if (!gate.ok) {
    return redirectToPayment(origin);
  }

  return serveGatedAsset(context, ASSET_PATH, gate);
}
