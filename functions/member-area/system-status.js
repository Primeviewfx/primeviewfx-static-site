// GET /member-area/system-status
//
// PrimeViewFX Member UI v1 shell. Same gate as /member-area, see
// functions/utils/gate.js.
//
// The underlying filename is deliberately unguessable (not just unlinked) -
// keep it in sync with the filename in this file's ASSET_PATH.
//
// Content is a manually-derived snapshot as of 2026-08-25 (see Decision
// Log) - a deliberately filtered, member-safe derivative of the internal
// production health data (status buckets + last-updated only, no
// filenames/scripts/thresholds/internals). Wiring this to regenerate
// automatically each run is a follow-up, not done in this first shell.
import { checkGate, redirectToPayment, serveGatedAsset } from "../utils/gate.js";

const ASSET_PATH = "/members-system-status-0c1af4ca8d3a36b5.html";

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  const gate = await checkGate(request, env);
  if (!gate.ok) {
    return redirectToPayment(origin);
  }

  return serveGatedAsset(context, ASSET_PATH, gate);
}
