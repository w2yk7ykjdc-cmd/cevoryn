import { NextResponse } from "next/server";

import { checkoutRequestSchema } from "@/features/billing/schemas/checkout";
import { isSubscriptionActive } from "@/features/billing/types";
import { tooManyRequestsResponse } from "@/lib/api-utils";
import { requireBillingAdmin } from "@/lib/billing-auth";
import { captureServerError } from "@/lib/error-reporting";
import {
  getPolarProductId,
  polarApi,
  PolarApiError,
  PolarConfigurationError,
} from "@/lib/polar/config";
import { tryRecordAuthAttempt } from "@/server/services/auth-rate-limit.service";
import { getOrganizationSubscription } from "@/server/services/billing.service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireBillingAdmin();
  if (!auth.ok) return auth.response;
  const { membership } = auth;

  if (
    !(await tryRecordAuthAttempt("change_plan_org", membership.organizationId))
  ) {
    return tooManyRequestsResponse(
      "Too many plan-change attempts. Please try again shortly."
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

    // Only PolarConfigurationError/PolarApiError messages are authored to
    // be safe to show a customer (a config problem or Polar's own API
    // error text, e.g. a declined card). Any other error - a Prisma
    // failure, a bug, a network error - is an unexpected internal
    // exception and must never have its raw message relayed to the client.
    const message =
      error instanceof PolarConfigurationError || error instanceof PolarApiError
        ? error.message
        : "Unable to change plan.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
