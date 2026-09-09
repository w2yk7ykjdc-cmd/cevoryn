import { prisma } from "@/server/db/client";
import { env } from "@/env";
import { logger } from "@/server/logger/logger";
import { isKillSwitchEngaged } from "@/server/ai/autonomy/policy-service";
import { isAutonomousExecutionEnabled } from "@/server/execution/autonomy-gate";
import { resolveExecutionCredentials } from "@/server/execution/org-credentials";
import { createBinanceExecutionAdapter } from "@/server/execution/binance-adapter";
import { reconcileOrganizationLiveState } from "@/server/execution/position-management";
import { isSafeToOpenNewOrders } from "@/server/execution/reconciliation";
import { generateMarketDecisions } from "@/server/intelligence/market-decision/service";
import { evaluateCapitalAllocation } from "@/server/execution/capital-allocation";
import { computePortfolioSnapshot, existingExposureFor } from "@/server/execution/portfolio-risk";
import { getOrganizationRiskPolicy } from "@/server/execution/risk-policy";
import { evaluateCircuitBreakers, isEmergencyStopEngaged } from "@/server/execution/circuit-breakers";
import { submitDecision } from "@/server/execution/service";
import { recordExecutionAudit } from "@/server/execution/audit";
import type { ExecutionGateway } from "@/server/execution/types";

const ORG_BATCH_SIZE = 50;

/**
 * Sprint 25: CONTROLLED AUTONOMOUS EXECUTION -- the missing wiring between
 * Sprint 19's decision engine and Sprint 22-24's own fully-built,
 * fully-tested, but never-production-called `submitDecision`/
 * `evaluateCapitalAllocation` pipeline (both had ZERO callers outside their
 * own test files before this sprint). This module reuses every existing
 * safety mechanism VERBATIM and adds no new financial formula, no new
 * risk/execution system, no second sizing or validation path:
 *
 *  1. `env.LIVE_EXECUTION_ENABLED` (Sprint 22) -- unchanged, still the
 *     deployment-wide master switch with no app-level write path, still
 *     `false` by default, checked FIRST and short-circuits everything.
 *  2. This organization's own `OrganizationExecutionAutonomyPolicy`
 *     (Sprint 25, `autonomy-gate.ts`) -- the NEW, narrow, per-organization,
 *     human, explicit opt-in this sprint adds. Disabled by default.
 *  3. The kill switch (Sprint 19/22/23) -- always supreme: checked here
 *     (so a killed organization is skipped before even generating
 *     decisions) AND, unconditionally, again inside `submitDecision` ->
 *     `validateForLiveExecution` regardless of what this orchestrator does.
 *  4. Reconciliation health (Sprint 22 Phase 10) -- never opens new risk on
 *     top of already-detected local/remote drift.
 *  5. `generateMarketDecisions` (Sprint 19) -- unchanged, the single
 *     canonical Decision Engine.
 *  6. `evaluateCapitalAllocation` (Sprint 24) -- wired in as a pre-trade
 *     check for the FIRST time this sprint: AVAILABLE CAPITAL -> RISK
 *     BUDGET -> EXPOSURE LIMIT -> MARGIN -> FINAL ORDER SIZE -> EXECUTION
 *     VALIDATION, evaluated per decision before `submitDecision` is even
 *     attempted, so a rejection is visible at the capital-allocation stage
 *     specifically (audited as `execution.autonomous_decision_skipped`).
 *  7. `submitDecision` (Sprint 22) itself, unchanged -- the final,
 *     unconditional gate (idempotency via `buildClientOrderId`,
 *     `validateForLiveExecution`, hard risk limits, live-mode readiness).
 *     This orchestrator can PROPOSE a submission; it can never skip or
 *     weaken that gate, and it never calls `gateway.submitOrder` directly.
 *
 * Mirrors `paper-trading/generate.ts#evaluatePaperTrading`'s exact
 * per-organization, cursor-paged, one-bad-organization-never-blocks-another
 * shape -- the SAME orchestration pattern applied to the LIVE path, never a
 * second, parallel one. Never reachable from any AI tool or chat-triggered
 * code path -- a plain scheduled background job
 * (`jobs/processors/run-autonomous-execution.ts`), the same trust boundary
 * `evaluatePaperTrading`/`submitDecision` already sit behind.
 *
 * KNOWN, DOCUMENTED SCOPE LIMIT (not a bug, not silently worked around):
 * `computePortfolioSnapshot` (Sprint 24) is deliberately PAPER-scoped --
 * `LIVE_EXECUTION_ENABLED` stays `false` through this sprint too, and no
 * live-position-tracking equivalent exists yet (Sprint 24's own doc comment
 * already says a future sprint would add a symmetric
 * `computeLivePortfolioSnapshot`). This orchestrator computes ONE snapshot
 * per organization per pass and evaluates every actionable decision in that
 * pass against it; it deliberately does NOT invent a second, in-memory
 * "expected new live exposure" formula to approximate what a not-yet-built
 * live snapshot would show. A second actionable decision in the SAME pass
 * for the SAME organization does not see the first's newly-submitted LIVE
 * notional -- `existingOpenPositionCount`/`existingTotalExposure`'s own hard
 * limit checks (`max_open_positions`/`max_total_exposure`) still apply,
 * just against the start-of-pass snapshot.
 */

