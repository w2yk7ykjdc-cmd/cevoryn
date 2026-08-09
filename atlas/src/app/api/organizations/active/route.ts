import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import {
  ACTIVE_ORGANIZATION_COOKIE,
  getOrganizationMemberships,
  getUser,
} from "@/lib/auth";

const requestSchema = z.object({
  organizationId: z.string().cuid(),
});

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse("Valid organization is required");
    }

    const memberships = await getOrganizationMemberships(user.id);
    const allowed = memberships.some(
      (membership) => membership.organizationId === parsed.data.organizationId
    );

    if (!allowed) {
      return forbiddenResponse("You do not belong to this organization");
    }

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORGANIZATION_COOKIE, parsed.data.organizationId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    return internalErrorResponse(
      "Switch active organization",
      error,
      "Failed to switch organization"
    );
  }
}
