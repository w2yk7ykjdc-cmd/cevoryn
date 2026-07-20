import { NextResponse } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/api-utils";
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
        (c: { id: string; title: string; updatedAt: Date }) => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt.toISOString(),
        })
      ),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    console.error("Conversations GET error:", msg);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to load conversations",
        },
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

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
    const msg = error instanceof Error ? error.message : "Internal error";
    console.error("Conversations POST error:", msg);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to create conversation",
        },
      },
      { status: 500 }
    );
  }
}
