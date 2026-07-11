import "server-only";

import { AI_CONFIG } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { ChatMessage, MembershipContext } from "@/types";

import { buildSystemPrompt } from "./prompts";

/**
 * Build the full message array for the AI provider.
 *
 * Strategy:
 * 1. System prompt with org/user context
 * 2. Conversation history (newest first, trimmed to budget)
 * 3. The new user message
 *
 * Extension point: `moduleContexts` allows future modules to inject
 * their own context (e.g. recent tasks, upcoming meetings).
 */
export async function buildContext(params: {
  conversationId: string;
  newMessage: string;
  membership: MembershipContext;
  moduleContexts?: string[];
}): Promise<ChatMessage[]> {
  const { conversationId, newMessage, membership, moduleContexts } = params;

  // Fetch org member count for context
  const memberCount = await prisma.member.count({
    where: { organizationId: membership.organizationId },
  });

  // System prompt
  const systemPrompt = buildSystemPrompt(
    membership,
    memberCount,
    moduleContexts
  );

  // Fetch conversation history
  const historyMessages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: AI_CONFIG.maxConversationHistory,
    select: {
      role: true,
      content: true,
    },
  });

  // Reverse to chronological order
  const history: ChatMessage[] = historyMessages.reverse().map((m: { role: string; content: string }) => ({
    role: m.role.toLowerCase() as ChatMessage["role"],
    content: m.content,
  }));

  return [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: newMessage },
  ];
}
