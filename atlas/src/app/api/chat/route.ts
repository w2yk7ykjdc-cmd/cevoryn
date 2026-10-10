import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { sendMessageSchema } from "@/features/ai/schemas/message";
import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { AI_CONFIG } from "@/lib/constants";
import { captureServerError } from "@/lib/error-reporting";
import { hasPermission } from "@/lib/rbac";
import { sendMessage } from "@/server/services/ai.service";
import { getConversation } from "@/server/services/conversation.service";
import {
  PlanLimitError,
  releaseAiTokenReservation,
  reserveAiTokenCapacity,
} from "@/server/services/entitlement.service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse("No organization found");

    if (!hasPermission(membership.role, "ai:use")) {
      return forbiddenResponse("Insufficient permissions");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid request body");
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
    if (!conversation) return notFoundResponse("Conversation not found");

    let reservationId: string;
    try {
      // Reserves a conservative worst-case token estimate atomically,
      // checking the monthly org cap and the daily org/per-user caps in
      // the same locked transaction - closing the check-then-act race a
      // plain "check usage, act later" read would have against concurrent
      // requests for the same organization or user. Reconciled to the
      // real usage (or released) once the stream finishes below.
      reservationId = await reserveAiTokenCapacity({
        organizationId: membership.organizationId,
        userId: membership.userId,
        conversationId: parsed.data.conversationId,
        model: AI_CONFIG.defaultModel,
        estimatedTokens: AI_CONFIG.maxOutputTokens,
      });
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return NextResponse.json(
          {
            error: {
              code: error.code,
              message: error.message,
            },
          },
          { status: 429 }
        );
      }
      throw error;
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let reconciled = false;
        try {
          for await (const chunk of sendMessage({
            conversationId: parsed.data.conversationId,
            content: parsed.data.content,
            membership,
            reservationId,
          })) {
            if (chunk.type === "done" || chunk.type === "error") {
              reconciled = true;
            }
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
            );
          }
        } catch (error) {
          captureServerError("chat-route", error, {
            organizationId: membership.organizationId,
            conversationId: parsed.data.conversationId,
          });
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                content:
                  "The response could not be completed. Please try again.",
              })}\n\n`
            )
          );
        } finally {
          if (!reconciled) {
            await releaseAiTokenReservation(reservationId).catch((error) => {
              captureServerError("chat-route-reservation-release", error, {
                organizationId: membership.organizationId,
                reservationId,
              });
            });
          }
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
    return internalErrorResponse(
      "Chat POST",
      error,
      "Failed to process chat request"
    );
  }
}
