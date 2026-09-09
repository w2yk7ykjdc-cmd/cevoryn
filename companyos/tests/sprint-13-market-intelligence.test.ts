import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient, CrossTenantAccessError } from "@/server/db/tenant";
import { getOrCreatePolicy, listAllowlist, updatePolicy } from "@/server/ai/autonomy/policy-service";
import { MAX_AUTONOMY_LEVEL_BY_DOMAIN } from "@/server/ai/autonomy/constants";
import { listRegisteredTools } from "@/server/ai/tools/registry";
import { createBinancePublicClient } from "@/server/market-data/binance-client";
import { createMockMarketDataClient, buildSyntheticCandles } from "@/server/market-data/mock-client";
import { DAILY_INTERVAL as CANDLE_INTERVAL, DAILY_WINDOW as CANDLE_WINDOW } from "@/server/market-data/types";
import { discoverMarketUniverse } from "@/server/market-data/universe";
import { evaluateMarketPriceMomentum } from "@/server/intelligence/signals/rules/market-price-momentum";
import { ingestMarketData } from "@/server/intelligence/signals/market-scanner";
import * as signalsService from "@/server/intelligence/signals/service";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders } from "./helpers";

function rawKlineRow(openTimeMs: number, close: string, valid = true): unknown[] {
  const closeTimeMs = valid ? openTimeMs + 3_600_000 - 1 : openTimeMs - 1; // invalid: closeTime <= openTime
  return [openTimeMs, close, close, close, close, "100.00000000", closeTimeMs, "0", 0, "0", "0", "0"];
}

describe("A/B/C/E: Binance client -- response validation and normalization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("A/E: parses a well-formed klines response into normalized Candle objects, preserving price strings exactly", async () => {
    const openTimeMs = Date.parse("2026-01-01T00:00:00.000Z");
    const body = [rawKlineRow(openTimeMs, "43521.23000000")];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, headers: new Headers() }),
    );

    const client = createBinancePublicClient();
    const candles = await client.getCandles("BTCUSDT", "1h", 1);

    expect(candles).toHaveLength(1);
    expect(candles[0]!.close).toBe("43521.23000000"); // exact string, never lossily converted to a float
    expect(candles[0]!.openTime).toBeInstanceOf(Date);
    expect(candles[0]!.openTime.getTime()).toBe(openTimeMs);
  });

  it("B: rejects a non-array response body as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ not: "an array" }), headers: new Headers() }),
    );
    const client = createBinancePublicClient();
    await expect(client.getCandles("BTCUSDT", "1h", 1)).rejects.toThrow(/expected an array/);
  });

  it("B: rejects a malformed kline row (wrong shape/types)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [["not", "a", "real", "kline"]], headers: new Headers() }),
    );
    const client = createBinancePublicClient();
    await expect(client.getCandles("BTCUSDT", "1h", 1)).rejects.toThrow(/malformed kline row/);
  });

  it("C: rejects a kline row whose closeTime is not after openTime", async () => {
    const openTimeMs = Date.parse("2026-01-01T00:00:00.000Z");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [rawKlineRow(openTimeMs, "100", false)], headers: new Headers() }),
    );
    const client = createBinancePublicClient();
    await expect(client.getCandles("BTCUSDT", "1h", 1)).rejects.toThrow(/invalid timestamp/);
  });

  it("rejects a non-numeric price field", async () => {
    const openTimeMs = Date.parse("2026-01-01T00:00:00.000Z");
    const row = [openTimeMs, "NaN_PRICE", "1", "1", "1", "1", openTimeMs + 3_600_000 - 1, "0", 0, "0", "0", "0"];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [row], headers: new Headers() }));
    const client = createBinancePublicClient();
    await expect(client.getCandles("BTCUSDT", "1h", 1)).rejects.toThrow(/non-numeric/);
  });

  it("classifies a 429 response as a rate-limit error, not a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, headers: new Headers({ "retry-after": "5" }), text: async () => "" }),
    );
    const client = createBinancePublicClient();
    await expect(client.getCandles("BTCUSDT", "1h", 1)).rejects.toThrow(/rate limit/);
  });

  it("classifies an AbortError as a timeout error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new DOMException("aborted", "AbortError"))),
    );
    const client = createBinancePublicClient();
    await expect(client.getCandles("BTCUSDT", "1h", 1)).rejects.toThrow(/timed out/);
  });
});

