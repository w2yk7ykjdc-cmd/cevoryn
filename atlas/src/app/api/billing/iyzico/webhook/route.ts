import { NextResponse } from "next/server";

import {
  verifyIyzicoSubscriptionWebhook,
  type IyzicoSubscriptionWebhookPayload,
} from "@/lib/iyzico/subscription";
import {
  runIdempotentIyzicoWebhook,
  updateIyzicoSubscriptionStatus,
} from "@/server/services/iyzico-billing.service";

export const runtime = "nodejs";

function isPayload(value: unknown): value is IyzicoSubscriptionWebhookPayload {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<IyzicoSubscriptionWebhookPayload>;
  return (
    (body.iyziEventType === "subscription.order.success" ||
      body.iyziEventType === "subscription.order.failure") &&
    typeof body.subscriptionReferenceCode === "string" &&
    typeof body.orderReferenceCode === "string" &&
    typeof body.customerReferenceCode === "string" &&
    typeof body.iyziReferenceCode === "string" &&
    (typeof body.merchantId === "string" || typeof body.merchantId === "number")
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get("x-iyz-signature-v3");
  const payload = (await request.json().catch(() => null)) as unknown;

  if (!signature || !isPayload(payload)) {
    return NextResponse.json({ error: "Invalid webhook." }, { status: 400 });
  }

  if (!verifyIyzicoSubscriptionWebhook(payload, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  await runIdempotentIyzicoWebhook(
    payload.iyziReferenceCode,
    payload.iyziEventType,
    async (transaction) => {
      await updateIyzicoSubscriptionStatus(
        payload.subscriptionReferenceCode,
        payload.iyziEventType === "subscription.order.success" ? "ACTIVE" : "UNPAID",
        transaction
      );
    }
  );

  return NextResponse.json({ received: true });
}
