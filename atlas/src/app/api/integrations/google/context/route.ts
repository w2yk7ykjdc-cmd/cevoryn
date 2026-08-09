import { NextResponse } from "next/server";

import {
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { GoogleConnectionError } from "@/lib/google-connection";
import { getGoogleWorkspaceContext } from "@/lib/google-data";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse("No organization found");

    const context = await getGoogleWorkspaceContext(
      membership.organizationId,
      user.id
    );

    return NextResponse.json({ data: context });
  } catch (error) {
    if (error instanceof GoogleConnectionError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.code === "NOT_CONNECTED" ? 404 : 409 }
      );
    }

    return internalErrorResponse(
      "Google workspace context",
      error,
      "Google workspace data could not be loaded"
    );
  }
}
