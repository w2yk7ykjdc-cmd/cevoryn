/**
 * Hook-level regression coverage for useChat, using jsdom + Testing
 * Library and a mocked fetch that returns a real ReadableStream of SSE
 * bytes — the same shape the browser actually receives from /api/chat.
 */
import "./dom-setup";

import assert from "node:assert/strict";
import test from "node:test";

import { act, renderHook, waitFor } from "@testing-library/react";

import { useChat } from "../src/features/ai/hooks/use-chat";

function sseStreamFrom(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      }
      controller.close();
    },
  });
}

function mockFetchOnce(response: {
  status?: number;
  ok?: boolean;
  body?: ReadableStream<Uint8Array>;
  json?: () => Promise<unknown>;
}) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      status: response.status ?? 200,
      ok: response.ok ?? true,
      body: response.body ?? null,
      json: response.json ?? (async () => ({})),
    }) as unknown as Response) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("a successful stream accumulates text and replaces the temp id with the real one", async () => {
  const restore = mockFetchOnce({
    body: sseStreamFrom([
      JSON.stringify({ type: "text", content: "Hello, " }),
      JSON.stringify({ type: "text", content: "world." }),
      JSON.stringify({ type: "done", messageId: "msg-real-1" }),
    ]),
  });

  try {
    const { result } = renderHook(() => useChat({ conversationId: "conv-1" }));

    await act(async () => {
      await result.current.sendMessage("hi there");
    });

    await waitFor(() => assert.equal(result.current.isStreaming, false));

    const assistant = result.current.messages.find(
      (m) => m.role === "ASSISTANT"
    );
    assert.equal(assistant?.content, "Hello, world.");
    assert.equal(assistant?.id, "msg-real-1");
    assert.equal(result.current.error, null);
  } finally {
    restore();
  }
});

test("an error chunk surfaces the error but keeps partial content visible", async () => {
  const restore = mockFetchOnce({
    body: sseStreamFrom([
      JSON.stringify({ type: "text", content: "Partial answer..." }),
      JSON.stringify({ type: "error", content: "Rate limited" }),
    ]),
  });

  try {
    const { result } = renderHook(() => useChat({ conversationId: "conv-1" }));

    await act(async () => {
      await result.current.sendMessage("hi there");
    });

    await waitFor(() => assert.equal(result.current.isStreaming, false));

    assert.equal(result.current.error, "Rate limited");
    const assistant = result.current.messages.find(
      (m) => m.role === "ASSISTANT"
    );
    assert.equal(assistant?.content, "Partial answer...");
  } finally {
    restore();
  }
});

test("regression: a stream that ends without a done/error chunk is treated as a failure, not a silent success", async () => {
  // This is the exact bug fixed earlier: the connection ending (e.g. the
  // serverless function's maxDuration) must not be mistaken for completion.
  const restore = mockFetchOnce({
    body: sseStreamFrom([
      JSON.stringify({ type: "text", content: "Still writing..." }),
    ]),
  });

  try {
    const { result } = renderHook(() => useChat({ conversationId: "conv-1" }));

    await act(async () => {
      await result.current.sendMessage("hi there");
    });

    await waitFor(() => assert.equal(result.current.isStreaming, false));

    assert.ok(result.current.error);
    assert.match(result.current.error ?? "", /interrupted/i);
    // The partial text is preserved so the user isn't left with nothing.
    const assistant = result.current.messages.find(
      (m) => m.role === "ASSISTANT"
    );
    assert.equal(assistant?.content, "Still writing...");
  } finally {
    restore();
  }
});

test("a non-ok response with no body surfaces the server's error message", async () => {
  const restore = mockFetchOnce({
    ok: false,
    status: 500,
    json: async () => ({
      error: { message: "Failed to process chat request" },
    }),
  });

  try {
    const { result } = renderHook(() => useChat({ conversationId: "conv-1" }));

    await act(async () => {
      await result.current.sendMessage("hi there");
    });

    await waitFor(() => assert.equal(result.current.isStreaming, false));

    assert.equal(result.current.error, "Failed to process chat request");
  } finally {
    restore();
  }
});
