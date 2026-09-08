import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import {
  getDirectionPerformance,
  getLeverageTierPerformance,
  getPaperTradeConfidenceCalibration,
  getRegimePerformance,
  getStrategyPerformanceOverall,
  getStrategyTypePerformance,
  getSymbolPerformance,
} from "@/server/intelligence/strategy-performance/service";

const schema = z.object({});

/**
 * Read-only. Sprint 17 Phase 11: surfaces already-computed, deterministic
 * PAPER/SIMULATION performance measurements over closed `PaperTrade` rows --
 * never a live computation the LLM could influence, never a recommendation,
 * never capable of changing `AutonomyPolicy`, an allowlist, a risk limit, or
 * any `StrategyCandidate` score. Reuses the existing `paperTrading: ["read"]`
 * permission (no new RBAC resource -- this is the same data domain
 * `get_paper_trading` already reads, just aggregated over history instead of
 * current state). Like `get_market_intelligence`/`get_paper_trading`, this
 * deliberately does NOT write an `AuditLog` entry on every call -- pure
 * read, no state change.
 */
registerTool({
  name: "get_strategy_performance",
  description:
    "Get this organization's PAPER/SIMULATION-ONLY historical strategy performance: overall and per-strategy-type " +
    "(TREND_FOLLOWING/MOMENTUM_CONTINUATION/RANGE_MEAN_REVERSION) win rate, loss rate, average/median return, " +
    "total realized P&L, best/worst trade, average holding duration, liquidation/stop-loss/take-profit/invalidation " +
    "counts, total fees and funding paid -- plus performance broken out by market regime, by symbol, by LONG vs. " +
    "SHORT direction, by leverage tier, and paper-trading-scoped confidence calibration (how often a given " +
    "confidence bucket's trades actually succeeded). All figures are deterministic database aggregations over " +
    "already-closed simulated trades -- never an LLM computation, never investment advice, never a guarantee of " +
    "future results. A strategy type or bucket with too few evaluated trades is reported with its real sample " +
    "size rather than a fabricated conclusion. This data can inform ranking as a bounded supporting signal but " +
    "can never itself change any policy, allowlist, risk limit, or autonomy level. No real Binance account, " +
    "credential, or order exists anywhere in this pipeline.",
  schema,
  requiredPermission: { paperTrading: ["read"] },
  domain: "market",
  mutationCategory: "read_only",
  async handler(_input, ctx) {
    const [overall, byStrategyType, byRegime, bySymbol, byDirection, byLeverageTier, confidenceCalibration] = await Promise.all([
      getStrategyPerformanceOverall(ctx.organizationId),
      getStrategyTypePerformance(ctx.organizationId),
      getRegimePerformance(ctx.organizationId),
      getSymbolPerformance(ctx.organizationId),
      getDirectionPerformance(ctx.organizationId),
      getLeverageTierPerformance(ctx.organizationId),
      getPaperTradeConfidenceCalibration(ctx.organizationId),
    ]);
    return { overall, byStrategyType, byRegime, bySymbol, byDirection, byLeverageTier, confidenceCalibration };
  },
});
