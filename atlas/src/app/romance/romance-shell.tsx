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
    <div className="relative min-h-screen overflow-x-clip bg-[#fbf5ee] text-[#382738]">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-0 bg-[radial-gradient(ellipse_at_14%_8%,rgba(225,151,177,0.24),transparent_36%),radial-gradient(ellipse_at_88%_28%,rgba(226,188,151,0.28),transparent_34%),linear-gradient(180deg,#fffaf5_0%,#f8eee8_58%,#fdf6ef_100%)]"
      />
      <header className="sticky top-0 z-20 border-b border-[#7b5a70]/15 bg-[#fffaf6]/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[68px] max-w-6xl items-center justify-between gap-1 px-2 py-3 sm:gap-3 sm:px-6">
          <Link
            href={ROUTES.ROMANCE_LIBRARY}
            className="min-w-0 shrink font-serif text-[1.08rem] tracking-[-0.035em] text-[#6e435b] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f18ab7] sm:text-2xl"
          >
            <span className="mr-1.5 text-[#bd648d] sm:mr-2" aria-hidden="true">✿</span>
            Thornbound
          </Link>
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <Link
              href={ROUTES.ROMANCE_LIBRARY}
              className="hidden rounded-full px-3 py-2 text-sm text-[#775d75] transition hover:text-[#382738] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f18ab7] sm:inline-flex"
            >
              Stories
            </Link>
            <BillingShellControl isPremium={isPremium} />
            <NotificationBell unreadCount={unreadNotificationCount} />
            <Link
              href="/romance/admin"
              aria-label="Admin"
              title="Admin"
              className="hidden h-9 w-9 items-center justify-center rounded-full border border-[#8e6b82]/25 text-[#76586f] transition hover:border-[#f18ab7]/60 hover:bg-[#f2e2e8] hover:text-[#382738] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f18ab7] sm:inline-flex"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
            </Link>
            <span className="hidden max-w-28 truncate text-xs text-[#806c7e] lg:inline">{displayName}</span>
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
