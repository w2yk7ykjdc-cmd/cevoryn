import "server-only";

import { toExternalEventStatus } from "@/lib/enum-validators";
import { prisma } from "@/lib/prisma";

export async function listEvents(
  organizationId: string,
  options: { status?: string; take?: number } = {}
) {
  return prisma.externalEvent.findMany({
    where: {
      organizationId,
      ...(options.status && {
        status: toExternalEventStatus(options.status) ?? undefined,
      }),
    },
    include: {
      externalEntity: {
        select: { id: true, name: true, watchReason: true },
      },
    },
    orderBy: [{ confidence: "desc" }, { occurredAt: "desc" }],
    take: options.take ?? 30,
  });
}

export async function updateEventStatus(
  organizationId: string,
  id: string,
  status: "ANALYZED" | "DISMISSED"
) {
  return prisma.externalEvent.updateMany({
    where: { id, organizationId },
    data: { status },
  });
}
