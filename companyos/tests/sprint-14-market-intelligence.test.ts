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
import { discoverMarketUniverse } from "@/server/market-data/universe";
import { createMockMarketDataClient, buildSyntheticCandles } from "@/server/market-data/mock-client";
import { computeMarketMetrics } from "@/server/intelligence/signals/market-metrics";
import { evaluateMarketTrend } from "@/server/intelligence/signals/rules/market-trend";
import { evaluateMarketVolumeAnomaly } from "@/server/intelligence/signals/rules/market-volume-anomaly";
import { evaluateMarketVolatility } from "@/server/intelligence/signals/rules/market-volatility";
import { evaluateMarketRelativeStrength } from "@/server/intelligence/signals/rules/market-relative-strength";
import { classifyMarketRegime } from "@/server/intelligence/signals/rules/market-regime";
import {
  computeMarketConfidence,
  computeOpportunityScore,
  evaluateMarketOpportunityEligibility,
  evaluateMarketRiskConditions,
} from "@/server/intelligence/market-intelligence/scoring";
import { rankMarketCandidates } from "@/server/intelligence/market-intelligence/ranking";
import { generateMarketIntelligence } from "@/server/intelligence/market-intelligence/generate";
import { getMarketIntelligenceRanking } from "@/server/intelligence/market-intelligence/service";
import { ingestMarketData, METRICS_SNAPSHOT_RULE_NAME, METRICS_SNAPSHOT_RULE_VERSION, type MarketMetricsSnapshotPayload } from "@/server/intelligence/signals/market-scanner";
import { RULE_NAME as OPPORTUNITY_RULE_NAME, RULE_VERSION as OPPORTUNITY_RULE_VERSION } from "@/server/intelligence/opportunity/rules/market-multi-signal";
import { RULE_NAME as RISK_RULE_NAME } from "@/server/intelligence/risk/rules/market-multi-signal";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders, addMemberDirect } from "./helpers";

const NEUTRAL_METRICS: MarketMetricsSnapshotPayload = {
  symbol: "SOLUSDT",
  dailyPercentChange: 0,
  shortTermPercentChange: 0,
  mediumPercentChange: 0,
  trendConsistency: 0.5,
  volumeRatio: 1.0,
  volatilityPct: 2,
  relativeStrength: 0,
  observedAt: new Date().toISOString(),
};

const ELIGIBLE_OPPORTUNITY_METRICS: MarketMetricsSnapshotPayload = {
  ...NEUTRAL_METRICS,
  dailyPercentChange: 5,
  shortTermPercentChange: 1,
  mediumPercentChange: 3,
  trendConsistency: 0.8,
  volumeRatio: 2.0,
  volatilityPct: 2,
  relativeStrength: 2,
};

