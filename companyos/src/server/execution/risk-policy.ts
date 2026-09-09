import { getTenantScopedClient } from "@/server/db/tenant";
import { recordExecutionAudit } from "@/server/execution/audit";
import {
  MAX_LIVE_LEVERAGE,
  MAX_ORDER_NOTIONAL_PCT_OF_EQUITY,
  MAX_LIVE_TOTAL_EXPOSURE_MULTIPLE,
  MAX_LIVE_SIMULTANEOUS_POSITIONS,
  MAX_SYMBOL_EXPOSURE_PCT_OF_EQUITY,
  MAX_STRATEGY_EXPOSURE_PCT_OF_EQUITY,
  MAX_DAILY_LOSS_PCT,
  MAX_CONSECUTIVE_LOSSES,
} from "@/server/execution/risk-limits";

/**
 * Sprint 24 Phase 2: organization-configurable risk policy. Every field
 * here has an exact Sprint 22 counterpart EXCEPT `maxPortfolioDrawdownPct`
 * and `emergencyStopThresholdPct`, which are genuinely new (Sprint 22 only
 * had a boolean `emergencyStopEngaged` flag, never a numeric portfolio
 * drawdown threshold an organization could tune).
 */
export type RiskPolicyLimits = {
  maxLeverage: number;
  maxOrderNotionalPct: number;
  maxTotalExposureMultiple: number;
  maxSimultaneousPositions: number;
  maxSymbolExposurePct: number;
  maxStrategyExposurePct: number;
  maxDailyLossPct: number;
  maxConsecutiveLosses: number;
  maxPortfolioDrawdownPct: number;
  emergencyStopThresholdPct: number;
};

/**
 * The safe default applied when an organization has never configured its
 * own policy -- built directly from Sprint 22's own hardcoded constants
 * for the 8 fields that already existed, so a brand-new organization's
 * effective limits are IDENTICAL to Sprint 22's behavior, never looser.
 * The two new fields get conservative, documented starting values:
 * `maxPortfolioDrawdownPct` (20%) is a real, meaningful ceiling below the
 * absolute ceiling; `emergencyStopThresholdPct` (30%) sits strictly above
 * it, so the portfolio-drawdown breaker (Phase 5) always fires and blocks
 * new entries well before the more severe emergency-stop state would.
 */
export const DEFAULT_RISK_POLICY: RiskPolicyLimits = {
  maxLeverage: MAX_LIVE_LEVERAGE,
  maxOrderNotionalPct: MAX_ORDER_NOTIONAL_PCT_OF_EQUITY,
  maxTotalExposureMultiple: MAX_LIVE_TOTAL_EXPOSURE_MULTIPLE,
  maxSimultaneousPositions: MAX_LIVE_SIMULTANEOUS_POSITIONS,
  maxSymbolExposurePct: MAX_SYMBOL_EXPOSURE_PCT_OF_EQUITY,
  maxStrategyExposurePct: MAX_STRATEGY_EXPOSURE_PCT_OF_EQUITY,
  maxDailyLossPct: MAX_DAILY_LOSS_PCT,
  maxConsecutiveLosses: MAX_CONSECUTIVE_LOSSES,
  maxPortfolioDrawdownPct: 0.2,
  emergencyStopThresholdPct: 0.3,
};

/**
 * A hardcoded, code-level ceiling NO organization's configured policy can
 * ever exceed, regardless of what is written to `OrganizationRiskPolicy` --
 * the same "a DB row can raise a value but a code-level clamp still bounds
 * what it's actually allowed to DO" discipline
 * `ai/autonomy/constants.ts#clampLevelForDomain` already established for
 * autonomy levels. A compromised admin session or a bad policy write can
 * set a looser value in the database, but it can never make real execution
 * actually use a looser one than this.
 */
export const ABSOLUTE_MAX_RISK_CEILING: RiskPolicyLimits = {
  maxLeverage: 5,
  maxOrderNotionalPct: 0.25,
  maxTotalExposureMultiple: 3,
  maxSimultaneousPositions: 10,
  maxSymbolExposurePct: 0.5,
  maxStrategyExposurePct: 0.75,
  maxDailyLossPct: 0.15,
  maxConsecutiveLosses: 10,
  maxPortfolioDrawdownPct: 0.4,
  emergencyStopThresholdPct: 0.5,
};

