"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { MessageDetail } from "@/types";

import { useChat } from "../hooks/use-chat";
import { useConversations } from "../hooks/use-conversations";
import { ChatHeader } from "./chat-header";
import { ChatInput } from "./chat-input";
import { ChatMessages } from "./chat-messages";
import { ChatSidebar } from "./chat-sidebar";

interface ChatLayoutProps {
  conversationId: string;
  conversationTitle: string;
  initialMessages: MessageDetail[];
}

export function ChatLayout({
  conversationId,
  conversationTitle,
  initialMessages,
}: ChatLayoutProps) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { invalidate } = useConversations();

  const { messages, isStreaming, error, sendMessage } = useChat({
    conversationId,
    initialMessages,
  });

  const handleSend = useCallback(
    async (content: string) => {
      await sendMessage(content);
      // Refresh conversation list to update ordering/title
      invalidate();
    },
    [sendMessage, invalidate]
  );

  if (error) {
    toast.error(error);
  }

  return (
    <div className="flex h-full">
      {/* Desktop conversation sidebar */}
      <div className="hidden w-64 shrink-0 border-r lg:block">
        <ChatSidebar activeId={conversationId} />
      </div>

      {/* Mobile conversation sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Conversations</SheetTitle>
          </SheetHeader>
          <ChatSidebar
            activeId={conversationId}
            onNavigate={() => setSidebarOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          title={conversationTitle}
          onToggleSidebar={() => setSidebarOpen(true)}
        />
        <ChatMessages messages={messages} />
        <ChatInput onSend={handleSend} isStreaming={isStreaming} />
      </div>
    </div>
  );
}
