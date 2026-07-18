// GET /member-area/map
//
// Same gate as /member-area, serving the integrated carry + structure map
// page. See functions/utils/gate.js.
//
// The underlying filename is deliberately unguessable (not just unlinked) -
// keep it in sync with MEMBERS_INTEGRATED_MAP_FILENAME in
// primeviewfx_static_site_publisher_v1.py and OUT_HTML in
// primeviewfx_members_integrated_map_export_v1.py.
import { checkGate, redirectToPayment, serveGatedAsset } from "../utils/gate.js";

const ASSET_PATH = "/members/primeviewfx_members_integrated_map_v1-8d9ae95fd8353fae.html";

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  const gate = await checkGate(request, env);
  if (!gate.ok) {
    return redirectToPayment(origin);
  }

  return serveGatedAsset(context, ASSET_PATH, gate);
}
