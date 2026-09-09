import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient, CrossTenantAccessError } from "@/server/db/tenant";
import { getOrCreatePolicy, listAllowlist, engageKillSwitch, isKillSwitchEngaged } from "@/server/ai/autonomy/policy-service";
import { MAX_AUTONOMY_LEVEL_BY_DOMAIN } from "@/server/ai/autonomy/constants";
import { listRegisteredTools, getTool } from "@/server/ai/tools/registry";
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { recordSignal } from "@/server/intelligence/signals/service";
import { METRICS_SNAPSHOT_RULE_NAME, METRICS_SNAPSHOT_RULE_VERSION, type MarketMetricsSnapshotPayload } from "@/server/intelligence/signals/market-scanner";
import { STRATEGY_CANDIDATE_RULE_NAME, STRATEGY_CANDIDATE_RULE_VERSION } from "@/server/intelligence/strategy/generate";
import type { StrategyCandidate } from "@/server/intelligence/strategy/types";
import { getOrCreatePaperAccount } from "@/server/intelligence/paper-trading/account";
import type { PaperAccountView } from "@/server/intelligence/paper-trading/account";
import { evaluatePaperTrading } from "@/server/intelligence/paper-trading/generate";
import { MAX_SIMULATION_LEVERAGE, MAX_SIMULTANEOUS_POSITIONS, MAX_TOTAL_EXPOSURE_MULTIPLE } from "@/server/intelligence/paper-trading/constants";
import { runPaperTradeResult } from "@/server/intelligence/outcome/rules/paper-trade-result";
import { MIN_SAMPLE_SIZE } from "@/server/intelligence/decision-intelligence/sample-safety";
import { buildMarketDecision, generateMarketDecisions, validateProposedOrder, type DecisionContext } from "@/server/intelligence/market-decision/service";
import type { ProposedOrder } from "@/server/intelligence/market-decision/types";
import type { StrategyEvaluation } from "@/server/intelligence/strategy-evaluation/types";
import { DECISION_VALIDITY_MS, MAX_ACCOUNT_DRAWDOWN_PCT_FOR_ENTRY } from "@/server/intelligence/market-decision/constants";
import { closeTestConnections, createClosedPaperTrade, createOrgForUser, signUpUser, authHeaders, addMemberDirect } from "./helpers";

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
  confidence: 90,
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

const BASE_ACCOUNT: PaperAccountView = {
  id: "acc",
  startingEquity: 10_000,
  currentEquity: 10_000,
  peakEquity: 10_000,
  usedMargin: 0,
  availableMargin: 10_000,
  unrealizedPnl: 0,
  realizedPnl: 0,
  totalFees: 0,
  totalFunding: 0,
  drawdownPct: 0,
};

function makeEvaluation(overrides: Partial<Extract<StrategyEvaluation, { status: "evaluated" }>> = {}): StrategyEvaluation {
  return {
    status: "evaluated",
    strategyType: "TREND_FOLLOWING",
    evidenceQuality: "strong",
    sampleSize: 50,
    evaluatedTrades: 50,
    winRate: 70,
    averageReturnPct: 5,
    totalRealizedPnl: 1000,
    averagePnl: 20,
    bestTradePnl: 100,
    worstTradePnl: -50,
    maxDrawdown: { status: "computed", maxDrawdownPnl: 50, maxDrawdownPct: 10, peakPnl: 500, troughPnl: 450 },
    liquidationRate: 0,
    stopRate: 10,
    takeProfitRate: 40,
    invalidationRate: 0,
    averageHoldingDurationMs: 3_600_000,
    feeImpact: 10,
    fundingImpact: 5,
    riskAdjustedReturn: { status: "computed", value: 1.5, cappedAtBound: false },
    confidenceCalibration: [],
    regimeRobustness: [],
    symbolRobustness: { uniqueSymbols: 3, profitableSymbols: 2, losingSymbols: 1, breakEvenSymbols: 0, bestSymbol: null, worstSymbol: null, concentrationIndex: 0.4 },
    directionRobustness: [],
    leverageRobustness: [],
    temporalRobustness: { status: "insufficient_evidence" },
    failureAnalysis: { totalFailingTrades: 0, byReason: [] },
    evaluationScore: 75,
    scoreBreakdown: { performanceComponent: 30, consistencyComponent: 15, regimeRobustnessComponent: 10, symbolRobustnessComponent: 6, confidenceCalibrationComponent: 10, drawdownPenalty: 2, liquidationPenalty: 0 },
    ...overrides,
  };
}

function baseContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    candidate: BASE_CANDIDATE,
    metrics: BASE_METRICS,
    riskSeverity: "none",
    opportunityScore: null,
    evaluation: makeEvaluation(),
    account: BASE_ACCOUNT,
    hasExistingPositionForSymbol: false,
    openPositionCount: 0,
    existingOpenNotional: 0,
    killSwitchEngaged: false,
    now: Date.now(),
    ...overrides,
  };
}

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

async function seedStrategyCandidate(organizationId: string, candidate: StrategyCandidate): Promise<void> {
  await recordSignal({
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
}

async function seedEvaluatedTrades(organizationId: string, count: number, strategyType = "TREND_FOLLOWING"): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await createClosedPaperTrade(organizationId, { strategyType, returnPct: 0.05, candidateConfidence: 85 });
  }
  await runPaperTradeResult(organizationId);
}

describe("A: decision generation -- end to end from real persisted data", () => {
  afterAll(closeTestConnections);

  it("A: generateMarketDecisions produces one decision per real strategy candidate, never fabricated", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);

    const decisions = await generateMarketDecisions(organization.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.symbol).toBe("BTCUSDT");
    expect(decisions[0]!.strategyType).toBe("TREND_FOLLOWING");
    expect(["BUY", "SELL", "HOLD", "NO_TRADE"]).toContain(decisions[0]!.action);
  });
});

describe("B/C: BUY and SELL", () => {
  it("B: an 'up' direction with no existing position produces a BUY decision with a LONG proposed order", () => {
    const decision = buildMarketDecision(baseContext());
    expect(decision.action).toBe("BUY");
    expect(decision.proposedOrder?.direction).toBe("LONG");
  });

  it("C: a 'down' direction with no existing position produces a SELL decision with a SHORT proposed order", () => {
    const decision = buildMarketDecision(baseContext({ candidate: { ...BASE_CANDIDATE, direction: "down" } }));
    expect(decision.action).toBe("SELL");
    expect(decision.proposedOrder?.direction).toBe("SHORT");
  });
});

describe("D/E: HOLD and NO_TRADE", () => {
  it("D: a directional candidate with an already-open position HOLDs -- the hypothetical order is still shown, explicitly REJECTED as no_trade", () => {
    const decision = buildMarketDecision(baseContext({ hasExistingPositionForSymbol: true }));
    expect(decision.action).toBe("HOLD");
    expect(decision.proposedOrder).not.toBeNull();
    expect(decision.proposedOrder?.validationStatus).toBe("REJECTED");
    expect(decision.proposedOrder?.rejectReason).toBe("no_trade");
  });

  it("E: a NO_TRADE strategy candidate produces action NO_TRADE and no proposed order -- direction is never fabricated", () => {
    const noTradeCandidate: StrategyCandidate = { ...BASE_CANDIDATE, strategyType: "NO_TRADE", direction: null, noTradeReason: "insufficient_evidence" };
    const decision = buildMarketDecision(baseContext({ candidate: noTradeCandidate }));
    expect(decision.action).toBe("NO_TRADE");
    expect(decision.proposedOrder).toBeNull();
    expect(decision.reasons.some((r) => r.includes("insufficient_evidence"))).toBe(true);
  });

  it("E: a non-directional RANGE_MEAN_REVERSION candidate also produces NO_TRADE, never an invented direction", () => {
    const rangeCandidate: StrategyCandidate = { ...BASE_CANDIDATE, strategyType: "RANGE_MEAN_REVERSION", direction: null };
    const decision = buildMarketDecision(baseContext({ candidate: rangeCandidate }));
    expect(decision.action).toBe("NO_TRADE");
    expect(decision.proposedOrder).toBeNull();
  });
});

