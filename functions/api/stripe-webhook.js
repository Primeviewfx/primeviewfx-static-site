// POST /api/stripe-webhook
//
// Handles the three Stripe events this feature needs:
//   checkout.session.completed   -> grant access (new token, or reuse+
//                                    reactivate on resubscribe), email links
//   customer.subscription.updated -> grace-period-aware revoke/reinstate
//   customer.subscription.deleted -> revoke
//
// Grace-period decision (locked in during planning): only revoke on
// past_due/unpaid/canceled, i.e. after Stripe's own Smart Retries are
// exhausted - a single failed renewal attempt does not lock out a paying
// customer mid-retry.
import { verifyAndParseStripeEvent, stripeGet } from "../utils/stripe.js";
import { generateToken, getTokenByCustomerId, putSubscriber, getSubscriberByToken, wasEventProcessed, markEventProcessed } from "../utils/kv.js";
import { sendAccessLinkEmail } from "../utils/email.js";

const REVOKE_STATUSES = new Set(["past_due", "unpaid", "canceled", "incomplete_expired"]);

function downloadUrls(origin) {
  return {
    redZonesUrl: `${origin}/api/download/redzones`,
    greenZonesUrl: `${origin}/api/download/greenzones`,
  };
}

async function handleCheckoutCompleted(event, env, origin) {
  const session = event.data.object;
  const customerId = session.customer;
  const subscriptionId = session.subscription;
  const email = session.customer_details?.email;
  if (!customerId || !subscriptionId || !email) {
    throw new Error("checkout.session.completed missing customer/subscription/email");
  }

  const subscription = await stripeGet(`subscriptions/${subscriptionId}`, env.STRIPE_SECRET_KEY);

  const existingToken = await getTokenByCustomerId(env.PVFX_TOKENS, customerId);
  const existingRecord = existingToken ? await getSubscriberByToken(env.PVFX_TOKENS, existingToken) : null;
  const token = existingToken || generateToken();
  const isWelcomeBack = Boolean(existingRecord);

  await putSubscriber(env.PVFX_TOKENS, token, {
    email,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    status: "active",
    current_period_end: subscription.current_period_end,
    created_at: existingRecord?.created_at ?? Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
  });

  const { redZonesUrl, greenZonesUrl } = downloadUrls(origin);
  await sendAccessLinkEmail(env, {
    to: email,
    redZonesUrl: `${redZonesUrl}?token=${token}`,
    greenZonesUrl: `${greenZonesUrl}?token=${token}`,
    isWelcomeBack,
  });
}

async function handleSubscriptionStatusChange(event, env) {
  const subscription = event.data.object;
  const customerId = subscription.customer;
  const token = await getTokenByCustomerId(env.PVFX_TOKENS, customerId);
  if (!token) return; // no on-file subscriber for this customer (e.g. never completed checkout) - nothing to update

  const record = await getSubscriberByToken(env.PVFX_TOKENS, token);
  if (!record) return;

  const newStatus = REVOKE_STATUSES.has(subscription.status) ? "inactive" : "active";
  record.status = newStatus;
  record.stripe_subscription_id = subscription.id;
  record.current_period_end = subscription.current_period_end;
  record.updated_at = Math.floor(Date.now() / 1000);
  await putSubscriber(env.PVFX_TOKENS, token, record);
}

async function handleSubscriptionDeleted(event, env) {
  const subscription = event.data.object;
  const customerId = subscription.customer;
  const token = await getTokenByCustomerId(env.PVFX_TOKENS, customerId);
  if (!token) return;

  const record = await getSubscriberByToken(env.PVFX_TOKENS, token);
  if (!record) return;

  record.status = "inactive";
  record.updated_at = Math.floor(Date.now() / 1000);
  await putSubscriber(env.PVFX_TOKENS, token, record);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const rawBody = await request.text();
  const sigHeader = request.headers.get("Stripe-Signature");

  let event;
  try {
    event = await verifyAndParseStripeEvent(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  if (await wasEventProcessed(env.PVFX_TOKENS, event.id)) {
    return new Response("Duplicate event, already processed", { status: 200 });
  }

  const origin = new URL(request.url).origin;

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event, env, origin);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionStatusChange(event, env);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event, env);
        break;
      default:
        // Not an event type we act on - still mark processed below so it doesn't recheck forever.
        break;
    }
  } catch (err) {
    // Deliberately do NOT mark the event processed here - a transient
    // failure (e.g. Resend briefly down) should let Stripe's automatic
    // retry actually reprocess and complete the grant, not get silently
    // swallowed as a duplicate. The only real cost of this ordering is a
    // narrow, practically-never-hit race on truly concurrent duplicate
    // deliveries (Stripe's retries are delayed, not simultaneous), which
    // is a better tradeoff than silently losing a paying subscriber's
    // access email.
    return new Response(`Webhook handler error: ${err.message}`, { status: 500 });
  }

  await markEventProcessed(env.PVFX_TOKENS, event.id);
  return new Response("ok", { status: 200 });
}
