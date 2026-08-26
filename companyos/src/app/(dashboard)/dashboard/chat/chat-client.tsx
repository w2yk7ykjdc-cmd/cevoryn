"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { archiveConversationAction } from "@/app/(dashboard)/dashboard/chat/actions";
import type { ConversationSummary, DisplayMessage } from "@/server/ai/runtime/conversations";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string };

type StreamEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; toolCall: unknown }
  | { type: "done"; result: unknown }
  | { type: "error"; message: string };

export function ChatClient({
  conversations,
  activeConversationId,
  initialMessages,
}: {
  conversations: ConversationSummary[];
  activeConversationId?: string;
  initialMessages: DisplayMessage[];
}) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | undefined>(activeConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || isSending) return;

    const isNewConversation = !conversationId;
    setInput("");
    setIsSending(true);
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: message }]);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message, stream: true }),
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          const streamEvent = JSON.parse(line.slice("data:".length).trim()) as StreamEvent;

          if (streamEvent.type === "conversation") {
            setConversationId(streamEvent.conversationId);
            if (isNewConversation) {
              router.replace(`/dashboard/chat?conversation=${streamEvent.conversationId}`, { scroll: false });
            }
          } else if (streamEvent.type === "text_delta") {
            const delta = streamEvent.delta;
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)));
          } else if (streamEvent.type === "error") {
            streamError = streamEvent.message;
          }
        }
      }

      if (streamError) {
        throw new Error(streamError);
      }
      // Refreshes the sidebar so a new conversation (or an updated `updatedAt`
      // for an existing one) shows up without a full navigation.
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reach the AI Runtime");
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setIsSending(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const result = await archiveConversationAction(id);
    setDeletingId(null);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    if (id === conversationId) {
      router.push("/dashboard/chat");
    } else {
      router.refresh();
    }
  }

  return (
    <div className="flex flex-1 gap-4 overflow-hidden">
      <aside className="hidden w-64 shrink-0 flex-col gap-1 overflow-y-auto sm:flex">
        <Button asChild variant="outline" size="sm" className="mb-2">
          <Link href="/dashboard/chat">New chat</Link>
        </Button>
        {conversations.length === 0 && (
          <p className="px-2 text-sm text-muted-foreground">No conversations yet.</p>
        )}
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={cn(
              "group flex items-center gap-1 rounded-md px-2 py-2 text-sm",
              conversation.id === conversationId
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            <Link href={`/dashboard/chat?conversation=${conversation.id}`} className="min-w-0 flex-1 truncate">
              {conversation.title}
            </Link>
            <button
              type="button"
              onClick={() => handleDelete(conversation.id)}
              disabled={deletingId === conversation.id}
              aria-label={`Delete conversation "${conversation.title}"`}
              className="shrink-0 rounded-full p-1 opacity-0 outline-none hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
      </aside>

      <Card className="flex flex-1 flex-col overflow-hidden">
        <CardContent className="flex flex-1 flex-col gap-4 overflow-y-auto pt-6">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask a question. Try &quot;what changed in the audit log recently?&quot; to see tool use in action.
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap",
                m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              {m.content.length > 0 ? m.content : m.role === "assistant" ? "…" : m.content}
            </div>
          ))}
        </CardContent>
        <form onSubmit={handleSubmit} className="flex gap-2 border-t p-4">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message the assistant…"
            disabled={isSending}
          />
          <Button type="submit" disabled={isSending || input.trim().length === 0}>
            Send
          </Button>
        </form>
      </Card>
    </div>
  );
}
