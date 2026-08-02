import { NextResponse } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { captureServerError } from "@/lib/error-reporting";
import { paddleApi, PaddleConfigurationError } from "@/lib/paddle/server";
import { getOrganizationSubscription } from "@/server/services/billing.service";

export const runtime = "nodejs";

function canManageBilling(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

type PortalResponse = {
  data: {
    urls: { general: { overview: string } };
  };
};

export async function POST(): Promise<NextResponse> {
  const user = await getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

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
    if (!subscription?.paddleCustomerId) {
      return NextResponse.json(
        { error: "No Paddle billing account exists for this organization." },
        { status: 404 }
      );
    }

    const payload = await paddleApi<PortalResponse>(
      `/customers/${subscription.paddleCustomerId}/portal-sessions`,
      {
        method: "POST",
        body: JSON.stringify(
          subscription.paddleSubscriptionId
            ? { subscription_ids: [subscription.paddleSubscriptionId] }
            : {}
        ),
      }
    );

    return NextResponse.json({ url: payload.data.urls.general.overview });
  } catch (error) {
    captureServerError("paddle-portal", error, {
      organizationId: membership.organizationId,
    });
    return NextResponse.json(
      {
        error:
          error instanceof PaddleConfigurationError
            ? error.message
            : "Unable to open billing management.",
      },
      { status: 500 }
    );
  }
}
