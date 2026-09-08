import type { AutonomyAllowlistEntry, AutonomyLevel, AutonomyPolicy, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { auth } from "@/server/auth/auth";
import { recordAuditLog } from "@/server/audit/audit-log";

const SYSTEM_ACTOR_ID = "system";
const DEFAULT_LEVEL: AutonomyLevel = "L2";
const DEFAULT_LIMIT = 0;

export class AutonomyPolicyPermissionError extends Error {
  constructor(action: string) {
    super(`Missing permission to ${action} autonomy policy`);
    this.name = "AutonomyPolicyPermissionError";
  }
}

async function assertPermission(organizationId: string, requestHeaders: Headers, permission: string[]): Promise<void> {
  const permitted = await auth.api.hasPermission({
    headers: requestHeaders,
    body: { organizationId, permissions: { autonomyPolicy: permission } as Record<string, string[]> },
  });
  if (!permitted.success) throw new AutonomyPolicyPermissionError(permission.join("/"));
}

function advisoryLockKey(organizationId: string, domain: string): string {
  return `autonomy-policy:${organizationId}:${domain}`;
}

async function nextVersionNumberFor(tx: Prisma.TransactionClient, organizationId: string, domain: string): Promise<number> {
  const last = await tx.autonomyPolicyVersion.findFirst({
    where: { organizationId, domain },
    orderBy: { versionNumber: "desc" },
  });
  return (last?.versionNumber ?? 0) + 1;
}

async function writeVersion(
  tx: Prisma.TransactionClient,
  policy: AutonomyPolicy,
  changedById: string,
  changeReason: string | null,
): Promise<void> {
  const versionNumber = await nextVersionNumberFor(tx, policy.organizationId, policy.domain);
  await tx.autonomyPolicyVersion.create({
    data: {
      organizationId: policy.organizationId,
      domain: policy.domain,
      versionNumber,
      level: policy.level,
      dailyActionLimit: policy.dailyActionLimit,
      dailyRiskLimit: policy.dailyRiskLimit,
      perActionRiskLimit: policy.perActionRiskLimit,
      killSwitchEngaged: policy.killSwitchEngaged,
      changedById,
      changeReason,
    },
  });
}

/**
 * Reads the current `AutonomyPolicy` row for `organizationId`+`domain`,
 * lazily creating the safe, zero-regression default (`L2`, every limit
 * `0`, kill switch off) the very first time it's asked for — self-healing
 * for organizations that existed before this sprint shipped, with no
 * separate backfill migration needed. The lazily-created row is versioned
 * like any other (`AutonomyPolicyVersion` #1), attributed to a `"system"`
 * actor since no human initiated it. Guarded by a transaction-scoped
 * Postgres advisory lock (the exact `withSeatLimitLock` pattern already
 * established in `src/server/billing/seats.ts`) so two concurrent
 * first-reads for the same org+domain can never create two rows.
 */
export async function getOrCreatePolicy(organizationId: string, domain: string): Promise<AutonomyPolicy> {
  const scoped = getTenantScopedClient(organizationId);
  const existing = await scoped.autonomyPolicy.findFirst({ where: { domain } });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${advisoryLockKey(organizationId, domain)}))`;

    const raceExisting = await tx.autonomyPolicy.findFirst({ where: { organizationId, domain } });
    if (raceExisting) return raceExisting;

    const policy = await tx.autonomyPolicy.create({
      data: {
        organizationId,
        domain,
        level: DEFAULT_LEVEL,
        dailyActionLimit: DEFAULT_LIMIT,
        dailyRiskLimit: DEFAULT_LIMIT,
        perActionRiskLimit: DEFAULT_LIMIT,
        killSwitchEngaged: false,
        updatedById: SYSTEM_ACTOR_ID,
      },
    });

    await writeVersion(tx, policy, SYSTEM_ACTOR_ID, "lazy default — no policy configured for this domain yet");

    return policy;
  });
}

export type UpdatePolicyInput = {
  organizationId: string;
  domain: string;
  level: AutonomyLevel;
  dailyActionLimit: number;
  dailyRiskLimit: number;
  perActionRiskLimit: number;
  changedById: string;
  changeReason?: string;
  requestHeaders: Headers;
};

/**
 * The sole human-facing path for changing an organization's autonomy
 * policy — owner-only (`autonomyPolicy:manage`). Every write both updates
 * the fast-lookup `AutonomyPolicy` row and appends a new, monotonically
 * numbered `AutonomyPolicyVersion`, inside the same transaction, so the two
 * can never drift out of step; also writes a normal `AuditLog` entry so the
 * change is visible in the existing audit UI/export with no new UI needed.
 */
export async function updatePolicy(input: UpdatePolicyInput): Promise<AutonomyPolicy> {
  await assertPermission(input.organizationId, input.requestHeaders, ["manage"]);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${advisoryLockKey(input.organizationId, input.domain)}))`;

    const current = await tx.autonomyPolicy.findFirst({ where: { organizationId: input.organizationId, domain: input.domain } });

    const policy = await tx.autonomyPolicy.upsert({
      where: { organizationId_domain: { organizationId: input.organizationId, domain: input.domain } },
      create: {
        organizationId: input.organizationId,
        domain: input.domain,
        level: input.level,
        dailyActionLimit: input.dailyActionLimit,
        dailyRiskLimit: input.dailyRiskLimit,
        perActionRiskLimit: input.perActionRiskLimit,
        killSwitchEngaged: current?.killSwitchEngaged ?? false,
        updatedById: input.changedById,
      },
      update: {
        level: input.level,
        dailyActionLimit: input.dailyActionLimit,
        dailyRiskLimit: input.dailyRiskLimit,
        perActionRiskLimit: input.perActionRiskLimit,
        updatedById: input.changedById,
      },
    });

    await writeVersion(tx, policy, input.changedById, input.changeReason ?? null);

    return policy;
  });

  await recordAuditLog({
    organizationId: input.organizationId,
    actorId: input.changedById,
    actorType: "user",
    action: "autonomy.policy_changed",
    targetType: "autonomy_policy",
    targetId: updated.id,
    metadata: {
      domain: input.domain,
      level: input.level,
      dailyActionLimit: input.dailyActionLimit,
      dailyRiskLimit: input.dailyRiskLimit.toString(),
      perActionRiskLimit: input.perActionRiskLimit.toString(),
    },
  });

  return updated;
}

