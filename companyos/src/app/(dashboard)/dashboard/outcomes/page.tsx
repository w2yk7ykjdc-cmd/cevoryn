import { requirePermission } from "@/server/auth/session";
import { listOutcomes } from "@/server/intelligence/outcome/service";
import { OutcomesClient } from "@/app/(dashboard)/dashboard/outcomes/outcomes-client";

export default async function OutcomesPage() {
  const { organization } = await requirePermission({ outcome: ["read"] });
  const { outcomes } = await listOutcomes({ organizationId: organization.id, limit: 50 });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Outcomes</h1>
        <p className="text-sm text-muted-foreground">
          What actually happened after a Decision, Opportunity, Risk, or autonomous action -- the data foundation
          for learning whether CompanyOS&apos;s recommendations and controlled autonomous actions are actually
          working. A pending row has no evidence yet; that is never the same as a failure.
        </p>
      </div>
      <OutcomesClient
        initialOutcomes={outcomes.map((o) => ({
          id: o.id,
          relatedEntityType: o.relatedEntityType,
          relatedEntityId: o.relatedEntityId,
          ruleName: o.ruleName,
          ruleVersion: o.ruleVersion,
          evaluationStatus: o.evaluationStatus,
          outcomeType: o.outcomeType,
          source: o.source,
          confidence: o.confidence,
          createdAt: o.createdAt.toISOString(),
          observedAt: o.observedAt ? o.observedAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
