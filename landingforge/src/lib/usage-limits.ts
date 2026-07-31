import { Plan } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Placeholder monthly token budgets per plan - tune once real OpenAI cost
// data exists. The point of this module is to make the cap non-zero and
// enforced everywhere content is generated, not to get the exact number
// right on day one.
const MONTHLY_TOKEN_LIMITS: Record<Plan, number> = {
  [Plan.FREE]: 20_000,
  [Plan.PRO]: 200_000,
  [Plan.BUSINESS]: 1_000_000,
};

export class UsageLimitExceededError extends Error {
  constructor(
    public readonly limit: number,
    public readonly used: number,
  ) {
    super(`Monthly AI usage limit reached (${used}/${limit} tokens).`);
    this.name = "UsageLimitExceededError";
  }
}

export async function assertWithinUsageLimit(userId: string, plan: Plan) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const usage = await prisma.apiUsage.aggregate({
    where: { userId, createdAt: { gte: startOfMonth } },
    _sum: { tokensUsed: true },
  });

  const used = usage._sum.tokensUsed ?? 0;
  const limit = MONTHLY_TOKEN_LIMITS[plan];

  if (used >= limit) {
    throw new UsageLimitExceededError(limit, used);
  }
}
