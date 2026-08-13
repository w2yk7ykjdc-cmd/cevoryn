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

type PolarCheckoutResponse = {
  url: string;
};

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
    !(await tryRecordAuthAttempt(
      "polar_checkout_org",
      membership.organizationId
    ))
  ) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Please try again shortly." },
      { status: 429 }
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const successUrl = appUrl
      ? new URL("/settings/billing", appUrl).toString()
      : undefined;

    const checkout = await polarApi<PolarCheckoutResponse>("/v1/checkouts/", {
      method: "POST",
      body: JSON.stringify({
        products: [getPolarProductId(parsedBody.data.plan)],
        external_customer_id: membership.organizationId,
        customer_email: user.email ?? undefined,
        success_url: successUrl,
        metadata: {
          organizationId: membership.organizationId,
          plan: parsedBody.data.plan,
        },
      }),
    });

    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    captureServerError("polar-checkout", error, {
      organizationId: membership.organizationId,
    });

    const message =
      error instanceof PolarConfigurationError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unable to start checkout.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
