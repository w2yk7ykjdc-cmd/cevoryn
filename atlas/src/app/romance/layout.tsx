import type { ReactNode } from "react";

import { isRomancePremiumActive } from "@/features/romance/billing/entitlement-math";
import { getRomanceSubscription } from "@/features/romance/billing/romance-subscription.service";
import { countUnreadRomanceNotifications } from "@/features/romance/notifications/romance-notification.service";
import { requireRomancePlayer } from "@/features/romance/player/romance-player-guards";

import { RomanceShell } from "./romance-shell";

/**
 * Auth boundary only (requireRomancePlayer() calls Cevoryn's own
 * requireUser() - no parallel auth system, per the product contract).
 * The 18+ gate is deliberately NOT enforced here: the age-gate page
 * itself renders under this same layout, and enforcing it here would
 * redirect-loop it. Every other page under /romance calls
 * requireAdultRomancePlayer() itself.
 */
export default async function RomanceLayout({ children }: { children: ReactNode }) {
  const { player } = await requireRomancePlayer();
  const [subscription, unreadNotificationCount] = await Promise.all([
    getRomanceSubscription(player.id),
    countUnreadRomanceNotifications(player.id),
  ]);
  return (
    <RomanceShell
      displayName={player.displayName}
      isPremium={isRomancePremiumActive(subscription)}
      unreadNotificationCount={unreadNotificationCount}
    >
      {children}
    </RomanceShell>
  );
}