describe("D: symbol scope -- superseded by Sprint 14's dynamic universe discovery", () => {
  it("D: the hardcoded 2-symbol list this test originally asserted was deliberately replaced by Sprint 14's discoverMarketUniverse (see tests/sprint-14-market-intelligence.test.ts) -- this test now proves the two-mock-symbol universe still resolves deterministically through that new discovery step, exercising the same underlying scope-boundedness intent without asserting a scheme that no longer exists", async () => {
    const client = createMockMarketDataClient({ BTCUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 110), ETHUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 110) });
    const universe = await discoverMarketUniverse(client);
    expect(universe.sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
});

describe("F/G: deterministic market signal generation", () => {
  it("F: no signal below the medium threshold (quiet market is not itself a signal)", () => {
    const candles = buildSyntheticCandles(CANDLE_WINDOW, 100, 101); // 1% move
    expect(evaluateMarketPriceMomentum(candles, "BTCUSDT", CANDLE_INTERVAL, CANDLE_WINDOW)).toBeNull();
  });

  it("F: medium severity for a move just over 3%, high over 7%, critical over 15%", () => {
    const medium = evaluateMarketPriceMomentum(buildSyntheticCandles(CANDLE_WINDOW, 100, 104), "BTCUSDT", CANDLE_INTERVAL, CANDLE_WINDOW);
    expect(medium?.severity).toBe("medium");

    const high = evaluateMarketPriceMomentum(buildSyntheticCandles(CANDLE_WINDOW, 100, 108), "BTCUSDT", CANDLE_INTERVAL, CANDLE_WINDOW);
    expect(high?.severity).toBe("high");

    const critical = evaluateMarketPriceMomentum(buildSyntheticCandles(CANDLE_WINDOW, 100, 120), "BTCUSDT", CANDLE_INTERVAL, CANDLE_WINDOW);
    expect(critical?.severity).toBe("critical");
  });

  it("F: direction reflects the sign of the move", () => {
    const up = evaluateMarketPriceMomentum(buildSyntheticCandles(CANDLE_WINDOW, 100, 110), "BTCUSDT", CANDLE_INTERVAL, CANDLE_WINDOW);
    expect(up?.direction).toBe("up");
    const down = evaluateMarketPriceMomentum(buildSyntheticCandles(CANDLE_WINDOW, 100, 90), "BTCUSDT", CANDLE_INTERVAL, CANDLE_WINDOW);
    expect(down?.direction).toBe("down");
  });

  it("F: a partial candle window (insufficient history) never produces a lower-confidence guess -- it returns null", () => {
    const partial = buildSyntheticCandles(CANDLE_WINDOW - 1, 100, 130);
    expect(evaluateMarketPriceMomentum(partial, "BTCUSDT", CANDLE_INTERVAL, CANDLE_WINDOW)).toBeNull();
  });

  it("G: identical candle input always produces an identical signal (pure, deterministic)", () => {
    const candles = buildSyntheticCandles(CANDLE_WINDOW, 100, 110);
    const first = evaluateMarketPriceMomentum(candles, "BTCUSDT", CANDLE_INTERVAL, CANDLE_WINDOW);
    const second = evaluateMarketPriceMomentum(candles, "BTCUSDT", CANDLE_INTERVAL, CANDLE_WINDOW);
    expect(first).toEqual(second);
  });
});

describe("H/I/J/K: CompanySignal integration -- idempotency and tenant isolation", () => {
  afterAll(closeTestConnections);

  it("H: re-running ingestion for the same organization/symbol upserts the same row instead of duplicating it", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const client = createMockMarketDataClient({ BTCUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 110), ETHUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 110) });

    await ingestMarketData(client);
    await ingestMarketData(client);

    const signals = await prisma.companySignal.findMany({
      where: { organizationId: organization.id, type: "market_price_momentum", relatedEntityId: "BTCUSDT" },
    });
    expect(signals).toHaveLength(1);
  }, 60_000);

  it("I: concurrent ingestion runs never produce two rows for the same organization/symbol", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const client = createMockMarketDataClient({ BTCUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 110), ETHUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 110) });

    await Promise.all([ingestMarketData(client), ingestMarketData(client)]);

    const signals = await prisma.companySignal.findMany({
      where: { organizationId: organization.id, type: "market_price_momentum", relatedEntityId: "BTCUSDT" },
    });
    expect(signals).toHaveLength(1);
  });

  it("J/K: an organization only ever sees its own market signals, and a cross-tenant query throws", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    const client = createMockMarketDataClient({ BTCUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 110), ETHUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 110) });

    await ingestMarketData(client);

    const scopedA = getTenantScopedClient(orgA.id);
    const scopedB = getTenantScopedClient(orgB.id);

    const signalsA = await scopedA.companySignal.findMany({ where: { type: "market_price_momentum" } });
    const signalsB = await scopedB.companySignal.findMany({ where: { type: "market_price_momentum" } });
    expect(signalsA.length).toBeGreaterThan(0);
    expect(signalsB.length).toBeGreaterThan(0);
    expect(signalsA.every((s) => s.organizationId === orgA.id)).toBe(true);
    expect(signalsB.every((s) => s.organizationId === orgB.id)).toBe(true);

    await expect(scopedB.companySignal.findFirst({ where: { organizationId: orgA.id } })).rejects.toBeInstanceOf(CrossTenantAccessError);
  });
});

