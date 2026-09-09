import { execSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { getTenantScopedClient } from "@/server/db/tenant";
import { computeSlippageBps, computeTimeToFillMs, summarizeExecutionQuality, getExecutionQualitySummary } from "@/server/execution/execution-quality";
import { getReconciliationHealth } from "@/server/execution/reconciliation-health";
import { recordExecutionAudit } from "@/server/execution/audit";
import { listRegisteredTools, getTool } from "@/server/ai/tools/registry";
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders, addMemberDirect } from "./helpers";

/**
 * Sprint 29: Production Intelligence.
 *
 * Audit found strategy/portfolio health, market-signal intelligence,
 * reconciliation-mismatch detection, and extensive read-only AI tooling
 * already existed across Sprints 5-27. The genuine, confirmed gap: real
 * production trades (`LiveOrder`) never fed any of it, and no
 * execution-quality metric (slippage, fill rate, time-to-fill) was ever
 * computed despite the raw data already being persisted since Sprint
 * 22/24. A deeper audit finding also confirmed the codebase honestly
 * CANNOT go further than this yet: `MarketDecision.proposedOrder`
 * (`intelligence/market-decision/types.ts`) only ever represents a NEW
 * entry -- there is no exit/close order concept anywhere in the decision
 * engine, so there is no real "closed live position" data to bridge into
 * Outcome/Learning/StrategyHealth without fabricating one. This sprint
 * therefore adds exactly what IS honestly computable now: execution-
 * quality metrics and a read-only reconciliation-health summary, both
 * pure aggregations over rows that already exist, exposed through one new
 * read-only AI tool (`get_execution_health`), deliberately kept separate
 * from the PAPER-only `get_strategy_performance` -- the same "never blend
 * paper and live" discipline `portfolio-risk.ts#computePortfolioSnapshot`
 * already established.
 */

