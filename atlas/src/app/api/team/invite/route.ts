import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { APP_CONFIG } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

export async function POST(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "members:invite")) {
      return forbiddenResponse("Only owners and admins can invite members");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse("Valid email is required");
    }

    // Check member limit
    const memberCount = await prisma.member.count({
      where: { organizationId: membership.organizationId },
    });
    if (memberCount >= APP_CONFIG.maxMembersPerOrg) {
      return badRequestResponse(
        `Maximum ${APP_CONFIG.maxMembersPerOrg} members per organization`
      );
    }

    // Check for existing active invite in this tenant. Member records only store
    // Supabase user ids, so invite email comparisons must remain on Invite rows.
    const existingInvite = await prisma.invite.findFirst({
      where: {
        organizationId: membership.organizationId,
        email: parsed.data.email,
        status: { in: ["PENDING", "ACCEPTED"] },
      },
    });
    if (existingInvite?.status === "PENDING") {
      return badRequestResponse("An invite for this email is already pending");
    }

    if (existingInvite?.status === "ACCEPTED") {
      return badRequestResponse("This email has already accepted an invite");
    }

    const invite = await prisma.invite.create({
      data: {
        organizationId: membership.organizationId,
        email: parsed.data.email,
        role: parsed.data.role,
        invitedBy: membership.userId,
        expiresAt: new Date(
          Date.now() + APP_CONFIG.inviteExpirationDays * 24 * 60 * 60 * 1000
        ),
      },
    });

    return NextResponse.json(
      {
        data: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(
      "Invite error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create invite" } },
      { status: 500 }
    );
  }
}