describe("L/M/N/O: external failure isolation and job-retry behavior", () => {
  afterAll(closeTestConnections);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("L: one symbol's provider error never prevents the other symbol from being processed", async () => {
    await signUpUser().then(createOrgForUser);
    const client = createMockMarketDataClient({ BTCUSDT: "provider_error", ETHUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 110) });

    const result = await ingestMarketData(client);
    expect(result.symbolsFailed).toBe(1);
    expect(result.symbolsProcessed).toBe(1);
  });

  it("M: a rate-limit error is handled the same way as any other external failure -- skip and continue, never throw", async () => {
    await signUpUser().then(createOrgForUser);
    const client = createMockMarketDataClient({ BTCUSDT: "rate_limited", ETHUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 100) });

    await expect(ingestMarketData(client)).resolves.toMatchObject({ symbolsFailed: 1 });
  });

  it("N: if every configured symbol fails, ingestion throws so BullMQ's own retry/backoff engages, rather than silently succeeding empty", async () => {
    const client = createMockMarketDataClient({ BTCUSDT: "timeout", ETHUSDT: "provider_error" });
    await expect(ingestMarketData(client)).rejects.toThrow(/failed for all/);
  });

  it("O: one organization's signal-write failure never stops another organization's signal from being written", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);

    const spy = vi.spyOn(signalsService, "recordSignal");
    spy.mockImplementationOnce(async () => {
      throw new Error("simulated failure for the first organization only");
    });

    const client = createMockMarketDataClient({ BTCUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 110), ETHUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 110) });
    const result = await ingestMarketData(client);

    expect(result.errors).toBeGreaterThanOrEqual(1);

    const scopedA = getTenantScopedClient(orgA.id);
    const scopedB = getTenantScopedClient(orgB.id);
    const [signalsA, signalsB] = await Promise.all([
      scopedA.companySignal.findMany({ where: { type: "market_price_momentum" } }),
      scopedB.companySignal.findMany({ where: { type: "market_price_momentum" } }),
    ]);
    // One of the two organizations hit the simulated failure; the other must still have real signals recorded.
    expect(signalsA.length + signalsB.length).toBeGreaterThan(0);
  });
});

describe("P/Q/R/S/T: CRITICAL SAFETY -- market ingestion can never touch autonomy or add execution capability", () => {
  afterAll(closeTestConnections);

  it("P/R/S: valid market data and a generated signal leave AutonomyPolicy, AutonomyAllowlistEntry, and AutonomyPolicyVersion byte-for-byte unchanged", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    await updatePolicy({
      organizationId: organization.id, domain: "crm", level: "L3",
      dailyActionLimit: 3, dailyRiskLimit: 100, perActionRiskLimit: 50,
      changedById: owner.userId, requestHeaders: headers,
    });

    const policyBefore = await getOrCreatePolicy(organization.id, "crm");
    const marketPolicyBefore = await getOrCreatePolicy(organization.id, "market");
    const allowlistBefore = await listAllowlist(organization.id, "crm");
    const versionCountBefore = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    const client = createMockMarketDataClient({ BTCUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 130), ETHUSDT: buildSyntheticCandles(CANDLE_WINDOW, 100, 130) });
    const result = await ingestMarketData(client);
    expect(result.signalsDetected).toBeGreaterThan(0); // a real, strong signal was actually generated

    const policyAfter = await getOrCreatePolicy(organization.id, "crm");
    const marketPolicyAfter = await getOrCreatePolicy(organization.id, "market");
    const allowlistAfter = await listAllowlist(organization.id, "crm");
    const versionCountAfter = await prisma.autonomyPolicyVersion.count({ where: { organizationId: organization.id } });

    expect(policyAfter).toEqual(policyBefore);
    expect(marketPolicyAfter).toEqual(marketPolicyBefore);
    expect(allowlistAfter).toEqual(allowlistBefore);
    expect(versionCountAfter).toBe(versionCountBefore);
  });

  it("Q: no MUTATING or autonomy-eligible tool is registered under the market domain (Sprint 14 legitimately adds one read-only tool, get_market_intelligence -- read_only tools never touch AutonomyPolicy at all per resolveAutonomyDecision's own contract, so this is safe; the invariant this test protects is no market-domain MUTATION capability)", () => {
    const marketTools = listRegisteredTools().filter((tool) => tool.domain === "market");
    for (const tool of marketTools) {
      expect(tool.mutationCategory).toBe("read_only");
      expect(tool.autonomyEligible).not.toBe(true);
    }
  });

  it("Q/T: the market data client exposes read-only public market-data access ONLY -- no order/account/withdrawal method exists at all", () => {
    const client = createBinancePublicClient();
    // Sprint 14 legitimately adds getExchangeInfo/getTicker24hr (both public, read-only, no account scope)
    // for dynamic universe discovery -- the invariant this test protects is "no execution/account method",
    // not "exactly one method forever".
    expect(Object.keys(client).sort()).toEqual(["getCandles", "getExchangeInfo", "getTicker24hr"]);
  });

  it("R/S: the market autonomy ceiling stays capped at L2, unchanged from every prior sprint", () => {
    expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.market).toBe("L2");
    expect(MAX_AUTONOMY_LEVEL_BY_DOMAIN.crm).toBe("L5");
  });

  it("T: no function named placeOrder/createOrder/withdraw/transfer exists anywhere in the registered tool set", () => {
    const forbiddenNamePattern = /placeorder|createorder|withdraw|transfer/i;
    const offendingTools = listRegisteredTools().filter((tool) => forbiddenNamePattern.test(tool.name));
    expect(offendingTools).toHaveLength(0);
  });
});
