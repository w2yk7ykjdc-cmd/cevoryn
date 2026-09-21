import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { FeatureAccessError } from "@/features/billing/config/plans";
import { prepareActionFromOpportunity } from "@/features/radar/opportunities/opportunity-action.service";
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

/**
 * Turns one Opportunity's recommendedAction into a real PreparedAction the
 * user must explicitly approve before anything happens - see
 * opportunity-action.service.ts for why this is safe to store verbatim
 * (never treated as an instruction) and how duplicate creation is
 * prevented. Same auth/RBAC/billing gating shape as the sibling
 * /research route on this same resource.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
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

    const result = await prepareActionFromOpportunity(
      membership.organizationId,
      id
    );

    if (result.outcome === "not_found") {
      return notFoundResponse("Opportunity not found");
    }
    if (result.outcome === "no_recommended_action") {
      return badRequestResponse(
        "This opportunity has no recommended action to prepare"
      );
    }

    return NextResponse.json(
      { data: { actionId: result.actionId } },
      { status: result.outcome === "created" ? 201 : 200 }
    );
  } catch (error) {
    return internalErrorResponse(
      "Opportunity prepare-action POST",
      error,
      "Failed to prepare action"
    );
  }
}
