import { AlertTriangle, MessageSquare } from "lucide-react";
import type { Metadata } from "next";

import { requireMembership, requireUser } from "@/lib/auth";

import { NewChatRedirect } from "./new-chat-redirect";

export const metadata: Metadata = {
  title: "Chat",
};

function isNextRedirect(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "digest" in error &&
      String(error.digest).startsWith("NEXT_REDIRECT")
  );
}

export default async function ChatPage() {
  try {
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
  } catch (error) {
    if (isNextRedirect(error)) throw error;

    console.error(
      "Chat page error:",
      error instanceof Error ? error.message : "unknown"
    );

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-7 w-7 text-destructive" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Chat is temporarily unavailable</h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Atlas could not load your workspace data. Please refresh the page in a moment.
          </p>
        </div>
      </div>
    );
  }
}
