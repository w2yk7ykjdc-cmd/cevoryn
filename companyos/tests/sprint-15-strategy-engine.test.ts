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
import { RULE_NAME as RISK_RULE_NAME, RULE_VERSION as RISK_RULE_VERSION } from "@/server/intelligence/risk/rules/market-multi-signal";
import { selectStrategy, computeStrategyScore, STALE_DATA_MAX_AGE_MS } from "@/server/intelligence/strategy/scoring";
import { generateMarketStrategies, STRATEGY_CANDIDATE_RULE_NAME, STRATEGY_CANDIDATE_RULE_VERSION } from "@/server/intelligence/strategy/generate";
import { getMarketIntelligenceRanking } from "@/server/intelligence/market-intelligence/service";
import type { StrategyInput } from "@/server/intelligence/strategy/types";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders, addMemberDirect } from "./helpers";

const BASE_METRICS: MarketMetricsSnapshotPayload = {
  symbol: "SOLUSDT",
  dailyPercentChange: 0,
  shortTermPercentChange: 0,
  mediumPercentChange: 0,
  trendConsistency: 0.5,
  volumeRatio: 1.0,
  volatilityPct: 2,
  relativeStrength: 0,
  observedAt: new Date().toISOString(),
  lastClose: 100,
};

const TREND_FOLLOWING_METRICS: MarketMetricsSnapshotPayload = {
  ...BASE_METRICS,
  mediumPercentChange: 4,
  trendConsistency: 0.8,
  dailyPercentChange: 5,
  shortTermPercentChange: 0.5,
  volatilityPct: 2,
};

const MOMENTUM_CONTINUATION_METRICS: MarketMetricsSnapshotPayload = {
  ...BASE_METRICS,
  mediumPercentChange: 1,
  trendConsistency: 0.5,
  dailyPercentChange: 4,
  shortTermPercentChange: 1.5,
  relativeStrength: 4,
  volatilityPct: 2,
};

const RANGE_METRICS: MarketMetricsSnapshotPayload = {
  ...BASE_METRICS,
  mediumPercentChange: 0.5,
  trendConsistency: 0.3,
  dailyPercentChange: 0.5,
  shortTermPercentChange: 0,
  relativeStrength: 0,
  volatilityPct: 2,
};

