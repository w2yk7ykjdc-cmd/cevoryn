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

export async function updateOpportunityStatus(
  organizationId: string,
  id: string,
  status: "REVIEWING" | "QUALIFIED" | "ACTED_ON" | "WON" | "LOST" | "DISMISSED",
  actorUserId: string
) {
  const result = await prisma.opportunity.updateMany({
    where: { id, organizationId },
    data: { status },
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