const EXTREME_RISK_METRICS: MarketMetricsSnapshotPayload = {
  ...NEUTRAL_METRICS,
  symbol: "XRPUSDT", // deliberately a DIFFERENT symbol than ELIGIBLE_OPPORTUNITY_METRICS -- same symbol would overwrite the same upserted snapshot row
  dailyPercentChange: 25,
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

describe("A/B: market universe discovery", () => {
  it("A: discovers TRADING, USDT-quoted, non-stablecoin symbols and ranks them by 24h quote volume, bounded to the universe size", async () => {
    const client = createMockMarketDataClient(
      { BTCUSDT: buildSyntheticCandles(25, 100, 100), ETHUSDT: buildSyntheticCandles(25, 100, 100), SOLUSDT: buildSyntheticCandles(25, 100, 100) },
      {
        exchangeInfo: [
          { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" },
          { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", status: "TRADING" },
          { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT", status: "TRADING" },
        ],
        ticker24hr: [
          { symbol: "SOLUSDT", quoteVolume: "500" },
          { symbol: "BTCUSDT", quoteVolume: "3000" },
          { symbol: "ETHUSDT", quoteVolume: "2000" },
        ],
      },
    );
    const universe = await discoverMarketUniverse(client, 2);
    expect(universe).toEqual(["BTCUSDT", "ETHUSDT"]); // top 2 by volume, BENCHMARK (BTCUSDT) already included
  });

  it("B: excludes non-TRADING symbols and stablecoin-pair symbols", async () => {
    const client = createMockMarketDataClient(
      { BTCUSDT: buildSyntheticCandles(25, 100, 100) },
      {
        exchangeInfo: [
          { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" },
          { symbol: "HALTEDUSDT", baseAsset: "HALTED", quoteAsset: "USDT", status: "BREAK" },
          { symbol: "USDCUSDT", baseAsset: "USDC", quoteAsset: "USDT", status: "TRADING" },
        ],
        ticker24hr: [
          { symbol: "BTCUSDT", quoteVolume: "1000" },
          { symbol: "HALTEDUSDT", quoteVolume: "9999999" },
          { symbol: "USDCUSDT", quoteVolume: "9999999" },
        ],
      },
    );
    const universe = await discoverMarketUniverse(client, 10);
    expect(universe).toEqual(["BTCUSDT"]);
  });
});

describe("C/D: data quality -- missing/insufficient candle history never produces a guessed metric", () => {
  it("C/D: computeMarketMetrics returns null when either window is short of its required length", () => {
    const fullDaily = buildSyntheticCandles(25, 100, 110);
    const shortShort = buildSyntheticCandles(5, 100, 110); // needs 8
    expect(computeMarketMetrics("BTCUSDT", fullDaily, shortShort)).toBeNull();
    expect(computeMarketMetrics("BTCUSDT", buildSyntheticCandles(20, 100, 110), buildSyntheticCandles(8, 100, 110))).toBeNull();
  });

  it("D: a full window on both timeframes produces real metrics, not a guess", () => {
    const metrics = computeMarketMetrics("BTCUSDT", buildSyntheticCandles(25, 100, 110), buildSyntheticCandles(8, 105, 108));
    expect(metrics).not.toBeNull();
    expect(metrics!.dailyPercentChange).toBeCloseTo(10, 0);
  });
});

describe("F/G/H/I: the 4 new deterministic signal families", () => {
  it("F: market_trend fires only when the medium move is both large enough AND consistent -- a large-but-inconsistent move does not fire", () => {
    const consistentTrend = { ...NEUTRAL_METRICS, mediumPercentChange: 5, trendConsistency: 0.9 };
    expect(evaluateMarketTrend(consistentTrend)?.direction).toBe("up");

    const inconsistentSpike = { ...NEUTRAL_METRICS, mediumPercentChange: 5, trendConsistency: 0.2 };
    expect(evaluateMarketTrend(inconsistentSpike)).toBeNull();
  });

  it("G: market_volume_anomaly fires only above the ratio threshold and scales severity with magnitude", () => {
    expect(evaluateMarketVolumeAnomaly({ ...NEUTRAL_METRICS, volumeRatio: 1.2 })).toBeNull();
    expect(evaluateMarketVolumeAnomaly({ ...NEUTRAL_METRICS, volumeRatio: 2.5 })?.severity).toBe("medium");
    expect(evaluateMarketVolumeAnomaly({ ...NEUTRAL_METRICS, volumeRatio: 7 })?.severity).toBe("critical");
  });

  it("H: market_volatility fires only above the elevated threshold", () => {
    expect(evaluateMarketVolatility({ ...NEUTRAL_METRICS, volatilityPct: 1 })).toBeNull();
    expect(evaluateMarketVolatility({ ...NEUTRAL_METRICS, volatilityPct: 12 })?.severity).toBe("critical");
  });

  it("I: market_relative_strength measures the SPREAD against the benchmark, not either symbol's own absolute change", () => {
    // Symbol up 5%, benchmark ALSO up 4% -- spread is only 1%, below threshold, no signal (both just riding the same market move).
    expect(evaluateMarketRelativeStrength({ ...NEUTRAL_METRICS, dailyPercentChange: 5 }, 4)).toBeNull();
    // Symbol up 5%, benchmark flat -- real 5-point outperformance.
    const outperform = evaluateMarketRelativeStrength({ ...NEUTRAL_METRICS, dailyPercentChange: 5 }, 0);
    expect(outperform?.direction).toBe("outperform");
  });
});

describe("J/K: market regime classification is deterministic and versioned", () => {
  it("J: classifies high_volatility, low_volatility, trending, ranging, and uncertain from real thresholds", () => {
    expect(classifyMarketRegime({ ...NEUTRAL_METRICS, volatilityPct: 8 }).regime).toBe("high_volatility");
    expect(classifyMarketRegime({ ...NEUTRAL_METRICS, volatilityPct: 0.5 }).regime).toBe("low_volatility");
    expect(classifyMarketRegime({ ...NEUTRAL_METRICS, volatilityPct: 2, trendConsistency: 0.9, mediumPercentChange: 4 }).regime).toBe("trending");
    expect(classifyMarketRegime({ ...NEUTRAL_METRICS, volatilityPct: 2, trendConsistency: 0.3 }).regime).toBe("ranging");
    expect(classifyMarketRegime({ ...NEUTRAL_METRICS, volatilityPct: 2, trendConsistency: 0.5 }).regime).toBe("uncertain");
  });

  it("K: regime is deterministic and reproducible for identical input", () => {
    const input = { ...NEUTRAL_METRICS, volatilityPct: 8 };
    expect(classifyMarketRegime(input)).toEqual(classifyMarketRegime(input));
  });
});

describe("L/M: deterministic multi-signal eligibility for Opportunity and Risk", () => {
  it("L: opportunity eligibility requires ALL 5 conditions -- a single strong signal alone is not enough", () => {
    expect(evaluateMarketOpportunityEligibility(ELIGIBLE_OPPORTUNITY_METRICS)).toBe(true);
    // Strong momentum alone, everything else neutral (fails trend/volume) -- not eligible.
    expect(evaluateMarketOpportunityEligibility({ ...NEUTRAL_METRICS, dailyPercentChange: 10 })).toBe(false);
  });

  it("M: risk conditions are OR-based -- extreme move alone is sufficient", () => {
    const evaluation = evaluateMarketRiskConditions(EXTREME_RISK_METRICS);
    expect(evaluation?.conditions).toContain("extreme_move");
    expect(evaluation?.severity).toBe("critical");
    expect(evaluateMarketRiskConditions(NEUTRAL_METRICS)).toBeNull();
  });
});

describe("N/O/P: scoring, ranking, and tie-breaking", () => {
  it("N: opportunity score is a transparent, capped, additive composite -- never unbounded", () => {
    const result = computeOpportunityScore(ELIGIBLE_OPPORTUNITY_METRICS, false);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown.momentumContribution).toBeGreaterThan(0);
    // A risk-flagged candidate scores strictly lower than the identical candidate without a co-occurring risk.
    const riskFlagged = computeOpportunityScore(ELIGIBLE_OPPORTUNITY_METRICS, true);
    expect(riskFlagged.score).toBeLessThan(result.score);
  });

  it("O/P: ranking is deterministic and reproducible, with a deterministic alphabetical tie-break on equal score/confidence", () => {
    const now = new Date();
    const opportunities = [
      { relatedEntityId: "ETHUSDT", score: 80, confidence: 85, evidence: { dailyPercentChange: 5 }, updatedAt: now },
      { relatedEntityId: "BTCUSDT", score: 80, confidence: 85, evidence: { dailyPercentChange: 5 }, updatedAt: now },
    ];
    const ranked = rankMarketCandidates(opportunities, [], "trending");
    expect(ranked.map((r) => r.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]); // alphabetical tie-break
    expect(rankMarketCandidates(opportunities, [], "trending")).toEqual(ranked); // reproducible
  });

  it("O: a higher score always ranks first, regardless of insertion order", () => {
    const now = new Date();
    const ranked = rankMarketCandidates(
      [
        { relatedEntityId: "LOWSCORE", score: 40, confidence: 70, evidence: {}, updatedAt: now },
        { relatedEntityId: "HIGHSCORE", score: 90, confidence: 70, evidence: {}, updatedAt: now },
      ],
      [],
      null,
    );
    expect(ranked[0]!.symbol).toBe("HIGHSCORE");
  });
});

describe("Q/R/S/T: idempotency -- no duplicate signal, opportunity, or risk on re-run", () => {
  afterAll(closeTestConnections);

  it("Q/R/S/T: running generateMarketIntelligence twice against the same metrics snapshot upserts, never duplicates, the Opportunity/Risk rows", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, ELIGIBLE_OPPORTUNITY_METRICS);
    await seedMetricsSnapshot(organization.id, EXTREME_RISK_METRICS);

    await generateMarketIntelligence();
    await generateMarketIntelligence();

    const opportunities = await prisma.opportunity.findMany({ where: { organizationId: organization.id, ruleName: OPPORTUNITY_RULE_NAME } });
    const risks = await prisma.risk.findMany({ where: { organizationId: organization.id, ruleName: RISK_RULE_NAME } });
    expect(opportunities).toHaveLength(1);
    expect(risks).toHaveLength(1);
  });

  it("S: a risk that no longer meets any condition on re-evaluation is auto-resolved, mirroring at_risk_subscription's own precedent", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, EXTREME_RISK_METRICS);
    await generateMarketIntelligence();

    const riskBefore = await prisma.risk.findFirstOrThrow({ where: { organizationId: organization.id, ruleName: RISK_RULE_NAME } });
    expect(riskBefore.status).toBe("open");

    // Same symbol (SOLUSDT), now back to neutral -- the risk condition no longer holds.
    await seedMetricsSnapshot(organization.id, { ...NEUTRAL_METRICS, symbol: EXTREME_RISK_METRICS.symbol });
    await generateMarketIntelligence();

    const riskAfter = await prisma.risk.findUniqueOrThrow({ where: { id: riskBefore.id } });
    expect(riskAfter.status).toBe("resolved");
  });
});

