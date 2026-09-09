import { env } from "@/env";
import { hasLiveCredentials } from "@/server/execution/credentials";
import { reconcile, type LocalOrderSnapshot, type LocalPositionSnapshot } from "@/server/execution/reconciliation";
import type { ExecutionGateway } from "@/server/execution/types";

/**
 * Sprint 22 Phase 13: LIVE mode's own explicit readiness gate --
 * `env.LIVE_EXECUTION_ENABLED` defaults to `false` (see `env.ts`'s own doc
 * comment) and this function's `ready` field can NEVER be `true` while
 * that flag is `false`, regardless of how healthy every other check
 * reports -- deliberately checked first and short-circuits everything
 * else, so a deployment that hasn't explicitly opted in never even runs
 * (and therefore never depends on the success of) a live network call to
 * Binance. This sprint ships with `LIVE_EXECUTION_ENABLED` unset (false)
 * everywhere -- see the Sprint 22 final report's own explicit "REAL
 * EXECUTION STATUS" item.
 */

export type LiveModeCheckName =
  | "live_execution_enabled"
  | "credentials_configured"
  | "account_readable"
  | "reconciliation_healthy"
  | "kill_switch_queryable"
  | "gateway_healthy"
  | "symbol_metadata_valid";

export type LiveModeCheckResult = { name: LiveModeCheckName; passed: boolean; detail?: string };

export type LiveModeReadiness = {
  ready: boolean;
  checks: LiveModeCheckResult[];
};

/**
 * Every check function is injectable so this can be evaluated WITHOUT a
 * real account (tests supply a mock gateway and canned responses -- see
 * `tests/sprint-22-live-execution.test.ts` Group AE). In production, the
 * default arguments call the real `ExecutionGateway`/kill-switch/symbol-
 * metadata checks, but `LIVE_EXECUTION_ENABLED` still gates the overall
 * `ready` result regardless.
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
}): Promise<LiveModeReadiness> {
  const checks: LiveModeCheckResult[] = [];

  const liveEnabled = params.liveExecutionEnabled ?? env.LIVE_EXECUTION_ENABLED;
  checks.push({ name: "live_execution_enabled", passed: liveEnabled, detail: liveEnabled ? undefined : "LIVE_EXECUTION_ENABLED is false" });

  const credentialsOk = hasLiveCredentials();
  checks.push({ name: "credentials_configured", passed: credentialsOk, detail: credentialsOk ? undefined : "BINANCE_API_KEY/BINANCE_API_SECRET not set" });

  let accountReadable = false;
  try {
    const account = await params.gateway.getAccount();
    accountReadable = account.canTrade;
  } catch (err) {
    checks.push({ name: "account_readable", passed: false, detail: err instanceof Error ? err.message : String(err) });
  }
  if (accountReadable) checks.push({ name: "account_readable", passed: true });

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

  const ready = liveEnabled && checks.every((c) => c.passed);
  return { ready, checks };
}
