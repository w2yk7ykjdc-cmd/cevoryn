import "server-only";
import { prisma } from "@/server/db/client";
import { resolveDefaultTarget } from "@/server/ai/providers/registry";
import type { ProviderId } from "@/server/ai/providers/types";

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

export async function listConversations(organizationId: string, userId: string) {
  return prisma.conversation.findMany({
    where: { organizationId, userId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
}
