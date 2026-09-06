import { z } from "zod";

export const updateEventStatusSchema = z.object({
  status: z.enum(["ANALYZED", "DISMISSED"]),
});

export type UpdateEventStatusInput = z.infer<typeof updateEventStatusSchema>;
