import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { sendMessageSchema } from "@/features/ai/schemas/message";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { sendMessage } from "@/server/services/ai.service";
import { getConversation } from "@/server/services/conversation.service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
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

    if (!hasPermission(membership.role, "ai:use")) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
        { status: 403 }
      );
    }

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

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of sendMessage({
            conversationId: parsed.data.conversationId,
            content: parsed.data.content,
            membership,
          })) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
            );
          }
        } catch (error) {
          console.error(
            "Chat stream error:",
            error instanceof Error ? error.message : "unknown"
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                content: "The response could not be completed. Please try again.",
              })}\n\n`
            )
          );
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
  } catch (error) {
    console.error(
      "Chat POST error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to process chat request",
        },
      },
      { status: 500 }
    );
  }
}
