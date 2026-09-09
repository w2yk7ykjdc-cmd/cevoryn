import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger/logger";
import { evaluateStrategyHealth } from "@/server/intelligence/learning/strategy-health";

const ORG_BATCH_SIZE = 50;

export type EvaluateStrategyHealthResult = {
  organizationsScanned: number;
  strategiesEvaluated: number;
  transitions: number;
  errors: number;
  durationMs: number;
};

/**
 * Sprint 26: the scheduled, cursor-paged, per-organization-isolated pass --
 * mirrors `evaluate-outcomes.ts#evaluatePendingOutcomes`'s and
 * `autonomous-execution.ts#runAutonomousExecution`'s own established shape
 * exactly. One organization's error never blocks another's.
 */
export async function evaluateStrategyHealthForAllOrganizations(): Promise<EvaluateStrategyHealthResult> {
  const start = Date.now();
  let cursor: string | undefined;
  let organizationsScanned = 0;
  let strategiesEvaluated = 0;
  let transitions = 0;
  let errors = 0;

  for (;;) {
    const organizations = await prisma.organization.findMany({
      take: ORG_BATCH_SIZE,
      orderBy: { id: "asc" },
      select: { id: true },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (organizations.length === 0) break;

    for (const organization of organizations) {
      try {
        const result = await evaluateStrategyHealth(organization.id);
        organizationsScanned += 1;
        strategiesEvaluated += result.evaluated;
        transitions += result.transitioned;
      } catch (err) {
        errors += 1;
        logger.error({ err, organizationId: organization.id }, "strategy health evaluation error for organization");
      }
    }

    cursor = organizations[organizations.length - 1]?.id;
    if (organizations.length < ORG_BATCH_SIZE) break;
  }

  const durationMs = Date.now() - start;
  logger.info({ organizationsScanned, strategiesEvaluated, transitions, errors, durationMs }, "strategy health evaluation completed");
  return { organizationsScanned, strategiesEvaluated, transitions, errors, durationMs };
}
