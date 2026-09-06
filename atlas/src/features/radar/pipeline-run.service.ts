import "server-only";

import { prisma } from "@/lib/prisma";

export async function listPipelineRuns(
  organizationId: string,
  options: { take?: number } = {}
) {
  return prisma.pipelineRun.findMany({
    where: { organizationId },
    orderBy: { startedAt: "desc" },
    take: options.take ?? 20,
  });
}
