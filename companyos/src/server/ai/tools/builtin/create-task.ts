import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { createTask } from "@/server/tasks/service";
import { TaskAssigneeReferenceError, TaskLeadReferenceError } from "@/server/tasks/types";

const schema = z.object({
  title: z.string().min(1).max(200).describe("A short, actionable task title."),
  description: z.string().max(2000).optional().describe("Optional additional detail."),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  dueDate: z
    .string()
    .optional()
    .describe("ISO 8601 date the task is due, e.g. 2026-08-15. Omit if there is no specific due date."),
  leadId: z.string().optional().describe("Link this task to a lead, if the task is about a specific lead."),
});

registerTool({
  name: "create_task",
  description:
    "Create a follow-up task, assigned to the person who is chatting with you. Use this to act on " +
    "a suggested next action from analyze_lead, or whenever the user asks you to create a task or " +
    "schedule a follow-up. If the task relates to a lead, pass leadId so it shows up on that lead's " +
    "timeline.",
  schema,
  requiredPermission: { task: ["create"] },
  domain: "crm",
  mutationCategory: "mutating_gated",
  blastRadius: "additive",
  autonomyEligible: false,
  async handler(input, ctx) {
    try {
      const task = await createTask({
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        actorType: "ai",
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        assigneeId: ctx.userId,
        leadId: input.leadId ?? null,
      });

      return {
        created: true as const,
        taskId: task.id,
        title: task.title,
        dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      };
    } catch (err) {
      if (err instanceof TaskLeadReferenceError || err instanceof TaskAssigneeReferenceError) {
        return { created: false as const, error: err.message };
      }
      throw err;
    }
  },
});
