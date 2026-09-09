import { getTenantScopedClient } from "@/server/db/tenant";
import { recordExecutionAudit } from "@/server/execution/audit";

/**
 * Sprint 25: the explicit, per-organization autonomy GATE for CONTROLLED
 * AUTONOMOUS EXECUTION. This is deliberately narrow and additive -- it sits
 * strictly ON TOP of, and can never loosen, two things that already exist
 * and stay completely unchanged:
 *
 *  - `env.LIVE_EXECUTION_ENABLED` (Sprint 22): the deployment-wide master
 *    switch. There is still no app-level write path to it -- only an
 *    operator, in the environment, outside the running application. This
 *    gate can be `enabled: true` for every organization in a deployment and
 *    NOTHING will ever submit while that flag stays `false`.
 *  - `AutonomyPolicy.killSwitchEngaged` for the "market" domain (Sprint 19):
 *    the kill switch, checked unconditionally inside
 *    `validation.ts#validateForLiveExecution` regardless of this row --
 *    always supreme, never bypassable by anything this module does.
 *
 * This row answers exactly one question: has a human at THIS organization
 * explicitly opted in to the autonomous-execution background job
 * (`autonomous-execution.ts`) ever attempting a submission for it? No row,
 * or `enabled: false`, means the orchestrator skips this organization
 * entirely -- the same lazy-default-off-and-tenant-scoped shape
 * `risk-policy.ts#getOrganizationRiskPolicy`/`org-credentials.ts` already
 * established; no RBAC assertion is made inside this module itself,
 * mirroring `risk-policy.ts#setOrganizationRiskPolicy`'s own precedent
 * (permission enforcement belongs to whatever server action/route calls
 * this, not to the execution module).
 */

export type ExecutionAutonomyStatus = {
  enabled: boolean;
  enabledAt: Date | null;
  enabledById: string | null;
  disabledAt: Date | null;
  disabledById: string | null;
};

const DISABLED_STATUS: ExecutionAutonomyStatus = { enabled: false, enabledAt: null, enabledById: null, disabledAt: null, disabledById: null };

/** Tenant-scoped; a nonexistent row means "never enabled," never an error. */
export async function getExecutionAutonomyStatus(organizationId: string): Promise<ExecutionAutonomyStatus> {
  const scoped = getTenantScopedClient(organizationId);
  const row = await scoped.organizationExecutionAutonomyPolicy.findUnique({ where: { organizationId } });
  if (!row) return DISABLED_STATUS;
  return { enabled: row.enabled, enabledAt: row.enabledAt, enabledById: row.enabledById, disabledAt: row.disabledAt, disabledById: row.disabledById };
}

/**
 * The single, cheap, pure-read function `autonomous-execution.ts` calls per
 * organization per pass -- defaults to `false` exactly like
 * `policy-service.ts#isKillSwitchEngaged`'s own identical "no row = safe
 * default, never a write" discipline.
 */
export async function isAutonomousExecutionEnabled(organizationId: string): Promise<boolean> {
  return (await getExecutionAutonomyStatus(organizationId)).enabled;
}

export type EnableAutonomousExecutionInput = { organizationId: string; actorId: string };

export async function enableAutonomousExecution(input: EnableAutonomousExecutionInput): Promise<ExecutionAutonomyStatus> {
  const { organizationId, actorId } = input;
  const scoped = getTenantScopedClient(organizationId);
  const now = new Date();

  const row = await scoped.organizationExecutionAutonomyPolicy.upsert({
    where: { organizationId },
    create: { organizationId, enabled: true, enabledById: actorId, enabledAt: now },
    update: { enabled: true, enabledById: actorId, enabledAt: now },
  });

  await recordExecutionAudit({ organizationId, action: "execution.autonomy_enabled", clientOrderId: organizationId, symbol: "n/a" });

  return { enabled: row.enabled, enabledAt: row.enabledAt, enabledById: row.enabledById, disabledAt: row.disabledAt, disabledById: row.disabledById };
}

export type DisableAutonomousExecutionInput = { organizationId: string; actorId: string; reason?: string };

/**
 * The human-override / emergency-stop path for the AUTONOMOUS pathway
 * SPECIFICALLY -- distinct from, and narrower than, the kill switch (which
 * blocks every new live submission regardless of source, including a
 * manually-triggered one). Disabling this gate only ever stops
 * `autonomous-execution.ts` from attempting any FURTHER decision for this
 * organization from its next scheduled pass onward: it never touches an
 * order already submitted, and never cancels or closes anything -- that
 * remains `position-management.ts`'s own separate, always-available,
 * kill-switch-exempt path, unchanged. Idempotent: disabling an
 * already-disabled (or never-enabled) organization is a safe no-op write,
 * not an error, and still records an audit row (a human's explicit
 * "make sure this is off" action is worth auditing even if it changed
 * nothing).
 */
export async function disableAutonomousExecution(input: DisableAutonomousExecutionInput): Promise<ExecutionAutonomyStatus> {
  const { organizationId, actorId, reason } = input;
  const scoped = getTenantScopedClient(organizationId);
  const now = new Date();

  const row = await scoped.organizationExecutionAutonomyPolicy.upsert({
    where: { organizationId },
    create: { organizationId, enabled: false, disabledById: actorId, disabledAt: now },
    update: { enabled: false, disabledById: actorId, disabledAt: now },
  });

  await recordExecutionAudit({
    organizationId,
    action: "execution.autonomy_disabled",
    clientOrderId: organizationId,
    symbol: "n/a",
    metadata: reason ? { reason } : null,
  });

  return { enabled: row.enabled, enabledAt: row.enabledAt, enabledById: row.enabledById, disabledAt: row.disabledAt, disabledById: row.disabledById };
}
