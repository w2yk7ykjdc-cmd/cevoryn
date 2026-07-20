import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ChatLayout } from "@/features/ai/components/chat-layout";
import { requireMembership, requireUser } from "@/lib/auth";
import { getConversationWithMessages } from "@/server/services/conversation.service";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Chat — ${id.slice(0, 8)}` };
}

export default async function ChatConversationPage({ params }: PageProps) {
  const { id } = await params;
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  const conversation = await getConversationWithMessages(
    id,
    membership.organizationId,
    membership.userId
  );

  if (!conversation) {
    notFound();
  }

  const messages = conversation.messages.map(
    (m: {
      id: string;
      role: "USER" | "ASSISTANT" | "SYSTEM";
      content: string;
      model: string | null;
      createdAt: Date;
    }) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      model: m.model,
      createdAt: m.createdAt.toISOString(),
    })
  );

  return (
    <ChatLayout
      conversationId={conversation.id}
      conversationTitle={conversation.title}
      initialMessages={messages}
    />
  );
}
