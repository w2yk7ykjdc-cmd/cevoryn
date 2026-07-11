"use client";

import { useCallback, useRef, useState } from "react";

import type { MessageDetail, StreamChunk } from "@/types";

interface UseChatOptions {
  conversationId: string;
  initialMessages?: MessageDetail[];
}

interface UseChatReturn {
  messages: MessageDetail[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
}

export function useChat({
  conversationId,
  initialMessages = [],
}: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<MessageDetail[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string) => {
      if (isStreaming || !content.trim()) return;

      setError(null);
      setIsStreaming(true);

      // Optimistic user message
      const userMessage: MessageDetail = {
        id: `temp-${Date.now()}`,
        role: "USER",
        content: content.trim(),
        model: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Placeholder for streaming assistant response
      const assistantId = `stream-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "ASSISTANT",
          content: "",
          model: null,
          createdAt: new Date().toISOString(),
        },
      ]);

      try {
        abortRef.current = new AbortController();

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, content: content.trim() }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          if (response.status === 401) {
            window.location.href = "/login";
            return;
          }
          const errorBody = await response.json().catch(() => null);
          throw new Error(
            errorBody?.error?.message ?? `Request failed (${response.status})`
          );
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data) continue;

            let chunk: StreamChunk;
            try {
              chunk = JSON.parse(data) as StreamChunk;
            } catch (_parseError) {
              continue;
            }

            if (chunk.type === "text" && chunk.content) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + chunk.content }
                    : m
                )
              );
            }

            if (chunk.type === "done" && chunk.messageId) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, id: chunk.messageId! } : m
                )
              );
            }

            if (chunk.type === "error") {
              setError(chunk.content ?? "An error occurred");
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        const message = err instanceof Error ? err.message : "Request failed";
        setError(message);
        // Remove the empty assistant placeholder on error
        setMessages((prev) =>
          prev.filter((m) => m.id !== assistantId || m.content.length > 0)
        );
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [conversationId, isStreaming]
  );

  return { messages, isStreaming, error, sendMessage };
}
