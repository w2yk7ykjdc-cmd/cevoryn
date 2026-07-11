import "server-only";

import { prisma } from "@/lib/prisma";
import type { MemberRole } from "@/types";

export async function getMemberByUserId(
  userId: string,
  organizationId: string
) {
  return prisma.member.findUnique({
    where: {
      userId_organizationId: { userId, organizationId },
    },
  });
}

export async function getUserMemberships(userId: string) {
  return prisma.member.findMany({
    where: { userId },
    include: {
      organization: {
        select: { id: true, name: true, slug: true, logoUrl: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function updateMemberRole(
  memberId: string,
  role: MemberRole
) {
  return prisma.member.update({
    where: { id: memberId },
    data: { role },
  });
}

export async function updateMemberProfile(
  memberId: string,
  data: { displayName?: string; avatarUrl?: string | null }
) {
  return prisma.member.update({
    where: { id: memberId },
    data,
  });
}

export async function removeMember(memberId: string) {
  return prisma.member.delete({
    where: { id: memberId },
  });
}

export async function getOrganizationMemberCount(
  organizationId: string
): Promise<number> {
  return prisma.member.count({
    where: { organizationId },
  });
}
