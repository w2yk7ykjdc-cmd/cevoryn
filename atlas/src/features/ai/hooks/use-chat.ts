"use client";

import { useCallback, useRef, useState } from "react";

import { handleUnauthorized } from "@/lib/client-auth";
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

      const userMessage: MessageDetail = {
        id: `temp-${Date.now()}`,
        role: "USER",
        content: content.trim(),
        model: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

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

        if (handleUnauthorized(response)) return;

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          throw new Error(
            errorBody?.error?.message ?? `Request failed (${response.status})`
          );
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";
        let streamError: string | null = null;

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
                prev.map((message) =>
                  message.id === assistantId
                    ? { ...message, content: message.content + chunk.content }
                    : message
                )
              );
            }

            if (chunk.type === "done" && chunk.messageId) {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId
                    ? { ...message, id: chunk.messageId! }
                    : message
                )
              );
            }

            if (chunk.type === "error") {
              streamError = chunk.content ?? "An error occurred";
              break;
            }
          }

          if (streamError) {
            await reader.cancel();
            throw new Error(streamError);
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;

        const message = err instanceof Error ? err.message : "Request failed";
        setError(message);
        setMessages((prev) =>
          prev.filter(
            (item) => item.id !== assistantId || item.content.length > 0
          )
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
