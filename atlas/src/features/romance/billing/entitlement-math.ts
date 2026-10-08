/**
 * Pure entitlement check - no Prisma, no "server-only", so it's directly
 * unit-testable and reusable from both the audio-render gate
 * (submit-action.ts) and any future UI premium-check.
 */

export interface RomanceSubscriptionLike {
  plan: string;
  status: string;
  currentPeriodEnd: Date | null;
}

/**
 * A player is entitled to premium features (currently: audio narration -
 * see Product Bible's "Premium voice performance") only when all three
 * hold: plan is PREMIUM, status is ACTIVE, and (if a period end is set)
 * it has not yet passed. A player who canceled stays entitled through the
 * end of their paid period, matching how Polar/Cevoryn's existing B2B
 * subscription already behaves (status stays ACTIVE with
 * cancel_at_period_end=true until the period actually ends).
 */
export function isRomancePremiumActive(
  subscription: RomanceSubscriptionLike | null,
  now: Date = new Date()
): boolean {
  if (!subscription) return false;
  if (subscription.plan !== "PREMIUM") return false;
  if (subscription.status !== "ACTIVE") return false;
  if (subscription.currentPeriodEnd && subscription.currentPeriodEnd < now) {
    return false;
  }
  return true;
}
