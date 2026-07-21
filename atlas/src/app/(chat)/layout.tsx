import { AlertTriangle } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getMembership, requireUser } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";

function isNextRedirect(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "digest" in error &&
      String(error.digest).startsWith("NEXT_REDIRECT")
  );
}

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
  try {
    const user = await requireUser();
    const membership = await getMembership(user.id);

    if (!membership) {
      redirect(ROUTES.ONBOARDING);
    }

    return <div className="flex h-screen overflow-hidden">{children}</div>;
  } catch (error) {
    if (isNextRedirect(error)) throw error;

    console.error(
      "Chat layout error:",
      error instanceof Error ? error.message : "unknown"
    );

    return (
      <div className="flex h-screen items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">Unable to load chat</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Atlas could not load your workspace. Refresh the page after the service recovers.
          </p>
        </div>
      </div>
    );
  }
}
