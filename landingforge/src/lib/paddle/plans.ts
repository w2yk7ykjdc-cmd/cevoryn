import { Plan } from "@prisma/client";

export function planFromPriceId(priceId: string | undefined): Plan {
  if (priceId && priceId === process.env.NEXT_PUBLIC_PADDLE_PRICE_BUSINESS) {
    return Plan.BUSINESS;
  }
  if (priceId && priceId === process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO) {
    return Plan.PRO;
  }
  return Plan.FREE;
}
