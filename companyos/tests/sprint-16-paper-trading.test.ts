import { afterAll, describe, expect, it, vi } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient, CrossTenantAccessError } from "@/server/db/tenant";
import * as tenantModule from "@/server/db/tenant";
import { getOrCreatePolicy, listAllowlist } from "@/server/ai/autonomy/policy-service";
import { MAX_AUTONOMY_LEVEL_BY_DOMAIN } from "@/server/ai/autonomy/constants";
import { listRegisteredTools, getTool } from "@/server/ai/tools/registry";
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { recordSignal } from "@/server/intelligence/signals/service";
import { METRICS_SNAPSHOT_RULE_NAME, METRICS_SNAPSHOT_RULE_VERSION, type MarketMetricsSnapshotPayload } from "@/server/intelligence/signals/market-scanner";
import { STRATEGY_CANDIDATE_RULE_NAME, STRATEGY_CANDIDATE_RULE_VERSION } from "@/server/intelligence/strategy/generate";
import type { StrategyCandidate } from "@/server/intelligence/strategy/types";
import { getOrCreatePaperAccount } from "@/server/intelligence/paper-trading/account";
import { decideEntry } from "@/server/intelligence/paper-trading/entry";
import { evaluatePositionUpdate, type OpenPositionState } from "@/server/intelligence/paper-trading/evaluate";
import { evaluatePaperTrading } from "@/server/intelligence/paper-trading/generate";
import { getPaperTradingSnapshot } from "@/server/intelligence/paper-trading/service";
import { computeFee, computeFundingCost, computeGrossPnl, computeNetPnl, computeReturnPct } from "@/server/intelligence/paper-trading/pnl";
import { buildEntryPlan, computePositionSizing, computeSimulatedLiquidationPrice, deriveStopDistancePct, selectSafeLeverage } from "@/server/intelligence/paper-trading/sizing";
import { MAX_SIMULATION_LEVERAGE, MAX_SIMULTANEOUS_POSITIONS, MAX_TOTAL_EXPOSURE_MULTIPLE, PAPER_FEE_RATE, STALE_DATA_MAX_AGE_MS } from "@/server/intelligence/paper-trading/constants";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders, addMemberDirect } from "./helpers";

const BASE_METRICS: MarketMetricsSnapshotPayload = {
  symbol: "BTCUSDT",
  dailyPercentChange: 5,
  shortTermPercentChange: 1,
  mediumPercentChange: 3,
  trendConsistency: 0.8,
  volumeRatio: 2,
  volatilityPct: 1,
  relativeStrength: 2,
  observedAt: new Date().toISOString(),
  lastClose: 50000,
};

const BASE_CANDIDATE: StrategyCandidate = {
  symbol: "BTCUSDT",
  strategyType: "TREND_FOLLOWING",
  strategyVersion: "v1",
  direction: "up",
  score: 80,
  confidence: 95,
  marketRegime: "trending",
  supportingSignals: ["test supporting signal"],
  contradictingSignals: [],
  thesis: "test thesis",
  entryConditions: ["test entry condition"],
  invalidationConditions: ["test invalidation condition"],
  riskConditions: [],
  expectedScenario: "Hypothetical: riskUnit = 1 test scenario",
  noTradeReason: null,
  riskUnit: 1,
  sourceOpportunityId: null,
  sourceRiskId: null,
  observedAt: BASE_METRICS.observedAt,
};

async function seedMetricsSnapshot(organizationId: string, metrics: MarketMetricsSnapshotPayload): Promise<void> {
  await recordSignal({
    organizationId,
    type: METRICS_SNAPSHOT_RULE_NAME,
    sourceType: "scanner",
    sourceId: `${metrics.symbol}:1h`,
    severity: "low",
    confidence: 90,
    ruleName: METRICS_SNAPSHOT_RULE_NAME,
    ruleVersion: METRICS_SNAPSHOT_RULE_VERSION,
    relatedEntityType: "MarketSymbol",
    relatedEntityId: metrics.symbol,
    payload: metrics,
  });
}

