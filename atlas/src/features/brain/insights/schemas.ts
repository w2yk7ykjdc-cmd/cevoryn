import { z } from "zod";

export const insightCategories = [
  "STRATEGIC",
  "OPERATIONAL",
  "TEAM",
  "FINANCIAL",
  "RISK",
] as const;

export const insightSeverities = [
  "INFO",
  "SUGGESTION",
  "WARNING",
  "CRITICAL",
] as const;

export const insightStatuses = [
  "NEW",
  "ACKNOWLEDGED",
  "ACTED_ON",
  "DISMISSED",
] as const;

export const updateInsightStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(insightStatuses),
});

export type UpdateInsightStatusInput = z.infer<
  typeof updateInsightStatusSchema
>;

export const generateInsightsSchema = z.object({
  since: z.string().datetime().optional(),
});

export type GenerateInsightsInput = z.infer<typeof generateInsightsSchema>;
