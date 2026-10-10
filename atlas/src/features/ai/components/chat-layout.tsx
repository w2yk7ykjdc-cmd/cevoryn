"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("chat");
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [title, setTitle] = useState(conversationTitle);
  const [isMutating, setIsMutating] = useState(false);
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

  const handleRename = useCallback(
    async (nextTitle: string) => {
      setIsMutating(true);
      try {
        const response = await fetch(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: nextTitle }),
        });

        if (handleUnauthorized(response)) return false;
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          toast.error(payload?.error?.message ?? t("conversationNotRenamed"));
          return false;
        }

        setTitle(payload?.data?.title ?? nextTitle);
        invalidate();
        router.refresh();
        toast.success(t("conversationRenamed"));
        return true;
      } catch (_error) {
        toast.error(t("conversationNotRenamed"));
        return false;
      } finally {
        setIsMutating(false);
      }
    },
    [conversationId, invalidate, router, t]
  );

  const handleArchive = useCallback(async () => {
    setIsMutating(true);
    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });

      if (handleUnauthorized(response)) return;
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(payload?.error?.message ?? t("conversationNotArchived"));
        return;
      }

      invalidate();
      toast.success(t("conversationArchived"));
      router.replace("/chat");
      router.refresh();
    } catch (_error) {
      toast.error(t("conversationNotArchived"));
    } finally {
      setIsMutating(false);
    }
  }, [conversationId, invalidate, router, t]);

  const sendOptionalWorkflowSummary = useCallback(
    async (content: string) => {
      try {
        await handleSend(content);
      } catch (_error) {
        toast.info(t("savedSummaryFailed"));
      }
    },
    [handleSend, t]
  );

  const showSavedToast = useCallback(
    (message: string) => {
      toast.success(message, {
        action: {
          label: t("openIntelligence"),
          onClick: () => window.location.assign("/intelligence"),
        },
      });
    },
    [t]
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
          const message = payload?.error?.message ?? t("decisionCreateFailed");
          toast.error(message);
          throw new Error(message);
        }

        if (payload?.data?.degraded) {
          showSavedToast(t("decisionSavedDegraded"));
        } else {
          showSavedToast(t("decisionSaved"));
        }
        await sendOptionalWorkflowSummary(
          t("decisionSummaryPrompt", { input })
        );
        return;
      }

      const actionTitle =
        input.length > 120 ? `${input.slice(0, 117)}...` : input;
      const response = await fetch("/api/brain/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: actionTitle,
          description: input,
          priority: "MEDIUM",
          acceptanceCriteria: [],
          reasoning: t("actionCreatedReasoning"),
          confidence: 0.8,
        }),
      });

      if (handleUnauthorized(response)) return;
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error?.message ?? t("actionCreateFailed");
        toast.error(message);
        throw new Error(message);
      }

      showSavedToast(t("actionSaved"));
      await sendOptionalWorkflowSummary(t("actionSummaryPrompt", { input }));
    },
    [sendOptionalWorkflowSummary, showSavedToast, t]
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
            <SheetTitle>{t("conversations")}</SheetTitle>
          </SheetHeader>
          <ChatSidebar
            activeId={conversationId}
            onNavigate={() => setSidebarOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          title={title}
          onToggleSidebar={() => setSidebarOpen(true)}
          onRename={handleRename}
          onArchive={handleArchive}
          isMutating={isMutating}
        />
        <ChatMessages messages={messages} onSelectPrompt={handleSend} />
        <ChatInput
          conversationId={conversationId}
          onSend={handleSend}
          onWorkflowSubmit={handleWorkflowSubmit}
          isStreaming={isStreaming}
        />
      </div>
    </div>
  );
}
