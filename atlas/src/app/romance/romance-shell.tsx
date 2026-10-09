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

/** Consumer-facing shell for Thornbound. Warm editorial palette, restrained
 * rose accents and high-contrast controls; no internal SaaS navigation. */
export function RomanceShell({
  displayName,
  isPremium,
  unreadNotificationCount,
  children,
}: RomanceShellProps) {
  return (
    <div className="min-h-screen overflow-x-clip bg-[#fbf7f3] text-[#2d211f]">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-0 bg-[radial-gradient(ellipse_at_top_right,rgba(221,151,158,0.15),transparent_38%),linear-gradient(180deg,#fffdfa_0%,#fbf5f1_58%,#f7eeea_100%)]" />
      <header className="sticky top-0 z-20 border-b border-[#eadbd5]/80 bg-[#fffdfa]/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[68px] max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href={ROUTES.ROMANCE_LIBRARY}
            className="min-w-0 font-serif text-[1.35rem] tracking-[-0.035em] text-[#342421] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#bd4968] sm:text-2xl"
          >
            <span className="mr-2 text-[#bd4968]" aria-hidden="true">♡</span>
            Thornbound
          </Link>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <BillingShellControl isPremium={isPremium} />
            <NotificationBell unreadCount={unreadNotificationCount} />
            <Link
              href="/romance/admin"
              aria-label="Admin"
              title="Admin"
              className="hidden h-9 w-9 items-center justify-center rounded-full border border-[#eadbd5] text-[#705d58] transition hover:border-[#bd4968]/40 hover:bg-[#faedf0] hover:text-[#a52f50] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bd4968] sm:inline-flex"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
            </Link>
            <span className="hidden max-w-28 truncate text-xs text-[#887671] lg:inline">{displayName}</span>
            <form action={signOutAction} className="inline-flex">
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#eadbd5] text-[#705d58] transition hover:border-[#bd4968]/40 hover:bg-[#faedf0] hover:text-[#a52f50] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bd4968]"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="relative z-10 mx-auto min-h-[calc(100svh-68px)] w-full max-w-5xl px-4 pb-12 pt-7 sm:px-6 sm:pt-10">
        {children}
      </main>
    </div>
  );
}
