import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { getStripeClient } from "@/lib/stripe/client";
import { getStripeEnvironment } from "@/lib/stripe/config";
import {
  getSubscriptionOrganizationId,
  mapStripeSubscription,
} from "@/lib/stripe/subscription";
import { updateSubscriptionStatusByCustomerId } from "@/server/services/billing-webhook.service";
import {
  runIdempotentWebhookEvent,
  syncOrganizationSubscription,
} from "@/server/services/billing.service";

export const runtime = "nodejs";

function getCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

async function synchronizeSubscription(
  subscription: Stripe.Subscription,
  organizationIdOverride?: string | null
): Promise<ReturnType<typeof mapStripeSubscription>> {
  const organizationId =
    organizationIdOverride ?? getSubscriptionOrganizationId(subscription);

  if (!organizationId) {
    throw new Error("Stripe subscription is missing organization metadata.");
  }

  return mapStripeSubscription(subscription, organizationId);
}

export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    const rawBody = await request.text();
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      getStripeEnvironment().STRIPE_WEBHOOK_SECRET
    );
  } catch {
    return NextResponse.json({ error: "Invalid webhook." }, { status: 400 });
  }

  try {
    const processed = await runIdempotentWebhookEvent(
      event.id,
      event.type,
      async (transaction) => {
        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object;
            const organizationId = session.metadata?.organizationId ?? null;
            const subscriptionId =
              typeof session.subscription === "string"
                ? session.subscription
                : session.subscription?.id;

            if (!organizationId || !subscriptionId) {
              throw new Error("Checkout session is missing billing metadata.");
            }

            const subscription =
              await getStripeClient().subscriptions.retrieve(subscriptionId);
            const syncInput = await synchronizeSubscription(
              subscription,
              organizationId
            );
            await syncOrganizationSubscription(syncInput, transaction);
            break;
          }

          case "customer.subscription.created":
          case "customer.subscription.updated":
          case "customer.subscription.deleted": {
            const subscription = event.data.object;
            const syncInput = await synchronizeSubscription(subscription);
            await syncOrganizationSubscription(syncInput, transaction);
            break;
          }

          case "invoice.paid": {
            const customerId = getCustomerId(event.data.object.customer);
            if (customerId) {
              await updateSubscriptionStatusByCustomerId(
                transaction,
                customerId,
                "ACTIVE"
              );
            }
            break;
          }

          case "invoice.payment_failed": {
            const customerId = getCustomerId(event.data.object.customer);
            if (customerId) {
              await updateSubscriptionStatusByCustomerId(
                transaction,
                customerId,
                "PAST_DUE"
              );
            }
            break;
          }
        }
      }
    );

    return NextResponse.json({ received: true, duplicate: !processed });
  } catch (error) {
    console.error("[cevoryn:billing] Stripe webhook processing failed", {
      eventId: event.id,
      eventType: event.type,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json(
      { error: "Webhook processing failed." },
      { status: 500 }
    );
  }
}
