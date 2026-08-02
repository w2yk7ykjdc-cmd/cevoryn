import { NextResponse } from "next/server";
import { getPaymentProvider, isBillingConfigured } from "@/server/billing/provider/registry";
import { applyWebhookEvent } from "@/server/billing/subscription";
import { logger } from "@/server/logger/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/webhook — Stripe's inbound event delivery endpoint.
 * Unauthenticated by session (Stripe has no cookie/bearer token); the
 * webhook signature check IS the authentication. Reads the raw body
 * (never `request.json()`) because signature verification is computed
 * over the exact bytes Stripe signed.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event;
  try {
    event = getPaymentProvider().constructWebhookEvent(rawBody, signature);
  } catch (err) {
    logger.warn({ err }, "rejected billing webhook: invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    await applyWebhookEvent(event);
  } catch (err) {
    logger.error({ err, eventId: event.id, type: event.type }, "failed to apply billing webhook event");
    return NextResponse.json({ error: "Failed to process event" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
