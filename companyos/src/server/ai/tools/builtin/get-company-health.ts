import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { getLatestHealthSnapshot } from "@/server/intelligence/health/service";
import {
  SALES_HEALTH_RULE_VERSION,
  computeSalesHealthEvidence,
  computeSalesHealthScore,
} from "@/server/intelligence/health/sales-health";
import { recordAuditLog } from "@/server/audit/audit-log";

const schema = z.object({});

registerTool({
  name: "get_company_health",
  description:
    "Get the organization's current Sales Health score (0-100) and the evidence behind it: how many open " +
    "leads are high/medium/low risk, overdue task count, and average days since last activity. Use this to " +
    "answer questions about overall pipeline health rather than one specific lead.",
  schema,
  requiredPermission: { companyHealth: ["read"] },
  domain: "crm",
  mutationCategory: "read_only",
  async handler(_input, ctx) {
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      actorType: "ai",
      action: "company_health.ai_viewed",
      targetType: "organization",
      targetId: ctx.organizationId,
      metadata: { conversationId: ctx.conversationId },
    });

    const latest = await getLatestHealthSnapshot(ctx.organizationId);
    if (latest) {
      return {
        salesHealthScore: latest.salesHealthScore,
        evidence: latest.evidence,
        ruleVersion: latest.ruleVersion,
        computedAt: latest.computedAt.toISOString(),
        source: "snapshot" as const,
      };
    }

    // No recurring job has run for this org yet (e.g. it was just created) —
    // this tool is read-only, so compute the score for this response
    // without persisting a snapshot; the next scheduled job run will.
    const evidence = await computeSalesHealthEvidence(ctx.organizationId);
    const salesHealthScore = computeSalesHealthScore(evidence);
    return {
      salesHealthScore,
      evidence,
      ruleVersion: SALES_HEALTH_RULE_VERSION,
      computedAt: new Date().toISOString(),
      source: "computed_on_demand" as const,
    };
  },
});
