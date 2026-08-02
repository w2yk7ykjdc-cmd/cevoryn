import { NextResponse } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { getSubscriptionIntegrityReport } from "@/server/services/billing.service";

export const dynamic = "force-dynamic";

function canManageBilling(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Read-only diagnostic for the organization's subscription row. Lets an
 * owner/admin confirm — from inside the deployed app, without direct DB
 * access — whether the active subscription was actually written by the
 * Paddle webhook (the only code path that creates these rows) or looks
 * anomalous. See SubscriptionIntegrityReport for what's checked.
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

  if (!canManageBilling(membership.role)) {
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
    console.error("[cevoryn:billing] Subscription integrity check failed", {
      organizationId: membership.organizationId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Subscription verification failed",
        },
      },
      { status: 500 }
    );
  }
}
