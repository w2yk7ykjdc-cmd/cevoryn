import { NextResponse } from "next/server";
import { z } from "zod";

import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

export async function PATCH(request: Request) {
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

    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse("Name must be between 1 and 80 characters");
    }

    const updated = await prisma.member.updateMany({
      where: { id: membership.memberId, userId: membership.userId },
      data: { displayName: parsed.data.displayName },
    });

    if (updated.count === 0) return notFoundResponse("Profile not found");

    return NextResponse.json({
      data: { displayName: parsed.data.displayName },
    });
  } catch (error) {
    return internalErrorResponse(
      "Profile update",
      error,
      "Failed to update profile"
    );
  }
}