export type AutonomousExecutionOrgResult =
  | { organizationId: string; status: "skipped"; reason: string }
  | {
      organizationId: string;
      status: "ran";
      decisionsEvaluated: number;
      submitted: number;
      rejectedByValidation: number;
      skippedByCapitalAllocation: number;
    };

export type AutonomousExecutionRunResult = {
  organizationsScanned: number;
  organizationsRanExecution: number;
  totalSubmitted: number;
  totalRejected: number;
  errors: number;
  durationMs: number;
};

async function resolveLiveGateway(organizationId: string): Promise<ExecutionGateway | null> {
  const credentials = await resolveExecutionCredentials(organizationId);
  if (!credentials) return null;
  return createBinanceExecutionAdapter(credentials);
}

/**
 * The full per-organization pass: every gate above, in order, first
 * failure wins (matching every other deterministic checker in this
 * codebase's own established "fixed order, first violation returned"
 * style). Every `deps` field is injectable for tests -- mirrors the exact
 * same "inject the real dependency, default to the production one" seam
 * already established across `validation.ts#validateForLiveExecution`/
 * `live-mode-gate.ts#checkLiveModeReadiness`; omitting `deps` entirely
 * reproduces real production behavior exactly.
 */
export async function runAutonomousExecutionForOrganization(
  organizationId: string,
  now: Date,
  deps: {
    gateway?: ExecutionGateway;
    liveExecutionEnabled?: boolean;
    hasLiveCredentials?: (organizationId: string) => boolean | Promise<boolean>;
  } = {},
): Promise<AutonomousExecutionOrgResult> {
  const skip = (reason: string): AutonomousExecutionOrgResult => ({ organizationId, status: "skipped", reason });
  const liveExecutionEnabled = deps.liveExecutionEnabled ?? env.LIVE_EXECUTION_ENABLED;

  // Gate 1: deployment-wide master switch -- unchanged, checked first.
  if (!liveExecutionEnabled) return skip("live_execution_disabled");

  // Gate 2: this organization's own explicit, human opt-in (Sprint 25, NEW).
  if (!(await isAutonomousExecutionEnabled(organizationId))) return skip("autonomous_execution_not_enabled");

  // Gate 3: the kill switch -- always supreme. Re-checked unconditionally
  // again inside `submitDecision` regardless of this early exit existing.
  const killSwitchEngaged = env.MARKET_EXECUTION_KILL_SWITCH || (await isKillSwitchEngaged(organizationId, "market"));
  if (killSwitchEngaged) return skip("kill_switch_engaged");

  const gateway = deps.gateway ?? (await resolveLiveGateway(organizationId));
  if (!gateway) return skip("no_live_credentials");

  // Gate 4: reconciliation health -- never open new risk on top of
  // undetected local/remote drift (Sprint 22 Phase 10's own rule, reused).
  const reconciliation = await reconcileOrganizationLiveState({ organizationId, gateway });
  if (!isSafeToOpenNewOrders(reconciliation)) return skip("reconciliation_unhealthy");

  // Gate 5: the canonical Decision Engine, unchanged.
  const decisions = await generateMarketDecisions(organizationId, now);
  const actionable = decisions.filter(
    (d) => (d.action === "BUY" || d.action === "SELL") && d.proposedOrder !== null && d.proposedOrder.validationStatus === "VALID",
  );

  if (actionable.length === 0) {
    return { organizationId, status: "ran", decisionsEvaluated: decisions.length, submitted: 0, rejectedByValidation: 0, skippedByCapitalAllocation: 0 };
  }

  const [snapshot, riskPolicy] = await Promise.all([computePortfolioSnapshot(organizationId), getOrganizationRiskPolicy(organizationId)]);

  let submitted = 0;
  let rejectedByValidation = 0;
  let skippedByCapitalAllocation = 0;

  for (const decision of actionable) {
    const order = decision.proposedOrder!;

    // Gate 6: capital allocation pre-check -- reused verbatim, wired into a
    // production path for the first time this sprint.
    const allocation = await evaluateCapitalAllocation({
      organizationId,
      symbol: order.symbol,
      strategyType: decision.strategyType,
      proposedNotional: order.notional,
      proposedLeverage: order.leverage,
      snapshot,
      policy: riskPolicy,
    });

    if (allocation.status === "REJECTED") {
      skippedByCapitalAllocation += 1;
      await recordExecutionAudit({
        organizationId,
        action: "execution.autonomous_decision_skipped",
        clientOrderId: organizationId,
        symbol: order.symbol,
        strategyType: decision.strategyType,
        rejectionReason: allocation.reason,
      });
      continue;
    }

    const breakers = evaluateCircuitBreakers({
      todaysRealizedLossPct: snapshot.todaysRealizedLossPct,
      consecutiveLosses: snapshot.consecutiveLosses,
      currentDrawdownPct: snapshot.account.drawdownPct,
      policy: riskPolicy,
    });

    // Gate 7: `submitDecision` itself -- the final, unconditional,
    // never-weakened gate. This orchestrator never calls
    // `gateway.submitOrder` directly.
    const result = await submitDecision({
      organizationId,
      decision,
      gateway,
      riskContext: {
        accountEquity: snapshot.account.currentEquity,
        existingTotalExposure: snapshot.totalExposure,
        existingOpenPositionCount: snapshot.openPositionCount,
        existingSymbolExposure: existingExposureFor(order.symbol, null, snapshot.bySymbol, snapshot.byStrategy),
        existingStrategyExposure: existingExposureFor(null, decision.strategyType, snapshot.bySymbol, snapshot.byStrategy),
        todaysRealizedLossPct: snapshot.todaysRealizedLossPct,
        consecutiveLosses: snapshot.consecutiveLosses,
        emergencyStopEngaged: isEmergencyStopEngaged(breakers),
      },
      currentDrawdownPct: snapshot.account.drawdownPct,
      riskPolicy,
      liveExecutionEnabled: deps.liveExecutionEnabled,
      hasLiveCredentials: deps.hasLiveCredentials,
    });

    if (result.status === "SUBMITTED") submitted += 1;
    else rejectedByValidation += 1;
  }

  return { organizationId, status: "ran", decisionsEvaluated: decisions.length, submitted, rejectedByValidation, skippedByCapitalAllocation };
}

