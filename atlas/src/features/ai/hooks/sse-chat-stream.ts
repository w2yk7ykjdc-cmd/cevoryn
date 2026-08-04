/**
 * Pure SSE chat-stream parsing/accumulation, split out of use-chat.ts so the
 * logic that decides whether a stream completed successfully is testable
 * without a browser DOM or a live fetch/ReadableStream.
 */

import type { StreamChunk } from "@/types";

export interface ChatStreamAccumulator {
  content: string;
  messageId: string | null;
  error: string | null;
  receivedTerminalChunk: boolean;
}

export function createChatStreamAccumulator(): ChatStreamAccumulator {
  return {
    content: "",
    messageId: null,
    error: null,
    receivedTerminalChunk: false,
  };
}

/**
 * Split a growing text buffer into complete SSE lines plus whatever partial
 * line remains (a chunk boundary can land mid-line, so the remainder must be
 * prepended to the next read).
 */
export function splitBufferedLines(buffer: string): {
  lines: string[];
  remainder: string;
} {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";
  return { lines, remainder };
}

/** Parses a single SSE "data: ..." line into a StreamChunk, or null if the line isn't a valid data event. */
export function parseSseDataLine(line: string): StreamChunk | null {
  if (!line.startsWith("data: ")) return null;
  const data = line.slice(6).trim();
  if (!data) return null;

  try {
    return JSON.parse(data) as StreamChunk;
  } catch {
    return null;
  }
}

/**
 * Fold one StreamChunk into the accumulator. "done" and "error" are terminal:
 * once received, the stream is considered to have finished (successfully or
 * not) rather than having been cut off mid-flight.
 */
export function applyStreamChunk(
  acc: ChatStreamAccumulator,
  chunk: StreamChunk
): ChatStreamAccumulator {
  if (chunk.type === "text" && chunk.content) {
    return { ...acc, content: acc.content + chunk.content };
  }

  if (chunk.type === "done" && chunk.messageId) {
    return { ...acc, messageId: chunk.messageId, receivedTerminalChunk: true };
  }

  if (chunk.type === "error") {
    return {
      ...acc,
      error: chunk.content ?? "An error occurred",
      receivedTerminalChunk: true,
    };
  }

  return acc;
}

/**
 * The reader loop exited (the underlying stream closed) without ever
 * delivering a "done" or "error" chunk — e.g. the serverless function hit
 * its time limit, or the connection dropped. Treat this as a failure rather
 * than silently accepting whatever partial content arrived.
 */
export function unterminatedStreamMessage(): string {
  return "The response was interrupted before it finished. Please try again.";
}
