import { LogOut, Settings } from "lucide-react";
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
 * low-chrome, so the story itself is the focus. Header controls are
 * real icon/pill buttons, not plain underlined text links - this is a
 * paid consumer product, and its own header shouldn't look like an
 * internal tool.
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
            className="font-serif text-xl font-semibold tracking-wide text-[#f1e9f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0]"
          >
            Thornbound
          </Link>
          <div className="flex items-center gap-1.5 text-sm text-white/60 sm:gap-2">
            <BillingShellControl isPremium={isPremium} />
            <NotificationBell unreadCount={unreadNotificationCount} />
            <Link
              href="/romance/admin"
              aria-label="Admin"
              className="hidden shrink-0 items-center justify-center rounded-full p-1.5 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0] sm:inline-flex"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
            </Link>
            <span className="hidden text-xs text-white/40 sm:inline">{displayName}</span>
            <form action={signOutAction} className="inline-flex">
              <button
                type="submit"
                aria-label="Sign out"
                className="inline-flex shrink-0 items-center justify-center rounded-full p-1.5 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a7e0]"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
