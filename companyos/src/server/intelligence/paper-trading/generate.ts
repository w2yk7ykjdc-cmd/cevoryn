import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { logger } from "@/server/logger/logger";
import { METRICS_SNAPSHOT_RULE_NAME, METRICS_SNAPSHOT_RULE_VERSION } from "@/server/intelligence/signals/market-scanner";
import { STRATEGY_CANDIDATE_RULE_NAME, STRATEGY_CANDIDATE_RULE_VERSION } from "@/server/intelligence/strategy/generate";
import { getOrCreatePaperAccount } from "@/server/intelligence/paper-trading/account";
import { decideEntry } from "@/server/intelligence/paper-trading/entry";
import { evaluatePositionUpdate, type OpenPositionState } from "@/server/intelligence/paper-trading/evaluate";
import { computeFee } from "@/server/intelligence/paper-trading/pnl";
import type { PaperEntryPlan } from "@/server/intelligence/paper-trading/types";
import type { MarketMetricsSnapshotPayload, StrategyCandidate } from "@/server/intelligence/strategy/types";

const ORG_BATCH_SIZE = 50;

export type EvaluatePaperTradingResult = {
  organizationsScanned: number;
  positionsOpened: number;
  positionsUpdated: number;
  positionsClosed: number;
  errors: number;
  durationMs: number;
};

/**
 * Stage 4 of the market pipeline (stage 1: `ingestMarketData`; stage 2:
 * `generateMarketIntelligence`; stage 3: `generateMarketStrategies`).
 * Reads back, per organization, only what those three stages already
 * persisted -- the `market_strategy_candidate.v1` and
 * `market_metrics_snapshot.v1` `CompanySignal` rows -- and NEVER calls
 * Binance or recomputes a metric. Mirrors their exact cursor-paged,
 * per-organization-isolated shape and one-bad-organization-never-blocks-
 * another isolation. Every position CLOSE (and every entry) is applied
 * inside a `prisma.$transaction` so a partial failure can never leave the
 * account's running totals (`realizedPnl`/`totalFees`/`totalFunding`) out
 * of sync with the position rows that produced them.
 */
