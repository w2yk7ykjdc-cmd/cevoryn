import type { Metadata } from "next";

import { ChatBootstrap } from "./chat-bootstrap";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: "Chat",
};

export default async function ChatConversationPage({ params }: PageProps) {
  const { id } = await params;
  return <ChatBootstrap conversationId={id} />;
}
