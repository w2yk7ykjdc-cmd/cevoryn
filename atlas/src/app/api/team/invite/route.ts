import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { sendTeamInviteEmail } from "@/features/team/invite-email";
import {
  canCreateInvite,
  getInviteAcceptPath,
  getInviteExpiresAt,
} from "@/features/team/invites";
import {
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
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

    if (parsed.data.role === "ADMIN" && membership.role !== "OWNER") {
      return forbiddenResponse("Only owners can invite administrators");
    }

    const [memberCount, existingInvite] = await Promise.all([
      prisma.member.count({
        where: { organizationId: membership.organizationId },
      }),
      prisma.invite.findFirst({
        where: {
          organizationId: membership.organizationId,
          email: parsed.data.email,
          status: "PENDING",
        },
      }),
    ]);

    const eligibility = canCreateInvite({
      memberCount,
      existingPendingInvite: Boolean(existingInvite),
      existingMember: false,
    });

    if (!eligibility.ok) {
      return badRequestResponse(eligibility.message);
    }

    const invite = await prisma.invite.create({
      data: {
        organizationId: membership.organizationId,
        email: parsed.data.email,
        role: parsed.data.role,
        invitedBy: membership.userId,
        expiresAt: getInviteExpiresAt(),
      },
    });

    const acceptPath = getInviteAcceptPath(invite.token);
    const emailResult = await sendTeamInviteEmail({
      to: invite.email,
      organizationName: membership.organizationName,
      role: parsed.data.role,
      acceptPath,
      expiresAt: invite.expiresAt,
    });

    return NextResponse.json(
      {
        data: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt.toISOString(),
          acceptPath,
          emailSent: emailResult.sent,
          emailStatus: emailResult.sent ? "SENT" : emailResult.reason,
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
