"use server";

import { requirePermission } from "@/server/auth/session";
import {
  archiveConversation,
  getConversationMessages,
  listConversations,
  type ConversationSummary,
  type DisplayMessage,
} from "@/server/ai/runtime/conversations";

export type ChatActionResult<T> = { success: true; data: T } | { success: false; error: string };

export async function listConversationsAction(): Promise<ChatActionResult<ConversationSummary[]>> {
  const { session, organization } = await requirePermission({ aiConversation: ["read"] });
  const conversations = await listConversations(organization.id, session.user.id);
  return { success: true, data: conversations };
}

export async function getConversationMessagesAction(
  conversationId: string,
): Promise<ChatActionResult<DisplayMessage[]>> {
  const { organization } = await requirePermission({ aiConversation: ["read"] });
  try {
    const messages = await getConversationMessages(organization.id, conversationId);
    return { success: true, data: messages };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to load conversation" };
  }
}

export async function archiveConversationAction(conversationId: string): Promise<ChatActionResult<null>> {
  const { session, organization } = await requirePermission({ aiConversation: ["delete"] });
  try {
    await archiveConversation(organization.id, conversationId, session.user.id);
    return { success: true, data: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to delete conversation" };
  }
}
