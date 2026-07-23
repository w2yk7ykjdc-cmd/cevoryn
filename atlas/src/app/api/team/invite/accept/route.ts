import { NextResponse } from "next/server";
import { z } from "zod";

import { canAcceptInvite } from "@/features/team/invites";
import {
  badRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getUser } from "@/lib/auth";
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
        await prisma.invite.update({
          where: { id: invite.id },
          data: { status: "EXPIRED" },
        });
      }

      return badRequestResponse(eligibility.message);
    }

    await prisma.$transaction(async (tx) => {
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

      await tx.invite.update({
        where: { id: invite.id },
        data: { status: "ACCEPTED" },
      });
    });

    return NextResponse.json({
      data: {
        organizationId: invite.organization.id,
        organizationName: invite.organization.name,
      },
    });
  } catch (error) {
    console.error(
      "Invite acceptance error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to accept invite" } },
      { status: 500 }
    );
  }
}
