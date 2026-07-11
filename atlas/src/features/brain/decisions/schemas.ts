import { z } from "zod";

export const createDecisionSchema = z.object({
  problemDescription: z
    .string()
    .trim()
    .min(10, "Problem description must be at least 10 characters")
    .max(2000),
  sourceInsightId: z.string().optional(),
});

export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;

export const updateDecisionStatusSchema = z.object({
  status: z.enum(["ACCEPTED", "REJECTED", "IGNORED", "COMPLETED"]),
  outcome: z.string().trim().max(2000).optional(),
});

export type UpdateDecisionStatusInput = z.infer<
  typeof updateDecisionStatusSchema
>;