function baseInput(overrides: Partial<StrategyInput> = {}): StrategyInput {
  return { metrics: BASE_METRICS, regime: "uncertain", opportunity: null, risk: null, ...overrides };
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

async function seedOpenRisk(organizationId: string, symbol: string, severity: "medium" | "high" | "critical", conditions: string[]): Promise<void> {
  await prisma.risk.create({
    data: {
      organizationId,
      type: "market_multi_signal_risk",
      title: `${symbol}: test risk`,
      description: "test fixture",
      severity,
      confidence: 90,
      potentialLoss: 0,
      evidence: { conditions },
      explanation: "test fixture",
      relatedEntityType: "MarketSymbol",
      relatedEntityId: symbol,
      status: "open",
      ruleName: RISK_RULE_NAME,
      ruleVersion: RISK_RULE_VERSION,
    },
  });
}

describe("A: strategy selection is gated by the global market regime", () => {
  it("A: RANGE_MEAN_REVERSION only fires when the global regime is ranging, even with otherwise-qualifying range metrics", () => {
    const rangingCandidate = selectStrategy(baseInput({ metrics: RANGE_METRICS, regime: "ranging" }));
    expect(rangingCandidate.strategyType).toBe("RANGE_MEAN_REVERSION");

    const trendingCandidate = selectStrategy(baseInput({ metrics: RANGE_METRICS, regime: "trending" }));
    expect(trendingCandidate.strategyType).toBe("NO_TRADE");
  });
});

describe("B: TREND_FOLLOWING selection", () => {
  it("B: fires on a sustained, consistent medium-term trend with agreeing daily momentum and acceptable volatility", () => {
    const candidate = selectStrategy(baseInput({ metrics: TREND_FOLLOWING_METRICS, regime: "trending" }));
    expect(candidate.strategyType).toBe("TREND_FOLLOWING");
    expect(candidate.direction).toBe("up");
  });

  it("B: does not fire when the medium trend is large but inconsistent (a spike, not a trend)", () => {
    const spike = { ...TREND_FOLLOWING_METRICS, trendConsistency: 0.2 };
    const candidate = selectStrategy(baseInput({ metrics: spike, regime: "trending" }));
    expect(candidate.strategyType).not.toBe("TREND_FOLLOWING");
  });
});

describe("C: MOMENTUM_CONTINUATION selection", () => {
  it("C: fires on strong daily momentum with a still-moving short-term window and supportive relative strength, when the medium trend isn't sustained enough for TREND_FOLLOWING", () => {
    const candidate = selectStrategy(baseInput({ metrics: MOMENTUM_CONTINUATION_METRICS, regime: "trending" }));
    expect(candidate.strategyType).toBe("MOMENTUM_CONTINUATION");
    expect(candidate.direction).toBe("up");
  });

  it("C: does not fire when relative strength does not support the direction", () => {
    const unsupported = { ...MOMENTUM_CONTINUATION_METRICS, relativeStrength: 0 };
    const candidate = selectStrategy(baseInput({ metrics: unsupported, regime: "trending" }));
    expect(candidate.strategyType).not.toBe("MOMENTUM_CONTINUATION");
  });
});

describe("D: RANGE_MEAN_REVERSION selection", () => {
  it("D: fires on contained volatility and weak directional trend when the global regime is ranging", () => {
    const candidate = selectStrategy(baseInput({ metrics: RANGE_METRICS, regime: "ranging" }));
    expect(candidate.strategyType).toBe("RANGE_MEAN_REVERSION");
    expect(candidate.direction).toBeNull();
  });
});

describe("E: NO_TRADE on conflicting signals", () => {
  it("E: an open risk carrying Sprint 14's own conflicting_signals condition forces NO_TRADE even over otherwise-strong trend evidence", () => {
    const candidate = selectStrategy(
      baseInput({
        metrics: TREND_FOLLOWING_METRICS,
        regime: "trending",
        risk: { id: "risk-1", severity: "medium", conditions: ["conflicting_signals"] },
      }),
    );
    expect(candidate.strategyType).toBe("NO_TRADE");
    expect(candidate.noTradeReason).toBe("conflicting_signals");
  });
});

describe("F: NO_TRADE on unacceptable risk", () => {
  it("F: a high/critical-severity open risk vetoes any strategy, even with strong opportunity-shaped evidence -- 'opportunity score high + risk unacceptable = NO_TRADE'", () => {
    const candidate = selectStrategy(
      baseInput({
        metrics: TREND_FOLLOWING_METRICS,
        regime: "trending",
        opportunity: { id: "opp-1", score: 92, confidence: 90 },
        risk: { id: "risk-1", severity: "critical", conditions: [] },
      }),
    );
    expect(candidate.strategyType).toBe("NO_TRADE");
    expect(candidate.noTradeReason).toBe("unacceptable_risk");
  });

  it("F: a medium-severity risk does not veto -- it's recorded as a contradicting signal instead", () => {
    const candidate = selectStrategy(baseInput({ metrics: TREND_FOLLOWING_METRICS, regime: "trending", risk: { id: "risk-1", severity: "medium", conditions: [] } }));
    expect(candidate.strategyType).toBe("TREND_FOLLOWING");
    expect(candidate.contradictingSignals.some((s) => s.includes("medium-severity"))).toBe(true);
  });
});

describe("G: NO_TRADE on stale/insufficient data", () => {
  it("G: stale market data forces NO_TRADE even when the metrics would otherwise qualify", () => {
    const staleObservedAt = new Date(Date.now() - STALE_DATA_MAX_AGE_MS - 60_000).toISOString();
    const candidate = selectStrategy(baseInput({ metrics: { ...TREND_FOLLOWING_METRICS, observedAt: staleObservedAt }, regime: "trending" }));
    expect(candidate.strategyType).toBe("NO_TRADE");
    expect(candidate.noTradeReason).toBe("stale_data");
  });

  it("G: neutral/insufficient evidence (no trend, no momentum, no ranging regime) also produces NO_TRADE", () => {
    const candidate = selectStrategy(baseInput());
    expect(candidate.strategyType).toBe("NO_TRADE");
    expect(candidate.noTradeReason).toBe("insufficient_evidence");
  });
});

describe("H/I/K: deterministic, reproducible scoring and selection", () => {
  it("H: strategy score is bounded [0, 100] and deterministic for identical input", () => {
    const input = baseInput({ metrics: TREND_FOLLOWING_METRICS, regime: "trending" });
    const evaluation1 = selectStrategy(input, 1_700_000_000_000);
    const evaluation2 = selectStrategy(input, 1_700_000_000_000);
    expect(evaluation1.score).toBeGreaterThan(0);
    expect(evaluation1.score).toBeLessThanOrEqual(100);
    expect(evaluation1).toEqual(evaluation2);
  });

  it("H: reuses the existing Opportunity score/confidence directly when one exists, rather than recomputing", () => {
    const input = baseInput({ metrics: TREND_FOLLOWING_METRICS, regime: "trending", opportunity: { id: "opp-1", score: 77, confidence: 88 } });
    const candidate = selectStrategy(input);
    expect(candidate.score).toBe(77);
    expect(candidate.confidence).toBe(88);
  });

  it("I: identical inputs always produce an identical candidate -- no randomness, no LLM, no hidden state", () => {
    const input = baseInput({ metrics: MOMENTUM_CONTINUATION_METRICS, regime: "trending" });
    const results = Array.from({ length: 5 }, () => selectStrategy(input, 1_700_000_000_000));
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it("K: invalidation conditions are deterministic and non-empty for a real strategy candidate", () => {
    const candidate = selectStrategy(baseInput({ metrics: TREND_FOLLOWING_METRICS, regime: "trending" }));
    expect(candidate.invalidationConditions.length).toBeGreaterThan(0);
    expect(candidate.invalidationConditions).toEqual(selectStrategy(baseInput({ metrics: TREND_FOLLOWING_METRICS, regime: "trending" })).invalidationConditions);
  });
});

describe("J: strategy explanation contains supporting evidence", () => {
  it("J: the thesis references the strategy type and the supporting evidence it fired on", () => {
    const candidate = selectStrategy(baseInput({ metrics: TREND_FOLLOWING_METRICS, regime: "trending" }));
    expect(candidate.thesis).toContain("TREND_FOLLOWING");
    expect(candidate.supportingSignals.length).toBeGreaterThan(0);
    expect(candidate.thesis).toContain(candidate.supportingSignals[0]);
  });
});

describe("L: no fabricated dollar value", () => {
  it("L: no strategy candidate ever contains a dollar amount, ROI, or profit figure", () => {
    const candidates = [
      selectStrategy(baseInput({ metrics: TREND_FOLLOWING_METRICS, regime: "trending" })),
      selectStrategy(baseInput({ metrics: MOMENTUM_CONTINUATION_METRICS, regime: "trending" })),
      selectStrategy(baseInput({ metrics: RANGE_METRICS, regime: "ranging" })),
      selectStrategy(baseInput()),
    ];
    for (const candidate of candidates) {
      const serialized = JSON.stringify(candidate);
      expect(serialized).not.toMatch(/\$\d/);
      expect(serialized.toLowerCase()).not.toContain("roi");
      expect(serialized.toLowerCase()).not.toContain("expectedprofit");
      expect(serialized.toLowerCase()).not.toContain("guaranteed");
    }
  });
});

describe("M: no account assumptions", () => {
  it("M: riskUnit is a normalized, dimensionless value only (0 or 1) -- never a real position size, balance, or leverage figure", () => {
    const noTrade = selectStrategy(baseInput());
    expect(noTrade.riskUnit).toBe(0);
    const trending = selectStrategy(baseInput({ metrics: TREND_FOLLOWING_METRICS, regime: "trending" }));
    expect(trending.riskUnit).toBe(1);

    // No field CARRIES an account figure -- the explicit "no account balance is known or assumed"
    // disclaimer text inside `expectedScenario` is the desired behavior, not a violation, so this
    // checks the candidate's own field names/types rather than banning the disclaimer's own words.
    const forbiddenFieldNames = ["balance", "equity", "leverage", "positionSize", "accountValue"];
    for (const field of forbiddenFieldNames) {
      expect(Object.keys(trending)).not.toContain(field);
    }
    expect(typeof trending.riskUnit).toBe("number");
    expect(trending.riskUnit).toBeLessThanOrEqual(1);
  });
});

describe("N/O: tenant isolation and cross-tenant rejection for the strategy engine", () => {
  afterAll(closeTestConnections);

  it("N: strategy candidates are only ever visible to their owning organization", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await seedMetricsSnapshot(orgA.id, TREND_FOLLOWING_METRICS);

    await generateMarketStrategies();

    const scopedA = getTenantScopedClient(orgA.id);
    const scopedB = getTenantScopedClient(orgB.id);
    const candidatesA = await scopedA.companySignal.findMany({ where: { ruleName: STRATEGY_CANDIDATE_RULE_NAME, ruleVersion: STRATEGY_CANDIDATE_RULE_VERSION } });
    const candidatesB = await scopedB.companySignal.findMany({ where: { ruleName: STRATEGY_CANDIDATE_RULE_NAME, ruleVersion: STRATEGY_CANDIDATE_RULE_VERSION } });
    expect(candidatesA.length).toBeGreaterThan(0);
    expect(candidatesB).toHaveLength(0);
  });

  it("O: a cross-tenant query against another organization's strategy signals throws CrossTenantAccessError", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await seedMetricsSnapshot(orgA.id, TREND_FOLLOWING_METRICS);
    await generateMarketStrategies();

    const scopedB = getTenantScopedClient(orgB.id);
    await expect(
      scopedB.companySignal.findFirst({ where: { organizationId: orgA.id, ruleName: STRATEGY_CANDIDATE_RULE_NAME } }),
    ).rejects.toBeInstanceOf(CrossTenantAccessError);
  });

  it("one organization's strategy-generation failure never stops another organization's", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await seedMetricsSnapshot(orgA.id, TREND_FOLLOWING_METRICS);
    await seedMetricsSnapshot(orgB.id, TREND_FOLLOWING_METRICS);

    const spy = vi.spyOn(tenantModule, "getTenantScopedClient");
    spy.mockImplementationOnce(() => {
      throw new Error("simulated failure for the first organization only");
    });

    const result = await generateMarketStrategies();
    spy.mockRestore();

    expect(result.errors).toBeGreaterThanOrEqual(1);
    const scopedB = getTenantScopedClient(orgB.id);
    const candidatesB = await scopedB.companySignal.findMany({ where: { ruleName: STRATEGY_CANDIDATE_RULE_NAME } });
    expect(candidatesB.length).toBeGreaterThan(0);
  });
});

