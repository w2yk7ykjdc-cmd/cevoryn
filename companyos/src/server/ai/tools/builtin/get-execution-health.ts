import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { getExecutionQualitySummary } from "@/server/execution/execution-quality";
import { getReconciliationHealth } from "@/server/execution/reconciliation-health";

const schema = z.object({});

/**
 * Sprint 29: read-only. Surfaces LIVE-execution-only health -- order
 * fill rate, slippage, time-to-fill (from real, already-persisted
 * `LiveOrder` rows), and recent reconciliation history (from the existing
 * `AuditLog` trail `position-management.ts` already writes) -- reusing the
 * same `marketIntelligence: ["read"]` permission `get_market_intelligence`
 * already gates on, held by every role including viewer. Deliberately
 * separate from `get_strategy_performance` (PAPER/SIMULATION-only) rather
 * than blending live and paper data into one tool -- the exact same
 * distinction `portfolio-risk.ts#computePortfolioSnapshot`'s own doc
 * comment already establishes. Every organization today will see an
 * all-null/zero summary: `LIVE_EXECUTION_ENABLED` stays `false` in every
 * existing deployment, so no organization has ever had a real live order --
 * this tool never fabricates activity that hasn't happened. This tool
 * cannot submit, cancel, or reconcile an order, touch a credential, or
 * reach a real exchange -- both underlying reads are pure, tenant-scoped
 * database aggregations over rows that already exist.
 */
registerTool({
  name: "get_execution_health",
  description:
    "Get this organization's real-money (non-simulated) execution health -- deliberately separate from " +
    "get_strategy_performance, which is PAPER/SIMULATION-only. Returns executionQuality (the total count of every " +
    "real-money order this organization has ever had submitted, how many FILLED/PARTIALLY_FILLED/REJECTED/FAILED/" +
    "CANCELLED, the fill rate percentage, average slippage in basis points between the intended and actual fill " +
    "price, and average time from submission to first fill) and reconciliationHealth (how many of the most recent " +
    "automated reconciliation passes were clean vs. found a mismatch, a breakdown of mismatch types seen, and when " +
    "this organization was last reconciled). All figures are deterministic aggregations over already-persisted " +
    "order-tracking and audit-log rows -- never a call to a real exchange, never an estimate. Every organization " +
    "with no real-money trading history (the default -- real-money execution stays disabled deployment-wide unless " +
    "an operator explicitly enables it) will see an all-null/zero result here, never fabricated activity. This " +
    "tool is strictly read-only: it has no way to submit, cancel, or reconcile anything, touch a credential, or " +
    "reach a real exchange.",
  schema,
  requiredPermission: { marketIntelligence: ["read"] },
  domain: "market",
  mutationCategory: "read_only",
  async handler(_input, ctx) {
    const [executionQuality, reconciliationHealth] = await Promise.all([
      getExecutionQualitySummary(ctx.organizationId),
      getReconciliationHealth(ctx.organizationId),
    ]);
    return { executionQuality, reconciliationHealth };
  },
});
