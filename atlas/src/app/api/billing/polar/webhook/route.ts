import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { Webhook, WebhookVerificationError } from "standardwebhooks";

import { captureServerError } from "@/lib/error-reporting";
import {
  getBillingPlanFromPolarProductId,
  mapPolarSubscriptionStatus,
  SUPPORTED_POLAR_EVENT_TYPES,
} from "@/lib/polar/mapping";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// Event shapes verified against a real production webhook delivery payload
// (Polar Dashboard > Webhooks > Deliveries), not the @polar-sh/sdk's
// camelCase TypeScript types - the SDK converts the wire format to
// camelCase internally, but this route parses the raw JSON body directly
// (to verify the Standard Webhooks signature first), so the field names
// below must match the actual snake_case wire format Polar sends.
type PolarSubscriptionEvent = {
  type: string;
  timestamp?: string;
  data: {
    id?: string;
    status?: string;
    customer_id?: string;
    product_id?: string;
    current_period_start?: string;
    current_period_end?: string;
    cancel_at_period_end?: boolean;
    metadata?: Record<string, unknown>;
  };
};

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

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
    const processed = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "billing_webhook_events" ("provider", "event_id", "event_type")
        VALUES ('polar', ${eventId}, ${event.type})
        ON CONFLICT ("provider", "event_id") DO NOTHING
      `);
      if (claimed === 0) return { processed: false, applied: false };

      const organizationId = event.data.metadata?.organizationId;
      const productId = event.data.product_id;
      const plan = productId
        ? getBillingPlanFromPolarProductId(productId)
        : null;

      if (
        typeof organizationId !== "string" ||
        !event.data.id ||
        !event.data.customer_id ||
        !productId ||
        !plan
      ) {
        throw new Error(
          "Polar subscription event is missing CEVORYN metadata or references an unknown product."
        );
      }

      const eventTimestamp = parseDate(event.timestamp);

      // Guards against out-of-order webhook delivery: Polar (like any
      // webhook provider) does not guarantee events arrive in the order
      // they occurred - a retried/delayed OLDER event can arrive after a
      // NEWER event already updated this row. The WHERE clause below keeps
      // this a single atomic statement (no separate SELECT, no race
      // between check and write) and only blocks the update when we have
      // positive evidence the incoming event is older than what's already
      // stored; it never blocks when either side lacks a timestamp to
      // compare, so a real update is never silently dropped just because
      // Polar omitted a timestamp.
      const updateResult = await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "subscriptions" (
          "id", "organization_id", "stripe_customer_id", "plan", "subscription_status",
          "polar_customer_id", "polar_subscription_id", "polar_product_id",
          "current_period_start", "current_period_end", "cancel_at_period_end",
          "last_webhook_event_at", "updated_at"
        ) VALUES (
          ${crypto.randomUUID()}, ${organizationId}, ${`polar:${event.data.customer_id}`},
          ${plan}::"BillingPlan", ${mapPolarSubscriptionStatus(event.data.status)}::"SubscriptionStatus",
          ${event.data.customer_id}, ${event.data.id}, ${productId},
          ${parseDate(event.data.current_period_start)},
          ${parseDate(event.data.current_period_end)},
          ${event.data.cancel_at_period_end === true},
          ${eventTimestamp}, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("organization_id") DO UPDATE SET
          "plan" = EXCLUDED."plan",
          "subscription_status" = EXCLUDED."subscription_status",
          "polar_customer_id" = EXCLUDED."polar_customer_id",
          "polar_subscription_id" = EXCLUDED."polar_subscription_id",
          "polar_product_id" = EXCLUDED."polar_product_id",
          "current_period_start" = EXCLUDED."current_period_start",
          "current_period_end" = EXCLUDED."current_period_end",
          "cancel_at_period_end" = EXCLUDED."cancel_at_period_end",
          "last_webhook_event_at" = EXCLUDED."last_webhook_event_at",
          "updated_at" = CURRENT_TIMESTAMP
        WHERE
          "subscriptions"."last_webhook_event_at" IS NULL
          OR EXCLUDED."last_webhook_event_at" IS NULL
          OR EXCLUDED."last_webhook_event_at" >= "subscriptions"."last_webhook_event_at"
      `);

      return { processed: true, applied: updateResult > 0 };
    });

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