type SetKillSwitchInput = {
  organizationId: string;
  domain: string;
  actorId: string;
  engaged: boolean;
  reason?: string;
};

async function setKillSwitch(input: SetKillSwitchInput): Promise<AutonomyPolicy> {
  await getOrCreatePolicy(input.organizationId, input.domain);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${advisoryLockKey(input.organizationId, input.domain)}))`;

    const policy = await tx.autonomyPolicy.update({
      where: { organizationId_domain: { organizationId: input.organizationId, domain: input.domain } },
      data: { killSwitchEngaged: input.engaged, updatedById: input.actorId },
    });

    await writeVersion(tx, policy, input.actorId, input.reason ?? null);

    return policy;
  });

  await recordAuditLog({
    organizationId: input.organizationId,
    actorId: input.actorId,
    actorType: "user",
    action: input.engaged ? "autonomy.kill_switch_engaged" : "autonomy.kill_switch_disengaged",
    targetType: "autonomy_policy",
    targetId: updated.id,
    metadata: { domain: input.domain },
  });

  return updated;
}

export type KillSwitchInput = {
  organizationId: string;
  domain: string;
  actorId: string;
  requestHeaders: Headers;
  reason?: string;
};

/**
 * Engaging the kill switch (making things safer) requires only
 * `autonomyPolicy:kill_switch` — grantable to `owner` and `admin`, so a
 * broader set of people can hit the brakes. No caching anywhere in this
 * path or in `resolveAutonomyDecision`: the very next autonomy resolution
 * reads this row fresh from the database.
 */
export async function engageKillSwitch(input: KillSwitchInput): Promise<AutonomyPolicy> {
  await assertPermission(input.organizationId, input.requestHeaders, ["kill_switch"]);
  return setKillSwitch({ ...input, engaged: true });
}

/**
 * Disengaging (loosening again) requires the fuller `autonomyPolicy:manage`
 * — owner-only — the asymmetric-trust split from the Sprint 9 design: it's
 * easier to make things safer than to make them less safe again.
 */
export async function disengageKillSwitch(input: KillSwitchInput): Promise<AutonomyPolicy> {
  await assertPermission(input.organizationId, input.requestHeaders, ["manage"]);
  return setKillSwitch({ ...input, engaged: false });
}

export type AddAllowlistEntryInput = {
  organizationId: string;
  domain: string;
  toolName: string;
  minLevelRequired: AutonomyLevel;
  addedById: string;
  requestHeaders: Headers;
};

/**
 * Adds one (domain, tool) pair to an organization's L4/L5 allowlist —
 * owner-only, same RBAC gate as `updatePolicy`. Necessary but not
 * sufficient on its own: `resolveAutonomyDecision` also requires the tool
 * be statically marked `autonomyEligible: true` in code
 * (`src/server/ai/tools/types.ts`) before this entry has any effect.
 */
export async function addAllowlistEntry(input: AddAllowlistEntryInput): Promise<AutonomyAllowlistEntry> {
  await assertPermission(input.organizationId, input.requestHeaders, ["manage"]);

  const entry = await prisma.autonomyAllowlistEntry.upsert({
    where: {
      organizationId_domain_toolName: {
        organizationId: input.organizationId,
        domain: input.domain,
        toolName: input.toolName,
      },
    },
    create: {
      organizationId: input.organizationId,
      domain: input.domain,
      toolName: input.toolName,
      minLevelRequired: input.minLevelRequired,
      addedById: input.addedById,
    },
    update: {
      minLevelRequired: input.minLevelRequired,
      addedById: input.addedById,
    },
  });

  await recordAuditLog({
    organizationId: input.organizationId,
    actorId: input.addedById,
    actorType: "user",
    action: "autonomy.allowlist_entry_added",
    targetType: "autonomy_allowlist_entry",
    targetId: entry.id,
    metadata: { domain: input.domain, toolName: input.toolName, minLevelRequired: input.minLevelRequired },
  });

  return entry;
}

export type RemoveAllowlistEntryInput = {
  organizationId: string;
  domain: string;
  toolName: string;
  removedById: string;
  requestHeaders: Headers;
};

export async function removeAllowlistEntry(input: RemoveAllowlistEntryInput): Promise<void> {
  await assertPermission(input.organizationId, input.requestHeaders, ["manage"]);

  const deleted = await prisma.autonomyAllowlistEntry.deleteMany({
    where: { organizationId: input.organizationId, domain: input.domain, toolName: input.toolName },
  });
  if (deleted.count === 0) return;

  await recordAuditLog({
    organizationId: input.organizationId,
    actorId: input.removedById,
    actorType: "user",
    action: "autonomy.allowlist_entry_removed",
    targetType: "autonomy_allowlist_entry",
    targetId: `${input.domain}:${input.toolName}`,
    metadata: { domain: input.domain, toolName: input.toolName },
  });
}

export async function listAllowlist(organizationId: string, domain: string): Promise<AutonomyAllowlistEntry[]> {
  const scoped = getTenantScopedClient(organizationId);
  return scoped.autonomyAllowlistEntry.findMany({ where: { domain }, orderBy: { createdAt: "asc" } });
}

export async function isToolAllowlisted(organizationId: string, domain: string, toolName: string): Promise<AutonomyAllowlistEntry | null> {
  const scoped = getTenantScopedClient(organizationId);
  return scoped.autonomyAllowlistEntry.findFirst({ where: { domain, toolName } });
}
