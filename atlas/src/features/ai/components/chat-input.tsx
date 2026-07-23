"use client";

import { ArrowUp, CheckSquare2, GitBranch, ListTodo, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { consumePendingChatMessage } from "@/lib/client-auth";
import { cn } from "@/lib/utils";

export type ExecutiveMode = "CHAT" | "DECIDE" | "PLAN" | "ACTION";

interface ChatInputProps {
  conversationId: string;
  onSend: (message: string) => void;
  onWorkflowSubmit: (
    mode: Exclude<ExecutiveMode, "CHAT" | "PLAN">,
    input: string
  ) => Promise<void>;
  isStreaming: boolean;
}

const EXECUTIVE_MODES = [
  { label: "Decide", icon: GitBranch, mode: "DECIDE" },
  { label: "Plan", icon: ListTodo, mode: "PLAN" },
  { label: "Create action", icon: CheckSquare2, mode: "ACTION" },
] as const;

const MODE_PLACEHOLDER: Record<ExecutiveMode, string> = {
  CHAT: "Ask Atlas anything...",
  DECIDE: "Describe the decision you need to make...",
  PLAN: "Describe the outcome you want to plan...",
  ACTION: "Describe the action Atlas should create...",
};

export function ChatInput({
  conversationId,
  onSend,
  onWorkflowSubmit,
  isStreaming,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<ExecutiveMode>("CHAT");
  const [isSubmittingWorkflow, setIsSubmittingWorkflow] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const pendingMessage = consumePendingChatMessage(conversationId);
    if (!pendingMessage) return;

    setValue((current) => current || pendingMessage);
    setMode("CHAT");

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
      textarea.focus();
    });
  }, [conversationId]);

  const resetComposer = useCallback(() => {
    setValue("");
    setMode("CHAT");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed || isStreaming || isSubmittingWorkflow) return;

      if (mode === "DECIDE" || mode === "ACTION") {
        setIsSubmittingWorkflow(true);
        try {
          await onWorkflowSubmit(mode, trimmed);
          resetComposer();
        } finally {
          setIsSubmittingWorkflow(false);
        }
        return;
      }

      const message =
        mode === "PLAN"
          ? `Turn this into a practical execution plan. Give me the objective, ordered steps, owner suggestions, dependencies, risks, and the next action:\n\n${trimmed}`
          : trimmed;
      onSend(message);
      resetComposer();
    }, [
      value,
      mode,
      isStreaming,
      isSubmittingWorkflow,
      onSend,
      onWorkflowSubmit,
      resetComposer,
    ]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit(e);
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

  const selectMode = useCallback((nextMode: ExecutiveMode) => {
    setMode((current) => (current === nextMode ? "CHAT" : nextMode));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const busy = isStreaming || isSubmittingWorkflow;
  const canSend = value.trim().length > 0 && !busy;

  return (
    <div className="border-t bg-background p-3 sm:p-4">
      <div className="mx-auto mb-2 flex max-w-3xl gap-2 overflow-x-auto pb-1">
        {EXECUTIVE_MODES.map(({ label, icon: Icon, mode: itemMode }) => {
          const active = mode === itemMode;
          return (
            <Button
              key={label}
              type="button"
              variant={active ? "default" : "outline"}
              size="sm"
              className="h-8 shrink-0 rounded-full text-xs"
              disabled={busy}
              aria-pressed={active}
              onClick={() => selectMode(itemMode)}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Button>
          );
        })}
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
          placeholder={MODE_PLACEHOLDER[mode]}
          rows={1}
          disabled={busy}
          className={cn(
            "max-h-[200px] flex-1 resize-none rounded-xl border bg-muted/50 px-4 py-3 text-sm",
            "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
            "disabled:opacity-50"
          )}
          aria-label="Message input"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!canSend}
          className="h-10 w-10 shrink-0 rounded-xl"
          aria-label={busy ? "Working..." : "Send"}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
