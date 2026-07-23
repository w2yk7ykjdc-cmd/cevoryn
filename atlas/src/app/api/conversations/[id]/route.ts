import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { CONVERSATION_CONFIG } from "@/lib/constants";
import { hasPermission } from "@/lib/rbac";
import {
  archiveConversation,
  deleteConversation,
  getConversationWithMessages,
  renameConversation,
} from "@/server/services/conversation.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const updateConversationSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title cannot be empty")
      .max(CONVERSATION_CONFIG.maxTitleLength)
      .optional(),
    archived: z.literal(true).optional(),
  })
  .refine((value) => value.title !== undefined || value.archived === true, {
    message: "A title or archive action is required",
  });

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const conversation = await getConversationWithMessages(
      id,
      membership.organizationId,
      membership.userId
    );
    if (!conversation) return notFoundResponse("Conversation not found");

    return NextResponse.json({
      data: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
        messages: conversation.messages.map(
          (message: {
            id: string;
            role: string;
            content: string;
            model: string | null;
            createdAt: Date;
          }) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            model: message.model,
            createdAt: message.createdAt.toISOString(),
          })
        ),
      },
    });
  } catch (error) {
    return internalErrorResponse(
      "Conversation GET",
      error,
      "Failed to load conversation"
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "ai:use")) {
      return forbiddenResponse("Insufficient permissions");
    }

    const body = await request.json().catch(() => null);
    const parsed = updateConversationSchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse(
        parsed.error.issues[0]?.message ?? "Invalid request body"
      );
    }

    if (parsed.data.archived === true) {
      const archived = await archiveConversation(
        id,
        membership.organizationId,
        membership.userId
      );
      if (archived.count === 0) {
        return notFoundResponse("Conversation not found");
      }

      return NextResponse.json({ data: { id, archived: true } });
    }

    const title = parsed.data.title;
    if (!title) return badRequestResponse("Title is required");

    const renamed = await renameConversation(
      id,
      membership.organizationId,
      title,
      membership.userId
    );
    if (renamed.count === 0) {
      return notFoundResponse("Conversation not found");
    }

    return NextResponse.json({ data: { id, title } });
  } catch (error) {
    return internalErrorResponse(
      "Conversation PATCH",
      error,
      "Failed to update conversation"
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "ai:use")) {
      return forbiddenResponse("Insufficient permissions");
    }

    const deleted = await deleteConversation(
      id,
      membership.organizationId,
      membership.userId
    );
    if (deleted.count === 0) {
      return notFoundResponse("Conversation not found");
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return internalErrorResponse(
      "Conversation DELETE",
      error,
      "Failed to delete conversation"
    );
  }
}
