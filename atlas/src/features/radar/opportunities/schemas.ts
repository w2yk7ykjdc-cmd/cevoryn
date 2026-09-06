import { z } from "zod";

export const updateOpportunityStatusSchema = z.object({
  status: z.enum([
    "REVIEWING",
    "QUALIFIED",
    "ACTED_ON",
    "WON",
    "LOST",
    "DISMISSED",
  ]),
});

export type UpdateOpportunityStatusInput = z.infer<
  typeof updateOpportunityStatusSchema
>;
