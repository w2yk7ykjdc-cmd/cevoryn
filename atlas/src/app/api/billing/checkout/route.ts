import { NextResponse } from "next/server";

import { checkoutRequestSchema } from "@/features/billing/schemas/checkout";
import { isSubscriptionActive } from "@/features/billing/types";
import { getMembership, getUser } from "@/lib/auth";
import { captureServerError } from "@/lib/error-reporting";
import {
  getPaddleEnvironment,
  getPaddlePriceId,
  PaddleConfigurationError,
} from "@/lib/paddle/config";
import { isRoleAtLeast } from "@/lib/rbac";
import { getOrganizationSubscription } from "@/server/services/billing.service";

export const runtime = "nodejs";

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

  if (!isRoleAtLeast(membership.role, "ADMIN")) {
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
      { error: "Invalid checkout request body." },
      { status: 400 }
    );
  }

  const parsedBody = checkoutRequestSchema.safeParse(requestBody);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid billing plan." },
      { status: 400 }
    );
  }

  try {
    const currentSubscription = await getOrganizationSubscription(
      membership.organizationId
    );

    if (
      currentSubscription &&
      isSubscriptionActive(currentSubscription.subscriptionStatus)
    ) {
      return NextResponse.json(
        { error: "Use Manage Billing to change an active subscription." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      priceId: getPaddlePriceId(parsedBody.data.plan),
      environment: getPaddleEnvironment(),
      customerEmail: user.email ?? undefined,
      customData: {
        organizationId: membership.organizationId,
        plan: parsedBody.data.plan,
      },
    });
  } catch (error) {
    captureServerError("paddle-checkout", error, {
      organizationId: membership.organizationId,
    });

    const message =
      error instanceof PaddleConfigurationError
        ? error.message
        : "Unable to start checkout.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
