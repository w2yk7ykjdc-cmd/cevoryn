import { z } from "zod";

export const watchReasons = [
  "PROSPECT",
  "CUSTOMER",
  "COMPETITOR",
  "SUPPLIER",
  "OTHER",
] as const;

export const createExternalEntitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(200).nullable().optional(),
  industry: z.string().trim().max(200).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  watchReason: z.enum(watchReasons),
  /** e.g. { greenhouseToken: "acme" } to enable the Jobs adapter for this entity. */
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CreateExternalEntityInput = z.infer<
  typeof createExternalEntitySchema
>;

export const updateExternalEntitySchema = z.object({
  domain: z.string().trim().max(200).nullable().optional(),
  industry: z.string().trim().max(200).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  watchReason: z.enum(watchReasons).optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateExternalEntityInput = z.infer<
  typeof updateExternalEntitySchema
>;