async function seedStrategyCandidate(organizationId: string, candidate: StrategyCandidate): Promise<string> {
  const { signal } = await recordSignal({
    organizationId,
    type: STRATEGY_CANDIDATE_RULE_NAME,
    sourceType: "scanner",
    sourceId: `${candidate.symbol}:1h`,
    severity: candidate.strategyType === "NO_TRADE" ? "low" : "medium",
    confidence: candidate.confidence,
    ruleName: STRATEGY_CANDIDATE_RULE_NAME,
    ruleVersion: STRATEGY_CANDIDATE_RULE_VERSION,
    relatedEntityType: "MarketSymbol",
    relatedEntityId: candidate.symbol,
    payload: candidate,
  });
  return signal.id;
}

describe("A: paper account initialization", () => {
  afterAll(closeTestConnections);

  it("A: lazily creates a PAPER/SIMULATION-ONLY account with the documented default starting equity", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const account = await getOrCreatePaperAccount(organization.id);
    expect(account.startingEquity).toBe(10_000);
    expect(account.currentEquity).toBe(10_000);
    expect(account.peakEquity).toBe(10_000);
    expect(account.availableMargin).toBe(10_000);
    expect(account.drawdownPct).toBe(0);

    const again = await getOrCreatePaperAccount(organization.id);
    expect(again.id).toBe(account.id);
  });
});

describe("B/C: long and short position entry", () => {
  afterAll(closeTestConnections);

  it("B: a directional 'up' candidate opens a LONG paper position at the fresh lastClose price", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);

    await evaluatePaperTrading();

    const position = await prisma.paperPosition.findFirstOrThrow({ where: { organizationId: organization.id, symbol: "BTCUSDT" } });
    expect(position.direction).toBe("LONG");
    expect(position.status).toBe("OPEN");
    expect(Number(position.entryPrice)).toBe(BASE_METRICS.lastClose);
  });

  it("C: a directional 'down' candidate opens a SHORT paper position", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const metrics = { ...BASE_METRICS, symbol: "ETHUSDT" };
    const candidate: StrategyCandidate = { ...BASE_CANDIDATE, symbol: "ETHUSDT", direction: "down" };
    await seedMetricsSnapshot(organization.id, metrics);
    await seedStrategyCandidate(organization.id, candidate);

    await evaluatePaperTrading();

    const position = await prisma.paperPosition.findFirstOrThrow({ where: { organizationId: organization.id, symbol: "ETHUSDT" } });
    expect(position.direction).toBe("SHORT");
  });
});

describe("D/E: spot vs. leveraged simulation modes", () => {
  it("D: a low-confidence candidate selects 1x leverage -- SPOT mode, no liquidation price", () => {
    const plan = buildEntryPlan({ direction: "LONG", entryPrice: 100, volatilityPct: 1, confidence: 50, equity: 10_000 });
    expect(plan.leverage).toBe(1);
    expect(plan.mode).toBe("SPOT");
    expect(plan.liquidationPrice).toBeNull();
  });

  it("E: a high-confidence, low-volatility candidate selects leverage > 1 -- PERPETUAL_SIMULATION mode, with a computed liquidation price", () => {
    const plan = buildEntryPlan({ direction: "LONG", entryPrice: 100, volatilityPct: 1, confidence: 95, equity: 10_000 });
    expect(plan.leverage).toBeGreaterThan(1);
    expect(plan.mode).toBe("PERPETUAL_SIMULATION");
    expect(plan.liquidationPrice).not.toBeNull();
  });
});