describe("integration: generateMarketStrategies persists an idempotent, risk-aware candidate per symbol", () => {
  afterAll(closeTestConnections);

  it("integration: risk-vetoed NO_TRADE persists correctly when a real Risk row already exists for the symbol", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, TREND_FOLLOWING_METRICS);
    await seedOpenRisk(organization.id, TREND_FOLLOWING_METRICS.symbol, "critical", ["extreme_move"]);

    await generateMarketStrategies();

    const signal = await prisma.companySignal.findFirstOrThrow({
      where: { organizationId: organization.id, ruleName: STRATEGY_CANDIDATE_RULE_NAME, relatedEntityId: TREND_FOLLOWING_METRICS.symbol },
    });
    const payload = signal.payload as unknown as { strategyType: string; noTradeReason: string | null };
    expect(payload.strategyType).toBe("NO_TRADE");
    expect(payload.noTradeReason).toBe("unacceptable_risk");
  });

  it("running generateMarketStrategies twice against the same snapshot upserts, never duplicates, the strategy CompanySignal", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, TREND_FOLLOWING_METRICS);

    await generateMarketStrategies();
    await generateMarketStrategies();

    const signals = await prisma.companySignal.findMany({
      where: { organizationId: organization.id, ruleName: STRATEGY_CANDIDATE_RULE_NAME, relatedEntityId: TREND_FOLLOWING_METRICS.symbol },
    });
    expect(signals).toHaveLength(1);
  });

  it("getMarketIntelligenceRanking surfaces the full strategy list, including NO_TRADE symbols with no Opportunity at all", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, BASE_METRICS); // neutral -- never becomes an Opportunity
    await generateMarketStrategies();

    const snapshot = await getMarketIntelligenceRanking(organization.id);
    expect(snapshot.strategies.length).toBeGreaterThan(0);
    const noTrade = snapshot.strategies.find((s) => s.symbol === BASE_METRICS.symbol);
    expect(noTrade?.strategyType).toBe("NO_TRADE");
  });
});

