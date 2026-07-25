import { NextResponse } from "next/server";

import { getAppUrl } from "@/lib/app-url";
import { getMembership, getUser } from "@/lib/auth";
import { getStripeClient } from "@/lib/stripe/client";
import { StripeConfigurationError } from "@/lib/stripe/config";
import { getOrganizationSubscription } from "@/server/services/billing.service";

export const runtime = "nodejs";

function canManageBilling(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export async function POST(): Promise<NextResponse> {
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

  try {
    const subscription = await getOrganizationSubscription(
      membership.organizationId
    );

    if (!subscription?.stripeCustomerId) {
      return NextResponse.json(
        { error: "No billing account exists for this organization." },
        { status: 404 }
      );
    }

    const portalSession = await getStripeClient().billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${getAppUrl()}/settings/billing`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    console.error("[cevoryn:billing] Portal creation failed", {
      organizationId: membership.organizationId,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    const message =
      error instanceof StripeConfigurationError
        ? error.message
        : "Unable to open billing management.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
