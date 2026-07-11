import { z } from "zod";

export const briefTypes = ["DAILY", "WEEKLY"] as const;

export const generateBriefSchema = z.object({
  type: z.enum(briefTypes).default("DAILY"),
});

export type GenerateBriefInput = z.infer<typeof generateBriefSchema>;
