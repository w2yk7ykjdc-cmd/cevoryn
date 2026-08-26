import { prisma } from "@/server/db/client";
import { resolveDefaultTarget } from "@/server/ai/providers/registry";
import { recordAuditLog, publishAuditEvent } from "@/server/audit/audit-log";
import type { ProviderId } from "@/server/ai/providers/types";

export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation "${conversationId}" was not found in this organization`);
    this.name = "ConversationNotFoundError";
  }
}

export type CreateConversationInput = {
  organizationId: string;
  userId: string;
  title?: string;
  provider?: ProviderId;
  model?: string;
};

export async function createConversation(input: CreateConversationInput) {
  const target = resolveDefaultTarget();
  return prisma.conversation.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      title: input.title,
      provider: input.provider ?? target.provider,
      model: input.model ?? target.model,
    },
  });
}

export async function getConversation(conversationId: string, organizationId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, organizationId },
  });
}

const TITLE_FALLBACK_LENGTH = 60;

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: Date;
};

/**
 * Lists a user's active (non-archived) conversations, newest first. No
 * `title` is ever set on a chat-created conversation (only agent runs pass
 * one), so this falls back to a snippet of the first user message — good
 * enough for a sidebar label without an extra LLM call to summarize it.
 */
export async function listConversations(organizationId: string, userId: string): Promise<ConversationSummary[]> {
  const conversations = await prisma.conversation.findMany({
    where: { organizationId, userId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: {
      messages: {
        where: { role: "user" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { content: true },
      },
    },
  });

  return conversations.map((conversation) => ({
    id: conversation.id,
    title:
      conversation.title ??
      conversation.messages[0]?.content.slice(0, TITLE_FALLBACK_LENGTH) ??
      "New conversation",
    updatedAt: conversation.updatedAt,
  }));
}

export type DisplayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

/**
 * A conversation's message history shaped for direct UI display — unlike
 * `getConversationHistory` (`memory/short-term.ts`), which includes system
 * and tool messages and is meant to feed the model, not a chat bubble list.
 */
export async function getConversationMessages(
  organizationId: string,
  conversationId: string,
): Promise<DisplayMessage[]> {
  const conversation = await getConversation(conversationId, organizationId);
  if (!conversation) {
    throw new ConversationNotFoundError(conversationId);
  }

  const rows = await prisma.message.findMany({
    where: { conversationId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({ id: row.id, role: row.role as "user" | "assistant", content: row.content }));
}

/**
 * Soft-deletes a conversation (`archivedAt`) so it drops out of
 * `listConversations` without losing its message history — matching the
 * `deletedAt` pattern the CRM domain (companies/contacts/leads/tasks) uses.
 */
export async function archiveConversation(
  organizationId: string,
  conversationId: string,
  actorId: string,
): Promise<void> {
  const { auditEntry } = await prisma.$transaction(async (tx) => {
    const existing = await tx.conversation.findFirst({
      where: { id: conversationId, organizationId, archivedAt: null },
    });
    if (!existing) {
      throw new ConversationNotFoundError(conversationId);
    }

    await tx.conversation.update({
      where: { id: existing.id },
      data: { archivedAt: new Date() },
    });

    const auditEntry = await recordAuditLog(
      {
        organizationId,
        actorId,
        actorType: "user",
        action: "conversation.archived",
        targetType: "conversation",
        targetId: conversationId,
        metadata: { title: existing.title },
      },
      tx,
    );

    return { auditEntry };
  });

  await publishAuditEvent(auditEntry);
}
