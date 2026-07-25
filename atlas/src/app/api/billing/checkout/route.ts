import { NextResponse } from "next/server";

import { checkoutRequestSchema } from "@/features/billing/schemas/checkout";
import { isSubscriptionActive } from "@/features/billing/types";
import { getAppUrl } from "@/lib/app-url";
import { getMembership, getUser } from "@/lib/auth";
import { getStripeClient } from "@/lib/stripe/client";
import { getStripePriceId, StripeConfigurationError } from "@/lib/stripe/config";
import {
  ensureStripeCustomerRecord,
  getOrganizationSubscription,
} from "@/server/services/billing.service";

export const runtime = "nodejs";

function canManageBilling(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const membership = await getMembership(user.id);
  if (!membership) {
    return NextResponse.json(
      { error: "Organization membership is required." },
      { status: 403 }
    );
  }

  if (!canManageBilling(membership.role)) {
    return NextResponse.json(
      { error: "Only organization owners and admins can manage billing." },
      { status: 403 }
    );
  }

  const parsedBody = checkoutRequestSchema.safeParse(await request.json());
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid billing plan." }, { status: 400 });
  }

  try {
    const stripe = getStripeClient();
    const currentSubscription = await getOrganizationSubscription(
      membership.organizationId
    );

    if (
      currentSubscription?.stripeSubscriptionId &&
      isSubscriptionActive(currentSubscription.subscriptionStatus)
    ) {
      return NextResponse.json(
        { error: "Use Manage Billing to change an active subscription." },
        { status: 409 }
      );
    }

    let stripeCustomerId = currentSubscription?.stripeCustomerId ?? null;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create(
        {
          email: user.email || undefined,
          name: membership.organizationName,
          metadata: {
            organizationId: membership.organizationId,
          },
        },
        {
          idempotencyKey: `cevoryn-customer-${membership.organizationId}`,
        }
      );

      stripeCustomerId = customer.id;
    }

    await ensureStripeCustomerRecord(
      membership.organizationId,
      stripeCustomerId,
      parsedBody.data.plan
    );

    const appUrl = getAppUrl();
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: stripeCustomerId,
        client_reference_id: membership.organizationId,
        line_items: [
          {
            price: getStripePriceId(parsedBody.data.plan),
            quantity: 1,
          },
        ],
        allow_promotion_codes: true,
        success_url: `${appUrl}/settings/billing?checkout=success`,
        cancel_url: `${appUrl}/settings/billing?checkout=canceled`,
        metadata: {
          organizationId: membership.organizationId,
          plan: parsedBody.data.plan,
        },
        subscription_data: {
          metadata: {
            organizationId: membership.organizationId,
            plan: parsedBody.data.plan,
          },
        },
      },
      {
        idempotencyKey: `cevoryn-checkout-${membership.organizationId}-${parsedBody.data.plan}-${Math.floor(Date.now() / 60_000)}`,
      }
    );

    if (!session.url) {
      throw new Error("Stripe Checkout did not return a URL.");
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[cevoryn:billing] Checkout creation failed", {
      organizationId: membership.organizationId,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    const message =
      error instanceof StripeConfigurationError
        ? error.message
        : "Unable to start checkout.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
