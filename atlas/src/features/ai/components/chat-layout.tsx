"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { handleUnauthorized } from "@/lib/client-auth";
import type { MessageDetail } from "@/types";

import { useChat } from "../hooks/use-chat";
import { useConversations } from "../hooks/use-conversations";

import { ChatHeader } from "./chat-header";
import { ChatInput } from "./chat-input";
import type { ExecutiveMode } from "./chat-input";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { invalidate } = useConversations();

  const { messages, isStreaming, error, sendMessage } = useChat({
    conversationId,
    initialMessages,
  });

  const handleSend = useCallback(
    async (content: string) => {
      await sendMessage(content);
      invalidate();
    },
    [sendMessage, invalidate]
  );

  const handleWorkflowSubmit = useCallback(
    async (mode: Exclude<ExecutiveMode, "CHAT" | "PLAN">, input: string) => {
      if (mode === "DECIDE") {
        const response = await fetch("/api/brain/decisions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ problemDescription: input }),
        });

        if (handleUnauthorized(response)) return;
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message = payload?.error?.message ?? "Decision could not be created";
          toast.error(message);
          throw new Error(message);
        }

        toast.success("Decision saved to Atlas");
        await handleSend(
          `A decision record was created for this problem: ${input}\n\nSummarize the recommendation, the largest risk, and the next step in plain language.`
        );
        return;
      }

      const title = input.length > 120 ? `${input.slice(0, 117)}...` : input;
      const response = await fetch("/api/brain/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: input,
          priority: "MEDIUM",
          acceptanceCriteria: [],
          reasoning: "Created directly from the Atlas chat action workflow",
          confidence: 0.8,
        }),
      });

      if (handleUnauthorized(response)) return;
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error?.message ?? "Action could not be created";
        toast.error(message);
        throw new Error(message);
      }

      toast.success("Action saved to Atlas");
      await handleSend(
        `An action was saved for: ${input}\n\nRefine it into a concise execution note with an owner suggestion, a realistic deadline, and a measurable definition of done.`
      );
    },
    [handleSend]
  );

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  return (
    <div className="flex h-full">
      <div className="hidden w-64 shrink-0 border-r lg:block">
        <ChatSidebar activeId={conversationId} />
      </div>

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

      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          title={conversationTitle}
          onToggleSidebar={() => setSidebarOpen(true)}
        />
        <ChatMessages messages={messages} />
        <ChatInput
          onSend={handleSend}
          onWorkflowSubmit={handleWorkflowSubmit}
          isStreaming={isStreaming}
        />
      </div>
    </div>
  );
}
