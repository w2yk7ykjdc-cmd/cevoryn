"use client";

import { MessageSquare } from "lucide-react";

import type { MessageDetail } from "@/types";

import { useScrollAnchor } from "../hooks/use-scroll-anchor";
import { MessageBubble } from "./message-bubble";

interface ChatMessagesProps {
  messages: MessageDetail[];
}

export function ChatMessages({ messages }: ChatMessagesProps) {
  const { containerRef } = useScrollAnchor();

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="h-7 w-7 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">Start a conversation</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask Atlas anything about strategy, operations, or your team.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto py-4">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  );
}