describe("P/Q/R: CRITICAL SAFETY -- the strategy engine can never touch autonomy or add execution capability", () => {
  afterAll(closeTestConnections);

  it("P: the market autonomy ceiling stays capped at L2, unchanged by this sprint", () => {
    expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.market).toBe("L2");
  });

  it("Q: a full strategy-generation pass leaves AutonomyPolicy, AutonomyPolicyVersion, and AutonomyAllowlistEntry byte-for-byte unchanged", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, TREND_FOLLOWING_METRICS);

    const policyBefore = await getOrCreatePolicy(organization.id, "market");
    const allowlistBefore = await listAllowlist(organization.id, "market");
    const versionCountBefore = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    const result = await generateMarketStrategies();
    expect(result.candidatesCreated).toBeGreaterThan(0);

    const policyAfter = await getOrCreatePolicy(organization.id, "market");
    const allowlistAfter = await listAllowlist(organization.id, "market");
    const versionCountAfter = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    expect(policyAfter).toEqual(policyBefore);
    expect(allowlistAfter).toEqual(allowlistBefore);
    expect(versionCountAfter).toBe(versionCountBefore);
  });

  it("R: no order/account/withdrawal/transfer function or tool exists anywhere in the registered tool set, and every market-domain tool stays read_only", () => {
    const forbiddenNamePattern = /placeorder|createorder|executeorder|withdraw|transfer|deposit/i;
    const offendingTools = listRegisteredTools().filter((tool) => forbiddenNamePattern.test(tool.name));
    expect(offendingTools).toHaveLength(0);

    const marketTools = listRegisteredTools().filter((t) => t.domain === "market");
    expect(marketTools.length).toBeGreaterThan(0);
    expect(marketTools.every((t) => t.mutationCategory === "read_only")).toBe(true);
    expect(marketTools.every((t) => !t.autonomyEligible)).toBe(true);
  });

  it("R: no strategy module exports a function named placeOrder/createOrder/executeOrder/withdraw/transfer", async () => {
    const generateModule = await import("@/server/intelligence/strategy/generate");
    const scoringModule = await import("@/server/intelligence/strategy/scoring");
    const forbidden = /placeorder|createorder|executeorder|withdraw|transfer/i;
    const allExportNames = [...Object.keys(generateModule), ...Object.keys(scoringModule)];
    expect(allExportNames.filter((name) => forbidden.test(name))).toHaveLength(0);
  });
});

