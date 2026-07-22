"use client";

import { ArrowUp, CheckSquare2, GitBranch, ListTodo, Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  isStreaming: boolean;
}

const EXECUTIVE_MODES = [
  {
    label: "Decide",
    icon: GitBranch,
    prompt:
      "Help me make this decision. Structure the options, trade-offs, risks, missing information, and your recommended decision:\n\n",
  },
  {
    label: "Plan",
    icon: ListTodo,
    prompt:
      "Turn this into a practical execution plan. Give me the objective, ordered steps, owner suggestions, dependencies, risks, and the next action:\n\n",
  },
  {
    label: "Create action",
    icon: CheckSquare2,
    prompt:
      "Convert this into a clear action item. Define the outcome, owner, priority, deadline suggestion, acceptance criteria, and first step:\n\n",
  },
] as const;

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

  const applyMode = useCallback((prompt: string) => {
    setValue((current) => (current.trim() ? `${prompt}${current}` : prompt));
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }, []);

  const canSend = value.trim().length > 0 && !isStreaming;

  return (
    <div className="border-t bg-background p-3 sm:p-4">
      <div className="mx-auto mb-2 flex max-w-3xl gap-2 overflow-x-auto pb-1">
        {EXECUTIVE_MODES.map(({ label, icon: Icon, prompt }) => (
          <Button
            key={label}
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 rounded-full text-xs"
            disabled={isStreaming}
            onClick={() => applyMode(prompt)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>

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
          placeholder="Ask Atlas, make a decision, or create an action..."
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
