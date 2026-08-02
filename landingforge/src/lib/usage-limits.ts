import { Plan, UsageType } from "@prisma/client";
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

// Conservative placeholder charged the instant a call is reserved, before
// the real token count is known - reconciled to the actual usage (or
// released back to 0 on failure) once the AI call finishes. Overshoot per
// user is bounded to one call's worth of estimate error instead of being
// unbounded across concurrent requests.
const ESTIMATED_TOKENS_PER_CALL = 1_500;

export class UsageLimitExceededError extends Error {
  constructor(
    public readonly limit: number,
    public readonly used: number,
  ) {
    super(`Monthly AI usage limit reached (${used}/${limit} tokens).`);
    this.name = "UsageLimitExceededError";
  }
}

function startOfCurrentMonth() {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start;
}

// Checks the monthly budget and immediately books an estimated charge
// against it, both inside a transaction serialized per-user via a
// Postgres advisory lock. Without the lock, two calls started close
// together (e.g. the new-project wizard's parallel section generations)
// would both read the same "used so far" total and both pass the check -
// letting a user blow well past their monthly cap through completely
// normal use. The lock makes the second call wait for the first call's
// reservation to commit, so it sees the update and can be rejected.
export async function reserveUsage(
  userId: string,
  plan: Plan,
  type: UsageType,
  locale?: string,
) {
  const startOfMonth = startOfCurrentMonth();
  const limit = MONTHLY_TOKEN_LIMITS[plan];

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

    const usage = await tx.apiUsage.aggregate({
      where: { userId, createdAt: { gte: startOfMonth } },
      _sum: { tokensUsed: true },
    });
    const used = usage._sum.tokensUsed ?? 0;

    if (used >= limit) {
      throw new UsageLimitExceededError(limit, used);
    }

    return tx.apiUsage.create({
      data: { userId, type, tokensUsed: ESTIMATED_TOKENS_PER_CALL, locale },
    });
  });
}
