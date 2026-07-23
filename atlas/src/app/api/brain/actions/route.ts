import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  createPreparedAction,
  listPreparedActions,
} from "@/features/brain/actions/action.service";
import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

const createActionSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2000),
  owner: z.string().trim().max(120).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: z.string().datetime().optional(),
  acceptanceCriteria: z
    .array(z.string().trim().min(1).max(300))
    .max(10)
    .default([]),
  reasoning: z
    .string()
    .trim()
    .max(2000)
    .default("Created from Atlas chat workflow"),
  confidence: z.number().min(0).max(1).default(0.8),
});

async function requireMember() {
  const user = await getUser();
  if (!user) return { response: unauthorizedResponse() } as const;

  const membership = await getMembership(user.id);
  if (!membership) return { response: forbiddenResponse() } as const;

  return { membership } as const;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireMember();
    if ("response" in auth) return auth.response;

    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;

    const actions = await listPreparedActions(
      auth.membership.organizationId,
      status
    );
    return NextResponse.json({ data: actions });
  } catch (error) {
    return internalErrorResponse(
      "Actions GET",
      error,
      "Failed to load actions"
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireMember();
    if ("response" in auth) return auth.response;

    if (!hasPermission(auth.membership.role, "ai:use")) {
      return forbiddenResponse("Insufficient permissions");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = createActionSchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse(
        "A valid action title and description are required"
      );
    }

    const action = await createPreparedAction({
      organizationId: auth.membership.organizationId,
      type: "TASK",
      title: parsed.data.title,
      description: parsed.data.description,
      content: {
        owner: parsed.data.owner ?? auth.membership.displayName,
        priority: parsed.data.priority,
        dueDate: parsed.data.dueDate ?? null,
        acceptanceCriteria: parsed.data.acceptanceCriteria,
        createdByUserId: auth.membership.userId,
        source: "CHAT",
      },
      confidence: parsed.data.confidence,
      reasoning: parsed.data.reasoning,
    });

    return NextResponse.json({ data: action }, { status: 201 });
  } catch (error) {
    return internalErrorResponse(
      "Actions POST",
      error,
      "Failed to create action"
    );
  }
}
