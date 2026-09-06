import { NextResponse } from "next/server";

import { tooManyRequestsResponse } from "@/lib/api-utils";
import { requireBillingAdmin } from "@/lib/billing-auth";
import { captureServerError } from "@/lib/error-reporting";
import {
  polarApi,
  PolarApiError,
  PolarConfigurationError,
} from "@/lib/polar/config";
import { tryRecordAuthAttempt } from "@/server/services/auth-rate-limit.service";
import { getOrganizationSubscription } from "@/server/services/billing.service";

export const runtime = "nodejs";

type CustomerSessionResponse = {
  customer_portal_url: string;
};

export async function POST(): Promise<NextResponse> {
  const auth = await requireBillingAdmin();
  if (!auth.ok) return auth.response;
  const { membership } = auth;

  if (
    !(await tryRecordAuthAttempt(
      "billing_portal_org",
      membership.organizationId
    ))
  ) {
    return tooManyRequestsResponse(
      "Too many requests. Please try again shortly."
    );
  }

  try {
    const subscription = await getOrganizationSubscription(
      membership.organizationId
    );
    if (!subscription?.polarCustomerId) {
      return NextResponse.json(
        { error: "No Polar billing account exists for this organization." },
        { status: 404 }
      );
    }

    const session = await polarApi<CustomerSessionResponse>(
      "/v1/customer-sessions/",
      {
        method: "POST",
        body: JSON.stringify({
          external_customer_id: membership.organizationId,
        }),
      }
    );

    return NextResponse.json({ url: session.customer_portal_url });
  } catch (error) {
    captureServerError("polar-portal", error, {
      organizationId: membership.organizationId,
    });
    // Only PolarConfigurationError/PolarApiError messages are authored to
    // be safe to show a customer. Any other error must never have its raw
    // message relayed to the client.
    return NextResponse.json(
      {
        error:
          error instanceof PolarConfigurationError ||
          error instanceof PolarApiError
            ? error.message
            : "Unable to open billing management.",
      },
      { status: 500 }
    );
  }
}
