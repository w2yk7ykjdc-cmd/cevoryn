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
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  tooManyRequestsResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import {
  withMemberCapacityLock,
  PlanLimitError,
} from "@/server/services/entitlement.service";

const MAX_INVITES_PER_HOUR = 10;

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

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const [memberCount, existingInvite, recentInviteCount] = await Promise.all([
      prisma.member.count({
        where: { organizationId: membership.organizationId },
      }),
      prisma.invite.findFirst({
        where: {
          organizationId: membership.organizationId,
          email: parsed.data.email,
          status: "PENDING",
          expiresAt: { gt: now },
        },
      }),
      prisma.invite.count({
        where: {
          invitedBy: membership.userId,
          createdAt: { gte: oneHourAgo },
        },
      }),
    ]);

    if (recentInviteCount >= MAX_INVITES_PER_HOUR) {
      return tooManyRequestsResponse(
        "Invite limit reached. Please try again in an hour.",
        60 * 60
      );
    }

    const eligibility = canCreateInvite({
      memberCount,
      existingPendingInvite: Boolean(existingInvite),
      existingMember: false,
    });

    if (!eligibility.ok) {
      return badRequestResponse(eligibility.message);
    }

    let invite;
    try {
      invite = await withMemberCapacityLock(
        membership.organizationId,
        1,
        (tx) =>
          tx.invite.create({
            data: {
              organizationId: membership.organizationId,
              email: parsed.data.email,
              role: parsed.data.role,
              invitedBy: membership.userId,
              expiresAt: getInviteExpiresAt(),
            },
          })
      );
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return badRequestResponse(error.message);
      }
      throw error;
    }

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
    return internalErrorResponse(
      "Create team invite",
      error,
      "Failed to create invite"
    );
  }
}