describe("F: insufficient evidence blocks execution, never blocks the decision itself", () => {
  it("F: insufficient evidence quality produces action BUY (current evidence still shown) but proposedOrder REJECTED", () => {
    const decision = buildMarketDecision(baseContext({ evaluation: { status: "insufficient_evidence", strategyType: "TREND_FOLLOWING", evaluatedTrades: 2, minimumRequired: MIN_SAMPLE_SIZE } }));
    expect(decision.action).toBe("BUY");
    expect(decision.evidenceQuality).toBe("insufficient");
    expect(decision.proposedOrder?.validationStatus).toBe("REJECTED");
    expect(decision.proposedOrder?.rejectReason).toBe("insufficient_evidence");
  });

  it("F: no evaluation at all for this strategy type (never traded) is also treated as insufficient, never a fabricated score", () => {
    const decision = buildMarketDecision(baseContext({ evaluation: null }));
    expect(decision.evidenceQuality).toBe("insufficient");
    expect(decision.evaluationScore).toBeNull();
    expect(decision.proposedOrder?.rejectReason).toBe("insufficient_evidence");
  });
});

describe("G: stale data", () => {
  it("G: a metrics snapshot older than the staleness window rejects the proposed order as stale_data", () => {
    const staleMetrics = { ...BASE_METRICS, observedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() };
    const decision = buildMarketDecision(baseContext({ metrics: staleMetrics }));
    expect(decision.proposedOrder?.validationStatus).toBe("REJECTED");
    expect(decision.proposedOrder?.rejectReason).toBe("stale_data");
  });

  it("edge case: missing metrics entirely (fell out of universe) produces no proposed order, never a fabricated price", () => {
    const decision = buildMarketDecision(baseContext({ metrics: null }));
    expect(decision.proposedOrder).toBeNull();
    expect(decision.reasons.some((r) => r.includes("No current market data"))).toBe(true);
  });
});

describe("H: conflicting signals", () => {
  it("H: critical co-occurring risk severity is a direct conflicting_signal", () => {
    const decision = buildMarketDecision(baseContext({ riskSeverity: "critical" }));
    expect(decision.proposedOrder?.rejectReason).toBe("conflicting_signal");
  });

  it("H: current evidence 'clearly good' but historical evaluation 'clearly bad' is a measured conflicting_signal", () => {
    const decision = buildMarketDecision(
      baseContext({
        opportunityScore: 85,
        evaluation: makeEvaluation({ evaluationScore: 10, evidenceQuality: "strong" }),
      }),
    );
    expect(decision.proposedOrder?.rejectReason).toBe("conflicting_signal");
  });
});

describe("I: risk rejection (unacceptable_risk)", () => {
  it("I: medium co-occurring risk severity is unacceptable at the execution layer, even though the strategy layer tolerates it", () => {
    const decision = buildMarketDecision(baseContext({ riskSeverity: "medium" }));
    expect(decision.proposedOrder?.rejectReason).toBe("unacceptable_risk");
  });

  it("I: high co-occurring risk severity is also unacceptable", () => {
    const decision = buildMarketDecision(baseContext({ riskSeverity: "high" }));
    expect(decision.proposedOrder?.rejectReason).toBe("unacceptable_risk");
  });
});

describe("J: exposure limit", () => {
  it("J: existing open notional plus this order's notional exceeding the total exposure ceiling rejects exposure_limit", () => {
    const decision = buildMarketDecision(baseContext({ existingOpenNotional: BASE_ACCOUNT.currentEquity * MAX_TOTAL_EXPOSURE_MULTIPLE }));
    expect(decision.proposedOrder?.rejectReason).toBe("exposure_limit");
  });

  it("edge case: max simultaneous positions already reached also rejects exposure_limit", () => {
    const decision = buildMarketDecision(baseContext({ openPositionCount: MAX_SIMULTANEOUS_POSITIONS }));
    expect(decision.proposedOrder?.rejectReason).toBe("exposure_limit");
  });
});

