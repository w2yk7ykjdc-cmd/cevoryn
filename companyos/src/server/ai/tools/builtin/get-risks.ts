import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { listRisks } from "@/server/intelligence/risk/service";
import { recordAuditLog } from "@/server/audit/audit-log";

const schema = z.object({
  status: z
    .enum(["open", "resolved", "dismissed"])
    .optional()
    .describe("Filter to risks in this status. Omit to return risks in any status."),
  limit: z.number().int().min(1).max(50).optional().describe("Max risks to return. Defaults to 20."),
});

registerTool({
  name: "get_risks",
  description:
    "List the organization's current business risks — e.g. a paid subscription that's past due or otherwise " +
    "unhealthy — ordered by severity. Each risk includes its explanation, potential dollar loss, and the " +
    "entity it relates to. Risks auto-resolve once their underlying condition clears. Use this to answer " +
    "questions about what could hurt the business if left unaddressed.",
  schema,
  requiredPermission: { risk: ["read"] },
  domain: "crm",
  mutationCategory: "read_only",
  async handler(input, ctx) {
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      actorType: "ai",
      action: "risk.ai_viewed",
      targetType: "organization",
      targetId: ctx.organizationId,
      metadata: { conversationId: ctx.conversationId },
    });

    const { risks } = await listRisks({
      organizationId: ctx.organizationId,
      status: input.status,
      limit: input.limit ?? 20,
    });

    return {
      risks: risks.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        description: r.description,
        severity: r.severity,
        confidence: r.confidence,
        potentialLoss: Number(r.potentialLoss),
        explanation: r.explanation,
        relatedEntityType: r.relatedEntityType,
        relatedEntityId: r.relatedEntityId,
        status: r.status,
        detectedAt: r.detectedAt.toISOString(),
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      })),
    };
  },
});
