import { z } from "zod";

export const recordOutcomeSchema = z.object({
  decisionId: z.string().min(1),
  status: z.enum(["EXECUTED", "COMPLETED", "SUCCESSFUL", "FAILED", "UNKNOWN"]),
  outcome: z.string().trim().max(2000).optional(),
});

export type RecordOutcomeInput = z.infer<typeof recordOutcomeSchema>;

export const evaluateOutcomeSchema = z.object({
  decisionId: z.string().min(1),
});

export type EvaluateOutcomeInput = z.infer<typeof evaluateOutcomeSchema>;
