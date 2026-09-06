import { NextResponse } from "next/server";
import { after } from "next/server";
import type { NextRequest } from "next/server";

import { FeatureAccessError } from "@/features/billing/config/plans";
import {
  createResearchTask,
  processResearchTask,
} from "@/features/radar/workers/research-worker";
import {
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
 * Kicks off the Research Worker for one opportunity. Responds as soon as
 * the ResearchTask row is claimed (PENDING) and schedules the actual LLM
 * work via Next's after() so it runs post-response within the same
 * function invocation - no separate queue/worker process, consistent with
 * not adding new infrastructure for this. The client polls
 * GET /api/radar/opportunities/:id for the task's eventual COMPLETED/
 * FAILED state, and a notification fires when it's done.
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

    const task = await createResearchTask(
      membership.organizationId,
      id,
      user.id
    );
    if (!task) return notFoundResponse("Opportunity not found");

    after(() => processResearchTask(task.taskId));

    return NextResponse.json(
      { data: { taskId: task.taskId, status: "PENDING" } },
      { status: 202 }
    );
  } catch (error) {
    return internalErrorResponse(
      "Opportunity research POST",
      error,
      "Failed to start research"
    );
  }
}
