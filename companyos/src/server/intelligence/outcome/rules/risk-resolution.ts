import { getTenantScopedClient } from "@/server/db/tenant";
import {
  applyEvaluation,
  createPendingOutcomeIfMissing,
  findDueOutcomes,
  markInsufficientEvidence,
} from "@/server/intelligence/outcome/service";

export const RULE_NAME = "risk_resolution";
export const RULE_VERSION = "v1";

/**
 * Subscription health is slower-moving than internal CRM housekeeping, so
 * this window is longer than `stale_advisory_resolution`'s: 72 hours gives
 * a genuinely meaningful chance for a relapse to show up in the signal
 * ledger before this rule calls the resolution a `success`.
 */
const OBSERVATION_WINDOW_MS = 72 * 60 * 60 * 1000;
const SYSTEM_CONFIDENCE = 90;

export type RiskResolutionResult = {
  discovered: number;
  evaluated: number;
  insufficientEvidence: number;
};

/**
 * `Risk.status` (`src/server/intelligence/risk/service.ts`) auto-transitions
 * `open` -> `resolved` when its signal's severity drops, but — verified by
 * direct inspection of `generateRisksForOrganization`, not assumed —
 * deliberately never transitions back to `open` again: a later relapse
 * only refreshes the row's other fields, `status` is explicitly excluded
 * from that update. That means `Risk.status` alone cannot answer "is this
 * genuinely still resolved" once time has passed. This rule instead
 * re-checks the Risk's own `sourceSignalId` `CompanySignal` directly: if
 * its severity has climbed back to `"high"`, the underlying condition came
 * back even though the schema's own status field still says `"resolved"`
 * — a real, honest `reversed` outcome this rule surfaces without touching
 * the Risk engine's existing (intentional) behavior at all.
 */
export async function runRiskResolution(organizationId: string): Promise<RiskResolutionResult> {
  const discovered = await discoverPending(organizationId);
  const { evaluated, insufficientEvidence } = await evaluateDue(organizationId);
  return { discovered, evaluated, insufficientEvidence };
}

async function discoverPending(organizationId: string): Promise<number> {
  const scoped = getTenantScopedClient(organizationId);
  const resolvedRisks = await scoped.risk.findMany({
    where: { status: "resolved" },
    select: { id: true, resolvedAt: true, createdAt: true, sourceSignalId: true, potentialLoss: true },
  });

  let discovered = 0;
  for (const risk of resolvedRisks) {
    const resolvedAt = risk.resolvedAt ?? risk.createdAt;
    const result = await createPendingOutcomeIfMissing({
      organizationId,
      relatedEntityType: "Risk",
      relatedEntityId: risk.id,
      ruleName: RULE_NAME,
      ruleVersion: RULE_VERSION,
      signalId: risk.sourceSignalId ?? undefined,
      observationDueAt: new Date(resolvedAt.getTime() + OBSERVATION_WINDOW_MS),
      evidence: { sourceSignalId: risk.sourceSignalId ?? null, potentialLoss: Number(risk.potentialLoss) },
    });
    if (result.created) discovered += 1;
  }
  return discovered;
}

async function evaluateDue(organizationId: string): Promise<{ evaluated: number; insufficientEvidence: number }> {
  const scoped = getTenantScopedClient(organizationId);
  const due = await findDueOutcomes(organizationId, RULE_NAME, RULE_VERSION);

  let evaluated = 0;
  let insufficientEvidence = 0;

  for (const outcome of due) {
    const evidence = outcome.evidence as { sourceSignalId?: string | null; potentialLoss?: number };
    const sourceSignalId = evidence.sourceSignalId;

    if (!sourceSignalId) {
      await markInsufficientEvidence({ organizationId, outcomeId: outcome.id, evidence: { reason: "no sourceSignalId recorded" } });
      insufficientEvidence += 1;
      continue;
    }

    const signal = await scoped.companySignal.findFirst({ where: { id: sourceSignalId }, select: { severity: true } });
    if (!signal) {
      await markInsufficientEvidence({
        organizationId,
        outcomeId: outcome.id,
        evidence: { reason: "source signal no longer exists", sourceSignalId },
      });
      insufficientEvidence += 1;
      continue;
    }

    const relapsed = signal.severity === "high";
    const potentialLoss = evidence.potentialLoss ?? 0;
    await applyEvaluation({
      outcomeId: outcome.id,
      organizationId,
      outcomeType: relapsed ? "reversed" : "success",
      confidence: SYSTEM_CONFIDENCE,
      evidence: { signalSeverityAtEvaluation: signal.severity },
      expectedValue: 0,
      observedValue: relapsed ? potentialLoss : 0,
    });
    evaluated += 1;
  }

  return { evaluated, insufficientEvidence };
}