/** Every field in this policy shape is "max allowed X" -- larger is always looser, so clamping is always `Math.min(configured, ceiling)`, uniformly, for every field. */
export function clampToAbsoluteCeiling(policy: RiskPolicyLimits): RiskPolicyLimits {
  return {
    maxLeverage: Math.min(policy.maxLeverage, ABSOLUTE_MAX_RISK_CEILING.maxLeverage),
    maxOrderNotionalPct: Math.min(policy.maxOrderNotionalPct, ABSOLUTE_MAX_RISK_CEILING.maxOrderNotionalPct),
    maxTotalExposureMultiple: Math.min(policy.maxTotalExposureMultiple, ABSOLUTE_MAX_RISK_CEILING.maxTotalExposureMultiple),
    maxSimultaneousPositions: Math.min(policy.maxSimultaneousPositions, ABSOLUTE_MAX_RISK_CEILING.maxSimultaneousPositions),
    maxSymbolExposurePct: Math.min(policy.maxSymbolExposurePct, ABSOLUTE_MAX_RISK_CEILING.maxSymbolExposurePct),
    maxStrategyExposurePct: Math.min(policy.maxStrategyExposurePct, ABSOLUTE_MAX_RISK_CEILING.maxStrategyExposurePct),
    maxDailyLossPct: Math.min(policy.maxDailyLossPct, ABSOLUTE_MAX_RISK_CEILING.maxDailyLossPct),
    maxConsecutiveLosses: Math.min(policy.maxConsecutiveLosses, ABSOLUTE_MAX_RISK_CEILING.maxConsecutiveLosses),
    maxPortfolioDrawdownPct: Math.min(policy.maxPortfolioDrawdownPct, ABSOLUTE_MAX_RISK_CEILING.maxPortfolioDrawdownPct),
    emergencyStopThresholdPct: Math.min(policy.emergencyStopThresholdPct, ABSOLUTE_MAX_RISK_CEILING.emergencyStopThresholdPct),
  };
}

export class InvalidRiskPolicyError extends Error {
  constructor(field: string) {
    super(`Invalid risk policy field "${field}": every field must be a positive, finite number`);
    this.name = "InvalidRiskPolicyError";
  }
}

function assertValid(policy: RiskPolicyLimits): void {
  for (const [field, value] of Object.entries(policy)) {
    if (!Number.isFinite(value) || value <= 0) throw new InvalidRiskPolicyError(field);
  }
}

const FIELD_KEYS = [
  "maxLeverage",
  "maxOrderNotionalPct",
  "maxTotalExposureMultiple",
  "maxSimultaneousPositions",
  "maxSymbolExposurePct",
  "maxStrategyExposurePct",
  "maxDailyLossPct",
  "maxConsecutiveLosses",
  "maxPortfolioDrawdownPct",
  "emergencyStopThresholdPct",
] as const;

function rowToPolicy(row: Record<string, unknown>): RiskPolicyLimits {
  return {
    maxLeverage: Number(row.maxLeverage),
    maxOrderNotionalPct: Number(row.maxOrderNotionalPct),
    maxTotalExposureMultiple: Number(row.maxTotalExposureMultiple),
    maxSimultaneousPositions: Number(row.maxSimultaneousPositions),
    maxSymbolExposurePct: Number(row.maxSymbolExposurePct),
    maxStrategyExposurePct: Number(row.maxStrategyExposurePct),
    maxDailyLossPct: Number(row.maxDailyLossPct),
    maxConsecutiveLosses: Number(row.maxConsecutiveLosses),
    maxPortfolioDrawdownPct: Number(row.maxPortfolioDrawdownPct),
    emergencyStopThresholdPct: Number(row.emergencyStopThresholdPct),
  };
}

/**
 * The single function every risk-evaluation call site uses to get "this
 * organization's effective limits": its own configured policy if one
 * exists (always clamped to the absolute ceiling), otherwise
 * `DEFAULT_RISK_POLICY` (already within the ceiling by construction --
 * never silently loosened for an organization that configured nothing).
 * Tenant-scoped via `getTenantScopedClient`.
 */
export async function getOrganizationRiskPolicy(organizationId: string): Promise<RiskPolicyLimits> {
  const scoped = getTenantScopedClient(organizationId);
  const row = await scoped.organizationRiskPolicy.findUnique({ where: { organizationId } });
  if (!row) return DEFAULT_RISK_POLICY;
  return clampToAbsoluteCeiling(rowToPolicy(row));
}

export type SetRiskPolicyInput = { organizationId: string; actorId: string; policy: Partial<RiskPolicyLimits> };

/**
 * Creates or updates this organization's risk policy. Missing fields are
 * filled from the CURRENT effective policy (its own existing row, or
 * `DEFAULT_RISK_POLICY` if none) -- a partial update never silently zeroes
 * out an unspecified field. Every field is validated (positive, finite)
 * before being clamped to the absolute ceiling and persisted. Every change
 * is audited via the existing `AuditLog` reuse (Sprint 23's own
 * credential-audit precedent) -- the audit row records the resulting
 * effective policy values (all plain numeric limits, nothing secret),
 * never who requested what wasn't ultimately applied due to clamping.
 */
export async function setOrganizationRiskPolicy(input: SetRiskPolicyInput): Promise<RiskPolicyLimits> {
  const { organizationId, actorId, policy } = input;
  const current = await getOrganizationRiskPolicy(organizationId);
  const merged: RiskPolicyLimits = { ...current, ...policy };
  assertValid(merged);
  const clamped = clampToAbsoluteCeiling(merged);

  const scoped = getTenantScopedClient(organizationId);
  await scoped.organizationRiskPolicy.upsert({
    where: { organizationId },
    create: { organizationId, createdById: actorId, ...clamped },
    update: { ...clamped },
  });

  await recordExecutionAudit({
    organizationId,
    action: "execution.risk_policy_updated",
    clientOrderId: organizationId,
    symbol: "n/a",
    metadata: clamped,
  });

  return clamped;
}

export { FIELD_KEYS as RISK_POLICY_FIELD_KEYS };
