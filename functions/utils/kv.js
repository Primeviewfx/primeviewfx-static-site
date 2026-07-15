// Shared Cloudflare KV helpers for the subscriber-token store.
//
// Bindings expected (configured in Cloudflare Pages -> Settings -> Functions
// -> KV namespace bindings):
//   env.PVFX_TOKENS - subscriber records + customer index + event dedupe
//   env.PVFX_FILES  - the two gated .ex5 file blobs
//
// Key layout in PVFX_TOKENS:
//   token:<opaque>      -> JSON subscriber record
//   customer:<stripeId> -> "<opaque token>"   (secondary index, avoids
//                          minting a second live token on resubscribe)
//   event:<stripeEventId> -> "1"  (webhook idempotency guard, short TTL)

const EVENT_DEDUPE_TTL_SECONDS = 60 * 60 * 24; // 24h - comfortably longer than Stripe's redelivery window

export function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32)); // 256 bits
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getSubscriberByToken(kv, token) {
  const raw = await kv.get(`token:${token}`);
  return raw ? JSON.parse(raw) : null;
}

export async function getTokenByCustomerId(kv, customerId) {
  return kv.get(`customer:${customerId}`);
}

export async function putSubscriber(kv, token, record) {
  await kv.put(`token:${token}`, JSON.stringify(record));
  await kv.put(`customer:${record.stripe_customer_id}`, token);
}

// Idempotency guard, split into check-then-mark-on-success (not a single
// atomic claim) so that a transient failure while handling a NEW event
// doesn't get silently swallowed as a "duplicate" on Stripe's retry -
// only events that actually finished processing get marked seen.
export async function wasEventProcessed(kv, eventId) {
  return Boolean(await kv.get(`event:${eventId}`));
}

export async function markEventProcessed(kv, eventId) {
  await kv.put(`event:${eventId}`, "1", { expirationTtl: EVENT_DEDUPE_TTL_SECONDS });
}
