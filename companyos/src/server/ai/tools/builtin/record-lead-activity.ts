import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { addLeadActivity } from "@/server/leads/service";
import { recordAuditLog } from "@/server/audit/audit-log";
import { LeadNotFoundError } from "@/server/leads/types";

const schema = z.object({
  leadId: z.string().min(1),
  type: z
    .enum(["ai_note", "ai_analysis"])
    .describe("ai_analysis for a full analysis writeup, ai_note for a shorter observation."),
  body: z.string().min(1).max(4000).describe("The note or analysis text to add to the lead's timeline."),
});

registerTool({
  name: "record_lead_activity",
  description:
    "Append a note or analysis writeup to a lead's activity timeline, visible to the whole team. " +
    "Use this to persist a lead summary or the findings from analyze_lead so people don't have to " +
    "re-ask you — it does not create a task or change the lead's stage.",
  schema,
  requiredPermission: { lead: ["update"] },
  async handler(input, ctx) {
    try {
      const activity = await addLeadActivity({
        organizationId: ctx.organizationId,
        leadId: input.leadId,
        type: input.type,
        body: input.body,
        actorId: null, // authored by the AI, not the human in the conversation
      });

      await recordAuditLog({
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        actorType: "ai",
        action: "lead.ai_activity_recorded",
        targetType: "lead",
        targetId: input.leadId,
        metadata: { conversationId: ctx.conversationId, activityId: activity.id, type: input.type },
      });

      return { recorded: true as const, activityId: activity.id };
    } catch (err) {
      if (err instanceof LeadNotFoundError) {
        return { recorded: false as const, error: err.message };
      }
      throw err;
    }
  },
});
