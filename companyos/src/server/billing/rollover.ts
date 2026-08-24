import { prisma } from "@/server/db/client";

/**
 * Advances the billing period for subscriptions whose current period has
 * ended and which have no Stripe-managed lifecycle (`stripeSubscriptionId`
 * is null — i.e. still on the free plan, never checked out). Paid
 * subscriptions get their period advanced by the `customer.subscription.updated`
 * webhook when Stripe renews them, so this job must not touch those or it
 * would race with that webhook.
 *
 * Without this, a free-tier organization's usage window would stay pinned
 * to its first month forever: `getCurrentPeriodUsage` only counts records
 * inside `[currentPeriodStart, currentPeriodEnd)`, so once that window is
 * in the past, new usage falls outside it and `checkUsageLimit` would see
 * zero usage — silently unlimited, rather than correctly rolled over.
 */
export async function rolloverExpiredPeriods(): Promise<number> {
  const expired = await prisma.subscription.findMany({
    where: { currentPeriodEnd: { lte: new Date() }, stripeSubscriptionId: null },
    take: 500,
  });

  let rolled = 0;
  for (const subscription of expired) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        currentPeriodStart: subscription.currentPeriodEnd,
        currentPeriodEnd: addOneMonth(subscription.currentPeriodEnd),
      },
    });
    rolled += 1;
  }
  return rolled;
}

function addOneMonth(date: Date): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}
