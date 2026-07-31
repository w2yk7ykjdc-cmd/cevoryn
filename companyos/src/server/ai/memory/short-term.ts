import { prisma } from "@/server/db/client";
import type { ChatMessage, ToolCall } from "@/server/ai/providers/types";
import type { MessageRole, Prisma } from "@prisma/client";

const DEFAULT_HISTORY_LIMIT = 40;
/** Rough token estimate (chars / 4) — good enough for a context-window budget
 * without pulling in a model-specific tokenizer for every provider. */
const CHARS_PER_TOKEN = 4;

export async function getConversationHistory(
  conversationId: string,
  limit = DEFAULT_HISTORY_LIMIT,
): Promise<ChatMessage[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  return rows.map(rowToChatMessage);
}

function rowToChatMessage(row: {
  role: MessageRole;
  content: string;
  toolCallId: string | null;
  toolName: string | null;
  toolArgs: Prisma.JsonValue;
}): ChatMessage {
  switch (row.role) {
    case "system":
      return { role: "system", content: row.content };
    case "user":
      return { role: "user", content: row.content };
    case "tool":
      return {
        role: "tool",
        toolCallId: row.toolCallId ?? "",
        toolName: row.toolName ?? "",
        content: row.content,
      };
    case "assistant":
      return {
        role: "assistant",
        content: row.content,
        toolCalls: (row.toolArgs as unknown as ToolCall[] | null) ?? undefined,
      };
  }
}

export type AppendMessageInput =
  | { conversationId: string; role: "system" | "user"; content: string }
  | {
      conversationId: string;
      role: "assistant";
      content: string;
      toolCalls?: ToolCall[];
      inputTokens?: number;
      outputTokens?: number;
    }
  | {
      conversationId: string;
      role: "tool";
      content: string;
      toolCallId: string;
      toolName: string;
    };

export async function appendMessage(input: AppendMessageInput) {
  return prisma.message.create({
    data: {
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      toolCallId: input.role === "tool" ? input.toolCallId : null,
      toolName: input.role === "tool" ? input.toolName : null,
      toolArgs: input.role === "assistant" && input.toolCalls ? (input.toolCalls as object) : undefined,
      inputTokens: input.role === "assistant" ? input.inputTokens : undefined,
      outputTokens: input.role === "assistant" ? input.outputTokens : undefined,
    },
  });
}

/**
 * Drops the oldest non-system messages until the conversation fits within
 * `maxTokens` (approximated by character count). The system prompt, if
 * present, is always kept.
 */
export function trimToTokenBudget(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
  const budgetChars = maxTokens * CHARS_PER_TOKEN;
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");

  let total = system.reduce((sum, m) => sum + m.content.length, 0);
  const kept: ChatMessage[] = [];

  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const message = rest[i];
    if (!message) continue;
    const length = "content" in message ? message.content.length : 0;
    if (total + length > budgetChars && kept.length > 0) break;
    total += length;
    kept.unshift(message);
  }

  return [...system, ...kept];
}
