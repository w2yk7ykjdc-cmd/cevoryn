import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { getLead } from "@/server/leads/service";
import { analyzeLead } from "@/server/leads/analysis";
import { recordAuditLog } from "@/server/audit/audit-log";

const schema = z.object({
  leadId: z.string().min(1).describe("The id of the lead to analyze."),
});

registerTool({
  name: "analyze_lead",
  description:
    "Run a deterministic risk analysis on a lead: how long it's been in the pipeline, days since " +
    "the last activity, open/overdue tasks, a risk level, and a suggested next action. Call this " +
    "when asked to analyze a lead, assess its health, or recommend what to do next — then decide " +
    "whether to act on the suggestion (e.g. with create_task) and/or record your findings with " +
    "record_lead_activity.",
  schema,
  requiredPermission: { lead: ["read"] },
  async handler(input, ctx) {
    const lead = await getLead(ctx.organizationId, input.leadId);
    if (!lead) {
      return { found: false as const };
    }

    const analysis = analyzeLead({
      title: lead.title,
      value: Number(lead.value),
      probability: lead.probability,
      createdAt: lead.createdAt,
      stage: { name: lead.stage.name, isWon: lead.stage.isWon, isLost: lead.stage.isLost },
      activities: lead.activities.map((a) => ({ createdAt: a.createdAt })),
      tasks: lead.tasks.map((t) => ({ status: t.status, dueDate: t.dueDate })),
    });

    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      actorType: "ai",
      action: "lead.ai_analyzed",
      targetType: "lead",
      targetId: lead.id,
      metadata: { conversationId: ctx.conversationId, riskLevel: analysis.riskLevel },
    });

    return { found: true as const, leadId: lead.id, leadTitle: lead.title, ...analysis };
  },
});
