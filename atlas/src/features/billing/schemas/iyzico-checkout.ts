import { z } from "zod";

import { BILLING_PLANS } from "@/features/billing/config/plans";

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{9,14}$/, "Telefon numarası ülke koduyla girilmelidir.");

const addressSchema = z.object({
  address: z.string().trim().min(10).max(500),
  zipCode: z.string().trim().min(3).max(20),
  city: z.string().trim().min(2).max(100),
  country: z.string().trim().min(2).max(100).default("Türkiye"),
});

export const iyzicoCheckoutRequestSchema = z.object({
  plan: z.enum(BILLING_PLANS),
  customer: z.object({
    name: z.string().trim().min(2).max(100),
    surname: z.string().trim().min(2).max(100),
    gsmNumber: phoneSchema,
    identityNumber: z.string().trim().regex(/^\d{10,11}$/, "Kimlik/vergi numarası 10 veya 11 haneli olmalıdır."),
    billingAddress: addressSchema,
  }),
});

export type IyzicoCheckoutRequest = z.infer<typeof iyzicoCheckoutRequestSchema>;
