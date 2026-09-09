import { env } from "@/env";
import { isKillSwitchEngaged } from "@/server/ai/autonomy/policy-service";
import type { MarketDecision } from "@/server/intelligence/market-decision/types";
import { checkRiskLimits, type RiskLimitCheckInput, type RiskLimitViolation } from "@/server/execution/risk-limits";
import { hasLiveCredentialsFor } from "@/server/execution/org-credentials";
import { getOrganizationRiskPolicy, type RiskPolicyLimits } from "@/server/execution/risk-policy";
import { evaluateCircuitBreakers, isEmergencyStopEngaged } from "@/server/execution/circuit-breakers";
import type { ExecutionGateway } from "@/server/execution/types";

/**
 * Sprint 22 Phase 7: the execution-readiness gate a `MarketDecision` must
 * clear before it can ever reach `ExecutionGateway.submitOrder` for a LIVE
 * provider. Deliberately layered ON TOP of Sprint 19's own
 * `validateProposedOrder` rather than re-checking the same things a second
 * way: `decision.proposedOrder.validationStatus === "VALID"` already
 * covers strategy validity, decision validity, confidence/evidence
 * quality, stop-loss/take-profit validity, staleness, and the Sprint 19
 * execution-readiness risk bar in ONE reused check -- this function only
 * adds what is genuinely NEW for real, live capital: hard risk limits
 * (Phase 8), the kill switch wired to a REAL execution path (Phase 9),
 * live-mode/credential availability (Phase 13), and live account
 * sufficiency (via the gateway itself, never guessed).
 */

export type LiveValidationReason =
  | "live_execution_disabled"
  | "no_live_credentials"
  | "kill_switch_engaged"
  | "proposed_order_invalid"
  | "no_trade_decision"
  | RiskLimitViolation
  | "insufficient_balance"
  // Sprint 24 Phase 5: distinct from `RiskLimitViolation`'s own
  // "emergency_stop" -- this specific reason means the PORTFOLIO-drawdown
  // breaker tripped (a real, new check `checkRiskLimits` never performed),
  // not the daily-loss/consecutive-loss/leverage/exposure checks it
  // already covers.
  | "portfolio_drawdown_breaker";

export type LiveValidationResult = { status: "VALID" } | { status: "NO_EXECUTION"; reason: LiveValidationReason };

/**
 * `riskContext` supplies everything `checkRiskLimits` needs EXCEPT
 * `orderNotional`/`leverage`, which are read directly off the decision's
 * own already-validated `proposedOrder` -- never re-derived or guessed a
 * second way.
 */