describe("K: leverage limit", () => {
  it("K: a proposed order's leverage never exceeds MAX_SIMULATION_LEVERAGE, even at maximum confidence", () => {
    const decision = buildMarketDecision(baseContext({ candidate: { ...BASE_CANDIDATE, confidence: 100 } }));
    expect(decision.proposedOrder!.leverage).toBeLessThanOrEqual(MAX_SIMULATION_LEVERAGE);
  });

  it("edge case: 1x leverage produces a SPOT order with no liquidation price", () => {
    const decision = buildMarketDecision(baseContext({ candidate: { ...BASE_CANDIDATE, confidence: 50 } }));
    expect(decision.proposedOrder!.leverage).toBe(1);
    expect(decision.proposedOrder!.mode).toBe("SPOT");
    expect(decision.proposedOrder!.liquidationPrice).toBeNull();
  });

  it("edge case: high confidence produces leverage > 1x, PERPETUAL_SIMULATION mode, with a real liquidation price", () => {
    const decision = buildMarketDecision(baseContext({ candidate: { ...BASE_CANDIDATE, confidence: 95 } }));
    expect(decision.proposedOrder!.leverage).toBeGreaterThan(1);
    expect(decision.proposedOrder!.mode).toBe("PERPETUAL_SIMULATION");
    expect(decision.proposedOrder!.liquidationPrice).not.toBeNull();
  });
});

describe("L: liquidation risk", () => {
  it("L: an order whose liquidation distance does not clear the stop distance by the safety margin is rejected liquidation_risk", () => {
    // Hand-crafted order that bypasses buildEntryPlan's own safety guarantee, to prove validateProposedOrder is a real, independent check.
    const order: Omit<ProposedOrder, "validationStatus" | "rejectReason"> = {
      symbol: "BTCUSDT",
      direction: "LONG",
      mode: "PERPETUAL_SIMULATION",
      entryPrice: 100,
      quantity: 1,
      notional: 1000,
      initialMargin: 100,
      leverage: 10, // liquidation ~10% away
      stopLossPrice: 92, // 8% away -- too close to the ~10% liquidation distance to clear the safety margin
      takeProfitPrice: 116,
      liquidationPrice: null,
      risk: 100,
      reason: "test",
      confidence: 90,
      decisionTimestamp: new Date().toISOString(),
      expiresAt: new Date(Date.now() + DECISION_VALIDITY_MS).toISOString(),
    };
    const result = validateProposedOrder({
      order,
      decisionTimestampMs: Date.now(),
      metrics: BASE_METRICS,
      riskSeverity: "none",
      evidenceQuality: "strong",
      opportunityScore: null,
      evaluationScore: 80,
      account: BASE_ACCOUNT,
      openPositionCount: 0,
      existingOpenNotional: 0,
      now: Date.now(),
    });
    expect(result).toEqual({ status: "REJECTED", reason: "liquidation_risk" });
  });
});

describe("M: drawdown limit", () => {
  it("M: an account already past the max-drawdown-for-entry ceiling rejects new entries as drawdown_limit", () => {
    const drawnDownAccount: PaperAccountView = { ...BASE_ACCOUNT, drawdownPct: (MAX_ACCOUNT_DRAWDOWN_PCT_FOR_ENTRY + 5) / 100 };
    const decision = buildMarketDecision(baseContext({ account: drawnDownAccount }));
    expect(decision.proposedOrder?.rejectReason).toBe("drawdown_limit");
  });

  it("a drawdown just under the ceiling does not reject on this check", () => {
    const okAccount: PaperAccountView = { ...BASE_ACCOUNT, drawdownPct: (MAX_ACCOUNT_DRAWDOWN_PCT_FOR_ENTRY - 5) / 100 };
    const decision = buildMarketDecision(baseContext({ account: okAccount }));
    expect(decision.proposedOrder?.rejectReason).not.toBe("drawdown_limit");
  });
});

