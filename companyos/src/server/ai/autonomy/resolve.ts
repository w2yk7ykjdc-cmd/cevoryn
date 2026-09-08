import type { AutonomousActionOutcome, AutonomousActionTrigger, AutonomyLevel, AutonomyPolicy, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getOrCreatePolicy, isToolAllowlisted } from "@/server/ai/autonomy/policy-service";
import { clampLevelForDomain, LEVEL_ORDER } from "@/server/ai/autonomy/constants";
import type { ToolBlastRadius, ToolMutationCategory } from "@/server/ai/tools/types";
import { recordAuditLog } from "@/server/audit/audit-log";

export type ResolveAutonomyDecisionInput = {
  organizationId: string;
  /** The caller whose session this tool call runs under — used only to attribute the `autonomy.action_executed` audit entry. */
  actorId: string;
  toolName: string;
  /** Raw `tool.domain` — undefined defaults to `"crm"`. */
  domain: string | undefined;
  /**
   * Raw `tool.mutationCategory`, deliberately NOT pre-defaulted by the
   * caller: `undefined` here means the tool has never been classified at
   * all (a genuinely unclassified/future tool), which is treated
   * differently from an explicit `"mutating_gated"` classification — see
   * the doc comment below.
   */
  mutationCategory: ToolMutationCategory | undefined;
  blastRadius: ToolBlastRadius | undefined;
  autonomyEligible: boolean | undefined;
  input: Record<string, unknown>;
  actionRiskValue?: number;
  triggeredBy: AutonomousActionTrigger;
};

/**
 * The caller (`executeToolCall`) only ever needs to react to three shapes:
 * run it, queue it for a human, or refuse it outright. The finer-grained
 * reason (`AutonomyPolicy` block vs. kill switch vs. an L4 tool that isn't
 * allowlisted vs. a spent daily limit) is still recorded on every
 * `AutonomousActionLog` row — `outcome` there stays the full, specific
 * enum — this return type just collapses it to what execution needs to do
 * next. Per the Sprint 9 design: only `L0`/`L1`/kill-switch are hard
 * refusals with no approval queued; an L4/L5 tool that isn't allowlisted
 * or is over its daily limit falls back to `L3`'s approval behavior rather
 * than being silently lost — "değilse L3 approval" applies to the whole
 * L4/L5 eligibility check (allowlist AND limits), not just one part of it.
 */
export type ResolveAutonomyDecisionResult =
  | { outcome: "executed"; logId: string; allowlistEntryId: string | null }
  | { outcome: "requires_approval"; logId: string }
  | { outcome: "blocked"; logId: string; reason: string };

async function getDailyUsage(organizationId: string, domain: string): Promise<{ actionCount: number; riskUsed: number }> {
  const now = new Date();
  const startOfUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const result = await prisma.autonomousActionLog.aggregate({
    where: { organizationId, domain, outcome: "executed", createdAt: { gte: startOfUtcDay } },
    _count: { _all: true },
    _sum: { actionRiskValue: true },
  });

  return { actionCount: result._count._all, riskUsed: Number(result._sum.actionRiskValue ?? 0) };
}

function checkDailyLimits(
  policy: AutonomyPolicy,
  usage: { actionCount: number; riskUsed: number },
  actionRiskValue: number | undefined,
): { blocked: boolean; reason?: string } {
  if (policy.dailyActionLimit <= 0 || usage.actionCount >= policy.dailyActionLimit) {
    return { blocked: true, reason: `daily action limit (${policy.dailyActionLimit}) reached for this domain` };
  }

  const perActionLimit = Number(policy.perActionRiskLimit);
  if (actionRiskValue !== undefined && actionRiskValue > perActionLimit) {
    return { blocked: true, reason: `action risk value ${actionRiskValue} exceeds the per-action risk limit ${perActionLimit}` };
  }

  const dailyRiskLimit = Number(policy.dailyRiskLimit);
  const projectedRisk = usage.riskUsed + (actionRiskValue ?? 0);
  if (projectedRisk > dailyRiskLimit) {
    return { blocked: true, reason: `daily risk budget (${dailyRiskLimit}) would be exceeded (${projectedRisk} projected)` };
  }

  return { blocked: false };
}

/**
 * The single, deterministic decision point for every mutating tool call —
 * never called for `mutationCategory: "read_only"` tools (those never
 * touch autonomy policy at all; see `executeToolCall`, the sole caller).
 * Writes exactly one `AutonomousActionLog` row for every outcome —
 * including every hard-blocked and every fallback-to-approval one —
 * synchronously, before returning: "her autonomy kararı audit edilebilir"
 * is enforced structurally here, not left to callers to remember.
 *
 * Resolution order (matches the Sprint 9 design exactly):
 * 1. RBAC has already passed — the caller's responsibility, never
 *    re-checked or substituted for here.
 * 2. A tool with no `mutationCategory` ever set (truly unclassified, not
 *    merely `"mutating_gated"`) always resolves to `requires_approval`,
 *    bypassing level/kill-switch/domain checks entirely — the safest
 *    fallback for a future tool a developer forgot to classify.
 * 3. Kill switch engaged -> effective level `L0`.
 * 4. Effective level is further clamped to `MAX_AUTONOMY_LEVEL_BY_DOMAIN`.
 * 5. `L0`/`L1` block every mutating tool outright — a hard refusal, no
 *    approval queued (a disabled domain shouldn't pile up an approval
 *    backlog).
 * 6. `auto_append` tools execute at `L2` and above.
 * 7. `mutating_gated` + `additive` reaches the approval queue at `L2`+;
 *    `mutating_gated` + `destructive` needs `L3`+ to even reach the queue.
 * 8. At `L4`/`L5`, a tool that is BOTH statically `autonomyEligible` AND
 *    present in the organization's allowlist for this domain, within its
 *    daily action/risk limits, executes unattended; if any part of that
 *    fails (not allowlisted, or a limit is spent), it falls back to the
 *    `L3` approval queue rather than being refused outright.
 */
