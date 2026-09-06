import { z } from "zod";

const stringList = z.array(z.string().trim().min(1)).max(50).default([]);

export const upsertCompanyProfileSchema = z.object({
  description: z.string().trim().max(2000).default(""),
  industry: z.string().trim().max(200).nullable().optional(),
  products: stringList,
  services: stringList,
  targetMarkets: stringList,
  targetCustomers: z.string().trim().max(1000).default(""),
  idealCustomerProfile: z.string().trim().max(1000).default(""),
  geographies: stringList,
  competitors: stringList,
  suppliers: stringList,
  businessModel: z.string().trim().max(1000).default(""),
  averageDealSize: z.number().positive().nullable().optional(),
  strategicGoals: stringList,
  strategicPriorities: stringList,
  capabilities: stringList,
  constraints: stringList,
});

export type UpsertCompanyProfileInput = z.infer<
  typeof upsertCompanyProfileSchema
>;
