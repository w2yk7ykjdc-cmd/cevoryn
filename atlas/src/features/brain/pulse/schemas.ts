import { z } from "zod";

export const pulsePeriods = ["DAILY", "WEEKLY"] as const;

export const getPulseSchema = z.object({
  period: z.enum(pulsePeriods).default("DAILY"),
});

export type GetPulseInput = z.infer<typeof getPulseSchema>;
