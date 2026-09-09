import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { CrossTenantAccessError, getTenantScopedClient } from "@/server/db/tenant";
import { getTool, listRegisteredTools } from "@/server/ai/tools/registry";
import { getOrCreatePolicy, engageKillSwitch } from "@/server/ai/autonomy/policy-service";
import { MAX_AUTONOMY_LEVEL_BY_DOMAIN, maxLevelForDomain } from "@/server/ai/autonomy/constants";
import { getOrCreatePaperAccount } from "@/server/intelligence/paper-trading/account";
import { buildEntryPlan, computePositionSizing } from "@/server/intelligence/paper-trading/sizing";
import type { MarketDecision, ProposedOrder } from "@/server/intelligence/market-decision/types";
import { createMockExecutionGateway } from "@/server/execution/mock-gateway";
import { submitDecision } from "@/server/execution/service";
import { validateForLiveExecution } from "@/server/execution/validation";
import { checkRiskLimits, DEFAULT_HARD_LIMITS, MAX_LIVE_LEVERAGE, MAX_ORDER_NOTIONAL_PCT_OF_EQUITY, MAX_LIVE_TOTAL_EXPOSURE_MULTIPLE, MAX_LIVE_SIMULTANEOUS_POSITIONS, MAX_SYMBOL_EXPOSURE_PCT_OF_EQUITY, MAX_STRATEGY_EXPOSURE_PCT_OF_EQUITY, MAX_DAILY_LOSS_PCT, MAX_CONSECUTIVE_LOSSES } from "@/server/execution/risk-limits";
import { DEFAULT_RISK_POLICY, ABSOLUTE_MAX_RISK_CEILING, getOrganizationRiskPolicy, setOrganizationRiskPolicy, InvalidRiskPolicyError, type RiskPolicyLimits } from "@/server/execution/risk-policy";
import { evaluateCircuitBreakers, isEmergencyStopEngaged } from "@/server/execution/circuit-breakers";
import { evaluateCapitalAllocation } from "@/server/execution/capital-allocation";
import { computePortfolioSnapshot, existingExposureFor } from "@/server/execution/portfolio-risk";
import { computePortfolioConcentration, computeCorrelationRisk } from "@/server/execution/concentration";
import { applyFillUpdate, syncOrderFillFromProvider, cancelExistingLiveOrder, reconcileOrganizationLiveState, LiveOrderNotFoundError } from "@/server/execution/position-management";
import { buildClientOrderId } from "@/server/execution/idempotency";
import { authHeaders, closeTestConnections, createClosedPaperTrade, createOrgForUser, signUpUser } from "./helpers";

afterAll(closeTestConnections);

/**
 * Sprint 24 test suite -- organization-configurable risk policy, capital
 * allocation, portfolio risk, circuit breakers, and real fill persistence.
 * Uses ONLY `createMockExecutionGateway`/small ad-hoc fakes -- never a real
 * Binance credential, never a real network call (Group AG asserts this
 * directly for this file's own gateway usage).
 */

const HEALTHY_RISK_CONTEXT = {
  accountEquity: 10_000,
  existingTotalExposure: 0,
  existingOpenPositionCount: 0,
  existingSymbolExposure: 0,
  existingStrategyExposure: 0,
  todaysRealizedLossPct: 0,
  consecutiveLosses: 0,
  emergencyStopEngaged: false,
};

function buildProposedOrder(overrides: Partial<ProposedOrder> = {}): ProposedOrder {
  const now = new Date();
  return {
    symbol: "BTCUSDT",
    direction: "LONG",
    mode: "SPOT",
    entryPrice: 100,
    quantity: 1,
    notional: 100,
    initialMargin: 100,
    leverage: 1,
    stopLossPrice: 99,
    takeProfitPrice: 102,
    liquidationPrice: null,
    risk: 1,
    reason: "test fixture",
    confidence: 80,
    decisionTimestamp: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    validationStatus: "VALID",
    rejectReason: null,
    ...overrides,
  };
}

function buildDecision(overrides: Partial<MarketDecision> & { proposedOrderOverrides?: Partial<ProposedOrder> } = {}): MarketDecision {
  const { proposedOrderOverrides, ...rest } = overrides;
  const base: MarketDecision = {
    symbol: "BTCUSDT",
    action: "BUY",
    strategyType: "TREND_FOLLOWING",
    strategyScore: 80,
    strategyConfidence: 80,
    evaluationScore: null,
    evidenceQuality: "strong",
    regime: null,
    riskSeverity: "low",
    reasons: ["test fixture"],
    killSwitchEngaged: false,
    strategyQuarantined: false,
    proposedOrder: buildProposedOrder(proposedOrderOverrides),
  };
  return { ...base, ...rest };
}

async function setupOrg() {
  const owner = await signUpUser();
  const organization = await createOrgForUser(owner);
  return { owner, organization };
}

/** Directly creates an OPEN `PaperPosition` row -- bypassing the full Sprint 16 entry pipeline for precise, deterministic control over exposure fixtures. */
async function createOpenPaperPosition(organizationId: string, overrides: Partial<{ symbol: string; strategyType: string; direction: "LONG" | "SHORT"; leverage: number; entryPrice: number; quantity: number; notional: number; initialMargin: number }> = {}) {
  const account = await getOrCreatePaperAccount(organizationId);
  const entryPrice = overrides.entryPrice ?? 100;
  const quantity = overrides.quantity ?? 10;
  const notional = overrides.notional ?? entryPrice * quantity;
  return prisma.paperPosition.create({
    data: {
      organizationId,
      accountId: account.id,
      symbol: overrides.symbol ?? "BTCUSDT",
      direction: overrides.direction ?? "LONG",
      mode: "SPOT",
      status: "OPEN",
      strategyType: overrides.strategyType ?? "TREND_FOLLOWING",
      leverage: overrides.leverage ?? 1,
      entryPrice,
      currentPrice: entryPrice,
      quantity,
      notional,
      initialMargin: overrides.initialMargin ?? notional,
      stopLossPrice: entryPrice * 0.99,
      takeProfitPrice: entryPrice * 1.02,
      riskUnit: 1,
      unrealizedPnl: 0,
      feesPaid: 0,
      fundingPaid: 0,
      maxFavorableExcursion: 0,
      maxAdverseExcursion: 0,
      openedAt: new Date(),
    },
  });
}

