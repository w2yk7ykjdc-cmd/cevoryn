import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { sendMessageSchema } from "@/features/ai/schemas/message";
import { getMembership, getUser } from "@/lib/auth";
import { sendMessage } from "@/server/services/ai.service";
import { getConversation } from "@/server/services/conversation.service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // 1. Auth
  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
  }

  const membership = await getMembership(user.id);
  if (!membership) {
    return NextResponse.json(
      { error: { code: "NO_MEMBERSHIP", message: "No organization found" } },
      { status: 403 }
    );
  }

  // 2. Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch (_error) {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Invalid request body" } },
      { status: 400 }
    );
  }

  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 }
    );
  }

  // 3. Verify conversation belongs to this organization
  const conversation = await getConversation(
    parsed.data.conversationId,
    membership.organizationId,
    membership.userId
  );
  if (!conversation) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Conversation not found" } },
      { status: 404 }
    );
  }

  // 4. Stream response via SSE
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of sendMessage({
          conversationId: parsed.data.conversationId,
          content: parsed.data.content,
          membership,
        })) {
          const data = `data: ${JSON.stringify(chunk)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Stream failed";
        const errorChunk = `data: ${JSON.stringify({ type: "error", content: message })}\n\n`;
        controller.enqueue(encoder.encode(errorChunk));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
