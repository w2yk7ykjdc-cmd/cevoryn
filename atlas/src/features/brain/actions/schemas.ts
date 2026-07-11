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

export type UpdateActionStatusInput = z.infer<
  typeof updateActionStatusSchema
>;