describe("Sprint 29: Production Intelligence", () => {
  afterAll(closeTestConnections);

  describe("A. execution-quality pure functions", () => {
    it("A1: computeSlippageBps is signed so a positive value always means unfavorable, regardless of side", () => {
      // BUY: paid MORE than intended (100 -> 101) is unfavorable -> positive.
      expect(computeSlippageBps({ side: "BUY", price: 100, averageFillPrice: 101 })).toBeCloseTo(100, 5);
      // SELL: received LESS than intended (100 -> 99) is unfavorable -> positive.
      expect(computeSlippageBps({ side: "SELL", price: 100, averageFillPrice: 99 })).toBeCloseTo(100, 5);
      // BUY: paid LESS than intended is favorable -> negative.
      expect(computeSlippageBps({ side: "BUY", price: 100, averageFillPrice: 99 })).toBeCloseTo(-100, 5);
    });

    it("A2: computeSlippageBps returns null, never a fabricated 0, when either price is unavailable", () => {
      expect(computeSlippageBps({ side: "BUY", price: null, averageFillPrice: 100 })).toBeNull();
      expect(computeSlippageBps({ side: "BUY", price: 100, averageFillPrice: null })).toBeNull();
    });

    it("A3: computeTimeToFillMs returns null when either timestamp is missing", () => {
      const now = new Date();
      expect(computeTimeToFillMs({ submittedAt: null, filledAt: now })).toBeNull();
      expect(computeTimeToFillMs({ submittedAt: now, filledAt: null })).toBeNull();
      expect(computeTimeToFillMs({ submittedAt: new Date(now.getTime() - 500), filledAt: now })).toBe(500);
    });

    it("A4: summarizeExecutionQuality returns an all-null summary for zero orders, never fabricated activity", () => {
      const summary = summarizeExecutionQuality([]);
      expect(summary).toEqual({
        totalOrders: 0,
        filledCount: 0,
        partiallyFilledCount: 0,
        rejectedCount: 0,
        failedCount: 0,
        cancelledCount: 0,
        fillRatePct: null,
        avgSlippageBps: null,
        avgTimeToFillMs: null,
      });
    });

    it("A5: summarizeExecutionQuality computes a correct fill rate and average slippage across a mixed batch, ignoring orders missing the data it needs", () => {
      const now = new Date();
      const summary = summarizeExecutionQuality([
        { status: "FILLED", side: "BUY", price: 100, averageFillPrice: 102, quantity: 1, filledQuantity: 1, submittedAt: now, filledAt: new Date(now.getTime() + 200) },
        { status: "FILLED", side: "BUY", price: 100, averageFillPrice: 100, quantity: 1, filledQuantity: 1, submittedAt: now, filledAt: new Date(now.getTime() + 400) },
        { status: "REJECTED", side: "SELL", price: 50, averageFillPrice: null, quantity: 1, filledQuantity: 0, submittedAt: null, filledAt: null },
        { status: "CANCELLED", side: "BUY", price: 50, averageFillPrice: null, quantity: 1, filledQuantity: 0, submittedAt: now, filledAt: null },
      ]);
      expect(summary.totalOrders).toBe(4);
      expect(summary.filledCount).toBe(2);
      expect(summary.rejectedCount).toBe(1);
      expect(summary.cancelledCount).toBe(1);
      expect(summary.fillRatePct).toBeCloseTo(50, 5);
      // (200bps + 0bps) / 2 = 100bps.
      expect(summary.avgSlippageBps).toBeCloseTo(100, 5);
      expect(summary.avgTimeToFillMs).toBeCloseTo(300, 5);
    });
  });

  describe("B. getExecutionQualitySummary -- tenant-scoped read over real LiveOrder rows", () => {
    it("B1: an organization only ever sees its own LiveOrder rows summarized, never another organization's", async () => {
      const ownerA = await signUpUser();
      const orgA = await createOrgForUser(ownerA);
      const ownerB = await signUpUser();
      const orgB = await createOrgForUser(ownerB);

      const scopedA = getTenantScopedClient(orgA.id);
      const scopedB = getTenantScopedClient(orgB.id);

      await scopedA.liveOrder.create({
        data: { organizationId: orgA.id, clientOrderId: "a-1", symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1, price: 100, status: "FILLED", averageFillPrice: 101, filledQuantity: 1, submittedAt: new Date(), filledAt: new Date() },
      });
      await scopedB.liveOrder.create({
        data: { organizationId: orgB.id, clientOrderId: "b-1", symbol: "ETHUSDT", side: "SELL", type: "MARKET", quantity: 1, price: 100, status: "REJECTED" },
      });

      const summaryA = await getExecutionQualitySummary(orgA.id);
      const summaryB = await getExecutionQualitySummary(orgB.id);

      expect(summaryA.totalOrders).toBe(1);
      expect(summaryA.filledCount).toBe(1);
      expect(summaryB.totalOrders).toBe(1);
      expect(summaryB.rejectedCount).toBe(1);
    });

    it("B2: an organization with no LiveOrder rows at all gets an all-null summary, matching every organization today (LIVE_EXECUTION_ENABLED stays false everywhere)", async () => {
      const owner = await signUpUser();
      const organization = await createOrgForUser(owner);
      const summary = await getExecutionQualitySummary(organization.id);
      expect(summary.totalOrders).toBe(0);
      expect(summary.fillRatePct).toBeNull();
    });
  });

  describe("C. getReconciliationHealth -- pure read of the existing AuditLog trail", () => {
    it("C1: counts clean passes and mismatch types separately, and is tenant-isolated", async () => {
      const ownerA = await signUpUser();
      const orgA = await createOrgForUser(ownerA);
      const ownerB = await signUpUser();
      const orgB = await createOrgForUser(ownerB);

      await recordExecutionAudit({ organizationId: orgA.id, action: "execution.position_reconciled", clientOrderId: orgA.id, symbol: "n/a" });
      await recordExecutionAudit({ organizationId: orgA.id, action: "execution.reconciliation_mismatch", clientOrderId: "co-1", symbol: "BTCUSDT", metadata: { mismatchType: "quantity_mismatch" } });
      await recordExecutionAudit({ organizationId: orgA.id, action: "execution.reconciliation_mismatch", clientOrderId: "co-2", symbol: "BTCUSDT", metadata: { mismatchType: "quantity_mismatch" } });
      await recordExecutionAudit({ organizationId: orgB.id, action: "execution.position_reconciled", clientOrderId: orgB.id, symbol: "n/a" });

      const healthA = await getReconciliationHealth(orgA.id);
      const healthB = await getReconciliationHealth(orgB.id);

      expect(healthA.cleanPasses).toBe(1);
      expect(healthA.mismatchCountsByType).toEqual({ quantity_mismatch: 2 });
      expect(healthA.lastReconciledAt).not.toBeNull();

      expect(healthB.cleanPasses).toBe(1);
      expect(healthB.mismatchCountsByType).toEqual({});
    });

    it("C2: an organization that has never been reconciled gets an empty, honest summary -- never fabricated", async () => {
      const owner = await signUpUser();
      const organization = await createOrgForUser(owner);
      const health = await getReconciliationHealth(organization.id);
      expect(health.cleanPasses).toBe(0);
      expect(health.mismatchCountsByType).toEqual({});
      expect(health.lastReconciledAt).toBeNull();
    });
  });

  describe("D. get_execution_health AI tool -- read-only, broadly available, never touches a real exchange", () => {
    it("D1: is registered, market-domain, read_only, and non-autonomy-eligible, like every other market-domain tool", () => {
      const marketTools = listRegisteredTools().filter((t) => t.domain === "market");
      expect(marketTools.every((t) => t.mutationCategory === "read_only")).toBe(true);
      expect(marketTools.every((t) => !t.autonomyEligible)).toBe(true);

      const tool = getTool("get_execution_health");
      expect(tool?.domain).toBe("market");
      expect(tool?.mutationCategory).toBe("read_only");
    });

    it("D2: every role including viewer can call it, reusing the same marketIntelligence:read permission get_market_intelligence already gates on", async () => {
      const owner = await signUpUser();
      const organization = await createOrgForUser(owner);
      const viewer = await signUpUser();
      await addMemberDirect(organization.id, viewer, "viewer");
      const conversation = await createConversation({ organizationId: organization.id, userId: viewer.userId });

      const result = await executeToolCall(
        { id: "eh-1", name: "get_execution_health", arguments: {} },
        { organizationId: organization.id, userId: viewer.userId, conversationId: conversation.id },
        authHeaders(viewer.token),
      );
      expect(result.status).toBe("success");
      const payload = result as unknown as { output?: { executionQuality?: { totalOrders?: number }; reconciliationHealth?: { cleanPasses?: number } } };
      expect(payload.output?.executionQuality?.totalOrders).toBe(0);
      expect(payload.output?.reconciliationHealth?.cleanPasses).toBe(0);
    });
  });

  describe("E. AI restriction", () => {
    it("E1: zero diff in src/server/ai/autonomy/ vs main -- Sprint 29 only adds read-only execution-quality/reconciliation-health reads and one new read-only AI tool", () => {
      try {
        execSync("git rev-parse --verify origin/main", { cwd: process.cwd(), stdio: "pipe" });
      } catch {
        execSync("git fetch --depth=1 origin main", { cwd: process.cwd(), stdio: "pipe" });
      }
      const diff = execSync("git diff --stat origin/main -- src/server/ai/autonomy/", { cwd: process.cwd(), encoding: "utf-8" });
      expect(diff.trim()).toBe("");
    });

    it("E2: getReconciliationHealth never imports reconciliation.ts's own reconcile() -- it can only ever read past results, never trigger a live one", () => {
      const grep = execSync('grep -c "from \\"@/server/execution/reconciliation\\"" src/server/execution/reconciliation-health.ts || true', {
        cwd: process.cwd(),
        encoding: "utf-8",
      });
      expect(grep.trim()).toBe("0");
    });
  });
});
