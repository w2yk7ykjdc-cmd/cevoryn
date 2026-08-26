import { requirePermission } from "@/server/auth/session";
import { getConversationMessages, listConversations } from "@/server/ai/runtime/conversations";
import { ChatClient } from "@/app/(dashboard)/dashboard/chat/chat-client";

type SearchParams = Promise<{ conversation?: string }>;

export default async function ChatPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, organization } = await requirePermission({ aiConversation: ["create"] });
  const params = await searchParams;

  const conversations = await listConversations(organization.id, session.user.id);
  const activeConversationId =
    params.conversation && conversations.some((c) => c.id === params.conversation) ? params.conversation : undefined;
  const initialMessages = activeConversationId
    ? await getConversationMessages(organization.id, activeConversationId)
    : [];

  return (
    <div className="flex h-[calc(100svh-8rem)] flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Assistant</h1>
        <p className="text-sm text-muted-foreground">
          Backed by the CompanyOS AI Runtime — provider-agnostic, tool-using, memory-aware.
        </p>
      </div>
      <ChatClient
        key={activeConversationId ?? "new"}
        conversations={conversations}
        activeConversationId={activeConversationId}
        initialMessages={initialMessages}
      />
    </div>
  );
}
