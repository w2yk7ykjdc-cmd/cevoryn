import { NextResponse } from "next/server";

import { getInviteAcceptPath } from "@/features/team/invites";
import { forbiddenResponse, notFoundResponse, unauthorizedResponse } from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const { id } = await params;
    const invite = await prisma.invite.findFirst({
      where: {
        id,
        organizationId: membership.organizationId,
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
