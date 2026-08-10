import { NextResponse } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { paddleApi, PaddleConfigurationError } from "@/lib/paddle/config";
import { isRoleAtLeast } from "@/lib/rbac";
import { getOrganizationSubscription } from "@/server/services/billing.service";

export const dynamic = "force-dynamic";

type PaddleSubscriptionResponse = {
  data: { id: string; status: string };
};

/**
 * Read-only diagnostic: confirms whether the organization's stored
 * paddle_subscription_id actually exists under the Paddle account that
 * PADDLE_API_KEY currently authenticates as. The webhook that originally
 * wrote that id (src/app/api/billing/paddle/webhook/route.ts) accepts any
 * correctly-signed payload regardless of which Paddle account/environment
 * sent it, so a stored id is not proof it exists under the account the
 * current API key belongs to. This calls Paddle's own API to settle that —
 * a 404 here means the id and the current API key are on different Paddle
 * accounts (or one is sandbox and the other live).
 */
export async function GET(): Promise<NextResponse> {
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

  if (!isRoleAtLeast(membership.role, "ADMIN")) {
    return NextResponse.json(
      { error: "Only organization owners and admins can view this." },
      { status: 403 }
    );
  }

  const subscription = await getOrganizationSubscription(
    membership.organizationId
  );

  if (!subscription?.paddleSubscriptionId) {
    return NextResponse.json({
      data: { foundInPaddle: false, reason: "NO_SUBSCRIPTION_ID_STORED" },
    });
  }

  try {
    const paddleSubscription = await paddleApi<PaddleSubscriptionResponse>(
      `/subscriptions/${subscription.paddleSubscriptionId}`
    );

    return NextResponse.json({
      data: {
        foundInPaddle: true,
        paddleSubscriptionId: paddleSubscription.data.id,
        paddleStatus: paddleSubscription.data.status,
      },
    });
  } catch (error) {
    if (error instanceof PaddleConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        foundInPaddle: false,
        paddleSubscriptionId: subscription.paddleSubscriptionId,
        paddleError: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}