describe("U/V: external failure and organization failure isolation for stage 2 generation", () => {
  afterAll(closeTestConnections);

  it("V: one organization's generation failure never stops another organization's", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await seedMetricsSnapshot(orgA.id, ELIGIBLE_OPPORTUNITY_METRICS);
    await seedMetricsSnapshot(orgB.id, ELIGIBLE_OPPORTUNITY_METRICS);

    const spy = vi.spyOn(tenantModule, "getTenantScopedClient");
    spy.mockImplementationOnce(() => {
      throw new Error("simulated failure for the first organization only");
    });

    const result = await generateMarketIntelligence();
    spy.mockRestore();

    expect(result.errors).toBeGreaterThanOrEqual(1);
    const opportunitiesB = await prisma.opportunity.findMany({ where: { organizationId: orgB.id, ruleName: OPPORTUNITY_RULE_NAME } });
    expect(opportunitiesB.length).toBeGreaterThan(0);
  });
});

describe("W/X: tenant isolation and cross-tenant rejection", () => {
  afterAll(closeTestConnections);

  it("W/X: an organization only ever sees its own market intelligence ranking, and a cross-tenant query throws", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await seedMetricsSnapshot(orgA.id, ELIGIBLE_OPPORTUNITY_METRICS);
    await generateMarketIntelligence();

    const rankingA = await getMarketIntelligenceRanking(orgA.id);
    const rankingB = await getMarketIntelligenceRanking(orgB.id);
    expect(rankingA.ranked.length).toBeGreaterThan(0);
    expect(rankingB.ranked).toHaveLength(0);

    const scopedB = getTenantScopedClient(orgB.id);
    await expect(scopedB.opportunity.findFirst({ where: { organizationId: orgA.id } })).rejects.toBeInstanceOf(CrossTenantAccessError);
  });
});

