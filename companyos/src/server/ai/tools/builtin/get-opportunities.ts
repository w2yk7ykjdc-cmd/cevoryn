import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { listOpportunities } from "@/server/intelligence/opportunity/service";
import { recordAuditLog } from "@/server/audit/audit-log";

const schema = z.object({
  status: z
    .enum(["new", "reviewed", "acted", "dismissed", "expired"])
    .optional()
    .describe("Filter to opportunities in this status. Omit to return opportunities in any status."),
  limit: z.number().int().min(1).max(50).optional().describe("Max opportunities to return. Defaults to 20."),
});

registerTool({
  name: "get_opportunities",
  description:
    "List the organization's current business opportunities — e.g. high-value leads that have stalled and " +
    "need re-engagement — ordered by priority score. Each opportunity includes its explanation, potential " +
    "dollar impact, urgency, and the entity it relates to. Use this to answer questions about what to act on next.",
  schema,
  requiredPermission: { opportunity: ["read"] },
  async handler(input, ctx) {
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      actorType: "ai",
      action: "opportunity.ai_viewed",
      targetType: "organization",
      targetId: ctx.organizationId,
      metadata: { conversationId: ctx.conversationId },
    });

    const { opportunities } = await listOpportunities({
      organizationId: ctx.organizationId,
      status: input.status,
      limit: input.limit ?? 20,
    });

    return {
      opportunities: opportunities.map((o) => ({
        id: o.id,
        type: o.type,
        title: o.title,
        description: o.description,
        score: o.score,
        confidence: o.confidence,
        potentialImpact: Number(o.potentialImpact),
        effort: o.effort,
        urgency: o.urgency,
        risk: o.risk,
        explanation: o.explanation,
        relatedEntityType: o.relatedEntityType,
        relatedEntityId: o.relatedEntityId,
        status: o.status,
        detectedAt: o.detectedAt.toISOString(),
      })),
    };
  },
});
