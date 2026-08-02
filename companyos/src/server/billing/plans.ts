import type { Plan, PlanTier } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { env } from "@/env";

type PlanDefinition = {
  name: string;
  monthlyPriceCents: number;
  aiTokenLimit: number;
  agentRunLimit: number;
  seatLimit: number | null;
};

/**
 * The plan catalog, defined in code rather than migration data so it needs
 * no separate seed script in CI — `ensurePlansSeeded` upserts these rows
 * idempotently on demand. Stripe price ids come from env since they differ
 * between Stripe test/live modes; the free plan has none.
 */
export const PLAN_CATALOG: Record<PlanTier, PlanDefinition> = {
  free: { name: "Free", monthlyPriceCents: 0, aiTokenLimit: 50_000, agentRunLimit: 20, seatLimit: 3 },
  pro: { name: "Pro", monthlyPriceCents: 4_900, aiTokenLimit: 1_000_000, agentRunLimit: 500, seatLimit: 25 },
  enterprise: {
    name: "Enterprise",
    monthlyPriceCents: 49_900,
    aiTokenLimit: 20_000_000,
    agentRunLimit: 10_000,
    seatLimit: null,
  },
};

function stripePriceIdFor(tier: PlanTier): string | null {
  if (tier === "pro") return env.STRIPE_PRICE_ID_PRO ?? null;
  if (tier === "enterprise") return env.STRIPE_PRICE_ID_ENTERPRISE ?? null;
  return null;
}

/** Idempotently upserts the 3 catalog plans. Cheap enough to call on every read — no caching needed at this scale. */
export async function ensurePlansSeeded(): Promise<void> {
  const tiers = Object.keys(PLAN_CATALOG) as PlanTier[];
  for (const tier of tiers) {
    const def = PLAN_CATALOG[tier];
    const data = {
      name: def.name,
      monthlyPriceCents: def.monthlyPriceCents,
      aiTokenLimit: def.aiTokenLimit,
      agentRunLimit: def.agentRunLimit,
      seatLimit: def.seatLimit,
      stripePriceId: stripePriceIdFor(tier),
    };
    await prisma.plan.upsert({
      where: { tier },
      create: { tier, ...data },
      update: data,
    });
  }
}

export async function listPlans(): Promise<Plan[]> {
  await ensurePlansSeeded();
  return prisma.plan.findMany({ orderBy: { monthlyPriceCents: "asc" } });
}

export async function getPlanByTier(tier: PlanTier): Promise<Plan> {
  await ensurePlansSeeded();
  return prisma.plan.findUniqueOrThrow({ where: { tier } });
}
