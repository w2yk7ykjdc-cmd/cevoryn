import { redirect } from "next/navigation";
import "server-only";

import { ROUTES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser, MembershipContext } from "@/types";

// =============================================================================
// User Authentication
// =============================================================================

/** Get current authenticated user, or null */
export async function getUser(): Promise<AuthUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    emailConfirmedAt: user.email_confirmed_at ?? null,
    createdAt: user.created_at,
  };
}

/** Get current user or redirect to login */
export async function requireUser(): Promise<AuthUser> {
  const user = await getUser();
  if (!user) redirect(ROUTES.LOGIN);
  return user;
}

// =============================================================================
// Organization Membership
// =============================================================================

/** Get user's first organization membership, or null */
export async function getMembership(
  userId: string
): Promise<MembershipContext | null> {
  const member = await prisma.member.findFirst({
    where: { userId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!member) return null;

  return {
    memberId: member.id,
    userId: member.userId,
    organizationId: member.organization.id,
    organizationName: member.organization.name,
    organizationSlug: member.organization.slug,
    role: member.role,
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
  };
}

/** Get membership or redirect to onboarding */
export async function requireMembership(
  userId: string
): Promise<MembershipContext> {
  const membership = await getMembership(userId);
  if (!membership) redirect(ROUTES.ONBOARDING);
  return membership;
}
