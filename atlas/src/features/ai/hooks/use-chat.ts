"use client";

import { useCallback, useRef, useState } from "react";

import {
  handleUnauthorized,
  preservePendingChatMessage,
} from "@/lib/client-auth";
import type { MessageDetail } from "@/types";

import {
  applyStreamChunk,
  createChatStreamAccumulator,
  parseSseDataLine,
  splitBufferedLines,
  unterminatedStreamMessage,
} from "./sse-chat-stream";

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
      const normalizedContent = content.trim();
      if (isStreaming || !normalizedContent) return;

      setError(null);
      setIsStreaming(true);

      const userMessage: MessageDetail = {
        id: `temp-${Date.now()}`,
        role: "USER",
        content: normalizedContent,
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
          body: JSON.stringify({
            conversationId,
            content: normalizedContent,
          }),
          signal: abortRef.current.signal,
        });

        if (response.status === 401) {
          preservePendingChatMessage(conversationId, normalizedContent);
          setMessages((prev) =>
            prev.filter(
              (item) => item.id !== userMessage.id && item.id !== assistantId
            )
          );
          handleUnauthorized(response);
          return;
        }

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
        let acc = createChatStreamAccumulator();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const { lines, remainder } = splitBufferedLines(buffer);
          buffer = remainder;

          for (const line of lines) {
            const chunk = parseSseDataLine(line);
            if (!chunk) continue;

            acc = applyStreamChunk(acc, chunk);

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

            if (acc.error) break;
          }

          if (acc.error) {
            await reader.cancel();
            throw new Error(acc.error);
          }
        }

        // The connection closed (e.g. the serverless function hit its time
        // limit) without ever sending a "done" or "error" chunk. Treat this
        // as a failure rather than silently leaving an unsaved, truncated
        // response on screen.
        if (!acc.receivedTerminalChunk) {
          throw new Error(unterminatedStreamMessage());
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
