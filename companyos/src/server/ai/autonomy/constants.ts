import type { AutonomyLevel } from "@prisma/client";

/**
 * Hardcoded, non-database-overridable ceiling per `AutonomyPolicy.domain`.
 * `resolveAutonomyDecision` (`src/server/ai/autonomy/resolve.ts`) always
 * clamps an organization's configured level to this ceiling before acting
 * on it — a compromised admin session or a bad policy write can raise an
 * `AutonomyPolicy.level` value in the database, but can never raise what
 * that level is actually allowed to DO for a given domain, because this
 * clamp only changes with a code deploy.
 *
 * `crm` is the only domain with any tools registered as of Sprint 9.
 * `market` is reserved for a future sprint and deliberately capped at `L2`
 * — no market/crypto/stocks/trading tool exists yet, and none can ever
 * reach unattended execution (`L4`/`L5`) without this constant itself
 * changing. Any domain not listed here defaults to `L2` as well (the same
 * fail-conservative floor), never to `L5`.
 */
export const MAX_AUTONOMY_LEVEL_BY_DOMAIN: Record<string, AutonomyLevel> = {
  crm: "L5",
  market: "L2",
};

export const DEFAULT_DOMAIN_CEILING: AutonomyLevel = "L2";

/** Ordinal ranking so levels can be compared/clamped with plain `<=`/`min`. */
const LEVEL_ORDER: Record<AutonomyLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };

export function levelAtMost(level: AutonomyLevel, ceiling: AutonomyLevel): AutonomyLevel {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[ceiling] ? level : ceiling;
}

export function maxLevelForDomain(domain: string): AutonomyLevel {
  return MAX_AUTONOMY_LEVEL_BY_DOMAIN[domain] ?? DEFAULT_DOMAIN_CEILING;
}

export function clampLevelForDomain(level: AutonomyLevel, domain: string): AutonomyLevel {
  return levelAtMost(level, maxLevelForDomain(domain));
}

export { LEVEL_ORDER };
