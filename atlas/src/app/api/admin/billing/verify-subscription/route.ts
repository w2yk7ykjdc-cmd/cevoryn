import { NextResponse } from "next/server";

import { internalErrorResponse } from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { isRoleAtLeast } from "@/lib/rbac";
import { getSubscriptionIntegrityReport } from "@/server/services/billing.service";

export const dynamic = "force-dynamic";

/**
 * Read-only diagnostic for the organization's subscription row. Lets an
 * owner/admin confirm — from inside the deployed app, without direct DB
 * access — whether the active subscription was actually written by the
 * Polar webhook (the only active code path that creates these rows; some
 * rows may predate the Paddle-to-Polar migration) or looks anomalous. See
 * SubscriptionIntegrityReport for what's checked.
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

  try {
    const report = await getSubscriptionIntegrityReport(
      membership.organizationId
    );
    return NextResponse.json({ data: report });
  } catch (error) {
    return internalErrorResponse(
      "Subscription integrity check",
      error,
      "Subscription verification failed"
    );
  }
}
