import { requirePermission } from "@/server/auth/session";
import { getOrCreatePolicy, isToolAllowlisted } from "@/server/ai/autonomy/policy-service";
import { AutonomyClient } from "@/app/(dashboard)/dashboard/settings/autonomy/autonomy-client";

const DOMAIN = "crm";
/** Sprint 10's pilot tool — see `actions.ts`'s own doc comment. */
const PILOT_TOOL_NAME = "expire_stale_opportunity";

export default async function AutonomyPage() {
  const { organization } = await requirePermission({ autonomyPolicy: ["read"] });
  const [policy, allowlistEntry] = await Promise.all([
    getOrCreatePolicy(organization.id, DOMAIN),
    isToolAllowlisted(organization.id, DOMAIN, PILOT_TOOL_NAME),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Autonomy</h1>
        <p className="text-sm text-muted-foreground">
          Controls how much the AI may do without a human approving each action, for the CRM domain. Read-only
          lookups are never gated here — this only governs actions that change data.
        </p>
      </div>
      <AutonomyClient
        domain={DOMAIN}
        pilotToolName={PILOT_TOOL_NAME}
        initialPolicy={{
          level: policy.level,
          dailyActionLimit: policy.dailyActionLimit,
          dailyRiskLimit: Number(policy.dailyRiskLimit),
          perActionRiskLimit: Number(policy.perActionRiskLimit),
          killSwitchEngaged: policy.killSwitchEngaged,
        }}
        initialPilotAllowlisted={allowlistEntry !== null}
      />
    </div>
  );
}