describe("F/G: margin calculation and position sizing", () => {
  it("F: required margin = notional / leverage, exactly", () => {
    const sizing1x = computePositionSizing(10_000, 100, 0.02, 1);
    const sizing5x = computePositionSizing(10_000, 100, 0.02, 5);
    expect(sizing1x.notional).toBeCloseTo(sizing5x.notional, 6); // sizing is leverage-independent
    expect(sizing5x.initialMargin).toBeCloseTo(sizing1x.initialMargin / 5, 6);
  });

  it("G: position sizing follows risk capital -> stop distance -> quantity -> notional deterministically", () => {
    const equity = 10_000;
    const entryPrice = 100;
    const stopDistancePct = 0.02;
    const { riskCapital, notional, quantity, initialMargin } = computePositionSizing(equity, entryPrice, stopDistancePct, 1);
    expect(riskCapital).toBeCloseTo(equity * 0.01, 6);
    expect(notional).toBeCloseTo(riskCapital / stopDistancePct, 6);
    expect(quantity).toBeCloseTo(notional / entryPrice, 6);
    expect(initialMargin).toBeCloseTo(notional, 6); // leverage 1 -> margin == notional
  });

  it("1x vs 5x: identical risk produces identical notional, margin scales inversely with leverage", () => {
    const stopDistancePct = deriveStopDistancePct(2);
    const s1 = computePositionSizing(10_000, 50_000, stopDistancePct, 1);
    const s5 = computePositionSizing(10_000, 50_000, stopDistancePct, 5);
    expect(s1.notional).toBeCloseTo(s5.notional, 6);
    expect(s5.initialMargin).toBeCloseTo(s1.initialMargin / 5, 6);
  });
});

describe("H/I: long and short P&L, symmetric by construction", () => {
  it("H: LONG P&L increases when price rises, decreases when price falls", () => {
    expect(computeGrossPnl("LONG", 100, 110, 1)).toBeCloseTo(10, 6);
    expect(computeGrossPnl("LONG", 100, 90, 1)).toBeCloseTo(-10, 6);
  });

  it("I: SHORT P&L increases when price falls, decreases when price rises -- exact mirror of LONG", () => {
    expect(computeGrossPnl("SHORT", 100, 90, 1)).toBeCloseTo(10, 6);
    expect(computeGrossPnl("SHORT", 100, 110, 1)).toBeCloseTo(-10, 6);
    expect(computeGrossPnl("LONG", 100, 123, 2)).toBeCloseTo(-computeGrossPnl("SHORT", 100, 123, 2), 6);
  });
});

describe("J/K: fees and funding reduce net P&L", () => {
  it("J: PAPER_FEE_RATE is applied to notional, and fees strictly reduce net P&L", () => {
    expect(computeFee(10_000)).toBeCloseTo(10_000 * PAPER_FEE_RATE, 6);
    expect(computeNetPnl(100, 5, 0)).toBeLessThan(100);
    expect(computeNetPnl(100, 0, 0)).toBe(100);
  });

  it("K: simulated funding is prorated by elapsed time and strictly reduces net P&L", () => {
    expect(computeFundingCost(10_000, 0)).toBe(0);
    const funding8h = computeFundingCost(10_000, 8);
    const funding16h = computeFundingCost(10_000, 16);
    expect(funding16h).toBeCloseTo(funding8h * 2, 6);
    expect(computeNetPnl(100, 0, 10)).toBeLessThan(100);
  });

  it("computeReturnPct is return on margin, not on notional", () => {
    expect(computeReturnPct(50, 500)).toBeCloseTo(0.1, 6);
    expect(computeReturnPct(50, 0)).toBe(0);
  });
});

describe("L/M/N/O: stop loss, take profit, invalidation, liquidation", () => {
  const baseState: OpenPositionState = {
    direction: "LONG",
    mode: "PERPETUAL_SIMULATION",
    entryPrice: 100,
    quantity: 1,
    stopLossPrice: 95,
    takeProfitPrice: 110,
    liquidationPrice: 90,
    feesPaidSoFar: 0.04,
    fundingPaidSoFar: 0,
    maxFavorableExcursion: 0,
    maxAdverseExcursion: 0,
    lastFundingAt: new Date("2026-01-01T00:00:00Z"),
  };
  const now = new Date("2026-01-01T01:00:00Z");

  it("L: price at/below the stop closes STOPPED", () => {
    const result = evaluatePositionUpdate(baseState, 94, now, false);
    expect(result.closeStatus).toBe("STOPPED");
  });

  it("M: price at/above the take-profit level closes TAKE_PROFIT", () => {
    const result = evaluatePositionUpdate(baseState, 111, now, false);
    expect(result.closeStatus).toBe("TAKE_PROFIT");
  });

  it("N: an invalidated thesis with no SL/TP/liquidation hit closes INVALIDATED", () => {
    const result = evaluatePositionUpdate(baseState, 102, now, true);
    expect(result.closeStatus).toBe("INVALIDATED");
  });

  it("O: liquidation occurs ONLY when price crosses the liquidation level, and takes priority over a simultaneous stop", () => {
    const noLiquidation = evaluatePositionUpdate(baseState, 94, now, false);
    expect(noLiquidation.closeStatus).toBe("STOPPED");

    const liquidated = evaluatePositionUpdate(baseState, 89, now, false);
    expect(liquidated.closeStatus).toBe("LIQUIDATED"); // below both stop AND liquidation -- liquidation wins
  });

  it("a SPOT position (liquidationPrice null) is never liquidated regardless of price", () => {
    const spotState: OpenPositionState = { ...baseState, mode: "SPOT", liquidationPrice: null };
    const result = evaluatePositionUpdate(spotState, 1, now, false);
    expect(result.closeStatus).not.toBe("LIQUIDATED");
  });
});

