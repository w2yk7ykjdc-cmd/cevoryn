import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { getLead } from "@/server/leads/service";
import { recordAuditLog } from "@/server/audit/audit-log";

const schema = z.object({
  leadId: z.string().min(1).describe("The id of the lead to fetch."),
});

registerTool({
  name: "get_lead",
  description:
    "Fetch full details for a lead: stage, value, probability, source, linked company/contact, " +
    "recent activity timeline, and open tasks. Use this before answering any question about a " +
    "specific lead or before deciding on a next action.",
  schema,
  requiredPermission: { lead: ["read"] },
  async handler(input, ctx) {
    const lead = await getLead(ctx.organizationId, input.leadId);
    if (!lead) {
      return { found: false as const };
    }

    // Every AI read of CRM data is itself audit-logged, not just writes.
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      actorType: "ai",
      action: "lead.ai_viewed",
      targetType: "lead",
      targetId: lead.id,
      metadata: { conversationId: ctx.conversationId },
    });

    return {
      found: true as const,
      id: lead.id,
      title: lead.title,
      value: Number(lead.value),
      probability: lead.probability,
      source: lead.source,
      stage: { id: lead.stage.id, name: lead.stage.name, isWon: lead.stage.isWon, isLost: lead.stage.isLost },
      company: lead.company ? { id: lead.company.id, name: lead.company.name } : null,
      contact: lead.contact
        ? { id: lead.contact.id, name: `${lead.contact.firstName} ${lead.contact.lastName}`, email: lead.contact.email }
        : null,
      owner: lead.owner ? { id: lead.owner.id, name: lead.owner.name } : null,
      createdAt: lead.createdAt.toISOString(),
      activities: lead.activities.map((a) => ({
        type: a.type,
        body: a.body,
        createdAt: a.createdAt.toISOString(),
        actor: a.actor?.name ?? null,
      })),
      tasks: lead.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      })),
    };
  },
});
