import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { recordAuditLog, publishAuditEvent } from "@/server/audit/audit-log";

/** Every organization gets this pipeline the moment it's created (see
 * `organizationHooks.afterCreateOrganization` in `src/server/auth/auth.ts`)
 * so leads can be created immediately — orgs can add their own stages
 * on top via `createPipelineStage`. */
export const DEFAULT_PIPELINE_STAGES: {
  name: string;
  order: number;
  isWon?: boolean;
  isLost?: boolean;
}[] = [
  { name: "New", order: 0 },
  { name: "Contacted", order: 1 },
  { name: "Qualified", order: 2 },
  { name: "Proposal", order: 3 },
  { name: "Won", order: 4, isWon: true },
  { name: "Lost", order: 5, isLost: true },
];

export async function seedDefaultPipelineStages(
  organizationId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  await client.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((stage) => ({
      organizationId,
      name: stage.name,
      order: stage.order,
      isWon: stage.isWon ?? false,
      isLost: stage.isLost ?? false,
    })),
    skipDuplicates: true,
  });
}

export async function listPipelineStages(organizationId: string) {
  const scoped = getTenantScopedClient(organizationId);
  return scoped.pipelineStage.findMany({ orderBy: { order: "asc" } });
}

export async function createPipelineStage(
  organizationId: string,
  actorId: string,
  name: string,
) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Stage name cannot be empty");
  }

  const { stage, auditEntry } = await prisma.$transaction(async (tx) => {
    const last = await tx.pipelineStage.findFirst({
      where: { organizationId },
      orderBy: { order: "desc" },
    });

    const stage = await tx.pipelineStage.create({
      data: { organizationId, name: trimmed, order: (last?.order ?? -1) + 1 },
    });

    const auditEntry = await recordAuditLog(
      {
        organizationId,
        actorId,
        actorType: "user",
        action: "pipeline_stage.created",
        targetType: "pipeline_stage",
        targetId: stage.id,
        metadata: { name: stage.name },
      },
      tx,
    );

    return { stage, auditEntry };
  });

  await publishAuditEvent(auditEntry);
  return stage;
}
