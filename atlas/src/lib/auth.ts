import { redirect } from "next/navigation";
import "server-only";

import { ROUTES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser, MembershipContext } from "@/types";

// =============================================================================
// User Authentication
// =============================================================================

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

export async function requireUser(): Promise<AuthUser> {
  const user = await getUser();
  if (!user) redirect(ROUTES.LOGIN);
  return user;
}

// =============================================================================
// Organization Membership
// =============================================================================

export async function getMembership(
  userId: string
): Promise<MembershipContext | null> {
  try {
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
  } catch (error) {
    const prismaError = error as { code?: string; meta?: { modelName?: string } };
    console.error("[atlas:auth] getMembership failed", {
      prismaCode: prismaError.code ?? "UNKNOWN",
      model: prismaError.meta?.modelName ?? "member",
      userId: userId.slice(0, 8) + "...",
      message: error instanceof Error ? error.message : "Unknown error",
    });

    if (prismaError.code === "P2021" || prismaError.code === "P2010") {
      console.error(
        "[atlas:auth] Database schema not migrated. Run: npx prisma migrate deploy"
      );
      return null;
    }

    throw error;
  }
}

export async function requireMembership(
  userId: string
): Promise<MembershipContext> {
  const membership = await getMembership(userId);
  if (!membership) redirect(ROUTES.ONBOARDING);
  return membership;
}
