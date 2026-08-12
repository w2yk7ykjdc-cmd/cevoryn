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

// Event shapes verified against @polar-sh/sdk 0.49.0 (src/webhooks.ts,
// src/models/components/subscription.ts) - not guessed. Polar only ever
// sends the fields listed below on subscription.* events; other event
// types (checkout.*, order.*, product.*, customer.*, ...) exist but are
// not subscribed to here.
type PolarSubscriptionEvent = {
  type: string;
  timestamp?: string;
  data: {
    id?: string;
    status?: string;
    customerId?: string;
    productId?: string;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd?: boolean;
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
    return NextResponse.json(
      { error: "Invalid webhook payload." },
      { status: 400 }
    );
  }

  if (!SUPPORTED_POLAR_EVENT_TYPES.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  const eventId = request.headers.get("webhook-id");
  if (!eventId) {
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
      if (claimed === 0) return false;

      const organizationId = event.data.metadata?.organizationId;
      const productId = event.data.productId;
      const plan = productId
        ? getBillingPlanFromPolarProductId(productId)
        : null;

      if (
        typeof organizationId !== "string" ||
        !event.data.id ||
        !event.data.customerId ||
        !productId ||
        !plan
      ) {
        throw new Error(
          "Polar subscription event is missing CEVORYN metadata or references an unknown product."
        );
      }

      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "subscriptions" (
          "id", "organization_id", "stripe_customer_id", "plan", "subscription_status",
          "polar_customer_id", "polar_subscription_id", "polar_product_id",
          "current_period_start", "current_period_end", "cancel_at_period_end", "updated_at"
        ) VALUES (
          ${crypto.randomUUID()}, ${organizationId}, ${`polar:${event.data.customerId}`},
          ${plan}::"BillingPlan", ${mapPolarSubscriptionStatus(event.data.status)}::"SubscriptionStatus",
          ${event.data.customerId}, ${event.data.id}, ${productId},
          ${parseDate(event.data.currentPeriodStart)},
          ${parseDate(event.data.currentPeriodEnd)},
          ${event.data.cancelAtPeriodEnd === true}, CURRENT_TIMESTAMP
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
          "updated_at" = CURRENT_TIMESTAMP
      `);
      return true;
    });

    return NextResponse.json({ received: true, processed });
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
