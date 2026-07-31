import { requirePermission } from "@/server/auth/session";
import { ChatClient } from "@/app/(dashboard)/dashboard/chat/chat-client";

export default async function ChatPage() {
  await requirePermission({ aiConversation: ["create"] });

  return (
    <div className="flex h-[calc(100svh-8rem)] flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Assistant</h1>
        <p className="text-sm text-muted-foreground">
          Backed by the CompanyOS AI Runtime — provider-agnostic, tool-using, memory-aware.
        </p>
      </div>
      <ChatClient />
    </div>
  );
}
