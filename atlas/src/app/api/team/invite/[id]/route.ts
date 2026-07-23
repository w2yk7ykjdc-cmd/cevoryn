import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { sendTeamInviteEmail } from "@/features/team/invite-email";
import { getInviteAcceptPath, getInviteExpiresAt } from "@/features/team/invites";
import {
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";

async function requireInviteManager() {
  const user = await getUser();
  if (!user) return { response: unauthorizedResponse() } as const;

  const membership = await getMembership(user.id);
  if (!membership) return { response: forbiddenResponse() } as const;

  if (!hasPermission(membership.role, "members:invite")) {
    return {
      response: forbiddenResponse("Only owners and admins can manage invites"),
    } as const;
  }

  return { membership } as const;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireInviteManager();
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const invite = await prisma.invite.findFirst({
      where: {
        id,
        organizationId: auth.membership.organizationId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      select: { token: true },
    });

    if (!invite) return notFoundResponse("Active invite not found");

    return NextResponse.json({
      data: { acceptPath: getInviteAcceptPath(invite.token) },
    });
  } catch (error) {
    return internalErrorResponse(
      "Invite link",
      error,
      "Failed to load invite link"
    );
  }
}

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireInviteManager();
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const invite = await prisma.invite.findFirst({
      where: {
        id,
        organizationId: auth.membership.organizationId,
        status: "PENDING",
      },
      select: { id: true, email: true, role: true },
    });

    if (!invite) return notFoundResponse("Invite not found");

    if (invite.role === "ADMIN" && auth.membership.role !== "OWNER") {
      return forbiddenResponse("Only owners can renew administrator invites");
    }

    const expiresAt = getInviteExpiresAt();
    const token = randomUUID().replaceAll("-", "");
    const updated = await prisma.invite.updateMany({
      where: {
        id: invite.id,
        organizationId: auth.membership.organizationId,
        status: "PENDING",
      },
      data: { expiresAt, token },
    });

    if (updated.count !== 1) {
      return notFoundResponse("Invite is no longer pending");
    }

    const acceptPath = getInviteAcceptPath(token);
    const emailResult = await sendTeamInviteEmail({
      to: invite.email,
      organizationName: auth.membership.organizationName,
      role: invite.role,
      acceptPath,
      expiresAt,
    });

    return NextResponse.json({
      data: {
        id: invite.id,
        expiresAt: expiresAt.toISOString(),
        acceptPath,
        emailSent: emailResult.sent,
        emailStatus: emailResult.sent ? "SENT" : emailResult.reason,
      },
    });
  } catch (error) {
    return internalErrorResponse(
      "Invite renewal",
      error,
      "Failed to renew invite"
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireInviteManager();
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const invite = await prisma.invite.findFirst({
      where: {
        id,
        organizationId: auth.membership.organizationId,
        status: "PENDING",
      },
      select: { id: true, role: true },
    });

    if (!invite) return notFoundResponse("Invite not found");

    if (invite.role === "ADMIN" && auth.membership.role !== "OWNER") {
      return forbiddenResponse("Only owners can cancel administrator invites");
    }

    const revoked = await prisma.invite.updateMany({
      where: {
        id: invite.id,
        organizationId: auth.membership.organizationId,
        status: "PENDING",
      },
      data: { status: "REVOKED" },
    });

    if (revoked.count !== 1) {
      return notFoundResponse("Invite is no longer pending");
    }

    return NextResponse.json({ data: { id: invite.id } });
  } catch (error) {
    return internalErrorResponse(
      "Invite cancellation",
      error,
      "Failed to cancel invite"
    );
  }
}