describe("T: the read-only AI tool surfaces strategy data but can never execute anything", () => {
  afterAll(closeTestConnections);

  it("T: get_market_intelligence stays read_only, requires marketIntelligence:read, and its response includes the deterministic strategy list", async () => {
    const tool = getTool("get_market_intelligence");
    expect(tool?.mutationCategory).toBe("read_only");
    expect(tool?.domain).toBe("market");
    // Sprint 19 additionally requires paperTrading:read (the tool's `decisions`
    // field now draws on PaperAccount state) -- every role already holds both
    // permissions together, so this is a documented capability extension, not
    // a narrowing: every role that could call this tool before still can.
    expect(tool?.requiredPermission).toEqual({ marketIntelligence: ["read"], paperTrading: ["read"] });

    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");
    await seedMetricsSnapshot(organization.id, TREND_FOLLOWING_METRICS);
    await generateMarketStrategies();

    const conversation = await createConversation({ organizationId: organization.id, userId: viewer.userId });
    const result = await executeToolCall(
      { id: "mi-strategy-1", name: "get_market_intelligence", arguments: {} },
      { organizationId: organization.id, userId: viewer.userId, conversationId: conversation.id },
      authHeaders(viewer.token),
    );
    expect(result.status).toBe("success");
    const payload = result as unknown as { output?: { strategies?: unknown[] } };
    expect(Array.isArray(payload.output?.strategies)).toBe(true);
  });
});

describe("scoring internals", () => {
  it("computeStrategyScore is bounded [0, 100] for a computed (non-Opportunity-backed) candidate", () => {
    const input = baseInput({ metrics: RANGE_METRICS, regime: "ranging" });
    const evaluation = selectStrategy(input);
    expect(evaluation.score).toBeGreaterThanOrEqual(0);
    expect(evaluation.score).toBeLessThanOrEqual(100);
    // computeStrategyScore is exercised directly via selectStrategy above; re-imported here only to confirm the export surface is stable for future callers.
    expect(typeof computeStrategyScore).toBe("function");
  });
});
