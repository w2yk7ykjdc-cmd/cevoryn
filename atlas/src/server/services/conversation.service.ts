import "server-only";

import { CONVERSATION_CONFIG } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

/**
 * All queries are scoped to organizationId to enforce tenant isolation.
 * Never trust a user-supplied organizationId — always derive it from
 * the authenticated membership context.
 */

export async function createConversation(params: {
  organizationId: string;
  createdById: string;
  title?: string;
}) {
  return prisma.conversation.create({
    data: {
      organizationId: params.organizationId,
      createdById: params.createdById,
      title: params.title ?? "New conversation",
    },
  });
}

export async function getConversation(
  id: string,
  organizationId: string,
  createdById: string
) {
  return prisma.conversation.findFirst({
    where: { id, organizationId, createdById, isArchived: false },
  });
}

export async function getConversationWithMessages(
  id: string,
  organizationId: string,
  createdById: string
) {
  return prisma.conversation.findFirst({
    where: { id, organizationId, createdById, isArchived: false },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          model: true,
          createdAt: true,
        },
      },
    },
  });
}

export async function listConversations(
  organizationId: string,
  createdById: string
) {
  return prisma.conversation.findMany({
    where: { organizationId, createdById, isArchived: false },
    orderBy: { updatedAt: "desc" },
    take: CONVERSATION_CONFIG.listPageSize,
    select: {
      id: true,
      title: true,
      updatedAt: true,
    },
  });
}

export async function renameConversation(
  id: string,
  organizationId: string,
  title: string,
  createdById: string
) {
  return prisma.conversation.updateMany({
    where: { id, organizationId, createdById, isArchived: false },
    data: { title: title.slice(0, CONVERSATION_CONFIG.maxTitleLength) },
  });
}

export async function deleteConversation(
  id: string,
  organizationId: string,
  createdById: string
) {
  return prisma.conversation.deleteMany({
    where: { id, organizationId, createdById },
  });
}

export async function archiveConversation(
  id: string,
  organizationId: string,
  createdById: string
) {
  return prisma.conversation.updateMany({
    where: { id, organizationId, createdById, isArchived: false },
    data: { isArchived: true },
  });
}
