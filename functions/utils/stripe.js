// Minimal Stripe REST + webhook-signature helpers, dependency-free (no
// `stripe` npm package) so Cloudflare Pages can deploy this with no build
// step. Stripe's webhook signature scheme is public/stable:
// https://stripe.com/docs/webhooks/signatures

const TOLERANCE_SECONDS = 300; // reject webhook payloads older than 5 minutes

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Verifies the Stripe-Signature header against the RAW (unparsed) request
// body. Returns the parsed event object if valid, throws otherwise.
export async function verifyAndParseStripeEvent(rawBody, sigHeader, webhookSecret) {
  if (!sigHeader) throw new Error("Missing Stripe-Signature header");

  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k, v];
    })
  );
  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) throw new Error("Malformed Stripe-Signature header");

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (age > TOLERANCE_SECONDS) throw new Error("Stripe webhook timestamp too old");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signedPayload = `${timestamp}.${rawBody}`;
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload))
  );
  const computedSig = bytesToHex(sigBytes);

  if (!timingSafeEqual(hexToBytes(computedSig), hexToBytes(expectedSig))) {
    throw new Error("Stripe webhook signature mismatch");
  }

  return JSON.parse(rawBody);
}

// Thin fetch-based wrapper for Stripe's REST API (Bearer auth, form-encoded
// for writes - we only need GETs here).
export async function stripeGet(path, secretKey) {
  const resp = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!resp.ok) {
    throw new Error(`Stripe GET ${path} failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}
