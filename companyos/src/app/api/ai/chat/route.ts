import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db/client";
import { assertWithinRateLimit, RateLimitExceededError } from "@/server/rate-limit/limiter";
import { runConversationTurn, streamConversationTurn } from "@/server/ai/runtime/runtime";
import { createConversation } from "@/server/ai/runtime/conversations";
import { UsageLimitExceededError } from "@/server/billing/usage";
import type { StreamEvent } from "@/server/ai/providers/types";
import { hasScope, mintSessionForApiKey, verifyApiKey } from "@/server/api-keys/service";
import { InvalidApiKeyError } from "@/server/api-keys/types";
import { env } from "@/env";
import { logger } from "@/server/logger/logger";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(8000),
  /** When true, respond with a text/event-stream of StreamEvents instead of one JSON body. */
  stream: z.boolean().optional().default(false),
});

type ResolvedCaller = { organizationId: string; userId: string; requestHeaders: Headers };
type CallerResolution = { ok: true; caller: ResolvedCaller } | { ok: false; status: number; error: string };

/**
 * Resolves who's calling and which headers to use for every downstream
 * RBAC check. Two paths:
 *
 * - Session cookie/bearer token (a logged-in user): the existing
 *   `aiConversation:create` permission check, exactly as before.
 * - `Authorization: Bearer cos_live_...` API key: verified against
 *   `ApiKey.keyHash`, then a short-lived Better Auth session is minted for
 *   the key's creator (see `mintSessionForApiKey`) so every downstream
 *   permission check — including each tool call's own `hasPermission` —
 *   runs through the exact same path a real session would, scoped to
 *   whatever that person's role actually permits. An API key additionally
 *   needs the `ai:chat` scope.
 */
async function resolveCaller(request: Request): Promise<CallerResolution> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (session) {
    const organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return { ok: false, status: 400, error: "No active organization" };
    }
    const permitted = await auth.api.hasPermission({
      headers: request.headers,
      body: { organizationId, permissions: { aiConversation: ["create"] } },
    });
    if (!permitted.success) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
    return { ok: true, caller: { organizationId, userId: session.user.id, requestHeaders: request.headers } };
  }

  const authHeader = request.headers.get("authorization");
  const bearerKey = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;
  if (!bearerKey) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  try {
    const verified = await verifyApiKey(bearerKey);
    if (!hasScope(verified, "ai:chat")) {
      return { ok: false, status: 403, error: "This API key does not have the ai:chat scope" };
    }
    const sessionToken = await mintSessionForApiKey(verified);
    return {
      ok: true,
      caller: {
        organizationId: verified.organizationId,
        userId: verified.userId,
        requestHeaders: new Headers({ authorization: `Bearer ${sessionToken}` }),
      },
    };
  } catch (err) {
    if (err instanceof InvalidApiKeyError) {
      return { ok: false, status: 401, error: err.message };
    }
    throw err;
  }
}

/**
 * POST /api/ai/chat — send a message to the AI Runtime and get back the
 * final assistant response (tool calls, if any, are resolved server-side
 * before responding). Authenticated via a session cookie/bearer token
 * (the logged-in dashboard user) or an `Authorization: Bearer` API key
 * with the `ai:chat` scope (see `/dashboard/settings/api-keys`); either
 * way, scoped to the caller's organization.
 */
export async function POST(request: Request) {
  const resolution = await resolveCaller(request);
  if (!resolution.ok) {
    return NextResponse.json({ error: resolution.error }, { status: resolution.status });
  }
  const { organizationId, userId, requestHeaders } = resolution.caller;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    await assertWithinRateLimit(`org:${organizationId}:ai-chat`, {
      limit: env.RATE_LIMIT_REQUESTS_PER_MINUTE,
      windowSeconds: 60,
    });
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json(
        { error: "Rate limit exceeded", resetAt: err.result.resetAt },
        { status: 429 },
      );
    }
    throw err;
  }

  let conversationId = parsed.data.conversationId;
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
  } else {
    const conversation = await createConversation({ organizationId, userId });
    conversationId = conversation.id;
  }

  if (parsed.data.stream) {
    return streamChatResponse({
      organizationId,
      userId,
      conversationId,
      userMessage: parsed.data.message,
      requestHeaders,
    });
  }

  try {
    const result = await runConversationTurn({
      organizationId,
      userId,
      conversationId,
      userMessage: parsed.data.message,
      requestHeaders,
    });

    return NextResponse.json({
      conversationId,
      content: result.content,
      toolRounds: result.toolRounds.map((r) => ({ toolName: r.toolName, status: r.result.status })),
      usage: result.usage,
    });
  } catch (err) {
    if (err instanceof UsageLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    logger.error({ err, conversationId, organizationId }, "AI runtime turn failed");
    return NextResponse.json({ error: "AI request failed" }, { status: 502 });
  }
}

/**
 * Builds the SSE response for `stream: true`. The generator's first step is
 * awaited before the `Response` is constructed so early failures (a usage
 * limit already exhausted, the conversation lookup) still return a normal
 * JSON error with the right status — only genuinely mid-stream failures
 * become an in-band `{"type":"error"}` event.
 */
async function streamChatResponse(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  userMessage: string;
  requestHeaders: Headers;
}): Promise<Response> {
  const generator = streamConversationTurn(input);

  let first: IteratorResult<StreamEvent, void>;
  try {
    first = await generator.next();
  } catch (err) {
    if (err instanceof UsageLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    logger.error({ err, conversationId: input.conversationId, organizationId: input.organizationId }, "AI runtime stream failed to start");
    return NextResponse.json({ error: "AI request failed" }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      send({ type: "conversation", conversationId: input.conversationId });

      try {
        let next = first;
        while (!next.done) {
          send(next.value);
          next = await generator.next();
        }
      } catch (err) {
        logger.error(
          { err, conversationId: input.conversationId, organizationId: input.organizationId },
          "AI runtime stream failed mid-stream",
        );
        send({ type: "error", message: "AI request failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
