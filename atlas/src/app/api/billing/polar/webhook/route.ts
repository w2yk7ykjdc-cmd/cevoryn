import { NextResponse } from "next/server";
import { Webhook, WebhookVerificationError } from "standardwebhooks";

import { applyPolarRomanceSubscriptionEvent } from "@/features/romance/billing/romance-subscription.service";
import { captureServerError } from "@/lib/error-reporting";
import {
  SUPPORTED_POLAR_EVENT_TYPES,
  type PolarSubscriptionEvent,
} from "@/lib/polar/mapping";
import { applyPolarSubscriptionEvent } from "@/server/services/billing.service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const secret = process.env.POLAR_WEBHOOK_SECRET?.trim();

  if (!secret) {
    captureServerError(
      "polar-webhook",
      new Error("POLAR_WEBHOOK_SECRET is not configured."),
      { eventId: request.headers.get("webhook-id") }
    );
    return NextResponse.json(
      { error: "Webhook is not configured." },
      { status: 401 }
    );
  }

  const headers = {
    "webhook-id": request.headers.get("webhook-id") ?? "",
    "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": request.headers.get("webhook-signature") ?? "",
  };

  let verified: unknown;
  try {
    // Polar's webhook secret is verified via the Standard Webhooks spec:
    // the raw secret is base64-encoded before constructing the verifier.
    // This matches @polar-sh/sdk's own src/webhooks.ts validateEvent().
    const base64Secret = Buffer.from(secret, "utf-8").toString("base64");
    const webhook = new Webhook(base64Secret);
    verified = webhook.verify(rawBody, headers);
  } catch (error) {
    // Not the secret or any signature material - just enough to tell a
    // genuine misconfiguration/rotation apart from routine internet noise
    // hitting the endpoint.
    captureServerError("polar-webhook-signature", error, {
      eventId: request.headers.get("webhook-id"),
    });
    if (error instanceof WebhookVerificationError) {
      return NextResponse.json(
        { error: "Invalid webhook signature." },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 401 }
    );
  }

  const event = verified as PolarSubscriptionEvent;
  if (!event || typeof event.type !== "string" || !event.data) {
    captureServerError(
      "polar-webhook",
      new Error("Invalid webhook payload shape after signature verification."),
      { eventId: request.headers.get("webhook-id") }
    );
    return NextResponse.json(
      { error: "Invalid webhook payload." },
      { status: 400 }
    );
  }

  if (!SUPPORTED_POLAR_EVENT_TYPES.has(event.type)) {
    // Expected, not an error: Polar sends many event types (checkout.*,
    // order.*, customer.*, product.*, refund.*, benefit.*, member.*,
    // organization.updated, ...) this integration deliberately doesn't
    // act on. Reporting these would just be noise that drowns out real
    // failures.
    return NextResponse.json({ received: true });
  }

  const eventId = request.headers.get("webhook-id");
  if (!eventId) {
    captureServerError(
      "polar-webhook",
      new Error("Missing webhook-id header."),
      { eventType: event.type }
    );
    return NextResponse.json(
      { error: "Missing webhook-id header." },
      { status: 400 }
    );
  }

  try {
    // Routed by which metadata key the checkout call set (checkout.ts /
    // the Romance checkout route each set exactly one) - never by
    // guessing from the product id, since that would require this one
    // shared route to know about every product any checkout flow might
    // ever add.
    const isRomanceEvent = typeof event.data.metadata?.romancePlayerId === "string";
    const processed = isRomanceEvent
      ? await applyPolarRomanceSubscriptionEvent(eventId, event)
      : await applyPolarSubscriptionEvent(eventId, event);

    if (processed.processed && !processed.applied) {
      console.warn(
        `[cevoryn:polar-webhook] Ignored out-of-order event ${eventId} (${event.type}): a newer event was already applied to this subscription.`
      );
    }

    return NextResponse.json({
      received: true,
      processed: processed.processed,
    });
  } catch (error) {
    captureServerError("polar-webhook", error, {
      eventId,
      eventType: event.type,
    });
    return NextResponse.json(
      { error: "Webhook processing failed." },
      { status: 500 }
    );
  }
}
