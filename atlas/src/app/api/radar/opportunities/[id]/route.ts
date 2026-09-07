import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { FeatureAccessError } from "@/features/billing/config/plans";
import {
  getOpportunity,
  updateOpportunityStatus,
} from "@/features/radar/opportunities/opportunity.service";
import { updateOpportunityStatusSchema } from "@/features/radar/opportunities/schemas";
import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { assertOrganizationFeatureAccess } from "@/server/services/entitlement.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "radar:read")) {
      return forbiddenResponse("Insufficient permissions");
    }

    const opportunity = await getOpportunity(membership.organizationId, id);
    if (!opportunity) return notFoundResponse("Opportunity not found");

    return NextResponse.json({ data: opportunity });
  } catch (error) {
    return internalErrorResponse(
      "Opportunity GET",
      error,
      "Failed to load opportunity"
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "radar:manage")) {
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

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = updateOpportunityStatusSchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invalid status");

    const result = await updateOpportunityStatus(
      membership.organizationId,
      id,
      parsed.data.status,
      user.id
    );
    if (result.count === 0) return notFoundResponse("Opportunity not found");

    return NextResponse.json({ data: { id, status: parsed.data.status } });
  } catch (error) {
    return internalErrorResponse(
      "Opportunity PATCH",
      error,
      "Failed to update opportunity"
    );
  }
}