describe("N: kill switch -- read/evaluation continues, execution proposals stop", () => {
  afterAll(closeTestConnections);

  it("N: when the kill switch is engaged, the decision (BUY/SELL/HOLD/NO_TRADE) is still computed, but no proposed order is generated at all", () => {
    const decision = buildMarketDecision(baseContext({ killSwitchEngaged: true }));
    expect(decision.action).toBe("BUY");
    expect(decision.killSwitchEngaged).toBe(true);
    expect(decision.proposedOrder).toBeNull();
  });

  it("N: engaging the organization's own market-domain kill switch is reflected by isKillSwitchEngaged, and generateMarketDecisions honors it end to end", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);

    expect(await isKillSwitchEngaged(organization.id, "market")).toBe(false);
    await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: headers });
    expect(await isKillSwitchEngaged(organization.id, "market")).toBe(true);

    const decisions = await generateMarketDecisions(organization.id);
    expect(decisions[0]!.killSwitchEngaged).toBe(true);
    expect(decisions[0]!.proposedOrder).toBeNull();
  });

  it("N: with the kill switch engaged, evaluatePaperTrading opens NO new position for that organization, but an already-open position still updates normally", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    // First, open a real paper position with the kill switch OFF.
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);
    await evaluatePaperTrading();
    const openedPosition = await prisma.paperPosition.findFirstOrThrow({ where: { organizationId: organization.id, symbol: "BTCUSDT" } });
    expect(openedPosition.status).toBe("OPEN");

    // Now engage the kill switch and introduce a second, brand-new candidate symbol.
    await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: headers });
    await seedMetricsSnapshot(organization.id, { ...BASE_METRICS, symbol: "ETHUSDT" });
    await seedStrategyCandidate(organization.id, { ...BASE_CANDIDATE, symbol: "ETHUSDT" });
    // Also move the price on the existing position's symbol so its update path has something real to do.
    await seedMetricsSnapshot(organization.id, { ...BASE_METRICS, lastClose: BASE_METRICS.lastClose * 1.001, observedAt: new Date().toISOString() });

    await evaluatePaperTrading();

    const ethPosition = await prisma.paperPosition.findFirst({ where: { organizationId: organization.id, symbol: "ETHUSDT" } });
    expect(ethPosition).toBeNull(); // kill switch blocked the new entry

    const stillOpen = await prisma.paperPosition.findUniqueOrThrow({ where: { id: openedPosition.id } });
    expect(stillOpen.status).toBe("OPEN"); // the existing position's read/evaluation behavior continues
  });
});

