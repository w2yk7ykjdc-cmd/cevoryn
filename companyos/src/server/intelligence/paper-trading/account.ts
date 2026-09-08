import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { DEFAULT_STARTING_EQUITY } from "@/server/intelligence/paper-trading/constants";

export type PaperAccountView = {
  id: string;
  startingEquity: number;
  currentEquity: number;
  peakEquity: number;
  usedMargin: number;
  availableMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalFees: number;
  totalFunding: number;
  drawdownPct: number;
};

function toView(account: {
  id: string;
  startingEquity: unknown;
  currentEquity: unknown;
  peakEquity: unknown;
  usedMargin: unknown;
  unrealizedPnl: unknown;
  realizedPnl: unknown;
  totalFees: unknown;
  totalFunding: unknown;
}): PaperAccountView {
  const currentEquity = Number(account.currentEquity);
  const peakEquity = Number(account.peakEquity);
  const usedMargin = Number(account.usedMargin);
  return {
    id: account.id,
    startingEquity: Number(account.startingEquity),
    currentEquity,
    peakEquity,
    usedMargin,
    availableMargin: currentEquity - usedMargin,
    unrealizedPnl: Number(account.unrealizedPnl),
    realizedPnl: Number(account.realizedPnl),
    totalFees: Number(account.totalFees),
    totalFunding: Number(account.totalFunding),
    // Drawdown is derived at read time from `peakEquity` rather than stored,
    // so it can never drift out of sync with the two values it's computed from.
    drawdownPct: peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0,
  };
}

/**
 * Lazily creates a PAPER/SIMULATION-ONLY account on first use, mirroring
 * `getOrCreatePolicy`'s own lazy-default pattern (`ai/autonomy/policy-service.ts`).
 * `startingEquity` is an explicit, documented simulation constant
 * (`DEFAULT_STARTING_EQUITY`) -- never inferred from anything real.
 */
export async function getOrCreatePaperAccount(organizationId: string): Promise<PaperAccountView> {
  const scoped = getTenantScopedClient(organizationId);
  const existing = await scoped.paperAccount.findUnique({ where: { organizationId } });
  if (existing) return toView(existing);

  const created = await prisma.paperAccount.upsert({
    where: { organizationId },
    create: {
      organizationId,
      startingEquity: DEFAULT_STARTING_EQUITY,
      currentEquity: DEFAULT_STARTING_EQUITY,
      peakEquity: DEFAULT_STARTING_EQUITY,
      usedMargin: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      totalFees: 0,
      totalFunding: 0,
    },
    // A concurrent lazy-create race resolves to the same row via the
    // `organizationId` unique constraint -- the update is a no-op rather
    // than a second competing initial state.
    update: {},
  });
  return toView(created);
}