describe("V: deterministic replay -- identical inputs always produce an identical result", () => {
  it("V: evaluatePositionUpdate is a pure function of its inputs", () => {
    const state: OpenPositionState = {
      direction: "SHORT",
      mode: "PERPETUAL_SIMULATION",
      entryPrice: 200,
      quantity: 2,
      stopLossPrice: 210,
      takeProfitPrice: 180,
      liquidationPrice: 230,
      feesPaidSoFar: 0.16,
      fundingPaidSoFar: 0.02,
      maxFavorableExcursion: 1,
      maxAdverseExcursion: -1,
      lastFundingAt: new Date("2026-01-01T00:00:00Z"),
    };
    const now = new Date("2026-01-01T04:00:00Z");
    const r1 = evaluatePositionUpdate(state, 195, now, false);
    const r2 = evaluatePositionUpdate(state, 195, now, false);
    expect(r1).toEqual(r2);
  });
});

describe("Q/R/S/T/U: portfolio and risk controls", () => {
  it("S: leverage never exceeds MAX_SIMULATION_LEVERAGE regardless of confidence", () => {
    const leverage = selectSafeLeverage(100, "LONG", 100, 0.01);
    expect(leverage).toBeLessThanOrEqual(MAX_SIMULATION_LEVERAGE);
  });

  it("S: a stop distance too wide for a high leverage tier steps DOWN to a safe leverage rather than skipping the trade", () => {
    // A very wide stop distance makes 10x's liquidation distance unsafe -- the engine must step down, never open an unsafe 10x position.
    const leverage = selectSafeLeverage(95, "LONG", 100, 0.08);
    const liquidationPrice = computeSimulatedLiquidationPrice(100, leverage, "LONG");
    if (liquidationPrice !== null) {
      const distance = Math.abs(100 - liquidationPrice) / 100;
      expect(distance).toBeGreaterThanOrEqual(0.08 * 1.2 - 1e-9);
    }
  });

  it("R: max exposure and max position count are enforced deterministically", () => {
    const account = { id: "acc", startingEquity: 10_000, currentEquity: 10_000, peakEquity: 10_000, usedMargin: 0, availableMargin: 10_000, unrealizedPnl: 0, realizedPnl: 0, totalFees: 0, totalFunding: 0, drawdownPct: 0 };

    const exposureBlocked = decideEntry({
      candidate: BASE_CANDIDATE,
      metrics: BASE_METRICS,
      account,
      hasExistingPositionForSymbol: false,
      openPositionCount: 0,
      existingOpenNotional: account.currentEquity * MAX_TOTAL_EXPOSURE_MULTIPLE,
      now: Date.now(),
    });
    expect(exposureBlocked).toEqual({ opened: false, reason: "max_exposure_reached" });

    const positionCountBlocked = decideEntry({
      candidate: BASE_CANDIDATE,
      metrics: BASE_METRICS,
      account,
      hasExistingPositionForSymbol: false,
      openPositionCount: MAX_SIMULTANEOUS_POSITIONS,
      existingOpenNotional: 0,
      now: Date.now(),
    });
    expect(positionCountBlocked).toEqual({ opened: false, reason: "max_positions_reached" });
  });

  it("T: insufficient available margin blocks entry", () => {
    const account = { id: "acc", startingEquity: 10_000, currentEquity: 10_000, peakEquity: 10_000, usedMargin: 9_999.99, availableMargin: 0.01, unrealizedPnl: 0, realizedPnl: 0, totalFees: 0, totalFunding: 0, drawdownPct: 0 };
    const decision = decideEntry({
      candidate: BASE_CANDIDATE,
      metrics: BASE_METRICS,
      account,
      hasExistingPositionForSymbol: false,
      openPositionCount: 0,
      existingOpenNotional: 0,
      now: Date.now(),
    });
    expect(decision).toEqual({ opened: false, reason: "insufficient_margin" });
  });

  it("U: stale market data blocks entry", () => {
    const account = { id: "acc", startingEquity: 10_000, currentEquity: 10_000, peakEquity: 10_000, usedMargin: 0, availableMargin: 10_000, unrealizedPnl: 0, realizedPnl: 0, totalFees: 0, totalFunding: 0, drawdownPct: 0 };
    const staleMetrics = { ...BASE_METRICS, observedAt: new Date(Date.now() - STALE_DATA_MAX_AGE_MS - 60_000).toISOString() };
    const decision = decideEntry({
      candidate: BASE_CANDIDATE,
      metrics: staleMetrics,
      account,
      hasExistingPositionForSymbol: false,
      openPositionCount: 0,
      existingOpenNotional: 0,
      now: Date.now(),
    });
    expect(decision).toEqual({ opened: false, reason: "stale_data" });
  });

  it("AF: a NO_TRADE candidate never opens a position", () => {
    const account = { id: "acc", startingEquity: 10_000, currentEquity: 10_000, peakEquity: 10_000, usedMargin: 0, availableMargin: 10_000, unrealizedPnl: 0, realizedPnl: 0, totalFees: 0, totalFunding: 0, drawdownPct: 0 };
    const noTradeCandidate: StrategyCandidate = { ...BASE_CANDIDATE, strategyType: "NO_TRADE", direction: null, noTradeReason: "insufficient_evidence" };
    const decision = decideEntry({
      candidate: noTradeCandidate,
      metrics: BASE_METRICS,
      account,
      hasExistingPositionForSymbol: false,
      openPositionCount: 0,
      existingOpenNotional: 0,
      now: Date.now(),
    });
    expect(decision).toEqual({ opened: false, reason: "no_trade_strategy" });
  });
});

