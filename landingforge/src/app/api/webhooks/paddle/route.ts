import { NextResponse } from "next/server";
import { EventName } from "@paddle/paddle-node-sdk";
import { Plan } from "@prisma/client";
import { paddle } from "@/lib/paddle/server";
import { prisma } from "@/lib/prisma";
import { planFromPriceId } from "@/lib/paddle/plans";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("paddle-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event;
  try {
    event = await paddle.webhooks.unmarshal(
      body,
      process.env.PADDLE_WEBHOOK_SECRET!,
      signature,
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event?.eventType) {
    case EventName.SubscriptionCreated:
    case EventName.SubscriptionUpdated:
    case EventName.SubscriptionActivated:
    case EventName.SubscriptionTrialing:
    case EventName.SubscriptionPastDue:
    case EventName.SubscriptionPaused:
    case EventName.SubscriptionResumed:
    case EventName.SubscriptionCanceled: {
      const subscription = event.data;
      const customDataUserId = (
        subscription.customData as { userId?: string } | null
      )?.userId;

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { paddleCustomerId: subscription.customerId },
            ...(customDataUserId ? [{ id: customDataUserId }] : []),
          ],
        },
      });

      if (user) {
        const priceId = subscription.items[0]?.price?.id;
        const isCanceled = subscription.status === "canceled";

        await prisma.user.update({
          where: { id: user.id },
          data: {
            paddleCustomerId: subscription.customerId,
            paddleSubscriptionId: subscription.id,
            paddleSubStatus: subscription.status,
            currentPeriodEnd: subscription.currentBillingPeriod?.endsAt
              ? new Date(subscription.currentBillingPeriod.endsAt)
              : null,
            plan: isCanceled ? Plan.FREE : planFromPriceId(priceId),
          },
        });
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
