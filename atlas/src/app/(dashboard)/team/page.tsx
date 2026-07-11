import type { Metadata } from "next";

import { requireMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRoleAtLeast } from "@/lib/rbac";

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
      },
    }),
  ]);

  const canInvite = isRoleAtLeast(membership.role, "ADMIN");

  return (
    <TeamClient
      orgName={membership.organizationName}
      currentUserId={membership.userId}
      canInvite={canInvite}
      members={members.map((m: { id: string; userId: string; displayName: string; role: string; createdAt: Date }) => ({
        id: m.id,
        userId: m.userId,
        displayName: m.displayName,
        role: m.role,
        joinedAt: m.createdAt.toISOString(),
      }))}
      pendingInvites={pendingInvites.map((i: { id: string; email: string; role: string; expiresAt: Date }) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
      }))}
    />
  );
}
