// GET /api/download/:file?token=...
//
// The only place actual file gating is enforced. `:file` is checked against
// a fixed allowlist (never used as a raw KV key) so this route can't be used
// to probe arbitrary KV keys.
import { getSubscriberByToken } from "../../utils/kv.js";

const FILES = {
  redzones: { kvKey: "file:redzones", downloadName: "PrimeViewFX_RedZones.ex5" },
  greenzones: { kvKey: "file:greenzones", downloadName: "PrimeViewFX_GreenZones.ex5" },
};

export async function onRequestGet(context) {
  const { params, request, env } = context;
  const fileMeta = FILES[params.file];
  if (!fileMeta) {
    return new Response("Unknown file", { status: 404 });
  }

  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return new Response("Missing access token", { status: 403 });
  }

  const record = await getSubscriberByToken(env.PVFX_TOKENS, token);
  if (!record || record.status !== "active") {
    return new Response(
      "This link is inactive. Check your subscription status or contact support.",
      { status: 403 }
    );
  }

  const bytes = await env.PVFX_FILES.get(fileMeta.kvKey, { type: "arrayBuffer" });
  if (!bytes) {
    return new Response("File not available - contact support", { status: 500 });
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fileMeta.downloadName}"`,
      "Cache-Control": "no-store",
    },
  });
}
