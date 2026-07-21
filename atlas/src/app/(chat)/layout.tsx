import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getMembership, requireUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";

/**
 * Chat gets its own route group with a full-screen layout.
 * Auth and membership are enforced, but the dashboard shell
 * (sidebar, header) is NOT rendered — the chat has its own chrome.
 */
export default async function ChatRouteLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const membership = await getMembership(user.id);

  if (!membership) {
    redirect(ROUTES.ONBOARDING);
  }

  return <div className="flex h-screen overflow-hidden">{children}</div>;
}
