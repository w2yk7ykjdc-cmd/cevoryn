import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { CrossTenantAccessError, getTenantScopedClient } from "@/server/db/tenant";
import { getTool } from "@/server/ai/tools/registry";
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import type { Candle } from "@/server/market-data/types";
import { BENCHMARK_SYMBOL } from "@/server/market-data/types";
import { createBacktestRun, getBacktestRun, listBacktestRuns, InvalidBacktestRunConfigError } from "@/server/intelligence/backtest/run-service";
import { runBacktestProcessor } from "@/server/jobs/processors/run-backtest";
import { compareBacktestRuns, compareBacktestToLive, getMostRecentBacktestComparisons } from "@/server/intelligence/backtest/comparison";
import { MAX_RUN_SYMBOLS, MAX_RUN_WINDOW_DAYS, MIN_RUN_WINDOW_DAYS } from "@/server/intelligence/backtest/constants";
import type { HistoricalDataset } from "@/server/intelligence/backtest/types";
import { roles } from "@/server/auth/permissions";
import { authHeaders, closeTestConnections, createClosedPaperTrade, createOrgForUser, signUpUser } from "./helpers";

afterAll(closeTestConnections);

const HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const START_MS = Date.UTC(2023, 0, 1, 0, 0, 0);
const OTHER_SYMBOL = "ETHUSDT";

function buildSeries(startMs: number, count: number, intervalMs: number, priceAt: (i: number) => number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const closeTimeMs = startMs + (i + 1) * intervalMs;
    const openTimeMs = closeTimeMs - intervalMs;
    const close = priceAt(i);
    candles.push({
      openTime: new Date(openTimeMs),
      closeTime: new Date(closeTimeMs),
      open: close.toFixed(4),
      high: (close * 1.001).toFixed(4),
      low: (close * 0.999).toFixed(4),
      close: close.toFixed(4),
      volume: "1000",
    });
  }
  return candles;
}

function uptrendCloseAt(hourIndex: number, base = 20000, hourlyRate = 0.003): number {
  return base * (1 + hourlyRate) ** hourIndex;
}

function buildUptrendDataset(symbols: string[], hours: number): HistoricalDataset {
  const dataset: HistoricalDataset = {};
  const allSymbols = symbols.includes(BENCHMARK_SYMBOL) ? symbols : [...symbols, BENCHMARK_SYMBOL];
  for (const symbol of allSymbols) {
    dataset[symbol] = {
      daily: buildSeries(START_MS, hours, HOUR_MS, (i) => uptrendCloseAt(i)),
      short: buildSeries(START_MS, hours * 4, FIFTEEN_MIN_MS, (i) => uptrendCloseAt(i / 4)),
    };
  }
  return dataset;
}

/** Test-only injectable dataset loader (Sprint 21's `LoadDatasetFn`) -- never makes a real network call, ignores the requested time range and always serves the same synthetic 80h uptrend, exactly the same "injectable client, offline, deterministic" discipline `createMockMarketDataClient` already established for Sprint 13/14. */
async function fakeLoadDataset(symbols: string[]): Promise<HistoricalDataset> {
  return buildUptrendDataset(symbols, 80);
}

async function setupOrg() {
  const owner = await signUpUser();
  const organization = await createOrgForUser(owner);
  return { owner, organization };
}