export async function evaluatePaperTrading(now: Date = new Date()): Promise<EvaluatePaperTradingResult> {
  const start = Date.now();
  let cursor: string | undefined;
  let organizationsScanned = 0;
  let positionsOpened = 0;
  let positionsUpdated = 0;
  let positionsClosed = 0;
  let errors = 0;

  for (;;) {
    const organizations = await prisma.organization.findMany({
      take: ORG_BATCH_SIZE,
      orderBy: { id: "asc" },
      select: { id: true },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (organizations.length === 0) break;

    for (const organization of organizations) {
      try {
        const result = await evaluatePaperTradingForOrganization(organization.id, now);
        organizationsScanned += 1;
        positionsOpened += result.positionsOpened;
        positionsUpdated += result.positionsUpdated;
        positionsClosed += result.positionsClosed;
      } catch (err) {
        errors += 1;
        logger.error({ err, organizationId: organization.id }, "paper trading simulation error for organization");
      }
    }

    cursor = organizations[organizations.length - 1]?.id;
    if (organizations.length < ORG_BATCH_SIZE) break;
  }

  const durationMs = Date.now() - start;
  logger.info(
    { organizationsScanned, positionsOpened, positionsUpdated, positionsClosed, errors, durationMs },
    "paper trading simulation completed",
  );

  return { organizationsScanned, positionsOpened, positionsUpdated, positionsClosed, errors, durationMs };
}

async function evaluatePaperTradingForOrganization(
  organizationId: string,
  now: Date,
): Promise<{ positionsOpened: number; positionsUpdated: number; positionsClosed: number }> {
  const scoped = getTenantScopedClient(organizationId);

  // Lazily create the account FIRST -- `syncAccountAggregates` below reads
  // it with `findUniqueOrThrow`, which would otherwise fail on this
  // organization's very first evaluation pass.
  await getOrCreatePaperAccount(organizationId);

  const [candidateSignals, metricsSignals, openPositions] = await Promise.all([
    scoped.companySignal.findMany({
      where: { ruleName: STRATEGY_CANDIDATE_RULE_NAME, ruleVersion: STRATEGY_CANDIDATE_RULE_VERSION, status: "active" },
      select: { relatedEntityId: true, payload: true, id: true },
    }),
    scoped.companySignal.findMany({
      where: { ruleName: METRICS_SNAPSHOT_RULE_NAME, ruleVersion: METRICS_SNAPSHOT_RULE_VERSION, status: "active" },
      select: { relatedEntityId: true, payload: true },
    }),
    scoped.paperPosition.findMany({ where: { status: "OPEN" } }),
  ]);

  const candidatesBySymbol = new Map<string, { candidate: StrategyCandidate; signalId: string }>();
  for (const s of candidateSignals) {
    if (!s.relatedEntityId) continue;
    candidatesBySymbol.set(s.relatedEntityId, { candidate: s.payload as unknown as StrategyCandidate, signalId: s.id });
  }
  const metricsBySymbol = new Map<string, MarketMetricsSnapshotPayload>();
  for (const s of metricsSignals) {
    if (!s.relatedEntityId) continue;
    metricsBySymbol.set(s.relatedEntityId, s.payload as unknown as MarketMetricsSnapshotPayload);
  }

  let positionsUpdated = 0;
  let positionsClosed = 0;
  const openSymbols = new Set(openPositions.map((p) => p.symbol));

  // 1) Update/close every currently-open position first, so entry's
  // margin/exposure checks below see this run's true, up-to-date state.
  for (const position of openPositions) {
    const metrics = metricsBySymbol.get(position.symbol);
    if (!metrics) {
      // Symbol fell out of this run's discovered universe, or its
      // ingestion failed this run -- leave the position exactly as-is
      // rather than guessing a price (Phase 32: "no silent corruption").
      logger.warn({ organizationId, symbol: position.symbol }, "paper trading: no fresh metrics this run, position left unchanged");
      continue;
    }

    const candidateEntry = candidatesBySymbol.get(position.symbol);
    const thesisInvalidated = !candidateEntry || candidateEntry.candidate.strategyType === "NO_TRADE";

    const state: OpenPositionState = {
      direction: position.direction,
      mode: position.mode,
      entryPrice: Number(position.entryPrice),
      quantity: Number(position.quantity),
      stopLossPrice: Number(position.stopLossPrice),
      takeProfitPrice: Number(position.takeProfitPrice),
      liquidationPrice: position.liquidationPrice !== null ? Number(position.liquidationPrice) : null,
      feesPaidSoFar: Number(position.feesPaid),
      fundingPaidSoFar: Number(position.fundingPaid),
      maxFavorableExcursion: Number(position.maxFavorableExcursion),
      maxAdverseExcursion: Number(position.maxAdverseExcursion),
      lastFundingAt: position.lastFundingAt ?? position.openedAt,
    };

    const update = evaluatePositionUpdate(state, metrics.lastClose, now, thesisInvalidated);

    if (!update.closeStatus) {
      await prisma.paperPosition.update({
        where: { id: position.id },
        data: {
          currentPrice: update.currentPrice,
          unrealizedPnl: update.netPnl,
          fundingPaid: update.fundingPaidTotal,
          lastFundingAt: now,
          maxFavorableExcursion: update.maxFavorableExcursion,
          maxAdverseExcursion: update.maxAdverseExcursion,
        },
      });
      positionsUpdated += 1;
      continue;
    }

    await closePosition(organizationId, position, update, now);
    positionsClosed += 1;
    openSymbols.delete(position.symbol);
  }

  // 2) Recompute account aggregates from the now-current set of open positions.
  const currentOpenPositions = await scoped.paperPosition.findMany({ where: { status: "OPEN" } });
  const unrealizedPnlSum = currentOpenPositions.reduce((sum, p) => sum + Number(p.unrealizedPnl), 0);
  const usedMarginSum = currentOpenPositions.reduce((sum, p) => sum + Number(p.initialMargin), 0);
  const notionalSum = currentOpenPositions.reduce((sum, p) => sum + Number(p.notional), 0);
  await syncAccountAggregates(organizationId, unrealizedPnlSum, usedMarginSum);
  // Re-read once, now reflecting the just-synced currentEquity -- every
  // subsequent margin/exposure check in this pass tracks running totals
  // purely in memory (no further DB reads per candidate) to avoid N+1
  // queries across a potentially large discovered universe.
  const account = await getOrCreatePaperAccount(organizationId);

  // 3) Attempt entry for every non-NO_TRADE, directional candidate that
  // doesn't already have an open position.
  let positionsOpened = 0;
  let runningUsedMargin = usedMarginSum;
  let runningNotional = notionalSum;
  let runningPositionCount = currentOpenPositions.length;

  for (const [symbol, { candidate, signalId }] of candidatesBySymbol) {
    const metrics = metricsBySymbol.get(symbol);
    if (!metrics) continue;

    const liveAccount = { ...account, usedMargin: runningUsedMargin, availableMargin: account.currentEquity - runningUsedMargin };

    const decision = decideEntry({
      candidate,
      metrics,
      account: liveAccount,
      hasExistingPositionForSymbol: openSymbols.has(symbol),
      openPositionCount: runningPositionCount,
      existingOpenNotional: runningNotional,
      now: now.getTime(),
    });

    if (!decision.opened) {
      logger.debug({ organizationId, symbol, reason: decision.reason }, "paper trading: entry skipped");
      continue;
    }

    await openPosition(organizationId, symbol, candidate, signalId, decision.plan!, now);
    positionsOpened += 1;
    openSymbols.add(symbol);
    runningNotional += decision.plan!.notional;
    runningUsedMargin += decision.plan!.initialMargin;
    runningPositionCount += 1;
  }

  return { positionsOpened, positionsUpdated, positionsClosed };
}

async function syncAccountAggregates(organizationId: string, unrealizedPnlSum: number, usedMarginSum: number): Promise<void> {
  const account = await prisma.paperAccount.findUniqueOrThrow({ where: { organizationId } });
  const currentEquity = Number(account.startingEquity) + Number(account.realizedPnl) + unrealizedPnlSum;
  const peakEquity = Math.max(Number(account.peakEquity), currentEquity);
  await prisma.paperAccount.update({
    where: { organizationId },
    data: { currentEquity, peakEquity, usedMargin: usedMarginSum, unrealizedPnl: unrealizedPnlSum },
  });
}

async function closePosition(
  organizationId: string,
  position: { id: string; symbol: string; direction: "LONG" | "SHORT"; mode: "SPOT" | "PERPETUAL_SIMULATION"; strategyType: string; strategySignalId: string | null; regime: string | null; leverage: number; entryPrice: Prisma.Decimal; quantity: Prisma.Decimal; notional: Prisma.Decimal; initialMargin: Prisma.Decimal; openedAt: Date },
  update: ReturnType<typeof evaluatePositionUpdate>,
  now: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.paperPosition.update({
      where: { id: position.id },
      data: {
        status: update.closeStatus!,
        currentPrice: update.currentPrice,
        exitPrice: update.currentPrice,
        unrealizedPnl: 0,
        realizedPnl: update.netPnl,
        feesPaid: update.feesPaidTotal,
        fundingPaid: update.fundingPaidTotal,
        maxFavorableExcursion: update.maxFavorableExcursion,
        maxAdverseExcursion: update.maxAdverseExcursion,
        closedAt: now,
      },
    });

    await tx.paperTrade.create({
      data: {
        organizationId,
        positionId: position.id,
        symbol: position.symbol,
        direction: position.direction,
        mode: position.mode,
        strategyType: position.strategyType,
        strategySignalId: position.strategySignalId,
        regime: position.regime,
        leverage: position.leverage,
        entryPrice: position.entryPrice,
        exitPrice: update.currentPrice,
        quantity: position.quantity,
        notional: position.notional,
        initialMargin: position.initialMargin,
        grossPnl: update.grossPnl,
        feesPaid: update.feesPaidTotal,
        fundingPaid: update.fundingPaidTotal,
        netPnl: update.netPnl,
        returnPct: Number(position.initialMargin) > 0 ? update.netPnl / Number(position.initialMargin) : 0,
        maxFavorableExcursion: update.maxFavorableExcursion,
        maxAdverseExcursion: update.maxAdverseExcursion,
        closeReason: update.closeStatus!,
        openedAt: position.openedAt,
        closedAt: now,
      },
    });

    const account = await tx.paperAccount.findUniqueOrThrow({ where: { organizationId } });
    const newRealizedPnl = Number(account.realizedPnl) + update.netPnl;
    const newTotalFees = Number(account.totalFees) + update.feesPaidTotal;
    const newTotalFunding = Number(account.totalFunding) + update.fundingPaidTotal;
    await tx.paperAccount.update({
      where: { organizationId },
      data: { realizedPnl: newRealizedPnl, totalFees: newTotalFees, totalFunding: newTotalFunding },
    });
  });
}