export async function validateForLiveExecution(params: {
  organizationId: string;
  decision: MarketDecision;
  gateway: ExecutionGateway;
  riskContext: Omit<RiskLimitCheckInput, "orderNotional" | "leverage">;
  /** Injectable for tests (mirrors every other "inject the real dependency, default to the production one" seam in this codebase -- `env.LIVE_EXECUTION_ENABLED` cannot be flipped at runtime once the process has booted, since `env.ts` validates it once at module load). */
  liveExecutionEnabled?: boolean;
  /**
   * Injectable for tests -- same rationale as `liveExecutionEnabled`:
   * `hasLiveCredentialsFor` reads real database state (and, as a
   * fallback, real boot-time env vars) this test environment never sets,
   * so exercising any check that sits BEHIND the credential gate needs a
   * way to simulate "credentials configured" without a real Binance API
   * key ever existing. Defaults to the real, production,
   * organization-scoped `hasLiveCredentialsFor` (Sprint 23 Phase 2) --
   * NEVER the old deployment-wide-only check, so this gate is tenant-scoped
   * by construction.
   */
  hasLiveCredentials?: (organizationId: string) => boolean | Promise<boolean>;
  /**
   * This organization's current portfolio drawdown (0 = no drawdown), used
   * ONLY to evaluate the Sprint 24 portfolio-drawdown/emergency-stop
   * breakers (`circuit-breakers.ts`). Optional and defaults to `0` (no
   * drawdown, breakers never trip) so every EXISTING call site -- none of
   * which know about this field -- keeps behaving exactly as before.
   */
  currentDrawdownPct?: number;
  /** Injectable for tests -- defaults to this organization's real, effective policy (`risk-policy.ts#getOrganizationRiskPolicy`), which itself defaults to Sprint 22's own hardcoded values for an organization that configured nothing. */
  riskPolicy?: RiskPolicyLimits;
}): Promise<LiveValidationResult> {
  const { organizationId, decision, gateway, riskContext } = params;
  const liveExecutionEnabled = params.liveExecutionEnabled ?? env.LIVE_EXECUTION_ENABLED;
  const hasCredentials = params.hasLiveCredentials ?? hasLiveCredentialsFor;
  const currentDrawdownPct = params.currentDrawdownPct ?? 0;
  const reject = (reason: LiveValidationReason): LiveValidationResult => ({ status: "NO_EXECUTION", reason });

  // Phase 13: LIVE mode itself, and credentials, checked FIRST, before
  // anything else -- a decision is never even worth evaluating further if
  // live execution could not possibly proceed. Deliberately scoped to
  // `gateway.mode === "LIVE"` only -- PAPER submissions (Phase 12's shared
  // pipeline) are never gated by the live-execution switch or live
  // credentials, exactly as paper trading already worked before this
  // sprint existed.
  if (gateway.mode === "LIVE") {
    if (!liveExecutionEnabled) return reject("live_execution_disabled");
    if (!(await hasCredentials(organizationId))) return reject("no_live_credentials");
  }

  // Phase 9: both kill switches, real and unconditional -- applied
  // regardless of provider mode, matching the existing paper-trading
  // kill-switch wiring's own scope (Sprint 19).
  const orgKillSwitchEngaged = await isKillSwitchEngaged(organizationId, "market");
  if (env.MARKET_EXECUTION_KILL_SWITCH || orgKillSwitchEngaged) return reject("kill_switch_engaged");

  // Reuse Sprint 19's own execution-readiness verdict wholesale.
  if (decision.action !== "BUY" && decision.action !== "SELL") return reject("no_trade_decision");
  if (!decision.proposedOrder || decision.proposedOrder.validationStatus !== "VALID") return reject("proposed_order_invalid");

  // Sprint 24 Phase 2: this organization's own effective risk policy --
  // its own configured limits (clamped to the absolute ceiling) or
  // Sprint 22's original hardcoded defaults if it configured nothing.
  const riskPolicy = params.riskPolicy ?? (await getOrganizationRiskPolicy(organizationId));

  // Sprint 24 Phase 5: the portfolio-drawdown breaker is a genuinely NEW
  // check `checkRiskLimits` never performed -- checked explicitly here,
  // separately from the emergency-stop flag folded into `riskContext`
  // below, so its own distinct reason is reported rather than the more
  // generic `emergency_stop`.
  const breakers = evaluateCircuitBreakers({
    todaysRealizedLossPct: riskContext.todaysRealizedLossPct,
    consecutiveLosses: riskContext.consecutiveLosses,
    currentDrawdownPct,
    policy: riskPolicy,
  });
  if (breakers.triggeredBreakers.includes("portfolio_drawdown")) return reject("portfolio_drawdown_breaker");

  // Phase 8: hard risk limits, using the already-validated proposed order's
  // own notional/leverage and this organization's own effective policy.
  // `emergencyStopEngaged` is the OR of whatever the caller supplied
  // (Sprint 22/23's original manual flag, preserved) and the breaker
  // evaluation's own derived verdict (Sprint 24, additive-only -- can only
  // ever ADD a trigger, never suppress one the caller already set).
  const violation = checkRiskLimits(
    {
      ...riskContext,
      orderNotional: decision.proposedOrder.notional,
      leverage: decision.proposedOrder.leverage,
      emergencyStopEngaged: riskContext.emergencyStopEngaged || isEmergencyStopEngaged(breakers),
    },
    riskPolicy,
  );
  if (violation) return reject(violation);

  // Account balance sufficiency, read live from the gateway itself -- never assumed or estimated.
  const balances = await gateway.getBalances();
  const quoteAsset = decision.proposedOrder.symbol.endsWith("USDT") ? "USDT" : null;
  if (quoteAsset) {
    const balance = balances.find((b) => b.asset === quoteAsset);
    const available = balance?.available ?? 0;
    if (available < decision.proposedOrder.initialMargin) return reject("insufficient_balance");
  }

  return { status: "VALID" };
}