describe("Sprint 21: Backtest Persistence, Multi-Scenario Comparison, Backtest-vs-Live", () => {
  // ── Group A: createBacktestRun validation ──────────────────────────────
  describe("A. run configuration validation", () => {
    it("A1: rejects an empty label", async () => {
      const { organization } = await setupOrg();
      await expect(createBacktestRun({ organizationId: organization.id, label: "   ", symbols: [OTHER_SYMBOL], windowDays: 10 })).rejects.toThrow(
        InvalidBacktestRunConfigError,
      );
    });

    it("A2: rejects a label longer than the documented maximum", async () => {
      const { organization } = await setupOrg();
      await expect(
        createBacktestRun({ organizationId: organization.id, label: "x".repeat(200), symbols: [OTHER_SYMBOL], windowDays: 10 }),
      ).rejects.toThrow(InvalidBacktestRunConfigError);
    });

    it("A3: rejects zero tradeable symbols (benchmark alone doesn't count)", async () => {
      const { organization } = await setupOrg();
      await expect(
        createBacktestRun({ organizationId: organization.id, label: "test", symbols: [BENCHMARK_SYMBOL], windowDays: 10 }),
      ).rejects.toThrow(InvalidBacktestRunConfigError);
    });

    it("A4: rejects more than MAX_RUN_SYMBOLS tradeable symbols", async () => {
      const { organization } = await setupOrg();
      const tooMany = Array.from({ length: MAX_RUN_SYMBOLS + 1 }, (_, i) => `SYM${i}USDT`);
      await expect(createBacktestRun({ organizationId: organization.id, label: "test", symbols: tooMany, windowDays: 10 })).rejects.toThrow(
        InvalidBacktestRunConfigError,
      );
    });

    it("A5: rejects windowDays outside [MIN_RUN_WINDOW_DAYS, MAX_RUN_WINDOW_DAYS]", async () => {
      const { organization } = await setupOrg();
      await expect(
        createBacktestRun({ organizationId: organization.id, label: "test", symbols: [OTHER_SYMBOL], windowDays: MIN_RUN_WINDOW_DAYS - 1 }),
      ).rejects.toThrow(InvalidBacktestRunConfigError);
      await expect(
        createBacktestRun({ organizationId: organization.id, label: "test", symbols: [OTHER_SYMBOL], windowDays: MAX_RUN_WINDOW_DAYS + 1 }),
      ).rejects.toThrow(InvalidBacktestRunConfigError);
    });

    it("A6: deduplicates symbols in the stored config", async () => {
      const { organization } = await setupOrg();
      const { id } = await createBacktestRun({ organizationId: organization.id, label: "dedupe test", symbols: [OTHER_SYMBOL, OTHER_SYMBOL], windowDays: 10 });
      const run = await getBacktestRun(organization.id, id);
      expect(run!.config.symbols).toEqual([OTHER_SYMBOL]);
    });

    it("A7: a valid request creates a PENDING row and returns an id", async () => {
      const { organization } = await setupOrg();
      const { id } = await createBacktestRun({ organizationId: organization.id, label: "valid run", symbols: [OTHER_SYMBOL], windowDays: 10 });
      const run = await getBacktestRun(organization.id, id);
      expect(run).not.toBeNull();
      expect(run!.status).toBe("PENDING");
      expect(run!.result).toBeNull();
    });
  });

  // ── Group B: reads ──────────────────────────────────────────────────────
  describe("B. reads", () => {
    it("B1: getBacktestRun returns null for a non-existent id", async () => {
      const { organization } = await setupOrg();
      expect(await getBacktestRun(organization.id, "nonexistent-id")).toBeNull();
    });

    it("B2: listBacktestRuns returns most-recent-first", async () => {
      const { organization } = await setupOrg();
      const first = await createBacktestRun({ organizationId: organization.id, label: "first", symbols: [OTHER_SYMBOL], windowDays: 5 });
      await new Promise((r) => setTimeout(r, 10));
      const second = await createBacktestRun({ organizationId: organization.id, label: "second", symbols: [OTHER_SYMBOL], windowDays: 5 });
      const runs = await listBacktestRuns(organization.id);
      expect(runs[0]!.id).toBe(second.id);
      expect(runs[1]!.id).toBe(first.id);
    });
  });

  // ── Group C: tenant isolation ────────────────────────────────────────────
  describe("C. tenant isolation", () => {
    it("C1: getBacktestRun never returns another organization's run", async () => {
      const { organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      const { id } = await createBacktestRun({ organizationId: orgA.id, label: "orgA run", symbols: [OTHER_SYMBOL], windowDays: 5 });
      expect(await getBacktestRun(orgB.id, id)).toBeNull();
      expect(await getBacktestRun(orgA.id, id)).not.toBeNull();
    });

    it("C2: listBacktestRuns for orgB never includes orgA's runs", async () => {
      const { organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      await createBacktestRun({ organizationId: orgA.id, label: "orgA only", symbols: [OTHER_SYMBOL], windowDays: 5 });
      const runsB = await listBacktestRuns(orgB.id);
      expect(runsB.every((r) => r.label !== "orgA only")).toBe(true);
    });

    it("C3: a direct cross-tenant BacktestRun query throws CrossTenantAccessError", async () => {
      const { organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      const scopedA = getTenantScopedClient(orgA.id);
      await expect(scopedA.backtestRun.findFirst({ where: { organizationId: orgB.id } })).rejects.toThrow(CrossTenantAccessError);
    });

    it("C4: the run-backtest job processor never touches a BacktestRun belonging to a different organization than its own payload", async () => {
      const { organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      const { id } = await createBacktestRun({ organizationId: orgA.id, label: "orgA isolation", symbols: [OTHER_SYMBOL], windowDays: 5 });

      // Payload claims orgB, but the row belongs to orgA -- tenant scoping must make this a no-op.
      await runBacktestProcessor({ backtestRunId: id, organizationId: orgB.id }, fakeLoadDataset);

      const stillPending = await getBacktestRun(orgA.id, id);
      expect(stillPending!.status).toBe("PENDING");
    });
  });

  // ── Group D: job processor execution + idempotency ─────────────────────
  describe("D. job processor", () => {
    it("D1: processes a PENDING run to COMPLETED with a real, non-empty result (using an injected, offline dataset)", async () => {
      const { organization } = await setupOrg();
      const { id } = await createBacktestRun({ organizationId: organization.id, label: "processed run", symbols: [OTHER_SYMBOL], windowDays: 10 });

      await runBacktestProcessor({ backtestRunId: id, organizationId: organization.id }, fakeLoadDataset);

      const run = await getBacktestRun(organization.id, id);
      expect(run!.status).toBe("COMPLETED");
      expect(run!.result).not.toBeNull();
      expect(run!.result!.run.closedTrades.length).toBeGreaterThan(0);
      expect(run!.result!.disclaimer.toUpperCase()).toContain("NOT REAL TRADING");
      expect(run!.completedAt).not.toBeNull();
    });

    it("D2: a FAILED dataset load transitions the run to FAILED with a real error message, never silently swallowed", async () => {
      const { organization } = await setupOrg();
      const { id } = await createBacktestRun({ organizationId: organization.id, label: "will fail", symbols: [OTHER_SYMBOL], windowDays: 10 });

      const throwingLoader = async (): Promise<HistoricalDataset> => {
        throw new Error("simulated historical data fetch failure");
      };
      await runBacktestProcessor({ backtestRunId: id, organizationId: organization.id }, throwingLoader);

      const run = await getBacktestRun(organization.id, id);
      expect(run!.status).toBe("FAILED");
      expect(run!.errorMessage).toContain("simulated historical data fetch failure");
      expect(run!.result).toBeNull();
    });

    it("D3: idempotent -- calling the processor again on an already-COMPLETED run is a safe no-op (never re-computes, never double-writes)", async () => {
      const { organization } = await setupOrg();
      const { id } = await createBacktestRun({ organizationId: organization.id, label: "idempotency check", symbols: [OTHER_SYMBOL], windowDays: 10 });

      await runBacktestProcessor({ backtestRunId: id, organizationId: organization.id }, fakeLoadDataset);
      const afterFirst = await getBacktestRun(organization.id, id);

      await runBacktestProcessor({ backtestRunId: id, organizationId: organization.id }, fakeLoadDataset);
      const afterSecond = await getBacktestRun(organization.id, id);

      expect(afterSecond).toEqual(afterFirst);
    });

    it("D4: idempotent -- calling the processor again on an already-FAILED run is a safe no-op", async () => {
      const { organization } = await setupOrg();
      const { id } = await createBacktestRun({ organizationId: organization.id, label: "failed idempotency", symbols: [OTHER_SYMBOL], windowDays: 10 });
      const throwingLoader = async (): Promise<HistoricalDataset> => {
        throw new Error("first failure");
      };
      await runBacktestProcessor({ backtestRunId: id, organizationId: organization.id }, throwingLoader);
      const afterFirst = await getBacktestRun(organization.id, id);

      // Second call uses a loader that WOULD succeed -- if the processor were not idempotent, this would flip the row to COMPLETED.
      await runBacktestProcessor({ backtestRunId: id, organizationId: organization.id }, fakeLoadDataset);
      const afterSecond = await getBacktestRun(organization.id, id);

      expect(afterSecond).toEqual(afterFirst);
      expect(afterSecond!.status).toBe("FAILED");
    });

    it("D5: processing a run never mutates any real PaperAccount/PaperPosition/PaperTrade/CompanySignal row (isolated in-memory computation, same as Sprint 20)", async () => {
      const { organization } = await setupOrg();
      const [accountsBefore, positionsBefore, tradesBefore, signalsBefore] = await Promise.all([
        prisma.paperAccount.count({ where: { organizationId: organization.id } }),
        prisma.paperPosition.count({ where: { organizationId: organization.id } }),
        prisma.paperTrade.count({ where: { organizationId: organization.id } }),
        prisma.companySignal.count({ where: { organizationId: organization.id } }),
      ]);

      const { id } = await createBacktestRun({ organizationId: organization.id, label: "isolation check", symbols: [OTHER_SYMBOL], windowDays: 10 });
      await runBacktestProcessor({ backtestRunId: id, organizationId: organization.id }, fakeLoadDataset);

      const [accountsAfter, positionsAfter, tradesAfter, signalsAfter] = await Promise.all([
        prisma.paperAccount.count({ where: { organizationId: organization.id } }),
        prisma.paperPosition.count({ where: { organizationId: organization.id } }),
        prisma.paperTrade.count({ where: { organizationId: organization.id } }),
        prisma.companySignal.count({ where: { organizationId: organization.id } }),
      ]);

      expect(accountsAfter).toBe(accountsBefore);
      expect(positionsAfter).toBe(positionsBefore);
      expect(tradesAfter).toBe(tradesBefore);
      expect(signalsAfter).toBe(signalsBefore);
    });

    it("D6: a run for a nonexistent BacktestRun id is a safe no-op", async () => {
      const { organization } = await setupOrg();
      await expect(runBacktestProcessor({ backtestRunId: "does-not-exist", organizationId: organization.id }, fakeLoadDataset)).resolves.toBeUndefined();
    });
  });

  // ── Group E: policy immutability ────────────────────────────────────────
  describe("E. policy immutability", () => {
    it("E1: creating and fully processing a backtest run leaves AutonomyPolicy/AutonomyPolicyVersion/AutonomyAllowlistEntry byte-for-byte unchanged, including for an organization that never touched its policy before", async () => {
      const { organization } = await setupOrg();
      const [policiesBefore, versionsBefore, allowlistBefore] = await Promise.all([
        prisma.autonomyPolicy.findMany({ where: { organizationId: organization.id } }),
        prisma.autonomyPolicyVersion.findMany({ where: { organizationId: organization.id } }),
        prisma.autonomyAllowlistEntry.findMany({ where: { organizationId: organization.id } }),
      ]);
      expect(policiesBefore).toHaveLength(0);

      const { id } = await createBacktestRun({ organizationId: organization.id, label: "policy immutability", symbols: [OTHER_SYMBOL], windowDays: 10 });
      await runBacktestProcessor({ backtestRunId: id, organizationId: organization.id }, fakeLoadDataset);

      const [policiesAfter, versionsAfter, allowlistAfter] = await Promise.all([
        prisma.autonomyPolicy.findMany({ where: { organizationId: organization.id } }),
        prisma.autonomyPolicyVersion.findMany({ where: { organizationId: organization.id } }),
        prisma.autonomyAllowlistEntry.findMany({ where: { organizationId: organization.id } }),
      ]);
      expect(policiesAfter).toEqual(policiesBefore);
      expect(versionsAfter).toEqual(versionsBefore);
      expect(allowlistAfter).toEqual(allowlistBefore);
    });
  });

  // ── Group F: comparison ──────────────────────────────────────────────────
  describe("F. multi-scenario comparison + backtest-vs-live", () => {
    it("F1: compareBacktestRuns returns null metrics for a run that hasn't completed yet, and real metrics for one that has", async () => {
      const { organization } = await setupOrg();
      const pending = await createBacktestRun({ organizationId: organization.id, label: "still pending", symbols: [OTHER_SYMBOL], windowDays: 10 });
      const completed = await createBacktestRun({ organizationId: organization.id, label: "completed", symbols: [OTHER_SYMBOL], windowDays: 10 });
      await runBacktestProcessor({ backtestRunId: completed.id, organizationId: organization.id }, fakeLoadDataset);

      const comparison = await compareBacktestRuns(organization.id, [pending.id, completed.id]);
      const pendingEntry = comparison.find((c) => c.id === pending.id)!;
      const completedEntry = comparison.find((c) => c.id === completed.id)!;
      expect(pendingEntry.metrics).toBeNull();
      expect(completedEntry.metrics).not.toBeNull();
      expect(completedEntry.metrics!.totalTrades).toBeGreaterThan(0);
    });

    it("F2: compareBacktestRuns silently skips a run id belonging to a different organization (tenant-scoped read underneath)", async () => {
      const { organization: orgA } = await setupOrg();
      const { organization: orgB } = await setupOrg();
      const runA = await createBacktestRun({ organizationId: orgA.id, label: "orgA", symbols: [OTHER_SYMBOL], windowDays: 5 });

      const comparisonFromOrgB = await compareBacktestRuns(orgB.id, [runA.id]);
      expect(comparisonFromOrgB).toHaveLength(0);
    });

    it("F3: compareBacktestToLive returns 'backtest_not_found' for a nonexistent or not-yet-completed run", async () => {
      const { organization } = await setupOrg();
      const pending = await createBacktestRun({ organizationId: organization.id, label: "not done", symbols: [OTHER_SYMBOL], windowDays: 10 });
      const result = await compareBacktestToLive(organization.id, pending.id, "TREND_FOLLOWING");
      expect(result.status).toBe("backtest_not_found");
    });

    it("F4: compareBacktestToLive returns 'strategy_type_not_in_backtest' for a strategy type the run never produced", async () => {
      const { organization } = await setupOrg();
      const { id } = await createBacktestRun({ organizationId: organization.id, label: "for comparison", symbols: [OTHER_SYMBOL], windowDays: 10 });
      await runBacktestProcessor({ backtestRunId: id, organizationId: organization.id }, fakeLoadDataset);

      const result = await compareBacktestToLive(organization.id, id, "A_STRATEGY_TYPE_THAT_NEVER_HAPPENED");
      expect(result.status).toBe("strategy_type_not_in_backtest");
    });

    it("F5: compareBacktestToLive returns a real, non-fabricated side-by-side comparison for a strategy type the run actually produced -- backtest side always populated, live side reflects genuine (possibly empty) live data, the two never blended", async () => {
      const { organization } = await setupOrg();
      // Give this organization some real, already-closed PaperTrade history so the LIVE side has real numbers.
      await createClosedPaperTrade(organization.id, { strategyType: "TREND_FOLLOWING", returnPct: 0.05, netPnl: 50 });
      await createClosedPaperTrade(organization.id, { strategyType: "TREND_FOLLOWING", returnPct: -0.02, netPnl: -20 });

      const { id } = await createBacktestRun({ organizationId: organization.id, label: "vs live", symbols: [OTHER_SYMBOL], windowDays: 10 });
      await runBacktestProcessor({ backtestRunId: id, organizationId: organization.id }, fakeLoadDataset);

      const result = await compareBacktestToLive(organization.id, id, "TREND_FOLLOWING");
      expect(result.status).toBe("compared");
      if (result.status === "compared") {
        expect(result.rows.length).toBeGreaterThan(0);
        const sampleSizeRow = result.rows.find((r) => r.metric.startsWith("Sample size"))!;
        expect(sampleSizeRow.backtestValue).toBeGreaterThan(0);
        // "Sample size" reads live.evaluatedTrades (Sprint 17's own outcome-
        // evaluated count), NOT the raw closed-trade count -- the 2 trades
        // seeded above were never run through an Outcome evaluation, so the
        // honest, non-fabricated live figure here is genuinely 0, not 2.
        // This is the real point of the test: the live column reflects
        // reality, never a guess, and is never blended into backtestValue.
        expect(sampleSizeRow.liveValue).toBe(0);
      }
    });

    it("F6: getMostRecentBacktestComparisons returns null/empty for an organization with no completed runs", async () => {
      const { organization } = await setupOrg();
      const result = await getMostRecentBacktestComparisons(organization.id);
      expect(result.backtestRun).toBeNull();
      expect(result.comparisons).toEqual([]);
    });

    it("F7: getMostRecentBacktestComparisons picks the MOST RECENT completed run, never an older one", async () => {
      const { organization } = await setupOrg();
      const older = await createBacktestRun({ organizationId: organization.id, label: "older run", symbols: [OTHER_SYMBOL], windowDays: 10 });
      await runBacktestProcessor({ backtestRunId: older.id, organizationId: organization.id }, fakeLoadDataset);
      await new Promise((r) => setTimeout(r, 10));
      const newer = await createBacktestRun({ organizationId: organization.id, label: "newer run", symbols: [OTHER_SYMBOL], windowDays: 10 });
      await runBacktestProcessor({ backtestRunId: newer.id, organizationId: organization.id }, fakeLoadDataset);

      const result = await getMostRecentBacktestComparisons(organization.id);
      expect(result.backtestRun!.id).toBe(newer.id);
    });
  });

  // ── Group G: RBAC ────────────────────────────────────────────────────────
  describe("G. RBAC", () => {
    it("G1: owner/admin/member roles grant both backtest:read and backtest:run", () => {
      for (const role of [roles.owner, roles.admin, roles.member]) {
        expect(role.authorize({ backtest: ["read"] }).success).toBe(true);
        expect(role.authorize({ backtest: ["run"] }).success).toBe(true);
      }
    });

    it("G2: viewer role grants backtest:read but never backtest:run", () => {
      expect(roles.viewer.authorize({ backtest: ["read"] }).success).toBe(true);
      expect(roles.viewer.authorize({ backtest: ["run"] }).success).toBe(false);
    });
  });

  // ── Group H: AI tool extension (read-only, no new tool) ─────────────────
  describe("H. get_strategy_performance tool extension", () => {
    it("H1: the tool's output includes a backtestComparison field, empty when nothing has completed yet", async () => {
      const { owner, organization } = await setupOrg();
      const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
      const result = await executeToolCall(
        { id: "gsp-1", name: "get_strategy_performance", arguments: {} },
        { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
        authHeaders(owner.token),
      );
      expect(result.status).toBe("success");
      const output = (result as { output?: { backtestComparison: { backtestRun: unknown; comparisons: unknown[] } } }).output;
      expect(output?.backtestComparison.backtestRun).toBeNull();
      expect(output?.backtestComparison.comparisons).toEqual([]);
    });

    it("H2: the tool's requiredPermission is unchanged (paperTrading:read only) -- Sprint 21 adds no new gate to this existing tool", () => {
      expect(getTool("get_strategy_performance")?.requiredPermission).toEqual({ paperTrading: ["read"] });
    });

    it("H3: the tool's output reflects a real completed backtest run once one exists", async () => {
      const { owner, organization } = await setupOrg();
      const { id } = await createBacktestRun({ organizationId: organization.id, label: "for the AI tool", symbols: [OTHER_SYMBOL], windowDays: 10 });
      await runBacktestProcessor({ backtestRunId: id, organizationId: organization.id }, fakeLoadDataset);

      const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
      const result = await executeToolCall(
        { id: "gsp-2", name: "get_strategy_performance", arguments: {} },
        { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
        authHeaders(owner.token),
      );
      expect(result.status).toBe("success");
      const output = (result as { output?: { backtestComparison: { backtestRun: { id: string } | null } } }).output;
      expect(output?.backtestComparison.backtestRun?.id).toBe(id);
    });
  });

  // ── Group I: determinism of the persisted result ────────────────────────
  describe("I. determinism", () => {
    it("I1: processing two separate runs with the identical config and dataset produces byte-identical result reports (excluding only the run's own id/timestamps)", async () => {
      const { organization } = await setupOrg();
      const runA = await createBacktestRun({ organizationId: organization.id, label: "det A", symbols: [OTHER_SYMBOL], windowDays: 10 });
      const runB = await createBacktestRun({ organizationId: organization.id, label: "det B", symbols: [OTHER_SYMBOL], windowDays: 10 });
      await runBacktestProcessor({ backtestRunId: runA.id, organizationId: organization.id }, fakeLoadDataset);
      await runBacktestProcessor({ backtestRunId: runB.id, organizationId: organization.id }, fakeLoadDataset);

      const a = await getBacktestRun(organization.id, runA.id);
      const b = await getBacktestRun(organization.id, runB.id);
      expect(a!.result).toEqual(b!.result);
    });
  });
});