describe("Q: multiple simultaneous paper positions", () => {
  afterAll(closeTestConnections);

  it("Q: the engine opens and tracks multiple positions across different symbols in one run", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, { ...BASE_METRICS, symbol: "BTCUSDT" });
    await seedStrategyCandidate(organization.id, { ...BASE_CANDIDATE, symbol: "BTCUSDT" });
    await seedMetricsSnapshot(organization.id, { ...BASE_METRICS, symbol: "ETHUSDT" });
    await seedStrategyCandidate(organization.id, { ...BASE_CANDIDATE, symbol: "ETHUSDT", direction: "down" });

    await evaluatePaperTrading();

    const openPositions = await prisma.paperPosition.findMany({ where: { organizationId: organization.id, status: "OPEN" } });
    expect(openPositions.length).toBe(2);
  });
});

describe("P: account-level drawdown", () => {
  afterAll(closeTestConnections);

  it("P: drawdown is computed from peak equity vs. current equity", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await getOrCreatePaperAccount(organization.id);
    await prisma.paperAccount.update({ where: { organizationId: organization.id }, data: { peakEquity: 11_000, currentEquity: 9_900 } });

    const account = await getOrCreatePaperAccount(organization.id);
    expect(account.drawdownPct).toBeCloseTo((11_000 - 9_900) / 11_000, 6);
  });
});

