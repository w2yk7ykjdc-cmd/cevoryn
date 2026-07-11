import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getMembership, requireUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";

export default async function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const membership = await getMembership(user.id);

  // Already has an org — skip onboarding
  if (membership) {
    redirect(ROUTES.DASHBOARD);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted px-4 py-12">
      {children}
    </div>
  );
}