export async function resolveAutonomyDecision(input: ResolveAutonomyDecisionInput): Promise<ResolveAutonomyDecisionResult> {
  const domain = input.domain ?? "crm";
  const policy = await getOrCreatePolicy(input.organizationId, domain);
  const usage = await getDailyUsage(input.organizationId, domain);
  const latestVersion = await prisma.autonomyPolicyVersion.findFirst({
    where: { organizationId: input.organizationId, domain },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });

  const rawLevel: AutonomyLevel = policy.killSwitchEngaged ? "L0" : policy.level;
  const effectiveLevel = clampLevelForDomain(rawLevel, domain);

  const logBase = {
    organizationId: input.organizationId,
    domain,
    toolName: input.toolName,
    level: effectiveLevel,
    policyVersionId: latestVersion?.id ?? null,
    input: input.input as Prisma.InputJsonValue,
    dailyActionCountAtDecision: usage.actionCount,
    dailyRiskUsedAtDecision: usage.riskUsed,
    actionRiskValue: input.actionRiskValue ?? null,
    triggeredBy: input.triggeredBy,
  };

  async function writeLog(
    outcome: AutonomousActionOutcome,
    extra: { allowlistEntryId?: string } = {},
  ): Promise<string> {
    const row = await prisma.autonomousActionLog.create({
      data: { ...logBase, outcome, allowlistEntryId: extra.allowlistEntryId ?? null },
    });
    return row.id;
  }

  // Truly unclassified: no mutationCategory was ever set for this tool.
  if (input.mutationCategory === undefined) {
    const logId = await writeLog("requires_approval");
    return { outcome: "requires_approval", logId };
  }

  const mutationCategory = input.mutationCategory;
  const blastRadius = input.blastRadius ?? "destructive";
  const autonomyEligible = input.autonomyEligible ?? false;

  if (effectiveLevel === "L0" || effectiveLevel === "L1") {
    const loggedOutcome: AutonomousActionOutcome = policy.killSwitchEngaged ? "blocked_kill_switch" : "blocked_policy";
    const reason = policy.killSwitchEngaged
      ? `the kill switch is engaged for domain "${domain}"`
      : `autonomy level ${effectiveLevel} does not permit mutating actions in domain "${domain}"`;
    const logId = await writeLog(loggedOutcome);
    return { outcome: "blocked", logId, reason };
  }

  if (mutationCategory === "auto_append") {
    const logId = await writeLog("executed");
    return { outcome: "executed", logId, allowlistEntryId: null };
  }

  // mutationCategory === "mutating_gated" from here on.
  if (effectiveLevel === "L2" && blastRadius === "destructive") {
    const logId = await writeLog("blocked_policy");
    return {
      outcome: "blocked",
      logId,
      reason: `destructive mutating tools require autonomy level L3 or higher (current: ${effectiveLevel})`,
    };
  }

  if (effectiveLevel === "L4" || effectiveLevel === "L5") {
    if (autonomyEligible) {
      const allowlistEntry = await isToolAllowlisted(input.organizationId, domain, input.toolName);
      const eligibleForLevel = allowlistEntry !== null && LEVEL_ORDER[effectiveLevel] >= LEVEL_ORDER[allowlistEntry.minLevelRequired];

      if (!eligibleForLevel) {
        // Not hard-blocked: the tool COULD be made autonomous by allowlisting it -- falls back to the L3 approval queue.
        const logId = await writeLog("blocked_not_allowlisted");
        return { outcome: "requires_approval", logId };
      }

      const limitCheck = checkDailyLimits(policy, usage, input.actionRiskValue);
      if (limitCheck.blocked) {
        // Not hard-blocked either: today's autonomous budget is spent, not the capability itself -- falls back to approval.
        const logId = await writeLog("blocked_limit");
        return { outcome: "requires_approval", logId };
      }

      const logId = await writeLog("executed", { allowlistEntryId: allowlistEntry!.id });
      // Only genuine, unattended L4/L5 executions get this generic audit
      // entry -- routine L2 auto_append writes already have their own
      // tool-specific AuditLog entries, so mirroring every one of those
      // here too would just be noise.
      await recordAuditLog({
        organizationId: input.organizationId,
        actorId: input.actorId,
        actorType: "ai",
        action: "autonomy.action_executed",
        targetType: "autonomous_action_log",
        targetId: logId,
        metadata: {
          domain,
          toolName: input.toolName,
          level: effectiveLevel,
          allowlistEntryId: allowlistEntry!.id,
        },
      });
      return { outcome: "executed", logId, allowlistEntryId: allowlistEntry!.id };
    }
    // Not statically opted into autonomy by the tool's own developer -- falls back to L3 approval behavior below.
  }

  const logId = await writeLog("requires_approval");
  return { outcome: "requires_approval", logId };
}
