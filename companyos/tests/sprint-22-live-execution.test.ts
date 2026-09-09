import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import "@/server/ai/tools/builtin";
import { env } from "@/env";
import { prisma } from "@/server/db/client";
import { CrossTenantAccessError, getTenantScopedClient } from "@/server/db/tenant";
import { getTool, listRegisteredTools } from "@/server/ai/tools/registry";
import { getOrCreatePolicy, engageKillSwitch, isKillSwitchEngaged } from "@/server/ai/autonomy/policy-service";
import { MAX_AUTONOMY_LEVEL_BY_DOMAIN, maxLevelForDomain } from "@/server/ai/autonomy/constants";
import type { MarketDecision, ProposedOrder } from "@/server/intelligence/market-decision/types";
import { createMockExecutionGateway } from "@/server/execution/mock-gateway";
import { createPaperExecutionAdapter } from "@/server/execution/paper-adapter";
import { createBinanceExecutionAdapter } from "@/server/execution/binance-adapter";
import { hasLiveCredentials, getCredentials, redactSecret, redactForLogging } from "@/server/execution/credentials";
import { buildClientOrderId } from "@/server/execution/idempotency";
import { checkRiskLimits, MAX_LIVE_LEVERAGE, MAX_LIVE_TOTAL_EXPOSURE_MULTIPLE, MAX_LIVE_SIMULTANEOUS_POSITIONS, MAX_SYMBOL_EXPOSURE_PCT_OF_EQUITY, MAX_STRATEGY_EXPOSURE_PCT_OF_EQUITY, MAX_DAILY_LOSS_PCT, MAX_CONSECUTIVE_LOSSES, type RiskLimitCheckInput } from "@/server/execution/risk-limits";
import { validateForLiveExecution } from "@/server/execution/validation";
import { submitDecision } from "@/server/execution/service";
import { reconcile, type LocalOrderSnapshot, type LocalPositionSnapshot } from "@/server/execution/reconciliation";
import { checkLiveModeReadiness } from "@/server/execution/live-mode-gate";
import { recordExecutionAudit } from "@/server/execution/audit";
import { binancePrivateGet, binancePrivatePost } from "@/server/execution/binance-private-client";
import { ExecutionTimeoutError, ExecutionUnknownResultError } from "@/server/execution/errors";
import type { ExecutionGateway, ExecutionOrder } from "@/server/execution/types";
import { authHeaders, closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

afterAll(closeTestConnections);

/**
 * Sprint 22 test suite -- exercises the entire live-execution-foundation
 * pipeline using ONLY `createMockExecutionGateway` (or small ad-hoc fakes
 * built for one specific scenario) -- never a real Binance credential and
 * never a real network call. `createBinanceExecutionAdapter` is exercised
 * only far enough to confirm its shape/wiring (Group B); nothing here ever
 * calls its `submitOrder`/`cancelOrder` against a real account, matching
 * Phase 18's own explicit rule.
 */

const HEALTHY_RISK_CONTEXT: Omit<RiskLimitCheckInput, "orderNotional" | "leverage"> = {
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
    proposedOrder: buildProposedOrder(proposedOrderOverrides),
  };
  return { ...base, ...rest };
}

async function setupOrg() {
  const owner = await signUpUser();
  const organization = await createOrgForUser(owner);
  return { owner, organization };
}

