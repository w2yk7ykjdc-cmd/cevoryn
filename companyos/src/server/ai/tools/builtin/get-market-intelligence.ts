import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { getMarketIntelligenceRanking } from "@/server/intelligence/market-intelligence/service";
import { generateMarketDecisions } from "@/server/intelligence/market-decision/service";

const schema = z.object({});

/**
 * Read-only. Surfaces already-computed, already-persisted market
 * Opportunity/Risk/regime/strategy data -- never decides anything, never
 * itself a trading recommendation, never generates an executable trading
 * instruction. Like `get_decision_performance`/`rank_decision_candidates`
 * (Sprint 12), this deliberately does NOT write an `AuditLog` entry on
 * every call -- pure read, no state change.
 *
 * Sprint 19 extends this SAME tool (Phase 12's own "gereksiz yeni tool
 * oluşturma" -- extend, don't duplicate) with `decisions`: the
 * deterministic BUY/SELL/HOLD/NO_TRADE Decision Engine output, each with
 * its execution-readiness `proposedOrder` (VALID/REJECTED and why) --
 * still never itself capable of executing anything, still requires
 * `paperTrading: ["read"]` in addition to the existing `marketIntelligence:
 * ["read"]` (the same two-permission pattern the dashboard page already
 * uses), since a decision's proposed order draws on `PaperAccount` state.
 */
registerTool({
  name: "get_market_intelligence",
  description:
    "Get this organization's current market intelligence: the overall market regime (trending/ranging/" +
    "high_volatility/low_volatility/uncertain), every currently-eligible market Opportunity ranked by a " +
    "deterministic, explainable composite score (momentum, trend, volume confirmation, relative strength vs. " +
    "BTC, minus volatility/risk penalties), each with plain-language reasons and any co-occurring market Risk, " +
    "and (Sprint 15) every deterministic strategy candidate -- TREND_FOLLOWING, MOMENTUM_CONTINUATION, " +
    "RANGE_MEAN_REVERSION, or an explicit NO_TRADE conclusion with its reason -- including thesis, supporting " +
    "and contradicting signals, entry conditions, and invalidation conditions. Also (Sprint 19) `decisions`: a " +
    "deterministic BUY/SELL/HOLD/NO_TRADE call per symbol combining current market evidence, the strategy " +
    "candidate, its historical Strategy Evaluation (evidence quality, evaluation score), and co-occurring risk -- " +
    "each with a `proposedOrder` (entry, quantity, leverage, stop, take-profit, liquidation price, risk) marked " +
    "VALID or REJECTED with a specific deterministic reason (stale_data, insufficient_evidence, " +
    "unacceptable_risk, exposure_limit, drawdown_limit, liquidation_risk, insufficient_margin, " +
    "conflicting_signal, no_trade, invalid_quantity/price/stop, expired_decision) when checks fail, or `null` " +
    "when the kill switch is engaged or the decision is HOLD/NO_TRADE with no direction to propose. " +
    "PAPER/SIMULATION ONLY -- NOT REAL EXECUTION: no order is ever sent anywhere from this data, no dollar " +
    "amount, ROI, or profit figure is ever computed or implied. All figures come from real Binance public " +
    "market data via deterministic rules -- never an LLM judgment, never a guarantee of profit. No order " +
    "execution, no account access, no financial capability of any kind exists anywhere in this pipeline.",
  schema,
  requiredPermission: { marketIntelligence: ["read"], paperTrading: ["read"] },
  domain: "market",
  mutationCategory: "read_only",
  async handler(_input, ctx) {
    const [snapshot, decisions] = await Promise.all([
      getMarketIntelligenceRanking(ctx.organizationId),
      generateMarketDecisions(ctx.organizationId),
    ]);
    return { ...snapshot, decisions };
  },
});
