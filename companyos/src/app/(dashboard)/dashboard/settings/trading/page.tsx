import { headers as nextHeaders } from "next/headers";
import { auth } from "@/server/auth/auth";
import { requirePermission } from "@/server/auth/session";
import { getOrCreatePolicy } from "@/server/ai/autonomy/policy-service";
import { getExecutionAutonomyStatus } from "@/server/execution/autonomy-gate";
import { getOrganizationRiskPolicy, RISK_POLICY_FIELD_KEYS } from "@/server/execution/risk-policy";
import { listOrganizationCredentialStatuses } from "@/server/execution/org-credentials";
import { SUPPORTED_EXECUTION_PROVIDERS } from "@/server/execution/providers";
import { listStrategyHealth } from "@/server/intelligence/learning/strategy-health";
import { TradingClient } from "@/app/(dashboard)/dashboard/settings/trading/trading-client";

const MARKET_DOMAIN = "market";

async function checkPermission(organizationId: string, headers: Headers, resource: string, action: string): Promise<boolean> {
  const result = await auth.api.hasPermission({ headers, body: { organizationId, permissions: { [resource]: [action] } } });
  return result.success;
}

/**
 * Sprint 28: the human-only control plane for live/autonomous market
 * execution. Every value shown here is read directly from a Sprint
 * 19/24/25/26/27 service that already existed, was already fully tested,
 * and was already RBAC-gated -- this page and its actions.ts are the FIRST
 * UI surface for any of them; no new state, no new formula, no second
 * system. Gated on `riskPolicy:read`, the one permission every role
 * (including viewer) already holds; each card below independently checks
 * its own resource's permissions and renders read-only or hides entirely
 * for a role that lacks them.
 */
export default async function TradingControlsPage() {
  const { organization } = await requirePermission({ riskPolicy: ["read"] });
  const headers = await nextHeaders();

  const [
    canReadAutonomyPolicy,
    canEngageKillSwitch,
    canManageAutonomyPolicy,
    canReadExecutionAutonomy,
    canManageExecutionAutonomy,
    canManageRiskPolicy,
    canReadCredentials,
    canManageCredentials,
    canRevokeCredentials,
    canReadStrategyHealth,
    canManageStrategyHealth,
  ] = await Promise.all([
    checkPermission(organization.id, headers, "autonomyPolicy", "read"),
    checkPermission(organization.id, headers, "autonomyPolicy", "kill_switch"),
    checkPermission(organization.id, headers, "autonomyPolicy", "manage"),
    checkPermission(organization.id, headers, "executionAutonomy", "read"),
    checkPermission(organization.id, headers, "executionAutonomy", "manage"),
    checkPermission(organization.id, headers, "riskPolicy", "manage"),
    checkPermission(organization.id, headers, "executionCredential", "read"),
    checkPermission(organization.id, headers, "executionCredential", "manage"),
    checkPermission(organization.id, headers, "executionCredential", "revoke"),
    checkPermission(organization.id, headers, "strategyHealth", "read"),
    checkPermission(organization.id, headers, "strategyHealth", "manage"),
  ]);

  const [marketPolicy, executionAutonomy, riskPolicy, credentialStatuses, strategyHealthRows] = await Promise.all([
    canReadAutonomyPolicy ? getOrCreatePolicy(organization.id, MARKET_DOMAIN) : null,
    canReadExecutionAutonomy ? getExecutionAutonomyStatus(organization.id) : null,
    getOrganizationRiskPolicy(organization.id),
    canReadCredentials ? listOrganizationCredentialStatuses(organization.id) : [],
    canReadStrategyHealth ? listStrategyHealth(organization.id) : [],
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trading Controls</h1>
        <p className="text-sm text-muted-foreground">
          The human-only control plane for live and autonomous market execution — kill switch, autonomy gate, risk
          limits, exchange credentials, and strategy health. No AI tool can read or change anything on this page.
        </p>
      </div>

      <TradingClient
        supportedProviders={[...SUPPORTED_EXECUTION_PROVIDERS]}
        riskPolicyFieldKeys={[...RISK_POLICY_FIELD_KEYS]}
        marketKillSwitch={
          canReadAutonomyPolicy && marketPolicy
            ? { engaged: marketPolicy.killSwitchEngaged, canEngage: canEngageKillSwitch, canDisengage: canManageAutonomyPolicy }
            : null
        }
        executionAutonomy={
          canReadExecutionAutonomy && executionAutonomy
            ? {
                enabled: executionAutonomy.enabled,
                enabledAt: executionAutonomy.enabledAt,
                disabledAt: executionAutonomy.disabledAt,
                canManage: canManageExecutionAutonomy,
              }
            : null
        }
        riskPolicy={{ values: riskPolicy, canManage: canManageRiskPolicy }}
        credentials={
          canReadCredentials
            ? {
                statuses: credentialStatuses.map((s) => ({
                  provider: s.provider,
                  configured: s.configured,
                  fingerprint: s.fingerprint,
                  rotatedAt: s.rotatedAt,
                  revokedAt: s.revokedAt,
                })),
                canManage: canManageCredentials,
                canRevoke: canRevokeCredentials,
              }
            : null
        }
        strategyHealth={
          canReadStrategyHealth
            ? {
                rows: strategyHealthRows.map((r) => ({
                  strategyType: r.strategyType,
                  status: r.status,
                  evaluationScoreAtLastCheck: r.evaluationScoreAtLastCheck,
                  reason: r.reason,
                  lastCheckedAt: r.lastCheckedAt,
                })),
                canManage: canManageStrategyHealth,
              }
            : null
        }
      />
    </div>
  );
}
