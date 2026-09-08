import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { getDecisionForOrganization } from "@/server/intelligence/decision/service";
import { recordAuditLog } from "@/server/audit/audit-log";

const schema = z.object({});

registerTool({
  name: "get_next_best_action",
  description:
    "Get the organization's single top-priority recommendation right now, ranked across every open risk and " +
    "active opportunity by severity-weighted dollar exposure. Purely advisory — it explains what matters most " +
    "and why, it does not take any action itself. Use this when asked what to focus on or do next.",
  schema,
  requiredPermission: { decision: ["read"] },
  domain: "crm",
  mutationCategory: "read_only",
  async handler(_input, ctx) {
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      actorType: "ai",
      action: "decision.ai_viewed",
      targetType: "organization",
      targetId: ctx.organizationId,
      metadata: { conversationId: ctx.conversationId },
    });

    const decision = await getDecisionForOrganization(ctx.organizationId);
    if (!decision) {
      return { hasDecision: false as const };
    }

    return {
      hasDecision: true as const,
      recommendation: decision.recommendation,
      rationale: decision.rationale,
      sourceType: decision.sourceType,
      sourceId: decision.sourceId,
      priorityScore: Number(decision.priorityScore),
      detectedAt: decision.detectedAt.toISOString(),
    };
  },
});
