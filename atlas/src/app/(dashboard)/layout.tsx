import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getMembership, requireUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";

import { DashboardShell } from "./dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const membership = await getMembership(user.id);

  if (!membership) {
    redirect(ROUTES.ONBOARDING);
  }

  return (
    <DashboardShell membership={membership} userEmail={user.email}>
      {children}
    </DashboardShell>
  );
}