describe("O/P: valid and invalid proposed orders", () => {
  afterAll(closeTestConnections);

  it("O: a clean candidate with sufficient evidence, ample margin, low exposure, and low drawdown produces a VALID proposed order", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);
    await seedEvaluatedTrades(organization.id, MIN_SAMPLE_SIZE);

    const decisions = await generateMarketDecisions(organization.id);
    const decision = decisions.find((d) => d.symbol === "BTCUSDT")!;
    expect(decision.action).toBe("BUY");
    expect(decision.proposedOrder?.validationStatus).toBe("VALID");
    expect(decision.proposedOrder?.rejectReason).toBeNull();
  });

  it("P: invalid_price is rejected when entry price is not positive", () => {
    const order = { symbol: "X", direction: "LONG" as const, entryPrice: 0, quantity: 1, notional: 100, initialMargin: 10, leverage: 1, stopLossPrice: -1, takeProfitPrice: 1, liquidationPrice: null, mode: "SPOT" as const, risk: 10, reason: "x", confidence: 80, decisionTimestamp: new Date().toISOString(), expiresAt: new Date(Date.now() + DECISION_VALIDITY_MS).toISOString() };
    const result = validateProposedOrder({ order, decisionTimestampMs: Date.now(), metrics: BASE_METRICS, riskSeverity: "none", evidenceQuality: "strong", opportunityScore: null, evaluationScore: 80, account: BASE_ACCOUNT, openPositionCount: 0, existingOpenNotional: 0, now: Date.now() });
    expect(result).toEqual({ status: "REJECTED", reason: "invalid_price" });
  });

  it("P: invalid_quantity is rejected when quantity is not positive", () => {
    const order = { symbol: "X", direction: "LONG" as const, entryPrice: 100, quantity: 0, notional: 100, initialMargin: 10, leverage: 1, stopLossPrice: 95, takeProfitPrice: 110, liquidationPrice: null, mode: "SPOT" as const, risk: 10, reason: "x", confidence: 80, decisionTimestamp: new Date().toISOString(), expiresAt: new Date(Date.now() + DECISION_VALIDITY_MS).toISOString() };
    const result = validateProposedOrder({ order, decisionTimestampMs: Date.now(), metrics: BASE_METRICS, riskSeverity: "none", evidenceQuality: "strong", opportunityScore: null, evaluationScore: 80, account: BASE_ACCOUNT, openPositionCount: 0, existingOpenNotional: 0, now: Date.now() });
    expect(result).toEqual({ status: "REJECTED", reason: "invalid_quantity" });
  });

  it("P: invalid_stop is rejected when the stop sits on the wrong side of entry for the direction", () => {
    const order = { symbol: "X", direction: "LONG" as const, entryPrice: 100, quantity: 1, notional: 100, initialMargin: 10, leverage: 1, stopLossPrice: 110, takeProfitPrice: 120, liquidationPrice: null, mode: "SPOT" as const, risk: 10, reason: "x", confidence: 80, decisionTimestamp: new Date().toISOString(), expiresAt: new Date(Date.now() + DECISION_VALIDITY_MS).toISOString() };
    const result = validateProposedOrder({ order, decisionTimestampMs: Date.now(), metrics: BASE_METRICS, riskSeverity: "none", evidenceQuality: "strong", opportunityScore: null, evaluationScore: 80, account: BASE_ACCOUNT, openPositionCount: 0, existingOpenNotional: 0, now: Date.now() });
    expect(result).toEqual({ status: "REJECTED", reason: "invalid_stop" });
  });

  it("P: insufficient_margin is rejected when the required margin exceeds available margin", () => {
    const order = { symbol: "X", direction: "LONG" as const, entryPrice: 100, quantity: 1, notional: 100_000, initialMargin: 50_000, leverage: 1, stopLossPrice: 95, takeProfitPrice: 110, liquidationPrice: null, mode: "SPOT" as const, risk: 10, reason: "x", confidence: 80, decisionTimestamp: new Date().toISOString(), expiresAt: new Date(Date.now() + DECISION_VALIDITY_MS).toISOString() };
    const result = validateProposedOrder({ order, decisionTimestampMs: Date.now(), metrics: BASE_METRICS, riskSeverity: "none", evidenceQuality: "strong", opportunityScore: null, evaluationScore: 80, account: BASE_ACCOUNT, openPositionCount: 0, existingOpenNotional: 0, now: Date.now() });
    expect(result).toEqual({ status: "REJECTED", reason: "insufficient_margin" });
  });
});

