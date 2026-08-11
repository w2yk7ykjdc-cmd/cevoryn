"use client";

import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { MessageDetail } from "@/types";

import { useScrollAnchor } from "../hooks/use-scroll-anchor";

import { MessageBubble } from "./message-bubble";

interface ChatMessagesProps {
  messages: MessageDetail[];
  onSelectPrompt?: (prompt: string) => void;
}

const EXAMPLE_PROMPT_KEYS = [
  "today",
  "risks",
  "decisions",
  "priorities",
] as const;

export function ChatMessages({ messages, onSelectPrompt }: ChatMessagesProps) {
  const t = useTranslations("chat");
  const { containerRef } = useScrollAnchor();

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="h-7 w-7 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">{t("startConversation")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("startConversationHelp")}
          </p>
        </div>
        {onSelectPrompt ? (
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {EXAMPLE_PROMPT_KEYS.map((key) => {
              const prompt = t(`examplePrompts.${key}`);
              return (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onSelectPrompt(prompt)}
                >
                  {prompt}
                </Button>
              );
            })}
          </div>
        ) : null}
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
