import { NextResponse } from "next/server";

import { getInviteAcceptPath, getInviteExpiresAt } from "@/features/team/invites";
import { forbiddenResponse, notFoundResponse, unauthorizedResponse } from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";

async function requireInviteManager() {
  const user = await getUser();
  if (!user) return { response: unauthorizedResponse() } as const;

  const membership = await getMembership(user.id);
  if (!membership) return { response: forbiddenResponse() } as const;

  if (!hasPermission(membership.role, "members:invite")) {
    return { response: forbiddenResponse("Only owners and admins can manage invites") } as const;
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
      },
      select: { token: true },
    });

    if (!invite) return notFoundResponse("Invite not found");

    return NextResponse.json({
      data: { acceptPath: getInviteAcceptPath(invite.token) },
    });
  } catch (error) {
    console.error(
      "Invite link error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to load invite link" } },
      { status: 500 }
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
      select: { id: true, role: true, token: true },
    });

    if (!invite) return notFoundResponse("Invite not found");

    if (invite.role === "ADMIN" && auth.membership.role !== "OWNER") {
      return forbiddenResponse("Only owners can renew administrator invites");
    }

    const updated = await prisma.invite.update({
      where: { id: invite.id },
      data: { expiresAt: getInviteExpiresAt() },
      select: { id: true, expiresAt: true },
    });

    return NextResponse.json({
      data: {
        id: updated.id,
        expiresAt: updated.expiresAt.toISOString(),
        acceptPath: getInviteAcceptPath(invite.token),
      },
    });
  } catch (error) {
    console.error(
      "Invite renewal error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to renew invite" } },
      { status: 500 }
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

    await prisma.invite.update({
      where: { id: invite.id },
      data: { status: "REVOKED" },
    });

    return NextResponse.json({ data: { id: invite.id } });
  } catch (error) {
    console.error(
      "Invite cancellation error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to cancel invite" } },
      { status: 500 }
    );
  }
}
