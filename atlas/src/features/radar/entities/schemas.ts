import { z } from "zod";

export const watchReasons = [
  "PROSPECT",
  "CUSTOMER",
  "COMPETITOR",
  "SUPPLIER",
  "OTHER",
] as const;

const tagsField = z.array(z.string().trim().min(1).max(50)).max(20).default([]);

export const createExternalEntitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(200).nullable().optional(),
  industry: z.string().trim().max(200).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  watchReason: z.enum(watchReasons),
  priority: z.number().int().min(1).max(10).default(5),
  tags: tagsField,
  notes: z.string().trim().max(2000).default(""),
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
  isPaused: z.boolean().optional(),
  priority: z.number().int().min(1).max(10).optional(),
  tags: tagsField.optional(),
  notes: z.string().trim().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateExternalEntityInput = z.infer<
  typeof updateExternalEntitySchema
>;
