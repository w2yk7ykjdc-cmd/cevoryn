import { createHmac, timingSafeEqual } from "node:crypto";

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { captureServerError } from "@/lib/error-reporting";
import { getBillingPlanFromPaddlePriceId } from "@/lib/paddle/config";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type PaddleEvent = {
  event_id: string;
  event_type: string;
  occurred_at?: string;
  data: {
    id?: string;
    customer_id?: string;
    status?: string;
    custom_data?: Record<string, unknown> | null;
    items?: Array<{ price?: { id?: string } }>;
    current_billing_period?: { starts_at?: string; ends_at?: string } | null;
    scheduled_change?: { action?: string } | null;
  };
};

function verifySignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): boolean {
  const parts = signatureHeader.split(";").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("ts="))?.slice(3);
  const signatures = parts
    .filter((part) => part.startsWith("h1="))
    .map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) return false;

  const timestampNumber = Number(timestamp);
  if (
    !Number.isFinite(timestampNumber) ||
    Math.abs(Date.now() / 1000 - timestampNumber) > 300
  ) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}:${rawBody}`)
    .digest("hex");

  return signatures.some((candidate) => {
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(
      Buffer.from(candidate, "hex"),
      Buffer.from(expected, "hex")
    );
  });
}

function mapStatus(status: string | undefined): string {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "paused":
      return "PAUSED";
    case "canceled":
      return "CANCELED";
    default:
      return "INCOMPLETE";
  }
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get("paddle-signature");
  const secret = process.env.PADDLE_WEBHOOK_SECRET?.trim();

  if (!signature || !secret || !verifySignature(rawBody, signature, secret)) {
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 401 }
    );
  }

  let event: PaddleEvent;
  try {
    event = JSON.parse(rawBody) as PaddleEvent;
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook payload." },
      { status: 400 }
    );
  }

  const supported = new Set([
    "subscription.created",
    "subscription.updated",
    "subscription.canceled",
    "subscription.paused",
    "subscription.resumed",
  ]);

  if (!supported.has(event.event_type)) {
    return NextResponse.json({ received: true });
  }

  try {
    const processed = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "billing_webhook_events" ("provider", "event_id", "event_type")
        VALUES ('paddle', ${event.event_id}, ${event.event_type})
        ON CONFLICT ("provider", "event_id") DO NOTHING
      `);
      if (claimed === 0) return false;

      const organizationId = event.data.custom_data?.organizationId;
      const priceId = event.data.items?.[0]?.price?.id;
      const plan = priceId ? getBillingPlanFromPaddlePriceId(priceId) : null;
      if (
        typeof organizationId !== "string" ||
        !event.data.id ||
        !event.data.customer_id ||
        !priceId ||
        !plan
      ) {
        throw new Error(
          "Paddle subscription event is missing CEVORYN metadata."
        );
      }

      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "subscriptions" (
          "id", "organization_id", "stripe_customer_id", "plan", "subscription_status",
          "paddle_customer_id", "paddle_subscription_id", "paddle_price_id",
          "current_period_start", "current_period_end", "cancel_at_period_end", "updated_at"
        ) VALUES (
          ${crypto.randomUUID()}, ${organizationId}, ${`paddle:${event.data.customer_id}`},
          ${plan}::"BillingPlan", ${mapStatus(event.data.status)}::"SubscriptionStatus",
          ${event.data.customer_id}, ${event.data.id}, ${priceId},
          ${parseDate(event.data.current_billing_period?.starts_at)},
          ${parseDate(event.data.current_billing_period?.ends_at)},
          ${event.data.scheduled_change?.action === "cancel"}, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("organization_id") DO UPDATE SET
          "plan" = EXCLUDED."plan",
          "subscription_status" = EXCLUDED."subscription_status",
          "paddle_customer_id" = EXCLUDED."paddle_customer_id",
          "paddle_subscription_id" = EXCLUDED."paddle_subscription_id",
          "paddle_price_id" = EXCLUDED."paddle_price_id",
          "current_period_start" = EXCLUDED."current_period_start",
          "current_period_end" = EXCLUDED."current_period_end",
          "cancel_at_period_end" = EXCLUDED."cancel_at_period_end",
          "updated_at" = CURRENT_TIMESTAMP
      `);
      return true;
    });

    return NextResponse.json({ received: true, processed });
  } catch (error) {
    captureServerError("paddle-webhook", error, {
      eventId: event.event_id,
      eventType: event.event_type,
    });
    return NextResponse.json(
      { error: "Webhook processing failed." },
      { status: 500 }
    );
  }
}
