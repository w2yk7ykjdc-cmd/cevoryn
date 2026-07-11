import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { unauthorizedResponse, forbiddenResponse, notFoundResponse, badRequestResponse } from "@/lib/api-utils";
import {
  deleteConversation,
  getConversationWithMessages,
  renameConversation,
} from "@/server/services/conversation.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const conversation = await getConversationWithMessages(id, membership.organizationId);
    if (!conversation) return notFoundResponse("Conversation not found");

    return NextResponse.json({
      data: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
        messages: conversation.messages.map((m: { id: string; role: string; content: string; model: string | null; createdAt: Date }) => ({
          id: m.id, role: m.role, content: m.content, model: m.model, createdAt: m.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error("Conversation GET error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to load conversation" } }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    let body: { title?: string };
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid request body");
    }

    if (!body.title || typeof body.title !== "string") {
      return badRequestResponse("Title is required");
    }

    await renameConversation(id, membership.organizationId, body.title.trim());
    return NextResponse.json({ data: { id, title: body.title.trim() } });
  } catch (error) {
    console.error("Conversation PATCH error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to update conversation" } }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    await deleteConversation(id, membership.organizationId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Conversation DELETE error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to delete conversation" } }, { status: 500 });
  }
}
