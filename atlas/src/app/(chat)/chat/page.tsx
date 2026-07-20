import { MessageSquare } from "lucide-react";
import type { Metadata } from "next";

import { requireMembership, requireUser } from "@/lib/auth";

import { NewChatRedirect } from "./new-chat-redirect";

export const metadata: Metadata = {
  title: "Chat",
};

export default async function ChatPage() {
  const user = await requireUser();
  await requireMembership(user.id);

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