describe("W: duplicate job / idempotency", () => {
  afterAll(closeTestConnections);

  it("W: running evaluatePaperTrading twice in a row never opens a duplicate position for the same symbol", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);

    await evaluatePaperTrading();
    await evaluatePaperTrading();

    const positions = await prisma.paperPosition.findMany({ where: { organizationId: organization.id, symbol: "BTCUSDT" } });
    expect(positions).toHaveLength(1);
  });

  it("missing symbol: a position whose symbol has no fresh metrics this run is left completely unchanged, never corrupted", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);
    await evaluatePaperTrading();

    const before = await prisma.paperPosition.findFirstOrThrow({ where: { organizationId: organization.id, symbol: "BTCUSDT" } });

    // Expire the metrics snapshot so it's no longer "active" -- simulating the symbol dropping out of this run's universe.
    await prisma.companySignal.updateMany({
      where: { organizationId: organization.id, ruleName: METRICS_SNAPSHOT_RULE_NAME, relatedEntityId: "BTCUSDT" },
      data: { status: "expired" },
    });
    await evaluatePaperTrading();

    const after = await prisma.paperPosition.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.status).toBe("OPEN");
    expect(Number(after.currentPrice)).toBe(Number(before.currentPrice));
    expect(Number(after.unrealizedPnl)).toBe(Number(before.unrealizedPnl));
  });
});

describe("X/Y: tenant isolation and cross-tenant rejection", () => {
  afterAll(closeTestConnections);

  it("X: paper positions and account are only ever visible to their owning organization", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await seedMetricsSnapshot(orgA.id, BASE_METRICS);
    await seedStrategyCandidate(orgA.id, BASE_CANDIDATE);

    await evaluatePaperTrading();

    const snapshotA = await getPaperTradingSnapshot(orgA.id);
    const snapshotB = await getPaperTradingSnapshot(orgB.id);
    expect(snapshotA.openPositions.length).toBeGreaterThan(0);
    expect(snapshotB.openPositions).toHaveLength(0);
  });

  it("Y: a cross-tenant query against another organization's paper positions throws CrossTenantAccessError", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await seedMetricsSnapshot(orgA.id, BASE_METRICS);
    await seedStrategyCandidate(orgA.id, BASE_CANDIDATE);
    await evaluatePaperTrading();

    const scopedB = getTenantScopedClient(orgB.id);
    await expect(scopedB.paperPosition.findFirst({ where: { organizationId: orgA.id } })).rejects.toBeInstanceOf(CrossTenantAccessError);
  });

  it("one organization's simulation failure never stops another organization's", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await seedMetricsSnapshot(orgA.id, BASE_METRICS);
    await seedStrategyCandidate(orgA.id, BASE_CANDIDATE);
    await seedMetricsSnapshot(orgB.id, BASE_METRICS);
    await seedStrategyCandidate(orgB.id, BASE_CANDIDATE);

    const spy = vi.spyOn(tenantModule, "getTenantScopedClient");
    spy.mockImplementationOnce(() => {
      throw new Error("simulated failure for the first organization only");
    });

    const result = await evaluatePaperTrading();
    spy.mockRestore();

    expect(result.errors).toBeGreaterThanOrEqual(1);
    const positionsB = await prisma.paperPosition.findMany({ where: { organizationId: orgB.id } });
    expect(positionsB.length).toBeGreaterThan(0);
  });
});

describe("Z: Outcome-ready close", () => {
  afterAll(closeTestConnections);

  it("Z: a closed position produces a PaperTrade row carrying everything a future Outcome evaluation needs, via the existing soft-reference pattern", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);
    await evaluatePaperTrading();

    const position = await prisma.paperPosition.findFirstOrThrow({ where: { organizationId: organization.id, symbol: "BTCUSDT" } });

    // Force an extreme adverse move so the position closes on the next evaluation pass.
    await seedMetricsSnapshot(organization.id, { ...BASE_METRICS, lastClose: BASE_METRICS.lastClose * 0.5, observedAt: new Date().toISOString() });
    await evaluatePaperTrading();

    const trade = await prisma.paperTrade.findUniqueOrThrow({ where: { positionId: position.id } });
    expect(trade.symbol).toBe("BTCUSDT");
    expect(trade.direction).toBe("LONG");
    expect(trade.strategyType).toBe("TREND_FOLLOWING");
    expect(["STOPPED", "LIQUIDATED"]).toContain(trade.closeReason);
    expect(Number(trade.netPnl)).toBeLessThan(0);
    expect(trade.closedAt.getTime()).toBeGreaterThanOrEqual(trade.openedAt.getTime());

    // No Outcome is fabricated by this sprint -- the soft-reference hook exists (relatedEntityType/relatedEntityId), nothing auto-created yet.
    const outcomes = await prisma.outcome.findMany({ where: { organizationId: organization.id, relatedEntityType: "PaperTrade", relatedEntityId: trade.id } });
    expect(outcomes).toHaveLength(0);
  });
});

