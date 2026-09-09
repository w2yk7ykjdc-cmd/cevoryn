import { env } from "@/env";
import { isKillSwitchEngaged } from "@/server/ai/autonomy/policy-service";
import { getExecutionAutonomyStatus } from "@/server/execution/autonomy-gate";
import { hasLiveCredentialsFor } from "@/server/execution/org-credentials";
import { DEFAULT_EXECUTION_PROVIDER } from "@/server/execution/providers";

/**
 * Sprint 30: a read-only synthesis of the exact same four pre-flight gates
 * `autonomous-execution.ts#runAutonomousExecutionForOrganization` already
 * checks, in the same order, using the SAME underlying functions -- never a
 * re-implementation or a second, parallel notion of "ready." This exists
 * because Sprint 28's Trading Controls page shows each individual control
 * (kill switch, autonomy gate, credentials) on its own card, but nothing
 * answers the single question an owner actually wants answered before
 * flipping the org-level switch: "is this organization actually ready for
 * controlled autonomous production?"
 *
 * Deliberately stops at the same four gates the orchestrator checks BEFORE
 * ever generating a decision (deployment switch, org opt-in, kill switch,
 * credentials) -- reconciliation health and generated-decision volume are
 * real-time, data-dependent state the orchestrator only evaluates once it
 * is already running, not a "readiness" precondition a human decides on
 * ahead of time. `getReconciliationHealth`/`get_execution_health` already
 * cover ongoing health once an organization is live; this module is
 * strictly the pre-flight checklist, not a duplicate of that surface.
 */

export type ProductionReadinessCheck = {
  key: "live_execution_enabled" | "autonomous_execution_enabled" | "kill_switch_off" | "credentials_configured";
  label: string;
  satisfied: boolean;
  detail: string;
};

export type ProductionReadinessSummary = {
  /** `true` only when every check below is satisfied -- the exact condition under which the orchestrator would proceed past its own first four gates. */
  ready: boolean;
  checks: ProductionReadinessCheck[];
};

export async function computeProductionReadiness(organizationId: string): Promise<ProductionReadinessSummary> {
  const [autonomyStatus, killSwitchEngaged, hasCredentials] = await Promise.all([
    getExecutionAutonomyStatus(organizationId),
    isKillSwitchEngaged(organizationId, "market"),
    hasLiveCredentialsFor(organizationId, DEFAULT_EXECUTION_PROVIDER),
  ]);

  const liveExecutionEnabled = env.LIVE_EXECUTION_ENABLED;

  const checks: ProductionReadinessCheck[] = [
    {
      key: "live_execution_enabled",
      label: "Live execution enabled (deployment-wide)",
      satisfied: liveExecutionEnabled,
      detail: liveExecutionEnabled
        ? "LIVE_EXECUTION_ENABLED is true for this deployment."
        : "LIVE_EXECUTION_ENABLED is false -- set by an operator outside the running application; no organization can override this.",
    },
    {
      key: "autonomous_execution_enabled",
      label: "Autonomous execution enabled for this organization",
      satisfied: autonomyStatus.enabled,
      detail: autonomyStatus.enabled ? "Enabled." : "Not enabled -- an owner can enable it above.",
    },
    {
      key: "kill_switch_off",
      label: "Market kill switch is off",
      satisfied: !killSwitchEngaged,
      detail: killSwitchEngaged ? "Engaged -- blocks every new live submission until an owner disengages it." : "Off.",
    },
    {
      key: "credentials_configured",
      label: "Exchange credentials configured",
      satisfied: hasCredentials,
      detail: hasCredentials
        ? "Configured for this organization (or available via the deployment-wide fallback)."
        : "No credentials configured for this organization, and no deployment-wide fallback is set.",
    },
  ];

  return { ready: checks.every((c) => c.satisfied), checks };
}
