import type { RiskPolicyLimits } from "@/server/execution/risk-policy";

/**
 * Sprint 24 Phase 5: drawdown & circuit breakers -- deterministic,
 * evidence-based decisions about whether NEW exposure may be opened, never
 * about closing or managing anything that already exists. Reuses
 * `RiskPolicyLimits`'s own two drawdown-related fields
 * (`maxPortfolioDrawdownPct`/`emergencyStopThresholdPct`) rather than
 * introducing a third, parallel threshold concept.
 *
 * Deliberately does NOT auto-close or auto-liquidate anything when a
 * breaker trips -- `position-management.ts`'s existing kill-switch-exempt
 * `cancelExistingLiveOrder`/`reconcileOrganizationLiveState` remain the
 * only way to act on an existing position, and remain unaffected by breaker
 * state, exactly like they remain unaffected by the kill switch (Sprint 23
 * Phase 4). A tripped breaker and an engaged kill switch have IDENTICAL
 * externally-visible effect (no new exposure); a breaker is this
 * organization's own risk-derived, automatic, reversible-by-market-recovery
 * signal, while the kill switch is a human-engaged, deliberate override
 * that stays engaged until a human disengages it. Both are checked in
 * `validation.ts`; either one alone is sufficient to block a new
 * submission.
 */

export type CircuitBreakerName = "daily_loss" | "consecutive_loss" | "portfolio_drawdown" | "emergency_stop";

export type CircuitBreakerResult = {
  /** `true` if ANY breaker below is triggered -- new exposure must be blocked. */
  engaged: boolean;
  triggeredBreakers: CircuitBreakerName[];
  /** Plain-language, auditable reasons -- one per triggered breaker, never fabricated, always traceable to the exact input value and threshold that tripped it. */
  reasons: string[];
};

export function evaluateCircuitBreakers(input: {
  todaysRealizedLossPct: number;
  consecutiveLosses: number;
  currentDrawdownPct: number;
  policy: RiskPolicyLimits;
}): CircuitBreakerResult {
  const { todaysRealizedLossPct, consecutiveLosses, currentDrawdownPct, policy } = input;
  const triggeredBreakers: CircuitBreakerName[] = [];
  const reasons: string[] = [];

  if (todaysRealizedLossPct >= policy.maxDailyLossPct) {
    triggeredBreakers.push("daily_loss");
    reasons.push(`daily realized loss ${(todaysRealizedLossPct * 100).toFixed(2)}% has reached the ${(policy.maxDailyLossPct * 100).toFixed(2)}% daily-loss breaker`);
  }
  if (consecutiveLosses >= policy.maxConsecutiveLosses) {
    triggeredBreakers.push("consecutive_loss");
    reasons.push(`${consecutiveLosses} consecutive losing trades has reached the ${policy.maxConsecutiveLosses}-loss circuit breaker`);
  }
  if (currentDrawdownPct >= policy.maxPortfolioDrawdownPct) {
    triggeredBreakers.push("portfolio_drawdown");
    reasons.push(`portfolio drawdown ${(currentDrawdownPct * 100).toFixed(2)}% has reached the ${(policy.maxPortfolioDrawdownPct * 100).toFixed(2)}% drawdown breaker`);
  }
  // Emergency stop is deliberately checked LAST and independently -- it is
  // strictly more severe than (and, by `DEFAULT_RISK_POLICY`'s own
  // documented ordering, numerically above) the portfolio-drawdown
  // breaker, so both can legitimately be triggered together; the emergency
  // reason is reported in addition to, never instead of, the drawdown one.
  if (currentDrawdownPct >= policy.emergencyStopThresholdPct) {
    triggeredBreakers.push("emergency_stop");
    reasons.push(`portfolio drawdown ${(currentDrawdownPct * 100).toFixed(2)}% has reached the ${(policy.emergencyStopThresholdPct * 100).toFixed(2)}% emergency-stop threshold`);
  }

  return { engaged: triggeredBreakers.length > 0, triggeredBreakers, reasons };
}

/** `true` iff the emergency-stop breaker specifically is triggered -- the exact boolean `risk-limits.ts#RiskLimitCheckInput.emergencyStopEngaged` expects, computed here rather than left as an opaque caller-supplied flag. */
export function isEmergencyStopEngaged(result: CircuitBreakerResult): boolean {
  return result.triggeredBreakers.includes("emergency_stop");
}
