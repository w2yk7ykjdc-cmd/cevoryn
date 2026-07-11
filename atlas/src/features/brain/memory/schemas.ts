import { z } from "zod";

export const memoryCategories = [
  "DECISION",
  "PREFERENCE",
  "TEAM_DYNAMIC",
  "PROJECT_STATUS",
  "PROCESS",
  "GOAL",
  "FACT",
] as const;

export const createMemorySchema = z.object({
  category: z.enum(memoryCategories),
  content: z.string().trim().min(1).max(2000),
});

export type CreateMemoryInput = z.infer<typeof createMemorySchema>;

export const updateMemorySchema = z.object({
  id: z.string().min(1),
  content: z.string().trim().min(1).max(2000).optional(),
  category: z.enum(memoryCategories).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;

export const searchMemorySchema = z.object({
  query: z.string().trim().min(1).max(500).optional(),
  category: z.enum(memoryCategories).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export type SearchMemoryInput = z.infer<typeof searchMemorySchema>;