describe("Y: RBAC for the market intelligence AI tool", () => {
  afterAll(closeTestConnections);

  it("Y: get_market_intelligence requires marketIntelligence:read, held by every role including viewer", async () => {
    expect(getTool("get_market_intelligence")?.requiredPermission).toEqual({ marketIntelligence: ["read"] });

    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");

    const conversation = await createConversation({ organizationId: organization.id, userId: viewer.userId });
    const result = await executeToolCall(
      { id: "mi-1", name: "get_market_intelligence", arguments: {} },
      { organizationId: organization.id, userId: viewer.userId, conversationId: conversation.id },
      authHeaders(viewer.token),
    );
    expect(result.status).toBe("success");
  });
});

describe("Z/AA/AB/AC: CRITICAL SAFETY -- market intelligence can never touch autonomy or add execution capability", () => {
  afterAll(closeTestConnections);

  it("Z: no order/account/withdrawal/transfer function exists anywhere in the registered tool set", () => {
    const forbiddenNamePattern = /placeorder|createorder|withdraw|transfer|deposit/i;
    const offendingTools = listRegisteredTools().filter((tool) => forbiddenNamePattern.test(tool.name));
    expect(offendingTools).toHaveLength(0);
  });

  it("AA: the market autonomy ceiling stays capped at L2, unchanged", () => {
    expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.market).toBe("L2");
  });

  it("AB/AC: a full ingestion + generation pass that produces a real opportunity and a real risk leaves AutonomyPolicy, AutonomyPolicyVersion, and AutonomyAllowlistEntry byte-for-byte unchanged", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const policyBefore = await getOrCreatePolicy(organization.id, "market");
    const allowlistBefore = await listAllowlist(organization.id, "market");
    const versionCountBefore = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    // A volume spike on the most recent candle is required for eligibility's
    // own volume-confirmation condition (>=1.5x baseline) -- flat volume
    // (the default) would never clear that bar.
    const volumeSpike = (index: number, count: number) => (index === count - 1 ? 3 : 1);
    const client = createMockMarketDataClient({
      BTCUSDT: buildSyntheticCandles(25, 100, 130, 60, volumeSpike),
      ETHUSDT: buildSyntheticCandles(25, 100, 130, 60, volumeSpike),
    });
    await ingestMarketData(client);
    await generateMarketIntelligence();

    const opportunities = await prisma.opportunity.findMany({ where: { organizationId: organization.id, ruleName: OPPORTUNITY_RULE_NAME } });
    expect(opportunities.length).toBeGreaterThan(0); // a real opportunity was actually produced this run

    const policyAfter = await getOrCreatePolicy(organization.id, "market");
    const allowlistAfter = await listAllowlist(organization.id, "market");
    const versionCountAfter = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    expect(policyAfter).toEqual(policyBefore);
    expect(allowlistAfter).toEqual(allowlistBefore);
    expect(versionCountAfter).toBe(versionCountBefore);

    const marketTools = listRegisteredTools().filter((t) => t.domain === "market");
    expect(marketTools.every((t) => t.mutationCategory === "read_only")).toBe(true);
  });
});

