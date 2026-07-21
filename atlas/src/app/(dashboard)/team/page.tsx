import type { Metadata } from "next";

import { getInviteAcceptPath } from "@/features/team/invites";
import { requireMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";

import { TeamClient } from "./team-client";

export const metadata: Metadata = { title: "Team — Atlas" };

export default async function TeamPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);

  const [members, pendingInvites] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        userId: true,
        displayName: true,
        role: true,
        createdAt: true,
      },
    }),
    prisma.invite.findMany({
      where: {
        organizationId: membership.organizationId,
        status: "PENDING",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        token: true,
      },
    }),
  ]);

  return (
    <TeamClient
      orgName={membership.organizationName}
      currentUserId={membership.userId}
      currentUserRole={membership.role}
      canInvite={hasPermission(membership.role, "members:invite")}
      canRemoveMembers={hasPermission(membership.role, "members:remove")}
      canUpdateRoles={hasPermission(membership.role, "members:update-role")}
      members={members.map((member) => ({
        id: member.id,
        userId: member.userId,
        displayName: member.displayName,
        role: member.role,
        joinedAt: member.createdAt.toISOString(),
      }))}
      pendingInvites={pendingInvites.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
        acceptPath: getInviteAcceptPath(invite.token),
      }))}
    />
  );
}
