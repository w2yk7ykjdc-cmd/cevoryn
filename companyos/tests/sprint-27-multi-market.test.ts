import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { CrossTenantAccessError, getTenantScopedClient } from "@/server/db/tenant";
import { listRegisteredTools } from "@/server/ai/tools/registry";
import {
  setOrganizationCredentials,
  revokeOrganizationCredentials,
  getOrganizationCredentials,
  getOrganizationCredentialStatus,
  listOrganizationCredentialStatuses,
  resolveExecutionCredentials,
  hasLiveCredentialsFor,
} from "@/server/execution/org-credentials";
import {
  SUPPORTED_EXECUTION_PROVIDERS,
  DEFAULT_EXECUTION_PROVIDER,
  isSupportedExecutionProvider,
  createExecutionGatewayForProvider,
  UnsupportedExecutionProviderError,
} from "@/server/execution/providers";
import { createMockExecutionGateway } from "@/server/execution/mock-gateway";
import { submitDecision } from "@/server/execution/service";
import type { MarketDecision, ProposedOrder } from "@/server/intelligence/market-decision/types";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

afterAll(closeTestConnections);

/**
 * Sprint 27 test suite -- multi-market provider isolation. Confirms
 * `ExecutionGateway`/`MarketDataClient` (Sprint 13/22) were ALREADY
 * provider-agnostic interfaces before this sprint, and that the new
 * provider registry + per-provider credential storage this sprint adds
 * are genuinely additive: every Sprint 22-26 call site that never
 * mentions a provider keeps behaving byte-for-byte identically. Never a
 * real Binance credential, never a real network call, and never a claim
 * that any provider besides "binance" is actually implemented.
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

describe("Sprint 27: Multi-Market Provider Isolation", () => {
  // ── Group A: provider registry ────────────────────────────────────────
  describe("A. provider registry", () => {
    it("A1: only 'binance' is a supported execution provider -- no unimplemented capability is fabricated", () => {
      expect(SUPPORTED_EXECUTION_PROVIDERS).toEqual(["binance"]);
      expect(DEFAULT_EXECUTION_PROVIDER).toBe("binance");
      expect(isSupportedExecutionProvider("binance")).toBe(true);
      expect(isSupportedExecutionProvider("coinbase")).toBe(false);
      expect(isSupportedExecutionProvider("kraken")).toBe(false);
    });

    it("A2: createExecutionGatewayForProvider builds a real gateway for 'binance'", () => {
      const gateway = createExecutionGatewayForProvider("binance", { apiKey: "test-key", apiSecret: "test-secret" });
      expect(gateway.providerName).toBe("binance");
      expect(gateway.mode).toBe("LIVE");
    });

    it("A3: createExecutionGatewayForProvider throws UnsupportedExecutionProviderError for any unimplemented provider -- never silently falls back to Binance", () => {
      expect(() => createExecutionGatewayForProvider("coinbase", { apiKey: "k", apiSecret: "s" })).toThrow(UnsupportedExecutionProviderError);
      expect(() => createExecutionGatewayForProvider("kraken", { apiKey: "k", apiSecret: "s" })).toThrow(UnsupportedExecutionProviderError);
    });
  });

  // ── Group B: multi-provider credential storage ──────────────────────────
  describe("B. multi-provider credential storage", () => {
    it("B1: an organization can hold independent credentials for two different provider names simultaneously", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "binance-key", apiSecret: "binance-secret", provider: "binance" });
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "other-key", apiSecret: "other-secret", provider: "other-provider" });

      const binance = await getOrganizationCredentials(organization.id, "binance");
      const other = await getOrganizationCredentials(organization.id, "other-provider");
      expect(binance).toEqual({ apiKey: "binance-key", apiSecret: "binance-secret" });
      expect(other).toEqual({ apiKey: "other-key", apiSecret: "other-secret" });

      const rows = await prisma.organizationExecutionCredential.count({ where: { organizationId: organization.id } });
      expect(rows).toBe(2);
    });

    it("B2: rotating one provider's credential never touches another provider's row", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "binance-v1", apiSecret: "binance-secret-v1", provider: "binance" });
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "other-v1", apiSecret: "other-secret-v1", provider: "other-provider" });

      const result = await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "binance-v2", apiSecret: "binance-secret-v2", provider: "binance" });
      expect(result.isRotation).toBe(true);

      expect(await getOrganizationCredentials(organization.id, "binance")).toEqual({ apiKey: "binance-v2", apiSecret: "binance-secret-v2" });
      expect(await getOrganizationCredentials(organization.id, "other-provider")).toEqual({ apiKey: "other-v1", apiSecret: "other-secret-v1" });
    });

    it("B3: revoking one provider's credential never touches another provider's row", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "k1", apiSecret: "s1", provider: "binance" });
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "k2", apiSecret: "s2", provider: "other-provider" });

      await revokeOrganizationCredentials(organization.id, owner.userId, "binance");

      expect(await hasLiveCredentialsFor(organization.id, "binance")).toBe(false);
      expect(await hasLiveCredentialsFor(organization.id, "other-provider")).toBe(true);
    });

    it("B4: listOrganizationCredentialStatuses returns every configured provider's status, never the encrypted values", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "k1", apiSecret: "s1", provider: "binance" });
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "k2", apiSecret: "s2", provider: "other-provider" });

      const statuses = await listOrganizationCredentialStatuses(organization.id);
      expect(statuses).toHaveLength(2);
      expect(statuses.map((s) => s.provider).sort()).toEqual(["binance", "other-provider"]);
      expect(statuses.every((s) => s.configured)).toBe(true);
      for (const s of statuses) {
        expect(s).not.toHaveProperty("encryptedApiKey");
        expect(s).not.toHaveProperty("encryptedApiSecret");
      }
    });
  });

  // ── Group C: backward compatibility ───────────────────────────────────
  describe("C. backward compatibility (no provider argument)", () => {
    it("C1: setOrganizationCredentials/getOrganizationCredentials without a provider argument default to 'binance', identical to Sprint 23 behavior", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "default-key", apiSecret: "default-secret" });

      const viaDefault = await getOrganizationCredentials(organization.id);
      const viaExplicitBinance = await getOrganizationCredentials(organization.id, "binance");
      expect(viaDefault).toEqual(viaExplicitBinance);
      expect(viaDefault).toEqual({ apiKey: "default-key", apiSecret: "default-secret" });
    });

    it("C2: getOrganizationCredentialStatus/hasLiveCredentialsFor/resolveExecutionCredentials without a provider argument all default to 'binance'", async () => {
      const { owner, organization } = await setupOrg();
      await setOrganizationCredentials({ organizationId: organization.id, actorId: owner.userId, apiKey: "k", apiSecret: "s" });

      expect((await getOrganizationCredentialStatus(organization.id)).provider).toBe("binance");
      expect(await hasLiveCredentialsFor(organization.id)).toBe(true);
      expect(await resolveExecutionCredentials(organization.id)).toEqual({ apiKey: "k", apiSecret: "s" });
    });

    it("C3: submitDecision's existing shape (gateway injected, no provider concept at the call site) is completely unaffected -- LiveOrder.provider is recorded from the gateway's own providerName", async () => {
      const { organization } = await setupOrg();
      const gateway = createMockExecutionGateway({ mode: "LIVE" });
      const decision = buildDecision();

      const result = await submitDecision({
        organizationId: organization.id,
        decision,
        gateway,
        riskContext: HEALTHY_RISK_CONTEXT,
        liveExecutionEnabled: true,
        hasLiveCredentials: () => true,
      });

      expect(result.status).toBe("SUBMITTED");
      const row = await prisma.liveOrder.findFirst({ where: { organizationId: organization.id, symbol: "BTCUSDT" } });
      expect(row!.provider).toBe("mock");
    });
  });

  // ── Group D: tenant isolation ──────────────────────────────────────────
  describe("D. tenant isolation", () => {
    it("D1: organization B cannot read organization A's credential for any provider through the tenant-scoped client", async () => {
      const { owner: ownerA, organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await setOrganizationCredentials({ organizationId: orgA.id, actorId: ownerA.userId, apiKey: "k", apiSecret: "s", provider: "binance" });
      await setOrganizationCredentials({ organizationId: orgA.id, actorId: ownerA.userId, apiKey: "k2", apiSecret: "s2", provider: "other-provider" });

      const scopedB = getTenantScopedClient(orgB.id);
      await expect(scopedB.organizationExecutionCredential.findFirst({ where: { organizationId: orgA.id } })).rejects.toThrow(CrossTenantAccessError);

      expect(await getOrganizationCredentials(orgB.id, "binance")).toBeNull();
      expect(await getOrganizationCredentials(orgB.id, "other-provider")).toBeNull();
    });

    it("D2: two organizations can independently configure the SAME provider name without collision", async () => {
      const { owner: ownerA, organization: orgA } = await setupOrg();
      const { owner: ownerB, organization: orgB } = await setupOrg();
      await setOrganizationCredentials({ organizationId: orgA.id, actorId: ownerA.userId, apiKey: "orgA-key", apiSecret: "orgA-secret", provider: "binance" });
      await setOrganizationCredentials({ organizationId: orgB.id, actorId: ownerB.userId, apiKey: "orgB-key", apiSecret: "orgB-secret", provider: "binance" });

      expect(await getOrganizationCredentials(orgA.id, "binance")).toEqual({ apiKey: "orgA-key", apiSecret: "orgA-secret" });
      expect(await getOrganizationCredentials(orgB.id, "binance")).toEqual({ apiKey: "orgB-key", apiSecret: "orgB-secret" });
    });
  });

  // ── Group E: env fallback stays provider-specific ─────────────────────
  describe("E. env fallback is Binance-only", () => {
    it("E1: resolveExecutionCredentials never falls back to the (inherently Binance-only) env vars for a non-default provider", async () => {
      const { organization } = await setupOrg();
      // No org credential configured for "other-provider" at all -- since the env
      // fallback is only ever meaningful for the default ("binance") provider,
      // this must resolve to null regardless of whether BINANCE_API_KEY/SECRET
      // happen to be set in this process's env (they are not, in this test suite).
      expect(await resolveExecutionCredentials(organization.id, "other-provider")).toBeNull();
    });
  });

  // ── Group F: AI restriction ─────────────────────────────────────────────
  describe("F. AI restriction", () => {
    it("F1: no registered AI tool can read or write execution credentials for any provider, or manage the provider registry", () => {
      const forbiddenNamePattern = /execution[_-]?credential|provider[_-]?registry|set[_-]?credential/i;
      const offending = listRegisteredTools().filter((t) => forbiddenNamePattern.test(t.name));
      expect(offending).toHaveLength(0);
    });
  });
});
