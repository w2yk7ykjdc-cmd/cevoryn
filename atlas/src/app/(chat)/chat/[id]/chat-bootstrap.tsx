"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ChatLayout } from "@/features/ai/components/chat-layout";
import { handleUnauthorized } from "@/lib/client-auth";
import type { MessageDetail } from "@/types";

interface ChatBootstrapProps {
  conversationId: string;
}

interface ConversationPayload {
  id: string;
  title: string;
  messages: MessageDetail[];
}

export function ChatBootstrap({ conversationId }: ChatBootstrapProps) {
  const t = useTranslations("chat");
  const [conversation, setConversation] = useState<ConversationPayload | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    void fetch(`/api/conversations/${conversationId}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (handleUnauthorized(response)) return null;
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            payload?.error?.message ?? t("conversationLoadFailed")
          );
        }
        return payload?.data as ConversationPayload;
      })
      .then((data) => {
        if (!cancelled && data) setConversation(data);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : t("conversationLoadFailed")
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, t]);

  if (!conversation) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        <div className="flex h-14 shrink-0 items-center border-b px-4 text-sm font-medium">
          CEVORYN
        </div>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
        <div className="h-24 shrink-0 border-t bg-background" />
      </div>
    );
  }

  return (
    <ChatLayout
      conversationId={conversation.id}
      conversationTitle={conversation.title}
      initialMessages={conversation.messages}
    />
  );
}