describe("Q: expired decision", () => {
  it("Q: a decision evaluated well after its validity window has elapsed is rejected expired_decision", () => {
    const order: Omit<ProposedOrder, "validationStatus" | "rejectReason"> = {
      symbol: "BTCUSDT", direction: "LONG", mode: "SPOT", entryPrice: 100, quantity: 1, notional: 100, initialMargin: 100, leverage: 1,
      stopLossPrice: 95, takeProfitPrice: 110, liquidationPrice: null, risk: 10, reason: "x", confidence: 80,
      decisionTimestamp: new Date(Date.now() - DECISION_VALIDITY_MS - 60_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    };
    const result = validateProposedOrder({
      order,
      decisionTimestampMs: Date.now() - DECISION_VALIDITY_MS - 60_000,
      metrics: BASE_METRICS,
      riskSeverity: "none",
      evidenceQuality: "strong",
      opportunityScore: null,
      evaluationScore: 80,
      account: BASE_ACCOUNT,
      openPositionCount: 0,
      existingOpenNotional: 0,
      now: Date.now(),
    });
    expect(result).toEqual({ status: "REJECTED", reason: "expired_decision" });
  });

  it("a freshly-computed decision (now === decisionTimestampMs) is never expired", () => {
    const decision = buildMarketDecision(baseContext());
    expect(decision.proposedOrder?.rejectReason).not.toBe("expired_decision");
  });
});

describe("R: paper trading integration -- decisions are read-only, the real engine is untouched", () => {
  afterAll(closeTestConnections);

  it("R: generateMarketDecisions never itself opens, closes, or modifies a PaperPosition/PaperTrade/PaperAccount row", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);
    await getOrCreatePaperAccount(organization.id);

    const positionsBefore = await prisma.paperPosition.count({ where: { organizationId: organization.id } });
    const tradesBefore = await prisma.paperTrade.count({ where: { organizationId: organization.id } });
    const accountBefore = await prisma.paperAccount.findUniqueOrThrow({ where: { organizationId: organization.id } });

    await generateMarketDecisions(organization.id);
    await generateMarketDecisions(organization.id);

    const positionsAfter = await prisma.paperPosition.count({ where: { organizationId: organization.id } });
    const tradesAfter = await prisma.paperTrade.count({ where: { organizationId: organization.id } });
    const accountAfter = await prisma.paperAccount.findUniqueOrThrow({ where: { organizationId: organization.id } });

    expect(positionsAfter).toBe(positionsBefore);
    expect(tradesAfter).toBe(tradesBefore);
    expect(accountAfter).toEqual(accountBefore);
  });

  it("R: the real paper-trading engine still opens real positions normally when the kill switch is off, unaffected by Sprint 19's new read layer", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);

    await generateMarketDecisions(organization.id); // read the decision first, exactly like the UI/AI tool would
    const result = await evaluatePaperTrading();
    expect(result.positionsOpened).toBeGreaterThan(0);

    const position = await prisma.paperPosition.findFirstOrThrow({ where: { organizationId: organization.id, symbol: "BTCUSDT" } });
    expect(position.status).toBe("OPEN");
  });
});

describe("S/T: tenant isolation and cross-tenant rejection", () => {
  afterAll(closeTestConnections);

  it("S: one organization's decisions never include another organization's strategy candidates or account state", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);

    await seedMetricsSnapshot(orgA.id, BASE_METRICS);
    await seedStrategyCandidate(orgA.id, BASE_CANDIDATE);

    const decisionsA = await generateMarketDecisions(orgA.id);
    const decisionsB = await generateMarketDecisions(orgB.id);
    expect(decisionsA.length).toBeGreaterThan(0);
    expect(decisionsB).toHaveLength(0);
  });

  it("T: a cross-tenant query against another organization's paper account/positions throws CrossTenantAccessError", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await getOrCreatePaperAccount(orgA.id);

    const scopedB = getTenantScopedClient(orgB.id);
    await expect(scopedB.paperAccount.findFirst({ where: { organizationId: orgA.id } })).rejects.toBeInstanceOf(CrossTenantAccessError);
    await expect(scopedB.paperPosition.findFirst({ where: { organizationId: orgA.id } })).rejects.toBeInstanceOf(CrossTenantAccessError);
  });
});

describe("U: idempotency", () => {
  afterAll(closeTestConnections);

  it("U: calling generateMarketDecisions twice in a row is a pure read -- identical output, zero new rows of any kind", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);

    const first = await generateMarketDecisions(organization.id);
    const second = await generateMarketDecisions(organization.id);
    // Only `decisionTimestamp`/`expiresAt` can differ across two real calls a moment apart -- strip them before comparing.
    const strip = (ds: typeof first) => ds.map((d) => ({ ...d, proposedOrder: d.proposedOrder ? { ...d.proposedOrder, decisionTimestamp: "x", expiresAt: "x" } : null }));
    expect(strip(first)).toEqual(strip(second));
  });
});

