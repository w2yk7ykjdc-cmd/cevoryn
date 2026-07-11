import { MessageSquare } from "lucide-react";
import type { Metadata } from "next";

import { requireMembership, requireUser } from "@/lib/auth";
import { listConversations } from "@/server/services/conversation.service";

import { NewChatRedirect } from "./new-chat-redirect";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  const conversations = await listConversations(
    membership.organizationId,
    membership.userId
  );

  // If recent conversations exist, redirect to the latest
  if (conversations.length > 0 && conversations[0]) {
    const { redirect } = await import("next/navigation");
    redirect(`/chat/${conversations[0].id}`);
  }

  // No conversations — show welcome state with create button
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <MessageSquare className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">Welcome to Atlas Chat</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask Atlas about strategy, operations, or your team.
        </p>
      </div>
      <NewChatRedirect />
    </div>
  );
}