describe("AA/AB/AC/AD/AE: CRITICAL SAFETY -- paper trading can never touch autonomy or add real execution capability", () => {
  afterAll(closeTestConnections);

  it("AA: no order/account/withdrawal/transfer function or tool exists anywhere in the registered tool set or the paper-trading module", async () => {
    const forbiddenNamePattern = /placeorder|createorder|executeorder|withdraw|transfer|deposit/i;
    const offendingTools = listRegisteredTools().filter((tool) => forbiddenNamePattern.test(tool.name));
    expect(offendingTools).toHaveLength(0);

    const generateModule = await import("@/server/intelligence/paper-trading/generate");
    const sizingModule = await import("@/server/intelligence/paper-trading/sizing");
    const pnlModule = await import("@/server/intelligence/paper-trading/pnl");
    const allExportNames = [...Object.keys(generateModule), ...Object.keys(sizingModule), ...Object.keys(pnlModule)];
    expect(allExportNames.filter((name) => forbiddenNamePattern.test(name))).toHaveLength(0);
  });

  it("AB: no Binance credential surface exists -- the market data client still exposes exactly getCandles/getExchangeInfo/getTicker24hr", async () => {
    const { createBinancePublicClient } = await import("@/server/market-data/binance-client");
    const client = createBinancePublicClient();
    expect(Object.keys(client).sort()).toEqual(["getCandles", "getExchangeInfo", "getTicker24hr"]);
  });

  it("AC: the market autonomy ceiling stays capped at L2, unchanged by this sprint", () => {
    expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.market).toBe("L2");
  });

  it("AD: a full paper-trading simulation pass leaves AutonomyPolicy, AutonomyPolicyVersion, and AutonomyAllowlistEntry byte-for-byte unchanged", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);

    const policyBefore = await getOrCreatePolicy(organization.id, "market");
    const allowlistBefore = await listAllowlist(organization.id, "market");
    const versionCountBefore = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    const result = await evaluatePaperTrading();
    expect(result.positionsOpened).toBeGreaterThan(0);

    const policyAfter = await getOrCreatePolicy(organization.id, "market");
    const allowlistAfter = await listAllowlist(organization.id, "market");
    const versionCountAfter = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    expect(policyAfter).toEqual(policyBefore);
    expect(allowlistAfter).toEqual(allowlistBefore);
    expect(versionCountAfter).toBe(versionCountBefore);
  });

  it("AE: get_paper_trading stays read_only/non-autonomy-eligible, requires paperTrading:read, and returns real simulation data to a viewer", async () => {
    const tool = getTool("get_paper_trading");
    expect(tool?.mutationCategory).toBe("read_only");
    expect(tool?.domain).toBe("market");
    expect(tool?.requiredPermission).toEqual({ paperTrading: ["read"] });
    expect(tool?.autonomyEligible).toBeFalsy();

    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);
    await evaluatePaperTrading();

    const conversation = await createConversation({ organizationId: organization.id, userId: viewer.userId });
    const result = await executeToolCall(
      { id: "pt-1", name: "get_paper_trading", arguments: {} },
      { organizationId: organization.id, userId: viewer.userId, conversationId: conversation.id },
      authHeaders(viewer.token),
    );
    expect(result.status).toBe("success");
    const payload = result as unknown as { output?: { account?: { startingEquity?: number }; openPositions?: unknown[] } };
    expect(payload.output?.account?.startingEquity).toBe(10_000);
    expect(Array.isArray(payload.output?.openPositions)).toBe(true);
  });

  it("every market-domain tool (including the new one) stays read_only and non-autonomy-eligible", () => {
    const marketTools = listRegisteredTools().filter((t) => t.domain === "market");
    expect(marketTools.length).toBeGreaterThanOrEqual(2);
    expect(marketTools.every((t) => t.mutationCategory === "read_only")).toBe(true);
    expect(marketTools.every((t) => !t.autonomyEligible)).toBe(true);
  });
});
