import { MemberRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  badRequestResponse,
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canModifyMember, hasPermission } from "@/lib/rbac";

const updateRoleSchema = z.object({
  role: z.enum([MemberRole.ADMIN, MemberRole.MEMBER]),
});

type RouteContext = {
  params: Promise<{ memberId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "members:update-role")) {
      return forbiddenResponse("Only the owner can change member roles");
    }

    const { memberId } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch (_error) {
      return badRequestResponse("Invalid body");
    }

    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse("Role must be ADMIN or MEMBER");
    }

    const target = await prisma.member.findFirst({
      where: {
        id: memberId,
        organizationId: membership.organizationId,
      },
      select: {
        id: true,
        userId: true,
        role: true,
      },
    });

    if (!target) return notFoundResponse("Member not found");

    if (target.userId === membership.userId) {
      return forbiddenResponse("You cannot change your own role");
    }

    if (!canModifyMember(membership.role, target.role)) {
      return forbiddenResponse("You cannot change this member's role");
    }

    const result = await prisma.member.updateMany({
      where: {
        id: target.id,
        organizationId: membership.organizationId,
        role: target.role,
      },
      data: { role: parsed.data.role },
    });

    if (result.count !== 1) {
      return notFoundResponse("Member changed before the request completed");
    }

    return NextResponse.json({
      data: {
        id: target.id,
        role: parsed.data.role,
      },
    });
  } catch (error) {
    return internalErrorResponse(
      "Member role update",
      error,
      "Failed to update member role"
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    if (!hasPermission(membership.role, "members:remove")) {
      return forbiddenResponse("You do not have permission to remove members");
    }

    const { memberId } = await context.params;

    const target = await prisma.member.findFirst({
      where: {
        id: memberId,
        organizationId: membership.organizationId,
      },
      select: {
        id: true,
        userId: true,
        role: true,
      },
    });

    if (!target) return notFoundResponse("Member not found");

    if (target.userId === membership.userId) {
      return forbiddenResponse("You cannot remove yourself");
    }

    if (!canModifyMember(membership.role, target.role)) {
      return forbiddenResponse("You cannot remove this member");
    }

    const result = await prisma.member.deleteMany({
      where: {
        id: target.id,
        organizationId: membership.organizationId,
        role: target.role,
      },
    });

    if (result.count !== 1) {
      return notFoundResponse("Member changed before the request completed");
    }

    return NextResponse.json({ data: { id: target.id } });
  } catch (error) {
    return internalErrorResponse(
      "Member removal",
      error,
      "Failed to remove member"
    );
  }
}
