import Link from "next/link";
import type { ReactNode } from "react";

import { signOutAction } from "@/features/auth/actions/auth";
import { BillingShellControl } from "@/features/romance/billing/components/billing-shell-control";
import { NotificationBell } from "@/features/romance/notifications/components/notification-bell";
import { ROUTES } from "@/lib/constants";

interface RomanceShellProps {
  displayName: string;
  isPremium: boolean;
  unreadNotificationCount: number;
  children: ReactNode;
}

/**
 * Minimal, atmospheric shell for the Romance product - deliberately NOT
 * the B2B DashboardShell (no org switcher, no team nav; ADR-0001: a
 * Romance player never sees "organization"/"team" anywhere). Dark,
 * low-chrome, so the story itself is the focus.
 */
export function RomanceShell({
  displayName,
  isPremium,
  unreadNotificationCount,
  children,
}: RomanceShellProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#160c1e] via-[#1a0f22] to-[#0d0712] text-[#f1e9f4]">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#120a18]/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link
            href={ROUTES.ROMANCE_LIBRARY}
            className="font-serif text-lg tracking-wide text-[#f1e9f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0]"
          >
            Thornbound
          </Link>
          <div className="flex items-center gap-3 text-sm text-white/60">
            <BillingShellControl isPremium={isPremium} />
            <NotificationBell unreadCount={unreadNotificationCount} />
            <Link
              href="/romance/admin"
              className="hidden rounded-md px-2 py-1 underline hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0] sm:inline"
            >
              Admin
            </Link>
            <span className="hidden sm:inline">{displayName}</span>
            <form action={signOutAction} className="inline">
              <button
                type="submit"
                className="rounded-md px-2 py-1 underline hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0]"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
