import { z } from "zod";

import { CONVERSATION_CONFIG } from "@/lib/constants";

export const createConversationSchema = z.object({
  title: z.string().trim().max(CONVERSATION_CONFIG.maxTitleLength).optional(),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const renameConversationSchema = z.object({
  id: z.string().min(1),
  title: z
    .string()
    .trim()
    .min(1, "Title cannot be empty")
    .max(CONVERSATION_CONFIG.maxTitleLength),
});

export type RenameConversationInput = z.infer<typeof renameConversationSchema>;

export const deleteConversationSchema = z.object({
  id: z.string().min(1),
});

export type DeleteConversationInput = z.infer<typeof deleteConversationSchema>;
