import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listOpportunities } from "@/features/radar/opportunities/opportunity.service";
import {
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "radar:read")) {
      return forbiddenResponse("Insufficient permissions");
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const polarity = url.searchParams.get("polarity") ?? undefined;

    const opportunities = await listOpportunities(membership.organizationId, {
      status,
      polarity,
    });

    return NextResponse.json({ data: opportunities });
  } catch (error) {
    return internalErrorResponse(
      "Opportunities GET",
      error,
      "Failed to load opportunities"
    );
  }
}
