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
import { submitDecision } from "@/server/execution/service";
import { checkLiveModeReadiness } from "@/server/execution/live-mode-gate";
import { computeRiskLimitsConfigured, areRiskLimitsConfigured } from "@/server/execution/risk-limits";
import {
  setOrganizationCredentials,
  revokeOrganizationCredentials,
  getOrganizationCredentials,
  getOrganizationCredentialStatus,
  resolveExecutionCredentials,
  hasLiveCredentialsFor,
} from "@/server/execution/org-credentials";
import { encryptSecret, decryptSecret, fingerprint } from "@/server/execution/credential-crypto";
import { cancelExistingLiveOrder, reconcileOrganizationLiveState, LiveOrderNotFoundError, LiveOrderNotCancellableError } from "@/server/execution/position-management";
import { buildClientOrderId } from "@/server/execution/idempotency";
import type { OrderIntent } from "@/server/execution/types";
import { authHeaders, closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

afterAll(closeTestConnections);

/**
 * Sprint 23 test suite -- hardens Sprint 22's live-execution foundation
 * (organization-scoped credentials, the two missing live-mode-readiness
 * checks, kill-switch-safe existing-position management) using ONLY
 * `createMockExecutionGateway`/small ad-hoc fakes -- never a real Binance
 * credential and never a real network call to Binance. `global.fetch` is
 * spied on and asserted never called with a `binance.com` URL anywhere in
 * this file's own gateway usage (Group V).
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
    proposedOrder: buildProposedOrder(proposedOrderOverrides),
  };
  return { ...base, ...rest };
}

function testIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return { clientOrderId: "readiness-test", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, price: 100, strategyType: "TREND_FOLLOWING", ...overrides };
}

async function setupOrg() {
  const owner = await signUpUser();
  const organization = await createOrgForUser(owner);
  return { owner, organization };
}

describe("Sprint 23: Live Execution Hardening & Organization Credentials", () => {
  // ── Group A: organization credential isolation ─────────────────────
  describe("A. organization credential isolation", () => {
    it("A1: organization A's own resolved credentials are never visible to organization B", async () => {
      const { owner, organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await setOrganizationCredentials({ organizationId: orgA.id, actorId: owner.userId, apiKey: "orgA-key-1234", apiSecret: "orgA-secret-5678" });

      const credsA = await resolveExecutionCredentials(orgA.id);
      const credsB = await resolveExecutionCredentials(orgB.id);
      expect(credsA).toEqual({ apiKey: "orgA-key-1234", apiSecret: "orgA-secret-5678" });
      expect(credsB).toBeNull();
    });
  });

  // ── Group B: credential absence ─────────────────────────────────────
  describe("B. credential absence", () => {
    it("B1: an organization that has configured nothing, with no env fallback, has no resolvable credentials", async () => {
      const { organization } = await setupOrg();
      expect(await hasLiveCredentialsFor(organization.id)).toBe(false);
      expect(await getOrganizationCredentials(organization.id)).toBeNull();
      expect(await resolveExecutionCredentials(organization.id)).toBeNull();
    });
  });

  // ── Group C: credential rotation/revocation ─────────────────────────
  describe("C. credential rotation/revocation", () => {
    it("C1: setting credentials twice is a rotation, not a duplicate row, and updates the stored value", async () => {
      const { owner, organization } = await setupOrg();
      const first = await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "key-v1-aaaa", apiSecret: "secret-v1-aaaa" });
      expect(first.isRotation).toBe(false);

      const second = await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "key-v2-bbbb", apiSecret: "secret-v2-bbbb" });
      expect(second.isRotation).toBe(true);

      const rowCount = await prisma.organizationExecutionCredential.count({ where: { organizationId: organization.id } });
      expect(rowCount).toBe(1);

      const creds = await getOrganizationCredentials(organization.id);
      expect(creds).toEqual({ apiKey: "key-v2-bbbb", apiSecret: "secret-v2-bbbb" });
    });

    it("C2: revoking makes the credential unavailable, and is idempotent", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "key-1234", apiSecret: "secret-5678" });
      await revokeOrganizationCredentials(organization.id, owner.userId);

      expect(await hasLiveCredentialsFor(organization.id)).toBe(false);
      expect(await getOrganizationCredentials(organization.id)).toBeNull();

      await expect(revokeOrganizationCredentials(organization.id, owner.userId)).resolves.not.toThrow();
    });

    it("C3: configuring a fresh credential after revocation re-enables it (revokedAt cleared)", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "key-1234", apiSecret: "secret-5678" });
      await revokeOrganizationCredentials(organization.id, owner.userId);
      expect(await hasLiveCredentialsFor(organization.id)).toBe(false);

      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "key-9999", apiSecret: "secret-9999" });
      expect(await hasLiveCredentialsFor(organization.id)).toBe(true);
      const status = await getOrganizationCredentialStatus(organization.id);
      expect(status.configured).toBe(true);
      expect(status.revokedAt).toBeNull();
    });
  });

  // ── Group D: secret redaction ────────────────────────────────────────
  describe("D. secret redaction", () => {
    it("D1: encrypt/decrypt round-trips correctly, and the encoded ciphertext never contains the plaintext substring", () => {
      const plaintext = "super-secret-binance-api-key-value";
      const encoded = encryptSecret(plaintext);
      expect(encoded).not.toContain(plaintext);
      expect(decryptSecret(encoded)).toBe(plaintext);
    });

    it("D2: fingerprint keeps only the last 4 characters, never enough to reconstruct the key", () => {
      expect(fingerprint("abcd1234wxyz")).toBe("****wxyz");
      expect(fingerprint("ab")).toBe("****");
    });
  });

  // ── Group E: cross-tenant credential access rejection ────────────────
  describe("E. cross-tenant credential access rejection", () => {
    it("E1: organization B's scoped client cannot read or write organization A's credential row", async () => {
      const { owner, organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await setOrganizationCredentials({ organizationId: orgA.id, actorId: owner.userId, apiKey: "key-1234", apiSecret: "secret-5678" });

      const scopedB = getTenantScopedClient(orgB.id);
      await expect(scopedB.organizationExecutionCredential.findFirst({ where: { organizationId: orgA.id } })).rejects.toThrow(CrossTenantAccessError);
      await expect(
        scopedB.organizationExecutionCredential.create({ data: { organizationId: orgA.id, encryptedApiKey: "x", encryptedApiSecret: "y", apiKeyFingerprint: "****xxxx" } }),
      ).rejects.toThrow(CrossTenantAccessError);
    });

    it("E2: organization B's own findMany never returns organization A's credential row (silent filtering, not an error)", async () => {
      const { owner, organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await setOrganizationCredentials({ organizationId: orgA.id, actorId: owner.userId, apiKey: "key-1234", apiSecret: "secret-5678" });

      const scopedB = getTenantScopedClient(orgB.id);
      const rows = await scopedB.organizationExecutionCredential.findMany({});
      expect(rows).toHaveLength(0);
    });
  });

  // ── Group F: readiness with missing credentials ──────────────────────
  describe("F. readiness with missing credentials", () => {
    it("F1: no organization credential and no env fallback -> credentials_configured fails, ready is false", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const readiness = await checkLiveModeReadiness({
        gateway,
        organizationId: organization.id,
        symbol: "BTCUSDT",
        isSymbolTradable: async () => true,
        isKillSwitchQueryable: async () => true,
        liveExecutionEnabled: true,
      });
      expect(readiness.ready).toBe(false);
      expect(readiness.checks.find((c) => c.name === "credentials_configured")?.passed).toBe(false);
    });
  });

  // ── Group G: readiness with invalid credentials ──────────────────────
  describe("G. readiness with invalid credentials", () => {
    it("G1: credentials configured but the account itself reports canTrade:false -> account_readable and gateway_healthy fail", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE", canTrade: false });
      const readiness = await checkLiveModeReadiness({
        gateway,
        organizationId: organization.id,
        symbol: "BTCUSDT",
        isSymbolTradable: async () => true,
        isKillSwitchQueryable: async () => true,
        liveExecutionEnabled: true,
        hasLiveCredentials: () => true,
      });
      expect(readiness.checks.find((c) => c.name === "account_readable")?.passed).toBe(false);
      expect(readiness.checks.find((c) => c.name === "gateway_healthy")?.passed).toBe(false);
      expect(readiness.ready).toBe(false);
    });

    it("G2: the provider itself rejects the test order (invalid params/signature) -> test_order_pathway_validated fails", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE", testOrderResult: { valid: false, reason: "invalid symbol filter" } });
      const readiness = await checkLiveModeReadiness({
        gateway,
        organizationId: organization.id,
        symbol: "BTCUSDT",
        isSymbolTradable: async () => true,
        isKillSwitchQueryable: async () => true,
        liveExecutionEnabled: true,
        hasLiveCredentials: () => true,
        testOrderIntent: testIntent(),
      });
      expect(readiness.checks.find((c) => c.name === "test_order_pathway_validated")).toEqual({ name: "test_order_pathway_validated", passed: false, detail: "invalid symbol filter" });
      expect(readiness.ready).toBe(false);
    });
  });

  // ── Group H: readiness with risk limits missing ──────────────────────
  describe("H. readiness with risk limits missing", () => {
    it("H1: the real, deployed risk-limit constants are always configured", () => {
      expect(areRiskLimitsConfigured()).toBe(true);
    });

    it("H2: computeRiskLimitsConfigured's pure core correctly reports false for a broken constant set (zero, negative, NaN, or missing)", () => {
      expect(computeRiskLimitsConfigured([3, 0.1, 2, 3])).toBe(true);
      expect(computeRiskLimitsConfigured([3, 0, 2, 3])).toBe(false);
      expect(computeRiskLimitsConfigured([3, -0.1, 2, 3])).toBe(false);
      expect(computeRiskLimitsConfigured([3, Number.NaN, 2, 3])).toBe(false);
      expect(computeRiskLimitsConfigured([])).toBe(false);
    });
  });

  // ── Group I: readiness with test-order pathway missing ───────────────
  describe("I. readiness with test-order pathway missing", () => {
    it("I1: omitting testOrderIntent entirely fails the check honestly rather than skipping or assuming it passes", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const readiness = await checkLiveModeReadiness({
        gateway,
        organizationId: organization.id,
        symbol: "BTCUSDT",
        isSymbolTradable: async () => true,
        isKillSwitchQueryable: async () => true,
        liveExecutionEnabled: true,
        hasLiveCredentials: () => true,
      });
      const check = readiness.checks.find((c) => c.name === "test_order_pathway_validated");
      expect(check?.passed).toBe(false);
      expect(check?.detail).toMatch(/no representative testOrderIntent/i);
      expect(readiness.ready).toBe(false);
    });
  });

  // ── Group J: fully ready state ────────────────────────────────────────
  describe("J. fully ready state", () => {
    it("J1: every check passing (all injected) makes readiness true, with LIVE_EXECUTION_ENABLED also injected true", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE", canTrade: true, testOrderResult: { valid: true } });
      const readiness = await checkLiveModeReadiness({
        gateway,
        organizationId: organization.id,
        symbol: "BTCUSDT",
        isSymbolTradable: async () => true,
        isKillSwitchQueryable: async () => true,
        liveExecutionEnabled: true,
        hasLiveCredentials: () => true,
        testOrderIntent: testIntent(),
      });
      expect(readiness.checks.every((c) => c.passed)).toBe(true);
      expect(readiness.ready).toBe(true);
    });
  });

  // ── Group K: LIVE_EXECUTION_ENABLED=false hard gate ───────────────────
  describe("K. LIVE_EXECUTION_ENABLED=false hard gate", () => {
    it("K1: the real environment has LIVE_EXECUTION_ENABLED false", () => {
      expect(env.LIVE_EXECUTION_ENABLED).toBe(false);
    });

    it("K2: even with every other check injected true, an explicit liveExecutionEnabled:false keeps ready false", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE", canTrade: true, testOrderResult: { valid: true } });
      const readiness = await checkLiveModeReadiness({
        gateway,
        organizationId: organization.id,
        symbol: "BTCUSDT",
        isSymbolTradable: async () => true,
        isKillSwitchQueryable: async () => true,
        liveExecutionEnabled: false,
        hasLiveCredentials: () => true,
        testOrderIntent: testIntent(),
      });
      expect(readiness.ready).toBe(false);
      expect(readiness.checks.find((c) => c.name === "live_execution_enabled")?.passed).toBe(false);
    });

    it("K3: omitting liveExecutionEnabled entirely uses the real env default (false)", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const readiness = await checkLiveModeReadiness({
        gateway,
        organizationId: organization.id,
        symbol: "BTCUSDT",
        isSymbolTradable: async () => true,
        isKillSwitchQueryable: async () => true,
      });
      expect(readiness.ready).toBe(false);
    });
  });

  // ── Group L: kill switch blocks new orders ────────────────────────────
  describe("L. kill switch blocks new orders", () => {
    it("L1: engaging the org kill switch blocks a new LIVE submission before the gateway is ever called", async () => {
      const { owner, organization } = await setupOrg();
      const headers = authHeaders(owner.token);
      await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: headers });

      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const result = await submitDecision({ organizationId: organization.id, decision: buildDecision(), gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(result.status).toBe("NO_EXECUTION");
      if (result.status === "NO_EXECUTION") expect(result.reason).toBe("kill_switch_engaged");
      expect(gateway.submittedIntents).toHaveLength(0);
    });
  });

  // ── Group M: kill switch with existing position ───────────────────────
  describe("M. kill switch with existing position", () => {
    it("M1: cancelling an already-open LiveOrder succeeds even while the kill switch is engaged", async () => {
      const { owner, organization } = await setupOrg();
      const headers = authHeaders(owner.token);
      const scoped = getTenantScopedClient(organization.id);
      await scoped.liveOrder.create({ data: { organizationId: organization.id, clientOrderId: "existing-1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, status: "SUBMITTED" } });

      await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: headers });
      expect(await isKillSwitchEngaged(organization.id, "market")).toBe(true);

      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      await cancelExistingLiveOrder({ organizationId: organization.id, gateway, clientOrderId: "existing-1" });

      const row = await scoped.liveOrder.findUnique({ where: { organizationId_clientOrderId: { organizationId: organization.id, clientOrderId: "existing-1" } } });
      expect(row!.status).toBe("CANCELLED");
      expect(gateway.cancelledClientOrderIds).toEqual(["existing-1"]);
    });

    it("M2: cancelling a non-existent order throws LiveOrderNotFoundError; cancelling an already-terminal order throws LiveOrderNotCancellableError", async () => {
      const { organization } = await setupOrg();
      const scoped = getTenantScopedClient(organization.id);
      await scoped.liveOrder.create({ data: { organizationId: organization.id, clientOrderId: "terminal-1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, status: "FILLED" } });

      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      await expect(cancelExistingLiveOrder({ organizationId: organization.id, gateway, clientOrderId: "nope" })).rejects.toBeInstanceOf(LiveOrderNotFoundError);
      await expect(cancelExistingLiveOrder({ organizationId: organization.id, gateway, clientOrderId: "terminal-1" })).rejects.toBeInstanceOf(LiveOrderNotCancellableError);
    });
  });

  // ── Group N: existing position reconciliation under kill switch ──────
  describe("N. existing position reconciliation under kill switch", () => {
    it("N1: reconciliation of existing live state proceeds normally while the kill switch is engaged", async () => {
      const { owner, organization } = await setupOrg();
      const headers = authHeaders(owner.token);
      const scoped = getTenantScopedClient(organization.id);
      await scoped.liveOrder.create({ data: { organizationId: organization.id, clientOrderId: "order-1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, price: 100, status: "SUBMITTED" } });

      await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: headers });

      const gateway = createMockExecutionGateway({
        mode: "LIVE",
        openOrders: [{ clientOrderId: "order-1", providerOrderId: "p1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, price: 100, status: "SUBMITTED", filledQuantity: 0, averageFillPrice: null, rejectionReason: null }],
      });
      const result = await reconcileOrganizationLiveState({ organizationId: organization.id, gateway });
      expect(result.healthy).toBe(true);
    });
  });

  // ── Group O: no new exposure under kill switch ────────────────────────
  describe("O. no new exposure under kill switch", () => {
    it("O1: with every OTHER gate wide open, the kill switch alone still blocks a brand-new submission", async () => {
      const { owner, organization } = await setupOrg();
      const headers = authHeaders(owner.token);
      await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: headers });

      const gateway = createMockExecutionGateway({ mode: "LIVE", canTrade: true, balances: [{ asset: "USDT", total: 100_000, available: 100_000, locked: 0 }] });
      const result = await submitDecision({
        organizationId: organization.id,
        decision: buildDecision(),
        gateway,
        riskContext: HEALTHY_RISK_CONTEXT,
        liveExecutionEnabled: true,
        hasLiveCredentials: () => true,
      });
      expect(result.status).toBe("NO_EXECUTION");
      expect(gateway.submittedIntents).toHaveLength(0);
    });
  });

  // ── Group P: idempotent execution ─────────────────────────────────────
  describe("P. idempotent execution", () => {
    it("P1: buildClientOrderId stays deterministic (carried forward from Sprint 22, unmodified)", () => {
      const base = { organizationId: "org-1", symbol: "BTCUSDT", strategyType: "TREND_FOLLOWING", decisionTimestamp: "2026-01-01T00:00:00.000Z" };
      expect(buildClientOrderId(base)).toBe(buildClientOrderId({ ...base }));
    });

    it("P2: submitting the identical decision twice never places a second order", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision();
      const first = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      const second = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(first.status).toBe("SUBMITTED");
      expect(second.status).toBe("NO_EXECUTION");
      expect(gateway.submittedIntents).toHaveLength(1);
    });
  });

  // ── Group Q: unknown-result safety ────────────────────────────────────
  describe("Q. unknown-result safety", () => {
    it("Q1: an unknown submission outcome is never treated as failed, and is never resubmitted", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE", submitOrderOutcome: "unknown_result" });
      const decision = buildDecision();
      const first = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      const second = await submitDecision({ organizationId: organization.id, decision, gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      expect(first.status).toBe("PENDING_RECONCILIATION");
      expect(second.status).toBe("PENDING_RECONCILIATION");
      expect(gateway.submittedIntents).toHaveLength(1);
    });
  });

  // ── Group R: tenant isolation ──────────────────────────────────────────
  describe("R. tenant isolation", () => {
    it("R1: organization B never sees organization A's LiveOrder rows created via cancelExistingLiveOrder/reconciliation flows", async () => {
      const { organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      const scopedA = getTenantScopedClient(orgA.id);
      await scopedA.liveOrder.create({ data: { organizationId: orgA.id, clientOrderId: "a-order-1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, status: "SUBMITTED" } });

      const scopedB = getTenantScopedClient(orgB.id);
      expect(await scopedB.liveOrder.findMany({})).toHaveLength(0);
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      await expect(cancelExistingLiveOrder({ organizationId: orgB.id, gateway, clientOrderId: "a-order-1" })).rejects.toBeInstanceOf(LiveOrderNotFoundError);
    });
  });

  // ── Group S: policy immutability ───────────────────────────────────────
  describe("S. policy immutability", () => {
    it("S1: the full Sprint 23 credential + submission + cancel + reconcile flow leaves AutonomyPolicy untouched", async () => {
      const { owner, organization } = await setupOrg();
      const policyBefore = await getOrCreatePolicy(organization.id, "market");
      const versionCountBefore = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "k", apiSecret: "s" });
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      await submitDecision({ organizationId: organization.id, decision: buildDecision(), gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      await reconcileOrganizationLiveState({ organizationId: organization.id, gateway });

      const policyAfter = await getOrCreatePolicy(organization.id, "market");
      const versionCountAfter = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });
      expect(policyAfter).toEqual(policyBefore);
      expect(versionCountAfter).toBe(versionCountBefore);
    });
  });

  // ── Group T: autonomy L2 invariant ─────────────────────────────────────
  describe("T. autonomy L2 invariant", () => {
    it("T1: the market domain's autonomy ceiling stays capped at L2, unchanged by this sprint", () => {
      expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.market).toBe("L2");
      expect(maxLevelForDomain("market")).toBe("L2");
    });
  });

  // ── Group U: AI execution restriction ──────────────────────────────────
  describe("U. AI execution restriction", () => {
    it("U1: no registered AI tool NAME can submit/cancel a live order or touch credentials, and no tool declares the executionCredential permission at all", () => {
      // Checked against tool NAMES only, not free-text descriptions: several
      // legitimate read-only tools (e.g. `get_paper_trading`) mention
      // "credential" in their own safety disclaimer prose ("no real
      // credential exists anywhere in this pipeline"), which is the
      // opposite of a capability and must not be flagged.
      const forbiddenNamePattern = /submit[_-]?order|cancel[_-]?order|create[_-]?order|execute[_-]?order|place[_-]?order|credential|api[_-]?key|api[_-]?secret|withdraw|transfer/i;
      const offendingByName = listRegisteredTools().filter((t) => forbiddenNamePattern.test(t.name));
      expect(offendingByName).toHaveLength(0);

      const offendingByPermission = listRegisteredTools().filter((t) => t.requiredPermission && "executionCredential" in t.requiredPermission);
      expect(offendingByPermission).toHaveLength(0);

      expect(getTool("set_execution_credentials")).toBeUndefined();
      expect(getTool("cancel_live_order")).toBeUndefined();
    });

    it("U2: market-domain tools stay read-only and non-autonomy-eligible", () => {
      const marketTools = listRegisteredTools().filter((t) => t.domain === "market");
      expect(marketTools.every((t) => t.mutationCategory === "read_only")).toBe(true);
      expect(marketTools.every((t) => !t.autonomyEligible)).toBe(true);
    });
  });

  // ── Group V: no real Binance call in tests ─────────────────────────────
  describe("V. no real Binance call in tests", () => {
    afterEach(() => vi.restoreAllMocks());

    it("V1: exercising readiness, submission, cancellation, and reconciliation through this file's own gateway usage never calls fetch against a real Binance host", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const { owner, organization } = await setupOrg();
      const scoped = getTenantScopedClient(organization.id);
      await scoped.liveOrder.create({ data: { organizationId: organization.id, clientOrderId: "v-order-1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, status: "SUBMITTED" } });

      const gateway = createMockExecutionGateway({ mode: "LIVE", openOrders: [{ clientOrderId: "v-order-1", providerOrderId: "p1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, price: 100, status: "SUBMITTED", filledQuantity: 0, averageFillPrice: null, rejectionReason: null }] });
      await submitDecision({ organizationId: organization.id, decision: buildDecision(), gateway, riskContext: HEALTHY_RISK_CONTEXT, liveExecutionEnabled: true, hasLiveCredentials: () => true });
      await reconcileOrganizationLiveState({ organizationId: organization.id, gateway });
      await cancelExistingLiveOrder({ organizationId: organization.id, gateway, clientOrderId: "v-order-1" });
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "k", apiSecret: "s" });

      const binanceCalls = fetchSpy.mock.calls.filter((call) => String(call[0]).includes("binance.com"));
      expect(binanceCalls).toHaveLength(0);
    });
  });

  // ── Group W: audit trail / redaction ───────────────────────────────────
  describe("W. audit trail/redaction", () => {
    it("W1: credential configure/rotate/revoke audit rows never contain the plaintext key or secret, only the fingerprint", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "leaktest-key-aaaa", apiSecret: "leaktest-secret-bbbb" });
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "leaktest-key-cccc", apiSecret: "leaktest-secret-dddd" });
      await revokeOrganizationCredentials(organization.id, owner.userId);

      const rows = await prisma.auditLog.findMany({ where: { organizationId: organization.id, action: { startsWith: "execution.credentials_" } } });
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const serialized = JSON.stringify(rows.map((r) => r.metadata));
      expect(serialized).not.toContain("leaktest-key");
      expect(serialized).not.toContain("leaktest-secret");
    });

    it("W2: cancellation and reconciliation-mismatch events are recorded to the audit trail", async () => {
      const { organization } = await setupOrg();
      const scoped = getTenantScopedClient(organization.id);
      await scoped.liveOrder.create({ data: { organizationId: organization.id, clientOrderId: "w-order-1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, status: "SUBMITTED" } });

      const gateway = createMockExecutionGateway({ mode: "LIVE" }); // remote has no open orders -> missing_order mismatch
      await reconcileOrganizationLiveState({ organizationId: organization.id, gateway });
      const cancelGateway = createMockExecutionGateway({ mode: "LIVE" });
      await cancelExistingLiveOrder({ organizationId: organization.id, gateway: cancelGateway, clientOrderId: "w-order-1" });

      const mismatchRows = await prisma.auditLog.findMany({ where: { organizationId: organization.id, action: "execution.reconciliation_mismatch" } });
      const cancelRows = await prisma.auditLog.findMany({ where: { organizationId: organization.id, action: "execution.order_cancelled" } });
      expect(mismatchRows.length).toBeGreaterThan(0);
      expect(cancelRows.length).toBe(1);
    });
  });

  // ── Group X: credential rotation does not leak old secret ─────────────
  describe("X. credential rotation does not leak old secret", () => {
    it("X1: after rotation, the stored ciphertext changes and only the NEW secret is ever decryptable from the row", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "rotate-old-key", apiSecret: "rotate-old-secret" });
      const before = await prisma.organizationExecutionCredential.findUnique({ where: { organizationId: organization.id } });

      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "rotate-new-key", apiSecret: "rotate-new-secret" });
      const after = await prisma.organizationExecutionCredential.findUnique({ where: { organizationId: organization.id } });

      expect(after!.encryptedApiKey).not.toBe(before!.encryptedApiKey);
      expect(after!.encryptedApiSecret).not.toBe(before!.encryptedApiSecret);
      expect(decryptSecret(after!.encryptedApiKey)).toBe("rotate-new-key");
      expect(decryptSecret(after!.encryptedApiSecret)).toBe("rotate-new-secret");
      expect(decryptSecret(after!.encryptedApiKey)).not.toBe("rotate-old-key");
    });
  });
});
