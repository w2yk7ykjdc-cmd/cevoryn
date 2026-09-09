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
import { getStrategyEvaluations } from "@/server/intelligence/strategy-evaluation/service";
import { getMostRecentBacktestComparisons } from "@/server/intelligence/backtest/comparison";

const schema = z.object({});

/**
 * Read-only. Sprint 17 Phase 11 (extended by Sprint 18 Phase 14, and again
 * by Sprint 21, per the same repeated, explicit "gereksiz yeni tool
 * oluşturma" -- extend, don't duplicate): surfaces already-computed,
 * deterministic PAPER/SIMULATION performance AND evaluation measurements
 * over closed `PaperTrade` rows -- never a live computation the LLM could
 * influence, never a recommendation, never capable of changing
 * `AutonomyPolicy`, an allowlist, a risk limit, or any `StrategyCandidate`
 * score. Reuses the existing `paperTrading: ["read"]` permission (no new
 * RBAC resource needed for this tool's own gate -- the new `backtest:
 * ["read", "run"]` resource this sprint adds is enforced at the run-service/
 * UI layer instead, where a run is actually launched). Like
 * `get_market_intelligence`/`get_paper_trading`, this deliberately does
 * NOT write an `AuditLog` entry on every call -- pure read, no state
 * change.
 */
registerTool({
  name: "get_strategy_performance",
  description:
    "Get this organization's PAPER/SIMULATION-ONLY historical strategy performance AND deterministic strategy " +
    "evaluation: overall and per-strategy-type (TREND_FOLLOWING/MOMENTUM_CONTINUATION/RANGE_MEAN_REVERSION) win " +
    "rate, loss rate, average/median return, total realized P&L, best/worst trade, average holding duration, " +
    "liquidation/stop-loss/take-profit/invalidation counts, total fees and funding paid, performance broken out by " +
    "market regime/symbol/direction/leverage tier, and paper-trading-scoped confidence calibration. Additionally " +
    "(Sprint 18), a bounded [0,100] evaluationScore per strategy type with its full explainable breakdown, an " +
    "evidenceQuality label (insufficient/limited/moderate/strong -- a strategy is NEVER reported as proven from a " +
    "handful of trades), a zero-variance-safe risk-adjusted (Sharpe-like) return, max drawdown (peak-to-trough of " +
    "the strategy's own reconstructed P&L sequence, never confused with account-level drawdown), regime/symbol/" +
    "direction/leverage robustness (does it only work in one condition, on one coin, in one direction, at one " +
    "leverage?), temporal robustness (recent vs. older performance, with no look-ahead), and a failure-reason " +
    "breakdown restricted to categories with real evidence behind them (liquidation, stop_loss, invalidated, " +
    "regime_mismatch, low_confidence_entry, or an honest unclassified -- never a fabricated reason like 'excessive " +
    "volatility' with no real evidence behind it). A strategy type with fewer than the minimum evaluated-trade " +
    "threshold is reported as insufficient_evidence -- no score, no evaluation, no fabricated verdict. Additionally " +
    "(Sprint 21), a backtestComparison field: this organization's most recently COMPLETED historical BACKTEST/" +
    "SIMULATION run (if any), and for every strategy type that run covers, a side-by-side BACKTEST vs. LIVE/PAPER " +
    "comparison (sample size, win rate, average return, total P&L, risk-adjusted return, max drawdown) -- the two " +
    "sides are never averaged or blended, always two clearly labeled columns; a backtest result never changes " +
    "live ranking or evaluation. All figures are deterministic database aggregations over already-closed simulated " +
    "trades or replayed historical data -- never an LLM computation, never investment advice, never a guarantee " +
    "of future results, never real-money performance. This data can inform ranking as a bounded supporting signal " +
    "but can never itself change any policy, allowlist, risk limit, or autonomy level. No real Binance account, " +
    "credential, or order exists anywhere in this pipeline.",
  schema,
  requiredPermission: { paperTrading: ["read"] },
  domain: "market",
  mutationCategory: "read_only",
  async handler(_input, ctx) {
    const [overall, byStrategyType, byRegime, bySymbol, byDirection, byLeverageTier, confidenceCalibration, evaluations, backtestComparison] = await Promise.all([
      getStrategyPerformanceOverall(ctx.organizationId),
      getStrategyTypePerformance(ctx.organizationId),
      getRegimePerformance(ctx.organizationId),
      getSymbolPerformance(ctx.organizationId),
      getDirectionPerformance(ctx.organizationId),
      getLeverageTierPerformance(ctx.organizationId),
      getPaperTradeConfidenceCalibration(ctx.organizationId),
      getStrategyEvaluations(ctx.organizationId),
      getMostRecentBacktestComparisons(ctx.organizationId),
    ]);
    return { overall, byStrategyType, byRegime, bySymbol, byDirection, byLeverageTier, confidenceCalibration, evaluations, backtestComparison };
  },
});
