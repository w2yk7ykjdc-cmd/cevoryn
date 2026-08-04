import assert from "node:assert/strict";
import test from "node:test";

import {
  applyStreamChunk,
  createChatStreamAccumulator,
  parseSseDataLine,
  splitBufferedLines,
  unterminatedStreamMessage,
} from "../src/features/ai/hooks/sse-chat-stream";

test("splitBufferedLines separates complete lines from a trailing partial line", () => {
  const { lines, remainder } = splitBufferedLines("a\nb\nc-partial");
  assert.deepEqual(lines, ["a", "b"]);
  assert.equal(remainder, "c-partial");
});

test("splitBufferedLines treats a buffer ending in a newline as all-complete", () => {
  const { lines, remainder } = splitBufferedLines("a\nb\n");
  assert.deepEqual(lines, ["a", "b"]);
  assert.equal(remainder, "");
});

test("parseSseDataLine ignores non-data lines", () => {
  assert.equal(parseSseDataLine(""), null);
  assert.equal(parseSseDataLine("event: ping"), null);
  assert.equal(parseSseDataLine("data:"), null);
});

test("parseSseDataLine ignores malformed JSON instead of throwing", () => {
  assert.equal(parseSseDataLine("data: {not json"), null);
});

test("parseSseDataLine parses a well-formed chunk", () => {
  const chunk = parseSseDataLine('data: {"type":"text","content":"hi"}');
  assert.deepEqual(chunk, { type: "text", content: "hi" });
});

test("applyStreamChunk accumulates text content across multiple chunks", () => {
  let acc = createChatStreamAccumulator();
  acc = applyStreamChunk(acc, { type: "text", content: "Hello, " });
  acc = applyStreamChunk(acc, { type: "text", content: "world." });
  assert.equal(acc.content, "Hello, world.");
  assert.equal(acc.receivedTerminalChunk, false);
});

test("applyStreamChunk ignores a text chunk with empty content", () => {
  let acc = createChatStreamAccumulator();
  acc = applyStreamChunk(acc, { type: "text", content: "" });
  assert.equal(acc.content, "");
});

test("a done chunk sets the message id and marks the stream terminated", () => {
  let acc = createChatStreamAccumulator();
  acc = applyStreamChunk(acc, { type: "text", content: "answer" });
  acc = applyStreamChunk(acc, { type: "done", messageId: "msg-123" });
  assert.equal(acc.messageId, "msg-123");
  assert.equal(acc.receivedTerminalChunk, true);
  assert.equal(acc.error, null);
});

test("a done chunk without a messageId is not treated as terminal", () => {
  let acc = createChatStreamAccumulator();
  acc = applyStreamChunk(acc, { type: "done" });
  assert.equal(acc.receivedTerminalChunk, false);
});

test("an error chunk records the error and marks the stream terminated", () => {
  let acc = createChatStreamAccumulator();
  acc = applyStreamChunk(acc, { type: "error", content: "rate limited" });
  assert.equal(acc.error, "rate limited");
  assert.equal(acc.receivedTerminalChunk, true);
});

test("an error chunk without content falls back to a generic message", () => {
  let acc = createChatStreamAccumulator();
  acc = applyStreamChunk(acc, { type: "error" });
  assert.equal(acc.error, "An error occurred");
});

test("regression: a fresh accumulator that never sees a terminal chunk stays unterminated", () => {
  // This is the exact bug fixed in use-chat.ts: a connection that closes
  // mid-stream (e.g. the serverless function's maxDuration is hit) must not
  // be mistaken for a successful, complete response.
  let acc = createChatStreamAccumulator();
  acc = applyStreamChunk(acc, { type: "text", content: "partial answer..." });
  assert.equal(acc.receivedTerminalChunk, false);
  assert.equal(acc.content, "partial answer...");
  assert.ok(unterminatedStreamMessage().length > 0);
});
