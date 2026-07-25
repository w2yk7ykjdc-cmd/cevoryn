import { z } from "zod";

import { BILLING_PLANS } from "@/features/billing/config/plans";

export const checkoutRequestSchema = z.object({
  plan: z.enum(BILLING_PLANS),
});

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
