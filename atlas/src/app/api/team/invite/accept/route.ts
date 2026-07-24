import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canAcceptInvite } from "@/features/team/invites";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { ACTIVE_ORGANIZATION_COOKIE, getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const acceptInviteSchema = z.object({
  token: z.string().trim().min(1),
});

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => null);
    const parsed = acceptInviteSchema.safeParse(body);
    if (!parsed.success) return badRequestResponse("Invite token is required");

    const invite = await prisma.invite.findUnique({
      where: { token: parsed.data.token },
      include: {
        organization: { select: { id: true, name: true } },
      },
    });

    if (!invite) return notFoundResponse("Invite not found");

    const eligibility = canAcceptInvite({
      inviteEmail: invite.email,
      userEmail: user.email,
      status: invite.status,
      expiresAt: invite.expiresAt,
    });

    if (!eligibility.ok) {
      if (
        invite.status === "PENDING" &&
        invite.expiresAt.getTime() <= Date.now()
      ) {
        await prisma.invite.updateMany({
          where: { id: invite.id, status: "PENDING" },
          data: { status: "EXPIRED" },
        });
      }

      return badRequestResponse(eligibility.message);
    }

    const accepted = await prisma.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: {
          id: invite.id,
          status: "PENDING",
          expiresAt: { gt: new Date() },
        },
        data: { status: "ACCEPTED" },
      });

      if (claimed.count !== 1) return false;

      await tx.member.upsert({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: invite.organizationId,
          },
        },
        update: {},
        create: {
          userId: user.id,
          organizationId: invite.organizationId,
          role: invite.role,
          displayName: user.email.split("@")[0] || user.email,
        },
      });

      return true;
    });

    if (!accepted) {
      return badRequestResponse("This invite has already been used or expired");
    }

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORGANIZATION_COOKIE, invite.organizationId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return NextResponse.json({
      data: {
        organizationId: invite.organization.id,
        organizationName: invite.organization.name,
      },
    });
  } catch (error) {
    return internalErrorResponse(
      "Invite acceptance",
      error,
      "Failed to accept invite"
    );
  }
}