/**
 * The scheduled entry point -- mirrors `evaluatePaperTrading`'s own
 * cursor-paged, per-organization-isolated shape exactly. Short-circuits
 * with zero database iteration when `LIVE_EXECUTION_ENABLED` is `false`
 * (the default), so a deployment that never opts in never even pages
 * through its organization list for this job.
 */
export async function runAutonomousExecution(now: Date = new Date()): Promise<AutonomousExecutionRunResult> {
  const start = Date.now();

  if (!env.LIVE_EXECUTION_ENABLED) {
    logger.debug("autonomous execution: LIVE_EXECUTION_ENABLED is false, skipping entire run");
    return { organizationsScanned: 0, organizationsRanExecution: 0, totalSubmitted: 0, totalRejected: 0, errors: 0, durationMs: Date.now() - start };
  }

  let cursor: string | undefined;
  let organizationsScanned = 0;
  let organizationsRanExecution = 0;
  let totalSubmitted = 0;
  let totalRejected = 0;
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
        const result = await runAutonomousExecutionForOrganization(organization.id, now);
        organizationsScanned += 1;
        if (result.status === "ran") {
          organizationsRanExecution += 1;
          totalSubmitted += result.submitted;
          totalRejected += result.rejectedByValidation + result.skippedByCapitalAllocation;
        }
      } catch (err) {
        errors += 1;
        logger.error({ err, organizationId: organization.id }, "autonomous execution error for organization");
      }
    }

    cursor = organizations[organizations.length - 1]?.id;
    if (organizations.length < ORG_BATCH_SIZE) break;
  }

  const durationMs = Date.now() - start;
  logger.info({ organizationsScanned, organizationsRanExecution, totalSubmitted, totalRejected, errors, durationMs }, "autonomous execution run completed");
  return { organizationsScanned, organizationsRanExecution, totalSubmitted, totalRejected, errors, durationMs };
}
