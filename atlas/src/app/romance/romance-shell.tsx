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

/** Consumer-facing shell for Thornbound. Cinematic plum tones, warm gold
 * details and high-contrast controls, separate from Cevoryn's SaaS chrome. */
export function RomanceShell({
  displayName,
  isPremium,
  unreadNotificationCount,
  children,
}: RomanceShellProps) {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#0b0712] text-[#f8edf5]">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-0 bg-[radial-gradient(ellipse_at_14%_8%,rgba(143,54,113,0.28),transparent_36%),radial-gradient(ellipse_at_88%_28%,rgba(95,53,150,0.22),transparent_34%),linear-gradient(180deg,#100817_0%,#0b0712_58%,#100813_100%)]"
      />
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0c0813]/85 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[68px] max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href={ROUTES.ROMANCE_LIBRARY}
            className="min-w-0 font-serif text-[1.4rem] tracking-[-0.035em] text-[#ffe7b0] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f18ab7] sm:text-2xl"
          >
            <span className="mr-2 text-[#f18ab7]" aria-hidden="true">✿</span>
            Thornbound
          </Link>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Link
              href={ROUTES.ROMANCE_LIBRARY}
              className="hidden rounded-full px-3 py-2 text-sm text-[#d8c9df] transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f18ab7] sm:inline-flex"
            >
              Stories
            </Link>
            <BillingShellControl isPremium={isPremium} />
            <NotificationBell unreadCount={unreadNotificationCount} />
            <Link
              href="/romance/admin"
              aria-label="Admin"
              title="Admin"
              className="hidden h-9 w-9 items-center justify-center rounded-full border border-white/15 text-[#e5d3e5] transition hover:border-[#f18ab7]/60 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f18ab7] sm:inline-flex"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
            </Link>
            <span className="hidden max-w-28 truncate text-xs text-[#b6a4bc] lg:inline">{displayName}</span>
            <form action={signOutAction} className="inline-flex">
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-[#e5d3e5] transition hover:border-[#f18ab7]/60 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f18ab7]"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="relative z-10 mx-auto min-h-[calc(100svh-68px)] w-full max-w-6xl px-4 pb-14 pt-7 sm:px-6 sm:pt-10">
        {children}
      </main>
    </div>
  );
}
