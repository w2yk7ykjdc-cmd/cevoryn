import { NextResponse } from "next/server";

import { FeatureAccessError } from "@/features/billing/config/plans";
import { listPipelineRuns } from "@/features/radar/pipeline-run.service";
import {
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { assertOrganizationFeatureAccess } from "@/server/services/entitlement.service";

/** Admin-only observability view of recent Radar pipeline executions. */
export async function GET() {
  try {
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

    const runs = await listPipelineRuns(membership.organizationId);
    return NextResponse.json({ data: runs });
  } catch (error) {
    return internalErrorResponse(
      "PipelineRuns GET",
      error,
      "Failed to load pipeline runs"
    );
  }
}