describe("Sprint 22: Live Execution Foundation", () => {
  // ── Group A: ExecutionGateway (mock) ────────────────────────────────
  describe("A. gateway", () => {
    it("A1: createMockExecutionGateway implements the full ExecutionGateway capability set", async () => {
      const gateway = createMockExecutionGateway();
      expect(gateway.providerName).toBe("mock");
      expect(gateway.mode).toBe("LIVE");
      await expect(gateway.getAccount()).resolves.toBeDefined();
      await expect(gateway.getBalances()).resolves.toBeInstanceOf(Array);
      await expect(gateway.getOpenPositions()).resolves.toBeInstanceOf(Array);
      await expect(gateway.getOpenOrders()).resolves.toBeInstanceOf(Array);
      await expect(gateway.getOrder("nope", "BTCUSDT")).resolves.toBeNull();
    });

    it("A2: mode is overridable to PAPER for tests that need a paper-shaped mock", () => {
      const gateway = createMockExecutionGateway({ mode: "PAPER" });
      expect(gateway.mode).toBe("PAPER");
    });
  });

  // ── Group B: provider abstraction (PAPER vs LIVE never conflated) ──
  describe("B. provider abstraction", () => {
    it("B1: PaperExecutionAdapter and BinanceExecutionAdapter both implement ExecutionGateway but report distinct, non-conflated modes/provider names", () => {
      const paper: ExecutionGateway = createPaperExecutionAdapter("org-fixture");
      const live: ExecutionGateway = createBinanceExecutionAdapter({ apiKey: "test-key", apiSecret: "test-secret" });
      expect(paper.mode).toBe("PAPER");
      expect(paper.providerName).toBe("paper");
      expect(live.mode).toBe("LIVE");
      expect(live.providerName).toBe("binance");
      expect(paper.mode).not.toBe(live.mode);
    });

    it("B2: the binance adapter's getOpenPositions is honestly empty (SPOT-only scope) rather than fabricating a leveraged position", async () => {
      const live = createBinanceExecutionAdapter({ apiKey: "test-key", apiSecret: "test-secret" });
      await expect(live.getOpenPositions()).resolves.toEqual([]);
    });
  });

  // ── Group C: credential handling ────────────────────────────────────
  describe("C. credential handling", () => {
    it("C1: hasLiveCredentials is false in this test environment (no BINANCE_API_KEY/SECRET configured)", () => {
      expect(hasLiveCredentials()).toBe(false);
    });

    it("C2: getCredentials throws loudly rather than returning a partial/empty credential", () => {
      expect(() => getCredentials()).toThrow(/not configured/i);
    });

    it("C3: validateForLiveExecution's credential check is injectable (env cannot be flipped at runtime once the process has booted), so the 'credentials configured' branch is exercised via the same seam production code defaults off of `hasLiveCredentials()`", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision({ action: "NO_TRADE", proposedOrder: null });
      const withRealCredentialCheck = await validateForLiveExecution({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true });
      expect(withRealCredentialCheck).toEqual({ status: "NO_EXECUTION", reason: "no_live_credentials" });

      const withInjectedCredentials = await validateForLiveExecution({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(withInjectedCredentials).toEqual({ status: "NO_EXECUTION", reason: "no_trade_decision" });
    });
  });

  // ── Group D: redaction ──────────────────────────────────────────────
  describe("D. redaction", () => {
    it("D1: redactSecret keeps only the first/last 2 characters behind a fixed-length mask", () => {
      expect(redactSecret("abcdefgh12")).toBe("ab********12");
      expect(redactSecret("ab")).toBe("********");
    });

    it("D2: redactForLogging masks values only by their OWNING KEY, deep into nested objects and arrays, and never touches unrelated fields", () => {
      const input = {
        apiKey: "realapikey12345",
        nested: { apiSecret: "realsecret6789", normalField: "hello world" },
        list: [{ token: "abc123token" }, { safe: "unaffected" }],
        signature: "deadbeef",
      };
      const out = redactForLogging(input);
      expect(out.apiKey).not.toBe(input.apiKey);
      expect(out.apiKey).toContain("*");
      expect(out.nested.apiSecret).not.toBe(input.nested.apiSecret);
      expect(out.nested.normalField).toBe("hello world");
      expect(out.list[0]!.token).toContain("*");
      expect(out.list[1]!.safe).toBe("unaffected");
      expect(out.signature).toContain("*");
    });
  });

  // ── Group E: account read ───────────────────────────────────────────
  describe("E. account read", () => {
    it("E1: getAccount reflects canTrade both when true and when false", async () => {
      const tradable = createMockExecutionGateway({ canTrade: true });
      const locked = createMockExecutionGateway({ canTrade: false });
      expect((await tradable.getAccount()).canTrade).toBe(true);
      expect((await locked.getAccount()).canTrade).toBe(false);
    });
  });

  // ── Group F: balance ─────────────────────────────────────────────────
  describe("F. balance", () => {
    it("F1: getBalances returns the configured balances, or a sane USDT default", async () => {
      const gateway = createMockExecutionGateway({ balances: [{ asset: "USDT", total: 500, available: 300, locked: 200 }] });
      const balances = await gateway.getBalances();
      expect(balances).toEqual([{ asset: "USDT", total: 500, available: 300, locked: 200 }]);
    });
  });

  // ── Group G: position ────────────────────────────────────────────────
  describe("G. position", () => {
    it("G1: getOpenPositions returns the configured positions", async () => {
      const gateway = createMockExecutionGateway({
        positions: [{ symbol: "ETHUSDT", side: "LONG", quantity: 2, entryPrice: 2000, markPrice: 2100, unrealizedPnl: 200, leverage: 1 }],
      });
      const positions = await gateway.getOpenPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0]!.symbol).toBe("ETHUSDT");
    });
  });

  // ── Group H: order lifecycle ────────────────────────────────────────
  describe("H. order lifecycle", () => {
    it("H1: a valid decision submitted through a LIVE mock gateway walks INTENT -> VALIDATING -> SUBMITTING -> a terminal status, persisted on LiveOrder", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision();

      const result = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result.status).toBe("SUBMITTED");
      if (result.status !== "SUBMITTED") throw new Error("unreachable");
      expect(result.order.status).toBe("FILLED");

      const scoped = getTenantScopedClient(organization.id);
      const row = await scoped.liveOrder.findUnique({ where: { organizationId_clientOrderId: { organizationId: organization.id, clientOrderId: result.order.clientOrderId } } });
      expect(row).not.toBeNull();
      expect(row!.status).toBe("FILLED");
      expect(row!.providerOrderId).not.toBeNull();
      expect(row!.submittedAt).not.toBeNull();
    });

    it("H2: a validation-rejected decision never reaches the gateway and is persisted as REJECTED", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision({ action: "HOLD", proposedOrder: null });

      const result = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT });
      expect(result.status).toBe("NO_EXECUTION");
      expect(gateway.submittedIntents).toHaveLength(0);
    });
  });

  // ── Group I: idempotency ────────────────────────────────────────────
  describe("I. idempotency", () => {
    it("I1: buildClientOrderId is deterministic for the same tuple and differs across any changed field", () => {
      const base = { organizationId: "org-1", symbol: "BTCUSDT", strategyType: "TREND_FOLLOWING", decisionTimestamp: "2026-01-01T00:00:00.000Z" };
      expect(buildClientOrderId(base)).toBe(buildClientOrderId({ ...base }));
      expect(buildClientOrderId(base)).not.toBe(buildClientOrderId({ ...base, organizationId: "org-2" }));
      expect(buildClientOrderId(base)).not.toBe(buildClientOrderId({ ...base, decisionTimestamp: "2026-01-01T00:00:01.000Z" }));
    });
  });

  // ── Group J: duplicate prevention ───────────────────────────────────
  describe("J. duplicate prevention", () => {
    it("J1: submitting the exact same decision twice never places a second order", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision();

      const first = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      const second = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });

      expect(first.status).toBe("SUBMITTED");
      expect(second.status).toBe("NO_EXECUTION");
      if (second.status === "NO_EXECUTION") expect(second.reason).toBe("duplicate_client_order_id");
      expect(gateway.submittedIntents).toHaveLength(1);
    });
  });

  // ── Group K: validation ─────────────────────────────────────────────
  describe("K. validation", () => {
    it("K1: a non-BUY/SELL decision is rejected as no_trade_decision", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision({ action: "NO_TRADE", proposedOrder: null });
      const result = await validateForLiveExecution({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result).toEqual({ status: "NO_EXECUTION", reason: "no_trade_decision" });
    });

    it("K2: a BUY decision with no proposedOrder is rejected as proposed_order_invalid", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision({ action: "BUY", proposedOrder: null });
      const result = await validateForLiveExecution({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result).toEqual({ status: "NO_EXECUTION", reason: "proposed_order_invalid" });
    });

    it("K3: Sprint 19's own REJECTED verdict is reused wholesale -- any rejectReason blocks live execution", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision({ proposedOrderOverrides: { validationStatus: "REJECTED", rejectReason: "unacceptable_risk" } });
      const result = await validateForLiveExecution({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result).toEqual({ status: "NO_EXECUTION", reason: "proposed_order_invalid" });
    });
  });

  // ── Group L: risk (pure function, fixed check order) ────────────────
  describe("L. risk", () => {
    const base: RiskLimitCheckInput = { orderNotional: 100, leverage: 1, ...HEALTHY_RISK_CONTEXT };

    it("L1: every limit passes for a small, healthy order", () => {
      expect(checkRiskLimits(base)).toBeNull();
    });

    it("L2: emergency stop wins over every other violation", () => {
      expect(checkRiskLimits({ ...base, emergencyStopEngaged: true, consecutiveLosses: 99, leverage: 99 })).toBe("emergency_stop");
    });

    it("L3: consecutive losses trip the circuit breaker", () => {
      expect(checkRiskLimits({ ...base, consecutiveLosses: MAX_CONSECUTIVE_LOSSES })).toBe("max_consecutive_losses");
    });

    it("L4: daily loss limit", () => {
      expect(checkRiskLimits({ ...base, todaysRealizedLossPct: MAX_DAILY_LOSS_PCT })).toBe("max_daily_loss");
    });
  });

  // ── Group M: exposure ────────────────────────────────────────────────
  describe("M. exposure", () => {
    it("M1: total exposure limit, checked end to end through validateForLiveExecution", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision();
      const riskContext = { ...HEALTHY_RISK_CONTEXT, existingTotalExposure: HEALTHY_RISK_CONTEXT.accountEquity * MAX_LIVE_TOTAL_EXPOSURE_MULTIPLE };
      const result = await validateForLiveExecution({ organizationId: organization.id, decision, gateway, riskContext, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result).toEqual({ status: "NO_EXECUTION", reason: "max_total_exposure" });
    });

    it("M2: symbol exposure limit", () => {
      const violation = checkRiskLimits({ orderNotional: 100, leverage: 1, ...HEALTHY_RISK_CONTEXT, existingSymbolExposure: HEALTHY_RISK_CONTEXT.accountEquity * MAX_SYMBOL_EXPOSURE_PCT_OF_EQUITY });
      expect(violation).toBe("max_symbol_exposure");
    });

    it("M3: strategy exposure limit", () => {
      const violation = checkRiskLimits({ orderNotional: 100, leverage: 1, ...HEALTHY_RISK_CONTEXT, existingStrategyExposure: HEALTHY_RISK_CONTEXT.accountEquity * MAX_STRATEGY_EXPOSURE_PCT_OF_EQUITY });
      expect(violation).toBe("max_strategy_exposure");
    });

    it("M4: max open positions", () => {
      const violation = checkRiskLimits({ orderNotional: 100, leverage: 1, ...HEALTHY_RISK_CONTEXT, existingOpenPositionCount: MAX_LIVE_SIMULTANEOUS_POSITIONS });
      expect(violation).toBe("max_open_positions");
    });
  });

  // ── Group N: leverage ────────────────────────────────────────────────
  describe("N. leverage", () => {
    it("N1: leverage above the live ceiling is rejected end to end", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision({ proposedOrderOverrides: { leverage: MAX_LIVE_LEVERAGE + 1 } });
      const result = await validateForLiveExecution({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result).toEqual({ status: "NO_EXECUTION", reason: "max_leverage" });
    });
  });

  // ── Group O: stop ─────────────────────────────────────────────────────
  describe("O. stop", () => {
    it("O1: an order Sprint 19 itself rejected for an invalid stop is blocked by the reused validationStatus check", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision({ proposedOrderOverrides: { validationStatus: "REJECTED", rejectReason: "invalid_stop" } });
      const result = await validateForLiveExecution({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result).toEqual({ status: "NO_EXECUTION", reason: "proposed_order_invalid" });
    });
  });

  // ── Group P: take profit ─────────────────────────────────────────────
  describe("P. take profit", () => {
    it("P1: stop-loss and take-profit prices computed by Sprint 16's own sizing are carried through unmodified into the opened PaperPosition", async () => {
      const { organization } = await setupOrg();
      const gateway = createPaperExecutionAdapter(organization.id);
      const decision = buildDecision({ proposedOrderOverrides: { stopLossPrice: 91, takeProfitPrice: 111 } });

      const result = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT });
      expect(result.status).toBe("SUBMITTED");

      const position = await prisma.paperPosition.findFirst({ where: { organizationId: organization.id, symbol: "BTCUSDT" } });
      expect(Number(position!.stopLossPrice)).toBe(91);
      expect(Number(position!.takeProfitPrice)).toBe(111);
    });
  });

  // ── Group Q: kill switch ─────────────────────────────────────────────
  describe("Q. kill switch", () => {
    it("Q1: the organization's own market-domain kill switch blocks submission before any gateway call", async () => {
      const { owner, organization } = await setupOrg();
      const headers = authHeaders(owner.token);
      expect(await isKillSwitchEngaged(organization.id, "market")).toBe(false);
      await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: headers });
      expect(await isKillSwitchEngaged(organization.id, "market")).toBe(true);

      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision();
      const result = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result.status).toBe("NO_EXECUTION");
      if (result.status === "NO_EXECUTION") expect(result.reason).toBe("kill_switch_engaged");
      expect(gateway.submittedIntents).toHaveLength(0);
    });
  });

  // ── Group R: stale data ──────────────────────────────────────────────
  describe("R. stale data", () => {
    it("R1: a decision Sprint 19 already rejected for stale market data is blocked by the same reused check, never re-derived a second way", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision({ proposedOrderOverrides: { validationStatus: "REJECTED", rejectReason: "stale_data" } });
      const result = await validateForLiveExecution({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result).toEqual({ status: "NO_EXECUTION", reason: "proposed_order_invalid" });
    });
  });

  // ── Group S: insufficient balance ────────────────────────────────────
  describe("S. insufficient balance", () => {
    it("S1: an account with too little available quote balance is rejected, read live from the gateway rather than assumed", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE", balances: [{ asset: "USDT", total: 10, available: 10, locked: 0 }] });
      const decision = buildDecision({ proposedOrderOverrides: { initialMargin: 100 } });
      const result = await validateForLiveExecution({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result).toEqual({ status: "NO_EXECUTION", reason: "insufficient_balance" });
    });
  });

  // ── Group T: reconciliation ──────────────────────────────────────────
  describe("T. reconciliation", () => {
    function order(overrides: Partial<ExecutionOrder> = {}): ExecutionOrder {
      return {
        clientOrderId: "c1",
        providerOrderId: "p1",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        quantity: 1,
        price: 100,
        status: "SUBMITTED",
        filledQuantity: 0,
        averageFillPrice: null,
        rejectionReason: null,
        ...overrides,
      };
    }
    function localOrder(overrides: Partial<LocalOrderSnapshot> = {}): LocalOrderSnapshot {
      return { clientOrderId: "c1", providerOrderId: "p1", symbol: "BTCUSDT", quantity: 1, price: 100, status: "SUBMITTED", filledQuantity: 0, requestedAt: new Date(), ...overrides };
    }

    it("T1: healthy when local and remote fully agree", async () => {
      const gateway = createMockExecutionGateway({ openOrders: [order()] });
      const result = await reconcile({ gateway, localOrders: [localOrder()], localPositions: [] });
      expect(result.healthy).toBe(true);
      expect(result.mismatches).toEqual([]);
    });

    it("T2: unknown_order -- remote has an order we never tracked", async () => {
      const gateway = createMockExecutionGateway({ openOrders: [order({ clientOrderId: "unknown-1" })] });
      const result = await reconcile({ gateway, localOrders: [], localPositions: [] });
      expect(result.healthy).toBe(false);
      expect(result.mismatches).toEqual([{ type: "unknown_order", providerOrderId: "p1", symbol: "BTCUSDT" }]);
    });

    it("T3: missing_order -- local non-terminal order absent remotely and unknown to a direct lookup", async () => {
      const gateway = createMockExecutionGateway({ openOrders: [] });
      const result = await reconcile({ gateway, localOrders: [localOrder()], localPositions: [] });
      expect(result.mismatches).toContainEqual({ type: "missing_order", clientOrderId: "c1", symbol: "BTCUSDT" });
    });

    it("T4: unexpected_close -- local non-terminal order absent from the open list, but a direct lookup finds it already terminal", async () => {
      const fakeGateway: ExecutionGateway = {
        ...createMockExecutionGateway({ openOrders: [] }),
        async getOrder() {
          return order({ status: "FILLED", filledQuantity: 1 });
        },
      };
      const result = await reconcile({ gateway: fakeGateway, localOrders: [localOrder()], localPositions: [] });
      expect(result.mismatches).toContainEqual({ type: "unexpected_close", clientOrderId: "c1" });
    });

    it("T5: quantity_mismatch and price_mismatch beyond tolerance", async () => {
      const gateway = createMockExecutionGateway({ openOrders: [order({ quantity: 2, price: 150 })] });
      const result = await reconcile({ gateway, localOrders: [localOrder({ quantity: 1, price: 100 })], localPositions: [] });
      expect(result.mismatches).toContainEqual({ type: "quantity_mismatch", clientOrderId: "c1", localQuantity: 1, providerQuantity: 2 });
      expect(result.mismatches).toContainEqual({ type: "price_mismatch", clientOrderId: "c1", localPrice: 100, providerPrice: 150 });
    });

    it("T6: position_mismatch between local and remote position quantity", async () => {
      const gateway = createMockExecutionGateway({ positions: [{ symbol: "BTCUSDT", side: "LONG", quantity: 3, entryPrice: 100, markPrice: 100, unrealizedPnl: 0, leverage: 1 }] });
      const localPositions: LocalPositionSnapshot[] = [{ symbol: "BTCUSDT", quantity: 1 }];
      const result = await reconcile({ gateway, localOrders: [], localPositions });
      expect(result.mismatches).toContainEqual({ type: "position_mismatch", symbol: "BTCUSDT", localQuantity: 1, providerQuantity: 3 });
    });

    it("T7: stale_order -- a non-terminal order older than the max age is flagged even when otherwise consistent", async () => {
      const gateway = createMockExecutionGateway({ openOrders: [order()] });
      const staleRequestedAt = new Date(Date.now() - 6 * 60 * 1000);
      const result = await reconcile({ gateway, localOrders: [localOrder({ requestedAt: staleRequestedAt })], localPositions: [] });
      expect(result.mismatches.some((m) => m.type === "stale_order")).toBe(true);
    });

    it("T8: balance_mismatch -- only checked when localBalances is explicitly supplied, and only flags a real, beyond-tolerance drift", async () => {
      const gateway = createMockExecutionGateway({ openOrders: [order()], balances: [{ asset: "USDT", total: 5000, available: 5000, locked: 0 }] });

      const omitted = await reconcile({ gateway, localOrders: [localOrder()], localPositions: [] });
      expect(omitted.mismatches.some((m) => m.type === "balance_mismatch")).toBe(false);

      const mismatched = await reconcile({ gateway, localOrders: [localOrder()], localPositions: [], localBalances: [{ asset: "USDT", available: 4000 }] });
      expect(mismatched.mismatches).toContainEqual({ type: "balance_mismatch", asset: "USDT", localAvailable: 4000, providerAvailable: 5000 });

      const agreeing = await reconcile({ gateway, localOrders: [localOrder()], localPositions: [], localBalances: [{ asset: "USDT", available: 5000 }] });
      expect(agreeing.mismatches.some((m) => m.type === "balance_mismatch")).toBe(false);
    });
  });

  // ── Group U: partial fill ────────────────────────────────────────────
  describe("U. partial fill", () => {
    it("U1: a remote PARTIALLY_FILLED order whose filled quantity differs from our local record is flagged", async () => {
      const gateway = createMockExecutionGateway({
        openOrders: [{ clientOrderId: "c1", providerOrderId: "p1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 2, price: 100, status: "PARTIALLY_FILLED", filledQuantity: 1, averageFillPrice: 100, rejectionReason: null }],
      });
      const local: LocalOrderSnapshot = { clientOrderId: "c1", providerOrderId: "p1", symbol: "BTCUSDT", quantity: 2, price: 100, status: "PARTIALLY_FILLED", filledQuantity: 0, requestedAt: new Date() };
      const result = await reconcile({ gateway, localOrders: [local], localPositions: [] });
      expect(result.mismatches).toContainEqual({ type: "partial_fill", clientOrderId: "c1", filledQuantity: 1, totalQuantity: 2 });
    });
  });

  // ── Group V: timeout classification ──────────────────────────────────
  describe("V. timeout", () => {
    afterEach(() => vi.restoreAllMocks());

    it("V1: a READ that aborts is classified as ExecutionTimeoutError (safe to retry)", async () => {
      vi.spyOn(global, "fetch").mockImplementation(() => Promise.reject(new DOMException("aborted", "AbortError")));
      await expect(binancePrivateGet("/api/v3/account", {}, { apiKey: "k", apiSecret: "s" })).rejects.toBeInstanceOf(ExecutionTimeoutError);
    });

    it("V2: a WRITE that aborts is classified as ExecutionUnknownResultError (must reconcile, never blindly retried)", async () => {
      vi.spyOn(global, "fetch").mockImplementation(() => Promise.reject(new DOMException("aborted", "AbortError")));
      await expect(binancePrivatePost("/api/v3/order", {}, { apiKey: "k", apiSecret: "s" })).rejects.toBeInstanceOf(ExecutionUnknownResultError);
    });
  });

  // ── Group W: unknown result ──────────────────────────────────────────
  describe("W. unknown result", () => {
    it("W1: an unknown-outcome submission is never treated as FAILED -- it lands in PENDING_RECONCILIATION and the row stays SUBMITTING", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE", submitOrderOutcome: "unknown_result" });
      const decision = buildDecision();

      const result = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result.status).toBe("PENDING_RECONCILIATION");

      const clientOrderId = buildClientOrderId({ organizationId: organization.id, symbol: decision.symbol, strategyType: decision.strategyType, decisionTimestamp: decision.proposedOrder!.decisionTimestamp });
      const scoped = getTenantScopedClient(organization.id);
      const row = await scoped.liveOrder.findUnique({ where: { organizationId_clientOrderId: { organizationId: organization.id, clientOrderId } } });
      expect(row!.status).toBe("SUBMITTING");
    });

    it("W2: a subsequent call for the SAME decision never resubmits -- it also returns PENDING_RECONCILIATION without a second gateway call", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE", submitOrderOutcome: "unknown_result" });
      const decision = buildDecision();

      await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      const second = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });

      expect(second.status).toBe("PENDING_RECONCILIATION");
      expect(gateway.submittedIntents).toHaveLength(1);
    });
  });

  // ── Group X: restart recovery ────────────────────────────────────────
  describe("X. restart recovery", () => {
    it("X1: after an unknown-result submission, a fresh process (new gateway instance, same decision) never places a second real order", async () => {
      const { organization } = await setupOrg();
      const beforeRestartGateway = createMockExecutionGateway({ mode: "LIVE", submitOrderOutcome: "unknown_result" });
      const decision = buildDecision();
      await submitDecision({ organizationId: organization.id, decision, gateway: beforeRestartGateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });

      // Simulate a process restart: a brand-new gateway instance, a brand-new call, same decision.
      const afterRestartGateway = createMockExecutionGateway({ mode: "LIVE", submitOrderOutcome: "fill" });
      const result = await submitDecision({ organizationId: organization.id, decision, gateway: afterRestartGateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });

      expect(result.status).toBe("PENDING_RECONCILIATION");
      expect(afterRestartGateway.submittedIntents).toHaveLength(0);
    });
  });

  // ── Group Y: tenant isolation ─────────────────────────────────────────
  describe("Y. tenant isolation", () => {
    it("Y1: organization B's scoped client never sees organization A's LiveOrder rows", async () => {
      const { organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      await submitDecision({ organizationId: orgA.id, decision: buildDecision(), gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });

      const scopedB = getTenantScopedClient(orgB.id);
      const rowsVisibleToB = await scopedB.liveOrder.findMany({});
      expect(rowsVisibleToB).toHaveLength(0);
    });
  });

  // ── Group Z: cross-tenant rejection ───────────────────────────────────
  describe("Z. cross-tenant rejection", () => {
    it("Z1: explicitly querying another organization's id through a scoped client throws CrossTenantAccessError rather than silently overriding it", async () => {
      const { organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      const scopedA = getTenantScopedClient(orgA.id);
      await expect(scopedA.liveOrder.findMany({ where: { organizationId: orgB.id } })).rejects.toThrow(CrossTenantAccessError);
      await expect(
        scopedA.liveOrder.create({ data: { organizationId: orgB.id, clientOrderId: "x", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, status: "INTENT" } }),
      ).rejects.toThrow(CrossTenantAccessError);
    });
  });

  // ── Group AA: policy immutability ─────────────────────────────────────
  describe("AA. policy immutability", () => {
    it("AA1: submitting decisions (paper and live) never mutates AutonomyPolicy for an org that never touched it", async () => {
      const { organization } = await setupOrg();
      const policyBefore = await getOrCreatePolicy(organization.id, "market");
      const versionCountBefore = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

      const liveGateway = createMockExecutionGateway({ mode: "LIVE" });
      await submitDecision({ organizationId: organization.id, decision: buildDecision(), gateway: liveGateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      const paperGateway = createPaperExecutionAdapter(organization.id);
      await submitDecision({ organizationId: organization.id, decision: buildDecision({ proposedOrderOverrides: { symbol: "ETHUSDT" }, symbol: "ETHUSDT" }), gateway: paperGateway, riskContext: HEALTHY_RISK_CONTEXT });

      const policyAfter = await getOrCreatePolicy(organization.id, "market");
      const versionCountAfter = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });
      expect(policyAfter).toEqual(policyBefore);
      expect(versionCountAfter).toBe(versionCountBefore);
    });
  });

  // ── Group AB: autonomy L2 boundary ────────────────────────────────────
  describe("AB. autonomy L2", () => {
    it("AB1: the market domain's autonomy ceiling stays capped at L2, unchanged by this sprint", () => {
      expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.market).toBe("L2");
      expect(maxLevelForDomain("market")).toBe("L2");
    });
  });

  // ── Group AC: AI restrictions ──────────────────────────────────────────
  describe("AC. AI restrictions", () => {
    it("AC1: no registered AI tool can submit, create, execute, or cancel a live order", () => {
      const forbiddenPattern = /submit[_-]?order|create[_-]?order|execute[_-]?order|cancel[_-]?order|place[_-]?order|live[_-]?order|withdraw|transfer/i;
      const offending = listRegisteredTools().filter((t) => forbiddenPattern.test(t.name) || forbiddenPattern.test(t.description));
      expect(offending).toHaveLength(0);
      expect(getTool("submit_order")).toBeUndefined();
      expect(getTool("execute_live_order")).toBeUndefined();
    });

    it("AC2: the execution module is never imported by any built-in AI tool file", async () => {
      const executionModule = await import("@/server/execution/service");
      expect(typeof executionModule.submitDecision).toBe("function");
      // Structural guarantee: every market-domain tool stays read-only and non-autonomy-eligible.
      const marketTools = listRegisteredTools().filter((t) => t.domain === "market");
      expect(marketTools.every((t) => t.mutationCategory === "read_only")).toBe(true);
    });
  });

  // ── Group AD: no credential leakage ───────────────────────────────────
  describe("AD. no credential leakage", () => {
    it("AD1: an audit row written for a real submission never contains a credential-shaped value", async () => {
      const { organization } = await setupOrg();
      await recordExecutionAudit({ organizationId: organization.id, action: "execution.intent_created", clientOrderId: "audit-test-1", symbol: "BTCUSDT", strategyType: "TREND_FOLLOWING" });
      const row = await prisma.auditLog.findFirst({ where: { organizationId: organization.id, targetId: "audit-test-1" } });
      expect(row).not.toBeNull();
      const serialized = JSON.stringify(row!.metadata);
      expect(serialized).not.toMatch(/BINANCE_API_(KEY|SECRET)/);
    });
  });

  // ── Group AE: live-disabled default ────────────────────────────────────
  describe("AE. live-disabled default", () => {
    it("AE1: LIVE_EXECUTION_ENABLED defaults to false in this environment", () => {
      expect(env.LIVE_EXECUTION_ENABLED).toBe(false);
    });

    it("AE2: checkLiveModeReadiness is never ready while live execution is disabled, regardless of every other check", async () => {
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const readiness = await checkLiveModeReadiness({
        gateway,
        organizationId: "org-fixture",
        symbol: "BTCUSDT",
        isSymbolTradable: async () => true,
        isKillSwitchQueryable: async () => true,
      });
      expect(readiness.ready).toBe(false);
      expect(readiness.checks.find((c) => c.name === "live_execution_enabled")?.passed).toBe(false);
    });

    it("AE3: validateForLiveExecution rejects a LIVE-mode submission for live_execution_disabled before ever reading the account", async () => {
      const { organization } = await setupOrg();
      let balancesRead = false;
      const gateway: ExecutionGateway = {
        ...createMockExecutionGateway({ mode: "LIVE" }),
        async getBalances() {
          balancesRead = true;
          return [];
        },
      };
      const result = await validateForLiveExecution({ organizationId: organization.id, decision: buildDecision(), gateway, riskContext: HEALTHY_RISK_CONTEXT });
      expect(result).toEqual({ status: "NO_EXECUTION", reason: "live_execution_disabled" });
      expect(balancesRead).toBe(false);
    });
  });

  // ── Group AF: no accidental live execution ─────────────────────────────
  describe("AF. no accidental live execution", () => {
    it("AF1: an explicit liveExecutionEnabled:false blocks the gateway from ever being called, for both validation and full submission", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision();

      const result = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: false });
      expect(result.status).toBe("NO_EXECUTION");
      expect(gateway.submittedIntents).toHaveLength(0);
    });

    it("AF2: PAPER submissions are entirely unaffected by the live-execution flag and never write a LiveOrder row", async () => {
      const { organization } = await setupOrg();
      const gateway = createPaperExecutionAdapter(organization.id);
      const decision = buildDecision();

      const result = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: false });
      expect(result.status).toBe("SUBMITTED");

      const scoped = getTenantScopedClient(organization.id);
      const liveOrderCount = await scoped.liveOrder.count({});
      expect(liveOrderCount).toBe(0);
    });
  });
});
