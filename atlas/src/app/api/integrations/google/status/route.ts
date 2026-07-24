import { NextResponse } from "next/server";

import {
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type GoogleConnectionStatus = {
  google_email: string;
  expires_at: Date;
  scopes: string;
};

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse("No organization found");

    const connections = await prisma.$queryRaw<GoogleConnectionStatus[]>`
      SELECT "google_email", "expires_at", "scopes"
      FROM "google_connections"
      WHERE "organization_id" = ${membership.organizationId}
        AND "user_id" = ${user.id}
      LIMIT 1
    `;

    const connection = connections[0];
    return NextResponse.json({
      data: connection
        ? {
            connected: true,
            googleEmail: connection.google_email,
            expiresAt: connection.expires_at,
            scopes: connection.scopes.split(" ").filter(Boolean),
          }
        : { connected: false },
    });
  } catch (error) {
    return internalErrorResponse(
      "Google status",
      error,
      "Google connection status could not be loaded"
    );
  }
}