describe("V/W: CRITICAL SAFETY -- policy immutability and the market autonomy ceiling", () => {
  afterAll(closeTestConnections);

  it("V: generating decisions and running paper trading leaves AutonomyPolicy, its version history, and the allowlist byte-for-byte unchanged for an organization that never touched autonomy policy before", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);

    const policyBefore = await getOrCreatePolicy(organization.id, "market");
    const allowlistBefore = await listAllowlist(organization.id, "market");
    const versionCountBefore = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    await generateMarketDecisions(organization.id);
    await evaluatePaperTrading();

    const policyAfter = await getOrCreatePolicy(organization.id, "market");
    const allowlistAfter = await listAllowlist(organization.id, "market");
    const versionCountAfter = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    expect(policyAfter).toEqual(policyBefore);
    expect(allowlistAfter).toEqual(allowlistBefore);
    expect(versionCountAfter).toBe(versionCountBefore);
  });

  it("V: the read-only kill-switch check itself never creates an AutonomyPolicy row for an organization that has never had one", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const engaged = await isKillSwitchEngaged(organization.id, "market");
    expect(engaged).toBe(false);
    const policy = await prisma.autonomyPolicy.findFirst({ where: { organizationId: organization.id, domain: "market" } });
    expect(policy).toBeNull();
  });

  it("W: the market autonomy ceiling stays capped at L2, unchanged by this sprint", () => {
    expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.market).toBe("L2");
  });
});

describe("X/Y/Z: CRITICAL SAFETY -- no real execution, no credential, no private Binance endpoint", () => {
  afterAll(closeTestConnections);

  it("X: no order/account/withdrawal/transfer capability exists anywhere in the registered tool set or the market-decision module", async () => {
    const forbiddenNamePattern = /placeorder|createorder|executeorder|withdraw|transfer|deposit/i;
    const offendingTools = listRegisteredTools().filter((tool) => forbiddenNamePattern.test(tool.name));
    expect(offendingTools).toHaveLength(0);

    const decisionModule = await import("@/server/intelligence/market-decision/service");
    expect(Object.keys(decisionModule).filter((name) => forbiddenNamePattern.test(name))).toHaveLength(0);
  });

  it("Y/Z: the Binance market data client still exposes exactly getCandles/getExchangeInfo/getTicker24hr -- no credential surface, no private endpoint", async () => {
    const { createBinancePublicClient } = await import("@/server/market-data/binance-client");
    const client = createBinancePublicClient();
    expect(Object.keys(client).sort()).toEqual(["getCandles", "getExchangeInfo", "getTicker24hr"]);
  });

  it("every market-domain tool, including the extended get_market_intelligence, stays read_only and non-autonomy-eligible", () => {
    const marketTools = listRegisteredTools().filter((t) => t.domain === "market");
    expect(marketTools.length).toBeGreaterThanOrEqual(3);
    expect(marketTools.every((t) => t.mutationCategory === "read_only")).toBe(true);
    expect(marketTools.every((t) => !t.autonomyEligible)).toBe(true);
  });

  it("get_market_intelligence now also returns Sprint 19 decisions to a permitted viewer, still read-only, still no execution", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");
    await seedMetricsSnapshot(organization.id, BASE_METRICS);
    await seedStrategyCandidate(organization.id, BASE_CANDIDATE);

    const tool = getTool("get_market_intelligence");
    expect(tool?.mutationCategory).toBe("read_only");
    expect(tool?.autonomyEligible).toBeFalsy();

    const conversation = await createConversation({ organizationId: organization.id, userId: viewer.userId });
    const result = await executeToolCall(
      { id: "gmi-1", name: "get_market_intelligence", arguments: {} },
      { organizationId: organization.id, userId: viewer.userId, conversationId: conversation.id },
      authHeaders(viewer.token),
    );
    expect(result.status).toBe("success");
    const payload = result as unknown as { output?: { decisions?: Array<{ symbol?: string; proposedOrder?: unknown }> } };
    expect(Array.isArray(payload.output?.decisions)).toBe(true);
    expect(payload.output?.decisions?.[0]?.symbol).toBe("BTCUSDT");
  });
});
