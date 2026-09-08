import { prisma } from "@/server/db/client";
import { runStaleAdvisoryResolution } from "@/server/intelligence/outcome/rules/stale-advisory-resolution";
import { runRiskResolution } from "@/server/intelligence/outcome/rules/risk-resolution";
import { runOpportunityStateProgression } from "@/server/intelligence/outcome/rules/opportunity-state-progression";
import { logger } from "@/server/logger/logger";

const ORG_BATCH_SIZE = 50;

export type EvaluatePendingOutcomesResult = {
  organizationsScanned: number;
  discovered: number;
  evaluated: number;
  insufficientEvidence: number;
  errors: number;
  durationMs: number;
};

/**
 * The recurring "Action -> Outcome" pass: for every organization, runs each
 * registered outcome-evaluation rule's discovery (open a `pending` `Outcome`
 * for any newly-eligible subject) and evaluation (advance any `pending` row
 * whose observation window has elapsed) step. Mirrors
 * `computeCompanyIntelligence`'s exact shape — cursor-paged organizations,
 * one pass, one organization's failure logged and skipped rather than
 * aborting the run for the rest — deliberately reusing that pattern rather
 * than inventing a new orchestration shape.
 *
 * Adding a fourth rule later means adding one more `run*` call to the array
 * below; no other wiring changes.
 */
export async function evaluatePendingOutcomes(): Promise<EvaluatePendingOutcomesResult> {
  const start = Date.now();
  let cursor: string | undefined;
  let organizationsScanned = 0;
  let discovered = 0;
  let evaluated = 0;
  let insufficientEvidence = 0;
  let errors = 0;

  const rules = [runStaleAdvisoryResolution, runRiskResolution, runOpportunityStateProgression];

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
        for (const runRule of rules) {
          const result = await runRule(organization.id);
          discovered += result.discovered;
          evaluated += result.evaluated;
          insufficientEvidence += result.insufficientEvidence;
        }
        organizationsScanned += 1;
      } catch (err) {
        errors += 1;
        logger.error({ err, organizationId: organization.id }, "outcome evaluation failed for organization");
      }
    }

    cursor = organizations[organizations.length - 1]?.id;
    if (organizations.length < ORG_BATCH_SIZE) break;
  }

  const durationMs = Date.now() - start;
  logger.info(
    { organizationsScanned, discovered, evaluated, insufficientEvidence, errors, durationMs },
    "outcome evaluation pass completed",
  );

  return { organizationsScanned, discovered, evaluated, insufficientEvidence, errors, durationMs };
}
