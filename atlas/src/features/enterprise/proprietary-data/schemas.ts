import { z } from "zod";

export const proprietaryDataSourceKinds = [
  "DOCUMENT_STORE",
  "CRM",
  "ERP",
  "INTERNAL_API",
  "KNOWLEDGE_BASE",
] as const;

const tagsField = z.array(z.string().trim().min(1).max(50)).max(20).default([]);

export const createProprietaryDataRecordSchema = z.object({
  sourceKind: z.enum(proprietaryDataSourceKinds).default("KNOWLEDGE_BASE"),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20_000),
  url: z.string().trim().url().max(500).nullable().optional(),
  tags: tagsField,
});

export type CreateProprietaryDataRecordInput = z.infer<
  typeof createProprietaryDataRecordSchema
>;

export const updateProprietaryDataRecordSchema = z.object({
  sourceKind: z.enum(proprietaryDataSourceKinds).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(20_000).optional(),
  url: z.string().trim().url().max(500).nullable().optional(),
  tags: tagsField.optional(),
});

export type UpdateProprietaryDataRecordInput = z.infer<
  typeof updateProprietaryDataRecordSchema
>;
