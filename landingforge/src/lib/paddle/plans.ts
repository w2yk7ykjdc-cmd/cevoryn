import { Plan } from "@prisma/client";

// Returns null (not FREE) when the price ID doesn't match a known plan -
// callers must not silently treat "unrecognized" the same as "no plan",
// since a webhook for a real paid subscription with a drifted/unmapped
// price ID would otherwise downgrade a paying customer to FREE.
export function planFromPriceId(priceId: string | undefined): Plan | null {
  if (priceId && priceId === process.env.NEXT_PUBLIC_PADDLE_PRICE_BUSINESS) {
    return Plan.BUSINESS;
  }
  if (priceId && priceId === process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO) {
    return Plan.PRO;
  }
  return null;
}
