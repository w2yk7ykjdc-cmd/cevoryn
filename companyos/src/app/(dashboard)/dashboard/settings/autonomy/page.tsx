import { requirePermission } from "@/server/auth/session";
import { getOrCreatePolicy } from "@/server/ai/autonomy/policy-service";
import { AutonomyClient } from "@/app/(dashboard)/dashboard/settings/autonomy/autonomy-client";

const DOMAIN = "crm";

export default async function AutonomyPage() {
  const { organization } = await requirePermission({ autonomyPolicy: ["read"] });
  const policy = await getOrCreatePolicy(organization.id, DOMAIN);

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
        initialPolicy={{
          level: policy.level,
          dailyActionLimit: policy.dailyActionLimit,
          dailyRiskLimit: Number(policy.dailyRiskLimit),
          perActionRiskLimit: Number(policy.perActionRiskLimit),
          killSwitchEngaged: policy.killSwitchEngaged,
        }}
      />
    </div>
  );
}