describe("AD: Outcome/Learning compatibility -- market Opportunity/Risk are ordinary, soft-referenceable rows", () => {
  afterAll(closeTestConnections);

  it("AD: a market Opportunity/Risk uses the exact same soft-reference shape (relatedEntityType/relatedEntityId, ruleName/ruleVersion) every existing Outcome rule already reads -- no schema change needed for a future rule to observe it", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await seedMetricsSnapshot(organization.id, ELIGIBLE_OPPORTUNITY_METRICS);
    await generateMarketIntelligence();

    const opportunity = await prisma.opportunity.findFirstOrThrow({ where: { organizationId: organization.id, ruleName: OPPORTUNITY_RULE_NAME } });
    expect(opportunity.relatedEntityType).toBe("MarketSymbol");
    expect(opportunity.relatedEntityId).toBe(ELIGIBLE_OPPORTUNITY_METRICS.symbol);
    expect(opportunity.ruleName).toBe(OPPORTUNITY_RULE_NAME);
    expect(opportunity.ruleVersion).toBe(OPPORTUNITY_RULE_VERSION);
    // No Outcome/LearningRecord is fabricated by this sprint -- confirm none exists yet for this row.
    const outcomes = await prisma.outcome.findMany({ where: { organizationId: organization.id, relatedEntityType: "Opportunity", relatedEntityId: opportunity.id } });
    expect(outcomes).toHaveLength(0);
  });

  it("computeMarketConfidence is evidence-margin-based, never a fabricated probability, and stays within [70, 95]", () => {
    const confidence = computeMarketConfidence(ELIGIBLE_OPPORTUNITY_METRICS);
    expect(confidence).toBeGreaterThanOrEqual(70);
    expect(confidence).toBeLessThanOrEqual(95);
  });
});
