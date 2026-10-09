import "server-only";

import { recordAuditEvent } from "@/features/enterprise/audit/audit.service";
import {
  toOpportunityPolarity,
  toOpportunityStatus,
} from "@/lib/enum-validators";
import { prisma } from "@/lib/prisma";

export async function listOpportunities(
  organizationId: string,
  options: { status?: string; polarity?: string; take?: number } = {}
) {
  return prisma.opportunity.findMany({
    where: {
      organizationId,
      ...(options.status && {
        status: toOpportunityStatus(options.status) ?? undefined,
      }),
      ...(options.polarity && {
        polarity: toOpportunityPolarity(options.polarity) ?? undefined,
      }),
    },
    include: {
      externalEntity: { select: { id: true, name: true, watchReason: true } },
      event: { select: { id: true, type: true, occurredAt: true } },
      workerTasks: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, brief: true, error: true },
      },
      // Non-dismissed only, most recent - just enough for the UI to know
      // whether "Prepare Action" has already been used on this Opportunity
      // (the real duplicate guard lives in
      // opportunity-action.service.ts::prepareActionFromOpportunity; this
      // is a display hint, not a security boundary).
      preparedActions: {
        where: { status: { not: "DISMISSED" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true },
      },
    },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: options.take ?? 30,
  });
}

export async function getOpportunity(organizationId: string, id: string) {
  return prisma.opportunity.findFirst({
    where: { id, organizationId },
    include: {
      externalEntity: true,
      event: true,
      workerTasks: { orderBy: { createdAt: "desc" }, take: 5 },
      preparedActions: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
}

/**
 * WON/LOST are terminal outcomes, not just a status label - each also
 * records an OutcomeEvaluation (result: SUCCESS/FAILURE), the same table
 * the Decision outcome-evaluation pipeline and the confidence-calibration
 * learning loop already read from (see
 * src/features/brain/learning/confidence-calibrator.ts). Without this,
 * marking an opportunity Won/Lost in the UI updated only Opportunity.status -
 * OutcomeEvaluation.opportunityId (added specifically for Radar) never got
 * populated by any real code path, so the Outcome Learning loop the
 * product is meant to provide for Radar opportunities never actually ran.
 *
 * Idempotent by construction: only the first transition into WON/LOST
 * creates an OutcomeEvaluation row (checked via a prior existing-row
 * query), so re-clicking or a duplicated request never creates a second
 * outcome record for the same opportunity.
 */
const TERMINAL_OUTCOME_RESULT: Partial<Record<string, "SUCCESS" | "FAILURE">> =
  {
    WON: "SUCCESS",
    LOST: "FAILURE",
  };

export async function updateOpportunityStatus(
  organizationId: string,
  id: string,
  status: "REVIEWING" | "QUALIFIED" | "ACTED_ON" | "WON" | "LOST" | "DISMISSED",
  actorUserId: string
) {
  // Lock the opportunity row before changing its status or outcome. Without
  // this, concurrent WON/LOST requests can race between updateMany and the
  // existing-outcome lookup, leaving the learning record inconsistent with
  // the final status (or creating duplicate evaluations).
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "opportunities"
      WHERE "id" = ${id} AND "organization_id" = ${organizationId}
      FOR UPDATE
    `;

    const updated = await tx.opportunity.updateMany({
      where: { id, organizationId },
      data: { status },
    });

    if (updated.count === 0) return updated;

    const outcomeResult = TERMINAL_OUTCOME_RESULT[status];
    if (outcomeResult) {
      const opportunity = await tx.opportunity.findFirst({
        where: { id, organizationId },
        select: { title: true, confidence: true },
      });

      if (opportunity) {
        const outcomeData = {
          result: outcomeResult,
          outcomeScore: outcomeResult === "SUCCESS" ? 1 : 0,
          confidence: opportunity.confidence,
          explanation: `Opportunity "${opportunity.title}" marked ${status} by user.`,
        };

        const existingOutcome = await tx.outcomeEvaluation.findFirst({
          where: { organizationId, opportunityId: id },
          select: { id: true },
        });

        if (existingOutcome) {
          // A terminal status can change (e.g. WON -> LOST). Keep the
          // learning record aligned with the latest persisted status.
          await tx.outcomeEvaluation.update({
            where: { id: existingOutcome.id },
            data: outcomeData,
          });
        } else {
          await tx.outcomeEvaluation.create({
            data: {
              organizationId,
              opportunityId: id,
              ...outcomeData,
            },
          });
        }
      }
    }

    return updated;
  });

  if (result.count > 0) {
    await recordAuditEvent({
      organizationId,
      actorType: "USER",
      actorId: actorUserId,
      action: "opportunity.status_changed",
      resourceType: "opportunity",
      resourceId: id,
      metadata: { status },
    });
  }

  return result;
}
