import { NextResponse } from "next/server";

import { checkoutRequestSchema } from "@/features/billing/schemas/checkout";
import { isSubscriptionActive } from "@/features/billing/types";
import { getMembership, getUser } from "@/lib/auth";
import { getPaddlePriceId, paddleApi, PaddleConfigurationError } from "@/lib/paddle/server";
import { getOrganizationSubscription } from "@/server/services/billing.service";

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

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid change-plan request body." },
      { status: 400 }
    );
  }

  const parsedBody = checkoutRequestSchema.safeParse(requestBody);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid billing plan." }, { status: 400 });
  }

  try {
    const currentSubscription = await getOrganizationSubscription(
      membership.organizationId
    );

    if (
      !currentSubscription ||
      !currentSubscription.paddleSubscriptionId ||
      !isSubscriptionActive(currentSubscription.subscriptionStatus)
    ) {
      return NextResponse.json(
        { error: "No active subscription to change. Start a new checkout instead." },
        { status: 409 }
      );
    }

    if (currentSubscription.plan === parsedBody.data.plan) {
      return NextResponse.json(
        { error: "This organization is already on that plan." },
        { status: 409 }
      );
    }

    await paddleApi(`/subscriptions/${currentSubscription.paddleSubscriptionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        items: [{ price_id: getPaddlePriceId(parsedBody.data.plan), quantity: 1 }],
        proration_billing_mode: "prorated_immediately",
      }),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[cevoryn:billing] Paddle plan change failed", {
      organizationId: membership.organizationId,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    const message =
      error instanceof PaddleConfigurationError
        ? error.message
        : "Unable to change plan.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
