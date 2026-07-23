import { NextResponse } from "next/server";

import {
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import {
  createConversation,
  listConversations,
} from "@/server/services/conversation.service";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const conversations = await listConversations(
      membership.organizationId,
      membership.userId
    );

    return NextResponse.json({
      data: conversations.map(
        (conversation: { id: string; title: string; updatedAt: Date }) => ({
          id: conversation.id,
          title: conversation.title,
          updatedAt: conversation.updatedAt.toISOString(),
        })
      ),
    });
  } catch (error) {
    return internalErrorResponse(
      "Conversations GET",
      error,
      "Failed to load conversations"
    );
  }
}

export async function POST() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "ai:use")) {
      return forbiddenResponse("Insufficient permissions");
    }

    const conversation = await createConversation({
      organizationId: membership.organizationId,
      createdById: membership.userId,
    });

    return NextResponse.json(
      {
        data: {
          id: conversation.id,
          title: conversation.title,
          updatedAt: conversation.updatedAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return internalErrorResponse(
      "Conversations POST",
      error,
      "Failed to create conversation"
    );
  }
}
