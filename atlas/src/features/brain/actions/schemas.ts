import { z } from "zod";

export const actionTypes = [
  "EMAIL_DRAFT",
  "TASK",
  "CALENDAR_PROPOSAL",
  "FOLLOW_UP",
] as const;

export const actionStatuses = ["PENDING", "APPROVED", "DISMISSED"] as const;

export const updateActionStatusSchema = z.object({
  status: z.enum(["APPROVED", "DISMISSED"]),
});

export type UpdateActionStatusInput = z.infer<typeof updateActionStatusSchema>;

export const actionExecutionChannels = [
  "MAILTO",
  "CLIPBOARD",
  "GOOGLE_EMAIL_DRAFT",
  "GOOGLE_CALENDAR_EVENT",
  "RESEARCH_WORKER",
] as const;

export const recordActionExecutionSchema = z.object({
  channel: z.enum(actionExecutionChannels),
  status: z.enum(["COMPLETED", "FAILED"]).default("COMPLETED"),
  error: z.string().trim().max(500).optional(),
});

export type RecordActionExecutionInput = z.infer<
  typeof recordActionExecutionSchema
>;
