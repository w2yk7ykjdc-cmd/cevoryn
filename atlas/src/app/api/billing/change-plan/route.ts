import { NextResponse } from "next/server";

import { checkoutRequestSchema } from "@/features/billing/schemas/checkout";
import { isSubscriptionActive } from "@/features/billing/types";
import { getMembership, getUser } from "@/lib/auth";
import { captureServerError } from "@/lib/error-reporting";
import {
  getPolarProductId,
  polarApi,
  PolarConfigurationError,
} from "@/lib/polar/config";
import { isRoleAtLeast } from "@/lib/rbac";
import { tryRecordAuthAttempt } from "@/server/services/auth-rate-limit.service";
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

  if (
    !(await tryRecordAuthAttempt("change_plan_org", membership.organizationId))
  ) {
    return NextResponse.json(
      { error: "Too many plan-change attempts. Please try again shortly." },
      { status: 429 }
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
      !currentSubscription ||
      !currentSubscription.polarSubscriptionId ||
      !isSubscriptionActive(currentSubscription.subscriptionStatus)
    ) {
      return NextResponse.json(
        {
          error:
            "No active subscription to change. Start a new checkout instead.",
        },
        { status: 409 }
      );
    }

    if (currentSubscription.plan === parsedBody.data.plan) {
      return NextResponse.json(
        { error: "This organization is already on that plan." },
        { status: 409 }
      );
    }

    await polarApi(
      `/v1/subscriptions/${currentSubscription.polarSubscriptionId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          product_id: getPolarProductId(parsedBody.data.plan),
        }),
      }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    captureServerError("polar-change-plan", error, {
      organizationId: membership.organizationId,
    });

    const message =
      error instanceof PolarConfigurationError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unable to change plan.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
