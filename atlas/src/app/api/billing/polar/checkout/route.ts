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

type PolarCheckoutResponse = {
  url: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireBillingAdmin();
  if (!auth.ok) return auth.response;
  const { user, membership } = auth;

  if (
    !(await tryRecordAuthAttempt(
      "polar_checkout_org",
      membership.organizationId
    ))
  ) {
    return tooManyRequestsResponse(
      "Too many checkout attempts. Please try again shortly."
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

    // Only PolarConfigurationError/PolarApiError messages are authored to
    // be safe to show a customer. Any other error must never have its raw
    // message relayed to the client.
    const message =
      error instanceof PolarConfigurationError || error instanceof PolarApiError
        ? error.message
        : "Unable to start checkout.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
