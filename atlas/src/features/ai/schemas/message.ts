import { z } from "zod";

import { AI_CONFIG } from "@/lib/constants";

export const sendMessageSchema = z.object({
  conversationId: z.string().min(1),
  content: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(AI_CONFIG.maxMessageLength, "Message is too long"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
