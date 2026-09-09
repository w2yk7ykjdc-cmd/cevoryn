import { env } from "@/env";
import { isKillSwitchEngaged } from "@/server/ai/autonomy/policy-service";
import type { MarketDecision } from "@/server/intelligence/market-decision/types";
import { checkRiskLimits, type RiskLimitCheckInput, type RiskLimitViolation } from "@/server/execution/risk-limits";
import { hasLiveCredentialsFor } from "@/server/execution/org-credentials";
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
  | "insufficient_balance";

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
}): Promise<LiveValidationResult> {
  const { organizationId, decision, gateway, riskContext } = params;
  const liveExecutionEnabled = params.liveExecutionEnabled ?? env.LIVE_EXECUTION_ENABLED;
  const hasCredentials = params.hasLiveCredentials ?? hasLiveCredentialsFor;
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

  // Phase 8: hard risk limits, using the already-validated proposed order's own notional/leverage.
  const violation = checkRiskLimits({
    ...riskContext,
    orderNotional: decision.proposedOrder.notional,
    leverage: decision.proposedOrder.leverage,
  });
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
