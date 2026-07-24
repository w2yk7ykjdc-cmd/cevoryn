import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getInviteAcceptPath } from "@/features/team/invites";
import { OnboardingForm } from "@/features/onboarding/components/onboarding-form";
import { getMembership, requireUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage() {
  const user = await requireUser();

  const membership = await getMembership(user.id);
  if (membership) {
    redirect(ROUTES.DASHBOARD);
  }

  const pendingInvite = await prisma.invite.findFirst({
    where: {
      email: { equals: user.email, mode: "insensitive" },
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    select: { token: true },
    orderBy: { createdAt: "desc" },
  });

  if (pendingInvite) {
    redirect(getInviteAcceptPath(pendingInvite.token));
  }

  return <OnboardingForm userEmail={user.email} />;
}
