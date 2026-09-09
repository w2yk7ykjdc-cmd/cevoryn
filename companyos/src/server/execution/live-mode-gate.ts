import { env } from "@/env";
import { hasLiveCredentialsFor } from "@/server/execution/org-credentials";
import { areRiskLimitsConfigured } from "@/server/execution/risk-limits";
import { reconcile, type LocalOrderSnapshot, type LocalPositionSnapshot } from "@/server/execution/reconciliation";
import type { ExecutionGateway, OrderIntent } from "@/server/execution/types";

/**
 * Sprint 22 Phase 13 / Sprint 23 Phase 3: LIVE mode's own explicit
 * readiness gate -- `env.LIVE_EXECUTION_ENABLED` defaults to `false` (see
 * `env.ts`'s own doc comment) and this function's `ready` field can NEVER
 * be `true` while that flag is `false`, regardless of how healthy every
 * other check reports -- deliberately checked first and short-circuits
 * everything else, so a deployment that hasn't explicitly opted in never
 * even runs (and therefore never depends on the success of) a live network
 * call to Binance. This sprint ships with `LIVE_EXECUTION_ENABLED` unset
 * (false) everywhere -- see the Sprint 23 final report's own explicit
 * "REAL EXECUTION STATUS" item.
 *
 * Sprint 23 completes the two named checks the spec's own Phase 13 list
 * always called for but Sprint 22 left unbuilt: `risk_limits_configured`
 * (a structural sanity check, not previously a distinct readiness item)
 * and `test_order_pathway_validated` (exercises the real signed-request
 * path via Binance's own non-mutating `/api/v3/order/test` endpoint --
 * see `types.ts#OrderTestCapability`'s own doc comment for why this is
 * safe to run even before live execution is enabled).
 */

export type LiveModeCheckName =
  | "live_execution_enabled"
  | "credentials_configured"
  | "account_readable"
  | "reconciliation_healthy"
  | "kill_switch_queryable"
  | "gateway_healthy"
  | "symbol_metadata_valid"
  | "risk_limits_configured"
  | "test_order_pathway_validated";

export type LiveModeCheckResult = { name: LiveModeCheckName; passed: boolean; detail?: string };

export type LiveModeReadiness = {
  ready: boolean;
  checks: LiveModeCheckResult[];
};

/**
 * Every check function is injectable so this can be evaluated WITHOUT a
 * real account (tests supply a mock gateway and canned responses -- see
 * `tests/sprint-23-live-execution-hardening.test.ts` Group J). In
 * production, the default arguments call the real
 * `ExecutionGateway`/kill-switch/symbol-metadata checks, but
 * `LIVE_EXECUTION_ENABLED` still gates the overall `ready` result
 * regardless.
 */
export async function checkLiveModeReadiness(params: {
  gateway: ExecutionGateway;
  organizationId: string;
  symbol: string;
  isSymbolTradable: (symbol: string) => Promise<boolean>;
  isKillSwitchQueryable: () => Promise<boolean>;
  localOrders?: LocalOrderSnapshot[];
  localPositions?: LocalPositionSnapshot[];
  /** Injectable for tests -- see `validation.ts`'s own identical seam and doc comment for why. */
  liveExecutionEnabled?: boolean;
  /** Injectable for tests -- defaults to the real, organization-scoped-with-env-fallback resolver (`org-credentials.ts`). */
  hasLiveCredentials?: (organizationId: string) => boolean | Promise<boolean>;
  /**
   * A representative order intent to run through the real, non-mutating
   * test-order pathway. Deliberately no fabricated default: a made-up
   * quantity/price could report "ready" for a symbol/size this
   * organization would never actually trade. If omitted, the
   * `test_order_pathway_validated` check honestly fails rather than being
   * skipped or assumed passing.
   */
  testOrderIntent?: OrderIntent;
}): Promise<LiveModeReadiness> {
  const checks: LiveModeCheckResult[] = [];

  const liveEnabled = params.liveExecutionEnabled ?? env.LIVE_EXECUTION_ENABLED;
  checks.push({ name: "live_execution_enabled", passed: liveEnabled, detail: liveEnabled ? undefined : "LIVE_EXECUTION_ENABLED is false" });

  const hasCredentials = params.hasLiveCredentials ?? hasLiveCredentialsFor;
  const credentialsOk = await hasCredentials(params.organizationId);
  checks.push({ name: "credentials_configured", passed: credentialsOk, detail: credentialsOk ? undefined : "no organization credential configured and no deployment-wide fallback set" });

  let accountReadable = false;
  try {
    const account = await params.gateway.getAccount();
    accountReadable = account.canTrade;
    // Sprint 23 fix: previously this branch only ever pushed a check on
    // the SUCCESS path when `canTrade` was true, so a reachable-but-locked
    // account (a real, real-world Binance state -- API restrictions,
    // a compliance hold, etc.) silently omitted the check entirely rather
    // than failing it. `checks.every(passed)` treats a missing check as
    // vacuously true, so this used to let readiness pass despite an
    // unreadable account.
    checks.push({ name: "account_readable", passed: accountReadable, detail: accountReadable ? undefined : "account is reachable but canTrade is false" });
  } catch (err) {
    checks.push({ name: "account_readable", passed: false, detail: err instanceof Error ? err.message : String(err) });
  }

  try {
    const reconciliation = await reconcile({
      gateway: params.gateway,
      localOrders: params.localOrders ?? [],
      localPositions: params.localPositions ?? [],
    });
    checks.push({ name: "reconciliation_healthy", passed: reconciliation.healthy, detail: reconciliation.healthy ? undefined : `${reconciliation.mismatches.length} mismatch(es)` });
  } catch (err) {
    checks.push({ name: "reconciliation_healthy", passed: false, detail: err instanceof Error ? err.message : String(err) });
  }

  try {
    const killSwitchOk = await params.isKillSwitchQueryable();
    checks.push({ name: "kill_switch_queryable", passed: killSwitchOk });
  } catch (err) {
    checks.push({ name: "kill_switch_queryable", passed: false, detail: err instanceof Error ? err.message : String(err) });
  }

  checks.push({ name: "gateway_healthy", passed: accountReadable && params.gateway.mode === "LIVE", detail: params.gateway.mode !== "LIVE" ? "gateway is not a LIVE provider" : undefined });

  try {
    const symbolOk = await params.isSymbolTradable(params.symbol);
    checks.push({ name: "symbol_metadata_valid", passed: symbolOk, detail: symbolOk ? undefined : `${params.symbol} is not tradable` });
  } catch (err) {
    checks.push({ name: "symbol_metadata_valid", passed: false, detail: err instanceof Error ? err.message : String(err) });
  }

  const riskLimitsOk = areRiskLimitsConfigured();
  checks.push({ name: "risk_limits_configured", passed: riskLimitsOk, detail: riskLimitsOk ? undefined : "one or more hard risk-limit constants is missing, zero, negative, or non-finite" });

  if (params.testOrderIntent) {
    try {
      const result = await params.gateway.testOrder(params.testOrderIntent);
      checks.push({ name: "test_order_pathway_validated", passed: result.valid, detail: result.valid ? undefined : result.reason });
    } catch (err) {
      checks.push({ name: "test_order_pathway_validated", passed: false, detail: err instanceof Error ? err.message : String(err) });
    }
  } else {
    checks.push({ name: "test_order_pathway_validated", passed: false, detail: "no representative testOrderIntent supplied" });
  }

  const ready = liveEnabled && checks.every((c) => c.passed);
  return { ready, checks };
}
