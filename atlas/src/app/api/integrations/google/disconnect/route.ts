import { NextResponse } from "next/server";

import {
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse("No organization found");

    await prisma.$executeRaw`
      DELETE FROM "google_connections"
      WHERE "organization_id" = ${membership.organizationId}
        AND "user_id" = ${user.id}
    `;

    return NextResponse.json({ data: { disconnected: true } });
  } catch (error) {
    return internalErrorResponse(
      "Google disconnect",
      error,
      "Google connection could not be removed"
    );
  }
}
