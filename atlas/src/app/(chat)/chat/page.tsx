import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireMembership, requireUser } from "@/lib/auth";
import {
  createConversation,
  listConversations,
} from "@/server/services/conversation.service";

export const metadata: Metadata = {
  title: "Chat",
};

export default async function ChatPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  const conversations = await listConversations(
    membership.organizationId,
    membership.userId
  );

  const conversation =
    conversations[0] ??
    (await createConversation({
      organizationId: membership.organizationId,
      createdById: membership.userId,
    }));

  redirect(`/chat/${conversation.id}`);
}
