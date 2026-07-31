import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db/client";
import { assertWithinRateLimit, RateLimitExceededError } from "@/server/rate-limit/limiter";
import { runConversationTurn } from "@/server/ai/runtime/runtime";
import { createConversation } from "@/server/ai/runtime/conversations";
import { env } from "@/env";
import { logger } from "@/server/logger/logger";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(8000),
});

/**
 * POST /api/ai/chat — send a message to the AI Runtime and get back the
 * final assistant response (tool calls, if any, are resolved server-side
 * before responding). Authenticated via the same session cookie/bearer
 * token as the rest of the app; scoped to the caller's active organization.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  const permitted = await auth.api.hasPermission({
    headers: request.headers,
    body: { organizationId, permissions: { aiConversation: ["create"] } },
  });
  if (!permitted.success) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    const conversation = await createConversation({ organizationId, userId: session.user.id });
    conversationId = conversation.id;
  }

  try {
    const result = await runConversationTurn({
      organizationId,
      userId: session.user.id,
      conversationId,
      userMessage: parsed.data.message,
      requestHeaders: request.headers,
    });

    return NextResponse.json({
      conversationId,
      content: result.content,
      toolRounds: result.toolRounds.map((r) => ({ toolName: r.toolName, status: r.result.status })),
      usage: result.usage,
    });
  } catch (err) {
    logger.error({ err, conversationId, organizationId }, "AI runtime turn failed");
    return NextResponse.json({ error: "AI request failed" }, { status: 502 });
  }
}
