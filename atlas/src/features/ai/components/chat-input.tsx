"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  isStreaming: boolean;
}

export function ChatInput({ onSend, isStreaming }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed || isStreaming) return;
      onSend(trimmed);
      setValue("");

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    },
    [value, isStreaming, onSend]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit]
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const canSend = value.trim().length > 0 && !isStreaming;

  return (
    <div className="border-t bg-background p-3 sm:p-4">
      <form
        onSubmit={handleSubmit}
        className="mx-auto flex max-w-3xl items-end gap-2"
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="Ask Atlas anything..."
          rows={1}
          disabled={isStreaming}
          className={cn(
            "flex-1 resize-none rounded-xl border bg-muted/50 px-4 py-3 text-sm",
            "placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            "disabled:opacity-50",
            "max-h-[200px]"
          )}
          aria-label="Message input"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!canSend}
          className="h-10 w-10 shrink-0 rounded-xl"
          aria-label={isStreaming ? "Sending..." : "Send message"}
        >
          {isStreaming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
