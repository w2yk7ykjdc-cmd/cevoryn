import { NextResponse } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { captureServerError } from "@/lib/error-reporting";
import { polarApi, PolarConfigurationError } from "@/lib/polar/config";
import { isRoleAtLeast } from "@/lib/rbac";
import { getOrganizationSubscription } from "@/server/services/billing.service";

export const runtime = "nodejs";

type CustomerSessionResponse = {
  customer_portal_url: string;
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
  if (!isRoleAtLeast(membership.role, "ADMIN")) {
    return NextResponse.json(
      { error: "Only organization owners and admins can manage billing." },
      { status: 403 }
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
    return NextResponse.json(
      {
        error:
          error instanceof PolarConfigurationError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unable to open billing management.",
      },
      { status: 500 }
    );
  }
}