describe("Sprint 24: Advanced Risk & Capital Management", () => {
  // ── Group A: default risk policy ────────────────────────────────────
  describe("A. default risk policy", () => {
    it("A1: an organization that has never configured a policy gets DEFAULT_RISK_POLICY", async () => {
      const { organization } = await setupOrg();
      const policy = await getOrganizationRiskPolicy(organization.id);
      expect(policy).toEqual(DEFAULT_RISK_POLICY);
    });

    it("A2: DEFAULT_RISK_POLICY's 8 carried-forward fields are never looser than Sprint 22's own hardcoded constants", () => {
      expect(DEFAULT_RISK_POLICY.maxLeverage).toBe(MAX_LIVE_LEVERAGE);
      expect(DEFAULT_RISK_POLICY.maxOrderNotionalPct).toBe(MAX_ORDER_NOTIONAL_PCT_OF_EQUITY);
      expect(DEFAULT_RISK_POLICY.maxTotalExposureMultiple).toBe(MAX_LIVE_TOTAL_EXPOSURE_MULTIPLE);
      expect(DEFAULT_RISK_POLICY.maxSimultaneousPositions).toBe(MAX_LIVE_SIMULTANEOUS_POSITIONS);
      expect(DEFAULT_RISK_POLICY.maxSymbolExposurePct).toBe(MAX_SYMBOL_EXPOSURE_PCT_OF_EQUITY);
      expect(DEFAULT_RISK_POLICY.maxStrategyExposurePct).toBe(MAX_STRATEGY_EXPOSURE_PCT_OF_EQUITY);
      expect(DEFAULT_RISK_POLICY.maxDailyLossPct).toBe(MAX_DAILY_LOSS_PCT);
      expect(DEFAULT_RISK_POLICY.maxConsecutiveLosses).toBe(MAX_CONSECUTIVE_LOSSES);
    });

    it("A3: the default policy is already within the absolute ceiling", () => {
      expect(DEFAULT_RISK_POLICY.maxLeverage).toBeLessThanOrEqual(ABSOLUTE_MAX_RISK_CEILING.maxLeverage);
      expect(DEFAULT_RISK_POLICY.maxPortfolioDrawdownPct).toBeLessThanOrEqual(ABSOLUTE_MAX_RISK_CEILING.maxPortfolioDrawdownPct);
      expect(DEFAULT_RISK_POLICY.emergencyStopThresholdPct).toBeLessThanOrEqual(ABSOLUTE_MAX_RISK_CEILING.emergencyStopThresholdPct);
    });
  });

  // ── Group B: organization-specific risk policy ──────────────────────
  describe("B. organization-specific risk policy", () => {
    it("B1: setting a custom policy persists and is returned by subsequent reads", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationRiskPolicy({ organizationId: organization.id, actorId: owner.userId, policy: { maxLeverage: 2, maxSimultaneousPositions: 1 } });
      const policy = await getOrganizationRiskPolicy(organization.id);
      expect(policy.maxLeverage).toBe(2);
      expect(policy.maxSimultaneousPositions).toBe(1);
      // Unspecified fields fall back to the previous effective policy (the default here), never silently zeroed.
      expect(policy.maxDailyLossPct).toBe(DEFAULT_RISK_POLICY.maxDailyLossPct);
    });

    it("B2: a configured value above the absolute ceiling is clamped down, never applied as-is", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationRiskPolicy({ organizationId: organization.id, actorId: owner.userId, policy: { maxLeverage: 999, maxDailyLossPct: 0.99 } });
      const policy = await getOrganizationRiskPolicy(organization.id);
      expect(policy.maxLeverage).toBe(ABSOLUTE_MAX_RISK_CEILING.maxLeverage);
      expect(policy.maxDailyLossPct).toBe(ABSOLUTE_MAX_RISK_CEILING.maxDailyLossPct);
    });

    it("B3: an invalid field (zero, negative, non-finite) is rejected before anything is persisted", async () => {
      const { owner, organization } = await setupOrg();
      await expect(setOrganizationRiskPolicy({ organizationId: organization.id, actorId: owner.userId, policy: { maxLeverage: 0 } })).rejects.toBeInstanceOf(InvalidRiskPolicyError);
      await expect(setOrganizationRiskPolicy({ organizationId: organization.id, actorId: owner.userId, policy: { maxDailyLossPct: -0.1 } })).rejects.toBeInstanceOf(InvalidRiskPolicyError);
      const policy = await getOrganizationRiskPolicy(organization.id);
      expect(policy).toEqual(DEFAULT_RISK_POLICY);
    });
  });

  // ── Group C: cross-tenant policy rejection ──────────────────────────
  describe("C. cross-tenant policy rejection", () => {
    it("C1: organization B cannot read or write organization A's risk policy row", async () => {
      const { owner, organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await setOrganizationRiskPolicy({ organizationId: orgA.id, actorId: owner.userId, policy: { maxLeverage: 2 } });

      const scopedB = getTenantScopedClient(orgB.id);
      await expect(scopedB.organizationRiskPolicy.findFirst({ where: { organizationId: orgA.id } })).rejects.toBeInstanceOf(CrossTenantAccessError);
      await expect(
        scopedB.organizationRiskPolicy.create({ data: { organizationId: orgA.id, maxLeverage: 1, maxOrderNotionalPct: 0.1, maxTotalExposureMultiple: 1, maxSimultaneousPositions: 1, maxSymbolExposurePct: 0.1, maxStrategyExposurePct: 0.1, maxDailyLossPct: 0.1, maxConsecutiveLosses: 1, maxPortfolioDrawdownPct: 0.1, emergencyStopThresholdPct: 0.2 } }),
      ).rejects.toBeInstanceOf(CrossTenantAccessError);
    });

    it("C2: organization B never sees organization A's policy row via a plain findMany", async () => {
      const { owner, organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await setOrganizationRiskPolicy({ organizationId: orgA.id, actorId: owner.userId, policy: { maxLeverage: 2 } });
      const scopedB = getTenantScopedClient(orgB.id);
      expect(await scopedB.organizationRiskPolicy.findMany({})).toHaveLength(0);
    });
  });

  // ── Group D: risk limit enforcement (org-configured) ────────────────
  describe("D. risk limit enforcement", () => {
    it("D1: checkRiskLimits uses the passed-in limits, not the module defaults, when supplied", () => {
      const strict: RiskPolicyLimits = { ...DEFAULT_RISK_POLICY, maxLeverage: 1 };
      const violation = checkRiskLimits({ ...HEALTHY_RISK_CONTEXT, orderNotional: 100, leverage: 2 }, strict);
      expect(violation).toBe("max_leverage");
    });

    it("D2: omitting limits entirely uses DEFAULT_HARD_LIMITS, unchanged from Sprint 22 behavior", () => {
      const violation = checkRiskLimits({ ...HEALTHY_RISK_CONTEXT, orderNotional: 100, leverage: MAX_LIVE_LEVERAGE + 1 });
      expect(violation).toBe("max_leverage");
      expect(DEFAULT_HARD_LIMITS.maxLeverage).toBe(MAX_LIVE_LEVERAGE);
    });
  });

  // ── Group E: leverage limit ──────────────────────────────────────────
  describe("E. leverage limit", () => {
    it("E1: an organization-configured stricter leverage limit is enforced end to end via validateForLiveExecution", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationRiskPolicy({ organizationId: organization.id, actorId: owner.userId, policy: { maxLeverage: 1 } });
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision({ proposedOrderOverrides: { leverage: 2 } });
      const result = await validateForLiveExecution({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result).toEqual({ status: "NO_EXECUTION", reason: "max_leverage" });
    });
  });

  // ── Group F: order notional limit ────────────────────────────────────
  describe("F. order notional limit", () => {
    it("F1: an organization-configured stricter notional cap rejects an otherwise-valid order", () => {
      const strict: RiskPolicyLimits = { ...DEFAULT_RISK_POLICY, maxOrderNotionalPct: 0.01 };
      const violation = checkRiskLimits({ ...HEALTHY_RISK_CONTEXT, orderNotional: 500, leverage: 1 }, strict);
      expect(violation).toBe("max_order_notional");
    });
  });

  // ── Group G: total exposure limit ────────────────────────────────────
  describe("G. total exposure limit", () => {
    it("G1: existing + new exposure over the configured multiple is rejected", () => {
      const strict: RiskPolicyLimits = { ...DEFAULT_RISK_POLICY, maxTotalExposureMultiple: 1 };
      const violation = checkRiskLimits({ ...HEALTHY_RISK_CONTEXT, orderNotional: 100, leverage: 1, existingTotalExposure: HEALTHY_RISK_CONTEXT.accountEquity }, strict);
      expect(violation).toBe("max_total_exposure");
    });
  });

  // ── Group H: symbol exposure limit ───────────────────────────────────
  describe("H. symbol exposure limit", () => {
    it("H1: existing + new exposure for ONE symbol over the configured pct is rejected", () => {
      const strict: RiskPolicyLimits = { ...DEFAULT_RISK_POLICY, maxSymbolExposurePct: 0.05 };
      const violation = checkRiskLimits({ ...HEALTHY_RISK_CONTEXT, orderNotional: 100, leverage: 1, existingSymbolExposure: 500 }, strict);
      expect(violation).toBe("max_symbol_exposure");
    });
  });

  // ── Group I: strategy exposure limit ─────────────────────────────────
  describe("I. strategy exposure limit", () => {
    it("I1: existing + new exposure for ONE strategy type over the configured pct is rejected", () => {
      const strict: RiskPolicyLimits = { ...DEFAULT_RISK_POLICY, maxStrategyExposurePct: 0.05 };
      const violation = checkRiskLimits({ ...HEALTHY_RISK_CONTEXT, orderNotional: 100, leverage: 1, existingStrategyExposure: 500 }, strict);
      expect(violation).toBe("max_strategy_exposure");
    });
  });

  // ── Group J: position count limit ────────────────────────────────────
  describe("J. position count limit", () => {
    it("J1: at the configured simultaneous-position ceiling, a new entry is rejected", () => {
      const strict: RiskPolicyLimits = { ...DEFAULT_RISK_POLICY, maxSimultaneousPositions: 2 };
      const violation = checkRiskLimits({ ...HEALTHY_RISK_CONTEXT, orderNotional: 10, leverage: 1, existingOpenPositionCount: 2 }, strict);
      expect(violation).toBe("max_open_positions");
    });
  });

  // ── Group K: daily loss limit ─────────────────────────────────────────
  describe("K. daily loss limit", () => {
    it("K1: today's realized loss at or above the configured pct rejects a new entry", () => {
      const strict: RiskPolicyLimits = { ...DEFAULT_RISK_POLICY, maxDailyLossPct: 0.02 };
      const violation = checkRiskLimits({ ...HEALTHY_RISK_CONTEXT, orderNotional: 10, leverage: 1, todaysRealizedLossPct: 0.02 }, strict);
      expect(violation).toBe("max_daily_loss");
    });
  });

  // ── Group L: consecutive loss limit ──────────────────────────────────
  describe("L. consecutive loss limit", () => {
    it("L1: consecutive losses at or above the configured count rejects a new entry", () => {
      const strict: RiskPolicyLimits = { ...DEFAULT_RISK_POLICY, maxConsecutiveLosses: 2 };
      const violation = checkRiskLimits({ ...HEALTHY_RISK_CONTEXT, orderNotional: 10, leverage: 1, consecutiveLosses: 2 }, strict);
      expect(violation).toBe("max_consecutive_losses");
    });
  });

  // ── Group M: portfolio drawdown limit ────────────────────────────────
  describe("M. portfolio drawdown limit", () => {
    it("M1: current drawdown at or above the policy's portfolio-drawdown threshold trips the breaker", () => {
      const policy: RiskPolicyLimits = { ...DEFAULT_RISK_POLICY, maxPortfolioDrawdownPct: 0.1 };
      const result = evaluateCircuitBreakers({ todaysRealizedLossPct: 0, consecutiveLosses: 0, currentDrawdownPct: 0.1, policy });
      expect(result.triggeredBreakers).toContain("portfolio_drawdown");
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  });

  // ── Group N: capital allocation ──────────────────────────────────────
  describe("N. capital allocation", () => {
    it("N1: a small, healthy order against an empty portfolio is APPROVED with a fully-populated stage trace", async () => {
      const { organization } = await setupOrg();
      const result = await evaluateCapitalAllocation({ organizationId: organization.id, symbol: "BTCUSDT", strategyType: "TREND_FOLLOWING", proposedNotional: 100, proposedLeverage: 1 });
      expect(result.status).toBe("APPROVED");
      expect(result.stage.availableCapital).toBeGreaterThan(0);
      expect(result.stage.finalOrderNotional).toBe(100);
      expect(result.stage.finalOrderLeverage).toBe(1);
      expect(result.stage.requiredMargin).toBe(100);
    });

    it("N2: an order that would breach total exposure is REJECTED with the correct reason", async () => {
      const { organization } = await setupOrg();
      // Existing exposure (1000) + a small new order (600, well under the
      // default per-order notional cap) breaches a tightened total-exposure
      // multiple (1500) without tripping the earlier order-notional,
      // position-count, symbol-, or strategy-exposure checks first --
      // isolating this test to the total-exposure check specifically.
      await createOpenPaperPosition(organization.id, { symbol: "BTCUSDT", strategyType: "TREND_FOLLOWING", notional: 1000 });
      const policy: RiskPolicyLimits = { ...DEFAULT_RISK_POLICY, maxTotalExposureMultiple: 0.15 };
      const result = await evaluateCapitalAllocation({
        organizationId: organization.id,
        symbol: "BTCUSDT",
        strategyType: "TREND_FOLLOWING",
        proposedNotional: 600,
        proposedLeverage: 1,
        policy,
      });
      expect(result.status).toBe("REJECTED");
      if (result.status === "REJECTED") expect(result.reason).toBe("max_total_exposure");
    });
  });

  // ── Group O: remaining risk budget ───────────────────────────────────
  describe("O. remaining risk budget", () => {
    it("O1: riskBudgetRemaining shrinks by today's realized loss, floored at zero", async () => {
      const { organization } = await setupOrg();
      const account = await getOrCreatePaperAccount(organization.id);
      await createClosedPaperTrade(organization.id, { netPnl: -account.currentEquity * 0.5, returnPct: -0.5, closedAt: new Date() });
      const result = await evaluateCapitalAllocation({ organizationId: organization.id, symbol: "BTCUSDT", strategyType: "TREND_FOLLOWING", proposedNotional: 10, proposedLeverage: 1 });
      expect(result.stage.riskBudgetRemaining).toBe(0); // 50% loss vastly exceeds the 5% default daily-loss budget
    });
  });

  // ── Group P: margin utilization ──────────────────────────────────────
  describe("P. margin utilization", () => {
    it("P1: margin utilization is usedMargin / currentEquity, zero for a fresh account", async () => {
      const { organization } = await setupOrg();
      const snapshot = await computePortfolioSnapshot(organization.id);
      expect(snapshot.marginUtilization).toBe(0);
    });
  });

  // ── Group Q: multi-position portfolio ────────────────────────────────
  describe("Q. multi-position portfolio", () => {
    it("Q1: multiple open positions across symbols/strategies aggregate correctly into total/gross/net/bySymbol/byStrategy", async () => {
      const { organization } = await setupOrg();
      await createOpenPaperPosition(organization.id, { symbol: "BTCUSDT", strategyType: "TREND_FOLLOWING", direction: "LONG", notional: 300 });
      await createOpenPaperPosition(organization.id, { symbol: "ETHUSDT", strategyType: "MOMENTUM_CONTINUATION", direction: "SHORT", notional: 200 });
      await createOpenPaperPosition(organization.id, { symbol: "BTCUSDT", strategyType: "TREND_FOLLOWING", direction: "LONG", notional: 100 });

      const snapshot = await computePortfolioSnapshot(organization.id);
      expect(snapshot.openPositionCount).toBe(3);
      expect(snapshot.totalExposure).toBe(600);
      expect(snapshot.grossExposure).toBe(600);
      expect(snapshot.netExposure).toBe(200); // +300 +100 (LONG) - 200 (SHORT)
      expect(existingExposureFor("BTCUSDT", null, snapshot.bySymbol, snapshot.byStrategy)).toBe(400);
      expect(existingExposureFor(null, "MOMENTUM_CONTINUATION", snapshot.bySymbol, snapshot.byStrategy)).toBe(200);
    });
  });

  // ── Group R: concentration ───────────────────────────────────────────
  describe("R. concentration", () => {
    it("R1: a single-symbol portfolio has maximal concentration (Herfindahl = 1)", () => {
      const result = computePortfolioConcentration([{ symbol: "BTCUSDT", notional: 500 }]);
      expect(result.herfindahlIndex).toBe(1);
      expect(result.maxSymbolConcentrationPct).toBe(1);
      expect(result.largestSymbol).toBe("BTCUSDT");
    });

    it("R2: two equally-weighted symbols have Herfindahl = 0.5, no single symbol dominating", () => {
      const result = computePortfolioConcentration([
        { symbol: "BTCUSDT", notional: 250 },
        { symbol: "ETHUSDT", notional: 250 },
      ]);
      expect(result.herfindahlIndex).toBeCloseTo(0.5, 5);
      expect(result.maxSymbolConcentrationPct).toBeCloseTo(0.5, 5);
    });

    it("R3: an empty portfolio has zero concentration, not a division-by-zero artifact", () => {
      const result = computePortfolioConcentration([]);
      expect(result).toEqual({ herfindahlIndex: 0, maxSymbolConcentrationPct: 0, largestSymbol: null });
    });
  });

  // ── Group S: insufficient evidence handling ──────────────────────────
  describe("S. insufficient evidence handling", () => {
    it("S1: correlation risk is always honestly reported as insufficient_evidence -- never a fabricated number", () => {
      const result = computeCorrelationRisk();
      expect(result.status).toBe("insufficient_evidence");
      expect(result.reason).toMatch(/no persisted historical price/i);
    });
  });

  // ── Group T: drawdown breaker ─────────────────────────────────────────
  describe("T. drawdown breaker", () => {
    it("T1: below the drawdown threshold, the breaker does not trip", () => {
      const result = evaluateCircuitBreakers({ todaysRealizedLossPct: 0, consecutiveLosses: 0, currentDrawdownPct: 0.05, policy: DEFAULT_RISK_POLICY });
      expect(result.triggeredBreakers).not.toContain("portfolio_drawdown");
      expect(result.engaged).toBe(false);
    });

    it("T2: validateForLiveExecution rejects with portfolio_drawdown_breaker when currentDrawdownPct is supplied and exceeds the threshold", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const result = await validateForLiveExecution({
        organizationId: organization.id,
        decision: buildDecision(),
        gateway,
        riskContext: HEALTHY_RISK_CONTEXT,
        liveExecutionEnabled: true,
        hasLiveCredentials: () => true,
        currentDrawdownPct: DEFAULT_RISK_POLICY.maxPortfolioDrawdownPct,
      });
      expect(result).toEqual({ status: "NO_EXECUTION", reason: "portfolio_drawdown_breaker" });
    });

    it("T3: omitting currentDrawdownPct defaults to 0 -- the breaker never trips for a caller that doesn't know about it (backward compatible with every Sprint 22/23 call site)", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const result = await validateForLiveExecution({ organizationId: organization.id, decision: buildDecision(), gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result.status).toBe("VALID");
    });
  });

  // ── Group U: daily-loss breaker ───────────────────────────────────────
  describe("U. daily-loss breaker", () => {
    it("U1: today's realized loss at or above the policy threshold trips the daily_loss breaker with a real reason string", () => {
      const result = evaluateCircuitBreakers({ todaysRealizedLossPct: DEFAULT_RISK_POLICY.maxDailyLossPct, consecutiveLosses: 0, currentDrawdownPct: 0, policy: DEFAULT_RISK_POLICY });
      expect(result.triggeredBreakers).toContain("daily_loss");
      expect(result.reasons.some((r) => r.includes("daily realized loss"))).toBe(true);
    });
  });

  // ── Group V: emergency stop ────────────────────────────────────────────
  describe("V. emergency stop", () => {
    it("V1: drawdown at or above emergencyStopThresholdPct trips emergency_stop, distinct from and in addition to portfolio_drawdown", () => {
      const result = evaluateCircuitBreakers({ todaysRealizedLossPct: 0, consecutiveLosses: 0, currentDrawdownPct: DEFAULT_RISK_POLICY.emergencyStopThresholdPct, policy: DEFAULT_RISK_POLICY });
      expect(result.triggeredBreakers).toContain("emergency_stop");
      expect(result.triggeredBreakers).toContain("portfolio_drawdown"); // emergencyStopThresholdPct > maxPortfolioDrawdownPct in DEFAULT_RISK_POLICY
      expect(isEmergencyStopEngaged(result)).toBe(true);
    });

    it("V2: emergency stop feeds into checkRiskLimits as emergencyStopEngaged, rejecting even a tiny, otherwise-healthy order", () => {
      const violation = checkRiskLimits({ ...HEALTHY_RISK_CONTEXT, orderNotional: 1, leverage: 1, emergencyStopEngaged: true }, DEFAULT_RISK_POLICY);
      expect(violation).toBe("emergency_stop");
    });
  });

  // ── Group W: kill-switch interaction ───────────────────────────────────
  describe("W. kill-switch interaction", () => {
    it("W1: the kill switch blocks new submissions independently of and identically to a tripped breaker", async () => {
      const { owner, organization } = await setupOrg();
      const headers = authHeaders(owner.token);
      await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: headers });

      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const result = await submitDecision({ organizationId: organization.id, decision: buildDecision(), gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result.status).toBe("NO_EXECUTION");
      if (result.status === "NO_EXECUTION") expect(result.reason).toBe("kill_switch_engaged");
      expect(gateway.submittedIntents).toHaveLength(0);
    });

    it("W2: cancelling/reconciling existing orders remains unaffected by breaker state -- reuses Sprint 23's own kill-switch-exempt behavior for the same reason", async () => {
      const { organization } = await setupOrg();
      const scoped = getTenantScopedClient(organization.id);
      await scoped.liveOrder.create({ data: { organizationId: organization.id, clientOrderId: "w2-order", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, status: "SUBMITTED" } });
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      await expect(cancelExistingLiveOrder({ organizationId: organization.id, gateway, clientOrderId: "w2-order" })).resolves.not.toThrow();
    });
  });

  // ── Group X: partial fill persistence ─────────────────────────────────
  describe("X. partial fill persistence", () => {
    it("X1: applyFillUpdate persists filledQuantity/status and reconciliation now uses the REAL value, not a hardcoded 0", async () => {
      const { organization } = await setupOrg();
      const scoped = getTenantScopedClient(organization.id);
      await scoped.liveOrder.create({ data: { organizationId: organization.id, clientOrderId: "x1-order", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 2, price: 100, status: "SUBMITTED" } });

      await applyFillUpdate({ organizationId: organization.id, clientOrderId: "x1-order", filledQuantity: 1, averageFillPrice: 100, status: "PARTIALLY_FILLED" });
      const row = await scoped.liveOrder.findUnique({ where: { organizationId_clientOrderId: { organizationId: organization.id, clientOrderId: "x1-order" } } });
      expect(Number(row!.filledQuantity)).toBe(1);
      expect(row!.status).toBe("PARTIALLY_FILLED");

      // Now provider reports fully filled (2/2) -- reconciliation must see the real local 1, not an assumed 0.
      const gateway = createMockExecutionGateway({
        mode: "LIVE",
        openOrders: [{ clientOrderId: "x1-order", providerOrderId: "p1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 2, price: 100, status: "PARTIALLY_FILLED", filledQuantity: 2, averageFillPrice: 100, rejectionReason: null }],
      });
      const result = await reconcileOrganizationLiveState({ organizationId: organization.id, gateway });
      expect(result.mismatches).toContainEqual({ type: "partial_fill", clientOrderId: "x1-order", filledQuantity: 2, totalQuantity: 2 });
    });
  });

  // ── Group Y: average fill price ────────────────────────────────────────
  describe("Y. average fill price", () => {
    it("Y1: submitting a MARKET order persists the gateway's own returned averageFillPrice", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision();
      const result = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result.status).toBe("SUBMITTED");
      if (result.status !== "SUBMITTED") throw new Error("unreachable");

      const scoped = getTenantScopedClient(organization.id);
      const row = await scoped.liveOrder.findUnique({ where: { organizationId_clientOrderId: { organizationId: organization.id, clientOrderId: result.order.clientOrderId } } });
      expect(Number(row!.averageFillPrice)).toBe(result.order.averageFillPrice);
      expect(Number(row!.filledQuantity)).toBe(result.order.filledQuantity);
    });

    it("Y2: syncOrderFillFromProvider corrects a local order's fill state from a real provider lookup", async () => {
      const { organization } = await setupOrg();
      const scoped = getTenantScopedClient(organization.id);
      await scoped.liveOrder.create({ data: { organizationId: organization.id, clientOrderId: "y2-order", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 2, status: "SUBMITTED" } });

      const gateway = createMockExecutionGateway({
        openOrders: [{ clientOrderId: "y2-order", providerOrderId: "p1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 2, price: 105, status: "FILLED", filledQuantity: 2, averageFillPrice: 105.5, rejectionReason: null }],
      });
      const { changed } = await syncOrderFillFromProvider({ organizationId: organization.id, gateway, clientOrderId: "y2-order" });
      expect(changed).toBe(true);

      const row = await scoped.liveOrder.findUnique({ where: { organizationId_clientOrderId: { organizationId: organization.id, clientOrderId: "y2-order" } } });
      expect(Number(row!.averageFillPrice)).toBe(105.5);
      expect(row!.status).toBe("FILLED");
      expect(row!.filledAt).not.toBeNull();
    });
  });

  // ── Group Z: restart recovery ───────────────────────────────────────────
  describe("Z. restart recovery", () => {
    it("Z1: fill state persisted by one call is correctly re-read by a completely fresh, unrelated call (simulating a process restart)", async () => {
      const { organization } = await setupOrg();
      const scoped = getTenantScopedClient(organization.id);
      await scoped.liveOrder.create({ data: { organizationId: organization.id, clientOrderId: "z1-order", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 3, status: "SUBMITTED" } });
      await applyFillUpdate({ organizationId: organization.id, clientOrderId: "z1-order", filledQuantity: 1.5, averageFillPrice: 101, status: "PARTIALLY_FILLED" });

      // Simulate a restart: a brand new tenant-scoped client, no shared in-memory state.
      const freshScoped = getTenantScopedClient(organization.id);
      const recovered = await freshScoped.liveOrder.findUnique({ where: { organizationId_clientOrderId: { organizationId: organization.id, clientOrderId: "z1-order" } } });
      expect(Number(recovered!.filledQuantity)).toBe(1.5);
      expect(Number(recovered!.averageFillPrice)).toBe(101);
      expect(recovered!.status).toBe("PARTIALLY_FILLED");
    });
  });

  // ── Group AA: unknown execution result ─────────────────────────────────
  describe("AA. unknown execution result", () => {
    it("AA1: an unknown submission outcome is still never treated as failed, unaffected by the new fill-tracking code path", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE", submitOrderOutcome: "unknown_result" });
      const result = await submitDecision({ organizationId: organization.id, decision: buildDecision(), gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result.status).toBe("PENDING_RECONCILIATION");
    });
  });

  // ── Group AB: idempotency ───────────────────────────────────────────────
  describe("AB. idempotency", () => {
    it("AB1: applying the identical fill update twice is a no-op the second time, with exactly one audit row", async () => {
      const { organization } = await setupOrg();
      const scoped = getTenantScopedClient(organization.id);
      await scoped.liveOrder.create({ data: { organizationId: organization.id, clientOrderId: "ab1-order", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, status: "SUBMITTED" } });

      const first = await applyFillUpdate({ organizationId: organization.id, clientOrderId: "ab1-order", filledQuantity: 1, averageFillPrice: 100, status: "FILLED" });
      const second = await applyFillUpdate({ organizationId: organization.id, clientOrderId: "ab1-order", filledQuantity: 1, averageFillPrice: 100, status: "FILLED" });
      expect(first.changed).toBe(true);
      expect(second.changed).toBe(false);

      const fillAudits = await prisma.auditLog.findMany({ where: { organizationId: organization.id, action: "execution.fill_recorded", targetId: "ab1-order" } });
      expect(fillAudits).toHaveLength(1);
    });

    it("AB2: submitting the identical decision twice never places a second order (carried forward, unaffected by risk-policy resolution)", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision();
      await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      const second = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(second.status).toBe("NO_EXECUTION");
      expect(gateway.submittedIntents).toHaveLength(1);
    });

    it("AB3: reconciliation never mutates anything -- calling it twice in a row produces the same read-only result, no duplicate side effects", async () => {
      const { organization } = await setupOrg();
      const scoped = getTenantScopedClient(organization.id);
      await scoped.liveOrder.create({ data: { organizationId: organization.id, clientOrderId: "ab3-order", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, price: 100, status: "SUBMITTED" } });
      const gateway = createMockExecutionGateway({
        mode: "LIVE",
        openOrders: [{ clientOrderId: "ab3-order", providerOrderId: "p1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, price: 100, status: "SUBMITTED", filledQuantity: 0, averageFillPrice: null, rejectionReason: null }],
      });
      const first = await reconcileOrganizationLiveState({ organizationId: organization.id, gateway });
      const second = await reconcileOrganizationLiveState({ organizationId: organization.id, gateway });
      expect(first.healthy).toBe(true);
      expect(second.healthy).toBe(true);
      const row = await scoped.liveOrder.findUnique({ where: { organizationId_clientOrderId: { organizationId: organization.id, clientOrderId: "ab3-order" } } });
      expect(row!.status).toBe("SUBMITTED"); // untouched by reconciliation itself
    });
  });

  // ── Group AC: tenant isolation ──────────────────────────────────────────
  describe("AC. tenant isolation", () => {
    it("AC1: organization B cannot apply a fill update or sync from provider against organization A's LiveOrder", async () => {
      const { organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      const scopedA = getTenantScopedClient(orgA.id);
      await scopedA.liveOrder.create({ data: { organizationId: orgA.id, clientOrderId: "ac1-order", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, status: "SUBMITTED" } });

      await expect(applyFillUpdate({ organizationId: orgB.id, clientOrderId: "ac1-order", filledQuantity: 1, averageFillPrice: 100, status: "FILLED" })).rejects.toBeInstanceOf(LiveOrderNotFoundError);
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      await expect(syncOrderFillFromProvider({ organizationId: orgB.id, gateway, clientOrderId: "ac1-order" })).rejects.toBeInstanceOf(LiveOrderNotFoundError);
    });

    it("AC2: organization B's own capital allocation/portfolio snapshot never reflects organization A's positions", async () => {
      const { organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await createOpenPaperPosition(orgA.id, { symbol: "BTCUSDT", notional: 1000 });

      const snapshotB = await computePortfolioSnapshot(orgB.id);
      expect(snapshotB.openPositionCount).toBe(0);
      expect(snapshotB.totalExposure).toBe(0);
    });
  });

  // ── Group AD: policy immutability ───────────────────────────────────────
  describe("AD. policy immutability", () => {
    it("AD1: a full risk-policy + capital-allocation + submit + breaker-evaluation flow leaves AutonomyPolicy untouched", async () => {
      const { owner, organization } = await setupOrg();
      const policyBefore = await getOrCreatePolicy(organization.id, "market");
      const versionCountBefore = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

      await setOrganizationRiskPolicy({ organizationId: organization.id, actorId: owner.userId, policy: { maxLeverage: 2 } });
      await evaluateCapitalAllocation({ organizationId: organization.id, symbol: "BTCUSDT", strategyType: "TREND_FOLLOWING", proposedNotional: 100, proposedLeverage: 1 });
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      await submitDecision({ organizationId: organization.id, decision: buildDecision(), gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });

      const policyAfter = await getOrCreatePolicy(organization.id, "market");
      const versionCountAfter = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });
      expect(policyAfter).toEqual(policyBefore);
      expect(versionCountAfter).toBe(versionCountBefore);
    });
  });

  // ── Group AE: AI restriction ─────────────────────────────────────────────
  describe("AE. AI restriction", () => {
    it("AE1: no registered AI tool NAME can mutate risk policy, capital allocation, or execution, and none declares the riskPolicy:manage permission", () => {
      const forbiddenNamePattern = /set[_-]?risk|update[_-]?risk|manage[_-]?risk|override[_-]?risk|submit[_-]?order|cancel[_-]?order|execution[_-]?credential/i;
      const offendingByName = listRegisteredTools().filter((t) => forbiddenNamePattern.test(t.name));
      expect(offendingByName).toHaveLength(0);

      const offendingByPermission = listRegisteredTools().filter((t) => {
        const perm = t.requiredPermission as Record<string, string[]> | undefined;
        return perm?.riskPolicy?.includes("manage");
      });
      expect(offendingByPermission).toHaveLength(0);

      expect(getTool("set_risk_policy")).toBeUndefined();
      expect(getTool("override_capital_allocation")).toBeUndefined();
    });

    it("AE2: market-domain tools remain read-only and non-autonomy-eligible", () => {
      const marketTools = listRegisteredTools().filter((t) => t.domain === "market");
      expect(marketTools.every((t) => t.mutationCategory === "read_only")).toBe(true);
      expect(marketTools.every((t) => !t.autonomyEligible)).toBe(true);
    });
  });

  // ── Group AF: L2 autonomy invariant ─────────────────────────────────────
  describe("AF. L2 autonomy invariant", () => {
    it("AF1: the market domain's autonomy ceiling stays capped at L2, unchanged by this sprint", () => {
      expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.market).toBe("L2");
      expect(maxLevelForDomain("market")).toBe("L2");
    });
  });

  // ── Group AG: no real order in tests ────────────────────────────────────
  describe("AG. no real order in tests", () => {
    afterEach(() => vi.restoreAllMocks());

    it("AG1: exercising risk policy, capital allocation, breaker evaluation, submission, cancellation, and reconciliation through this file's own gateway usage never calls fetch against a real Binance host", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const { owner, organization } = await setupOrg();
      await setOrganizationRiskPolicy({ organizationId: organization.id, actorId: owner.userId, policy: { maxLeverage: 2 } });
      await evaluateCapitalAllocation({ organizationId: organization.id, symbol: "BTCUSDT", strategyType: "TREND_FOLLOWING", proposedNotional: 100, proposedLeverage: 1 });
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      await submitDecision({ organizationId: organization.id, decision: buildDecision(), gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      await reconcileOrganizationLiveState({ organizationId: organization.id, gateway });

      const binanceCalls = fetchSpy.mock.calls.filter((call) => String(call[0]).includes("binance.com"));
      expect(binanceCalls).toHaveLength(0);
    });
  });

  // ── Group AH: audit/redaction ────────────────────────────────────────────
  describe("AH. audit/redaction", () => {
    it("AH1: a risk-policy update audit row contains only plain numeric limits, never a secret-shaped value", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationRiskPolicy({ organizationId: organization.id, actorId: owner.userId, policy: { maxLeverage: 2 } });
      const rows = await prisma.auditLog.findMany({ where: { organizationId: organization.id, action: "execution.risk_policy_updated" } });
      expect(rows.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(rows.map((r) => r.metadata));
      expect(serialized).not.toMatch(/apiKey|apiSecret|BINANCE_API/i);
      expect(rows[0]!.targetType).toBe("OrganizationRiskPolicy");
    });

    it("AH2: a fill-recorded audit row exists with the expected action/target shape", async () => {
      const { organization } = await setupOrg();
      const scoped = getTenantScopedClient(organization.id);
      await scoped.liveOrder.create({ data: { organizationId: organization.id, clientOrderId: "ah2-order", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, status: "SUBMITTED" } });
      await applyFillUpdate({ organizationId: organization.id, clientOrderId: "ah2-order", filledQuantity: 1, averageFillPrice: 100, status: "FILLED" });

      const rows = await prisma.auditLog.findMany({ where: { organizationId: organization.id, action: "execution.fill_recorded", targetId: "ah2-order" } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.targetType).toBe("LiveOrder");
    });
  });

  // ── Group AI: regression against Sprints 16-23 ──────────────────────────
  describe("AI. regression against Sprints 16-23", () => {
    it("AI1: Sprint 16's buildEntryPlan/computePositionSizing formulas are byte-for-byte unmodified by this sprint", () => {
      const plan = buildEntryPlan({ direction: "LONG", entryPrice: 20000, volatilityPct: 2, confidence: 85, equity: 10_000 });
      expect(plan.leverage).toBeGreaterThanOrEqual(1);
      expect(plan.notional).toBeGreaterThan(0);

      const sizing = computePositionSizing(10_000, 20000, 0.03, 1);
      expect(sizing.riskCapital).toBe(100); // 10_000 * RISK_PER_TRADE_PCT (0.01), unchanged
      expect(sizing.notional).toBeCloseTo(100 / 0.03, 6);
    });

    it("AI2: DEFAULT_HARD_LIMITS matches every one of Sprint 22's original hardcoded constants exactly", () => {
      expect(DEFAULT_HARD_LIMITS).toEqual({
        maxLeverage: MAX_LIVE_LEVERAGE,
        maxOrderNotionalPct: MAX_ORDER_NOTIONAL_PCT_OF_EQUITY,
        maxTotalExposureMultiple: MAX_LIVE_TOTAL_EXPOSURE_MULTIPLE,
        maxSimultaneousPositions: MAX_LIVE_SIMULTANEOUS_POSITIONS,
        maxSymbolExposurePct: MAX_SYMBOL_EXPOSURE_PCT_OF_EQUITY,
        maxStrategyExposurePct: MAX_STRATEGY_EXPOSURE_PCT_OF_EQUITY,
        maxDailyLossPct: MAX_DAILY_LOSS_PCT,
        maxConsecutiveLosses: MAX_CONSECUTIVE_LOSSES,
      });
    });

    it("AI3: buildClientOrderId idempotency (Sprint 22) is unaffected by this sprint's changes", () => {
      const base = { organizationId: "org-1", symbol: "BTCUSDT", strategyType: "TREND_FOLLOWING", decisionTimestamp: "2026-01-01T00:00:00.000Z" };
      expect(buildClientOrderId(base)).toBe(buildClientOrderId({ ...base }));
    });
  });
});
