import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { getMarketIntelligenceRanking } from "@/server/intelligence/market-intelligence/service";

const schema = z.object({});

/**
 * Read-only. Surfaces already-computed, already-persisted market
 * Opportunity/Risk/regime/strategy data -- never decides anything, never
 * itself a trading recommendation, never generates an executable trading
 * instruction. Like `get_decision_performance`/`rank_decision_candidates`
 * (Sprint 12), this deliberately does NOT write an `AuditLog` entry on
 * every call -- pure read, no state change.
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
    "and contradicting signals, entry conditions, and invalidation conditions. Strategy candidates are " +
    "explicitly hypothetical: no dollar amount, ROI, or profit figure is ever computed or implied, and no order " +
    "can ever be placed from this data. All figures come from real Binance public market data via deterministic " +
    "rules -- never an LLM judgment, never a trading signal, never a guarantee of profit. No order execution, " +
    "no account access, no financial capability of any kind exists anywhere in this pipeline.",
  schema,
  requiredPermission: { marketIntelligence: ["read"] },
  domain: "market",
  mutationCategory: "read_only",
  async handler(_input, ctx) {
    return getMarketIntelligenceRanking(ctx.organizationId);
  },
});
