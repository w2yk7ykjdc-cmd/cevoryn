import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { listLeads } from "@/server/leads/service";
import { recordAuditLog } from "@/server/audit/audit-log";

const schema = z.object({
  query: z.string().optional().describe("Free-text search over lead titles."),
  stageId: z.string().optional().describe("Filter to a specific pipeline stage id."),
  limit: z.number().int().min(1).max(25).default(10),
});

registerTool({
  name: "search_leads",
  description:
    "Search the organization's leads by title and/or pipeline stage. Use this to answer broad " +
    "questions about the pipeline (e.g. 'what leads are in Proposal?') or to find a lead's id " +
    "before calling get_lead or analyze_lead.",
  schema,
  requiredPermission: { lead: ["read"] },
  async handler(input, ctx) {
    const { leads } = await listLeads({
      organizationId: ctx.organizationId,
      query: input.query,
      stageId: input.stageId,
      limit: input.limit,
    });

    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      actorType: "ai",
      action: "lead.ai_searched",
      targetType: "lead",
      targetId: input.stageId ?? "search",
      metadata: { conversationId: ctx.conversationId, query: input.query ?? null, resultCount: leads.length },
    });

    return {
      results: leads.map((lead) => ({
        id: lead.id,
        title: lead.title,
        value: Number(lead.value),
        probability: lead.probability,
        stage: lead.stage.name,
        company: lead.company?.name ?? null,
        contact: lead.contact ? `${lead.contact.firstName} ${lead.contact.lastName}` : null,
      })),
    };
  },
});
