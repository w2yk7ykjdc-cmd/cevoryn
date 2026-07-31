"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ChatMessage = { role: "user" | "assistant"; content: string };

export function ChatClient() {
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || isSending) return;

    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Request failed");
      }

      setConversationId(data.conversationId);
      setMessages((prev) => [...prev, { role: "assistant", content: data.content }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reach the AI Runtime");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Card className="flex flex-1 flex-col overflow-hidden">
      <CardContent className="flex flex-1 flex-col gap-4 overflow-y-auto pt-6">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask a question. Try &quot;what changed in the audit log recently?&quot; to see tool use in action.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap",
              m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted",
            )}
          >
            {m.content}
          </div>
        ))}
        {isSending && <div className="max-w-[80%] rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">Thinking…</div>}
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
  );
}
