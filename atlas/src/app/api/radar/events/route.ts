import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { FeatureAccessError } from "@/features/billing/config/plans";
import { listEvents } from "@/features/radar/events/event.service";
import {
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { assertOrganizationFeatureAccess } from "@/server/services/entitlement.service";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "radar:read")) {
      return forbiddenResponse("Insufficient permissions");
    }

    try {
      await assertOrganizationFeatureAccess(membership.organizationId, "RADAR");
    } catch (error) {
      if (error instanceof FeatureAccessError) {
        return NextResponse.json(
          {
            error: {
              code: error.code,
              message: "Radar requires the Professional or Business plan.",
            },
          },
          { status: 403 }
        );
      }
      throw error;
    }

    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const events = await listEvents(membership.organizationId, { status });

    return NextResponse.json({ data: events });
  } catch (error) {
    return internalErrorResponse("Events GET", error, "Failed to load events");
  }
}
