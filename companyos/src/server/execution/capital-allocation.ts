import { checkRiskLimits, type RiskLimitViolation } from "@/server/execution/risk-limits";
import { evaluateCircuitBreakers, isEmergencyStopEngaged } from "@/server/execution/circuit-breakers";
import { getOrganizationRiskPolicy, type RiskPolicyLimits } from "@/server/execution/risk-policy";
import { computePortfolioSnapshot, existingExposureFor, type PortfolioSnapshot } from "@/server/execution/portfolio-risk";

/**
 * Sprint 24 Phase 3: the deterministic capital-allocation chain the spec
 * names explicitly -- AVAILABLE CAPITAL -> RISK BUDGET -> EXPOSURE LIMIT ->
 * MARGIN -> FINAL ORDER SIZE -> EXECUTION VALIDATION. This is deliberately
 * NOT a second sizing system: `proposedNotional`/`proposedLeverage` are
 * inputs, already computed by Sprint 16's `buildEntryPlan`/`computePositionSizing`
 * (via Sprint 19's `ProposedOrder`) -- this module only checks that
 * already-decided size against this organization's own remaining risk
 * budget, exposure headroom, and margin, producing a fully-traceable
 * intermediate value at every stage (never re-deriving quantity or price).
 * "Execution validation" here reuses `checkRiskLimits`/`evaluateCircuitBreakers`
 * verbatim -- the exact same functions `validation.ts#validateForLiveExecution`
 * itself calls -- so a decision this module approves and a decision
 * `validateForLiveExecution` would separately approve can never disagree;
 * there is exactly one canonical pass/fail rule, reused from two call
 * sites.
 */

export type CapitalAllocationStage = {
  availableCapital: number;
  availableMargin: number;
  dailyLossBudget: number;
  riskBudgetRemaining: number;
  portfolioDrawdownBudgetRemaining: number;
  exposureLimit: number;
  exposureRemaining: number;
  symbolExposureLimit: number;
  symbolExposureRemaining: number;
  strategyExposureLimit: number;
  strategyExposureRemaining: number;
  requiredMargin: number;
  finalOrderNotional: number;
  finalOrderLeverage: number;
};

export type CapitalAllocationResult =
  | { status: "APPROVED"; stage: CapitalAllocationStage }
  | { status: "REJECTED"; reason: RiskLimitViolation | "portfolio_drawdown_breaker" | "insufficient_margin"; stage: CapitalAllocationStage };

export async function evaluateCapitalAllocation(params: {
  organizationId: string;
  symbol: string;
  strategyType: string;
  proposedNotional: number;
  proposedLeverage: number;
  /** Injectable for tests -- defaults to a real, freshly-computed read (`portfolio-risk.ts#computePortfolioSnapshot`). */
  snapshot?: PortfolioSnapshot;
  /** Injectable for tests -- defaults to this organization's real effective policy. */
  policy?: RiskPolicyLimits;
}): Promise<CapitalAllocationResult> {
  const { organizationId, symbol, strategyType, proposedNotional, proposedLeverage } = params;
  const snapshot = params.snapshot ?? (await computePortfolioSnapshot(organizationId));
  const policy = params.policy ?? (await getOrganizationRiskPolicy(organizationId));

  // STAGE 1: AVAILABLE CAPITAL
  const availableCapital = snapshot.account.currentEquity;
  const availableMargin = snapshot.account.availableMargin;

  // STAGE 2: RISK BUDGET
  const dailyLossBudget = policy.maxDailyLossPct * availableCapital;
  const riskBudgetRemaining = Math.max(0, dailyLossBudget - snapshot.todaysRealizedLossPct * availableCapital);
  const portfolioDrawdownBudgetRemaining = Math.max(0, policy.maxPortfolioDrawdownPct - snapshot.account.drawdownPct);

  // STAGE 3: EXPOSURE LIMIT
  const exposureLimit = policy.maxTotalExposureMultiple * availableCapital;
  const exposureRemaining = Math.max(0, exposureLimit - snapshot.totalExposure);
  const symbolExposureLimit = policy.maxSymbolExposurePct * availableCapital;
  const existingSymbolExposure = existingExposureFor(symbol, null, snapshot.bySymbol, snapshot.byStrategy);
  const symbolExposureRemaining = Math.max(0, symbolExposureLimit - existingSymbolExposure);
  const strategyExposureLimit = policy.maxStrategyExposurePct * availableCapital;
  const existingStrategyExposure = existingExposureFor(null, strategyType, snapshot.bySymbol, snapshot.byStrategy);
  const strategyExposureRemaining = Math.max(0, strategyExposureLimit - existingStrategyExposure);

  // STAGE 4: MARGIN
  const requiredMargin = proposedLeverage > 0 ? proposedNotional / proposedLeverage : proposedNotional;

  // STAGE 5: FINAL ORDER SIZE -- echoed, never re-derived.
  const stage: CapitalAllocationStage = {
    availableCapital,
    availableMargin,
    dailyLossBudget,
    riskBudgetRemaining,
    portfolioDrawdownBudgetRemaining,
    exposureLimit,
    exposureRemaining,
    symbolExposureLimit,
    symbolExposureRemaining,
    strategyExposureLimit,
    strategyExposureRemaining,
    requiredMargin,
    finalOrderNotional: proposedNotional,
    finalOrderLeverage: proposedLeverage,
  };

  // STAGE 6: EXECUTION VALIDATION -- the one canonical rule, reused verbatim.
  const breakers = evaluateCircuitBreakers({
    todaysRealizedLossPct: snapshot.todaysRealizedLossPct,
    consecutiveLosses: snapshot.consecutiveLosses,
    currentDrawdownPct: snapshot.account.drawdownPct,
    policy,
  });
  if (breakers.triggeredBreakers.includes("portfolio_drawdown")) {
    return { status: "REJECTED", reason: "portfolio_drawdown_breaker", stage };
  }

  const violation = checkRiskLimits(
    {
      orderNotional: proposedNotional,
      leverage: proposedLeverage,
      accountEquity: availableCapital,
      existingTotalExposure: snapshot.totalExposure,
      existingOpenPositionCount: snapshot.openPositionCount,
      existingSymbolExposure,
      existingStrategyExposure,
      todaysRealizedLossPct: snapshot.todaysRealizedLossPct,
      consecutiveLosses: snapshot.consecutiveLosses,
      emergencyStopEngaged: isEmergencyStopEngaged(breakers),
    },
    policy,
  );
  if (violation) return { status: "REJECTED", reason: violation, stage };
  if (requiredMargin > availableMargin) return { status: "REJECTED", reason: "insufficient_margin", stage };

  return { status: "APPROVED", stage };
}