async function openPosition(
  organizationId: string,
  symbol: string,
  candidate: StrategyCandidate,
  strategySignalId: string,
  plan: PaperEntryPlan,
  now: Date,
): Promise<void> {
  const entryFee = computeFee(plan.notional);
  const initialUnrealizedPnl = -entryFee;

  await prisma.$transaction(async (tx) => {
    await tx.paperPosition.create({
      data: {
        organizationId,
        accountId: (await tx.paperAccount.findUniqueOrThrow({ where: { organizationId }, select: { id: true } })).id,
        symbol,
        direction: plan.direction,
        mode: plan.mode,
        status: "OPEN",
        strategyType: candidate.strategyType,
        strategySignalId,
        regime: candidate.marketRegime,
        leverage: plan.leverage,
        entryPrice: plan.entryPrice,
        currentPrice: plan.entryPrice,
        quantity: plan.quantity,
        notional: plan.notional,
        initialMargin: plan.initialMargin,
        stopLossPrice: plan.stopLossPrice,
        takeProfitPrice: plan.takeProfitPrice,
        liquidationPrice: plan.liquidationPrice,
        riskUnit: candidate.riskUnit,
        unrealizedPnl: initialUnrealizedPnl,
        feesPaid: entryFee,
        fundingPaid: 0,
        maxFavorableExcursion: initialUnrealizedPnl,
        maxAdverseExcursion: initialUnrealizedPnl,
        lastFundingAt: now,
        openedAt: now,
      },
    });

    const account = await tx.paperAccount.findUniqueOrThrow({ where: { organizationId } });
    await tx.paperAccount.update({
      where: { organizationId },
      data: { totalFees: Number(account.totalFees) + entryFee },
    });
  });

  logger.info({ organizationId, symbol, direction: plan.direction, leverage: plan.leverage, mode: plan.mode }, "paper trading: position opened");
}
