import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import {
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
} from "@/lib/api-utils";
import {
  createMemory,
  deleteMemory,
  listMemories,
} from "@/features/brain/memory/memory.service";
import { createMemorySchema } from "@/features/brain/memory/schemas";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();
    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const url = new URL(request.url);
    const category = url.searchParams.get("category") ?? undefined;
    const memories = await listMemories(membership.organizationId, {
      category,
    });
    return NextResponse.json({ data: memories });
  } catch (error) {
    console.error(
      "Memories GET error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to load memories" } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();
    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = createMemorySchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invalid input");

    const memory = await createMemory(
      membership.organizationId,
      parsed.data,
      "MANUAL"
    );
    return NextResponse.json({ data: memory }, { status: 201 });
  } catch (error) {
    console.error(
      "Memories POST error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create memory" } },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();
    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return badRequestResponse("Memory ID required");

    await deleteMemory(membership.organizationId, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error(
      "Memories DELETE error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to delete memory" } },
      { status: 500 }
    );
  }
}
