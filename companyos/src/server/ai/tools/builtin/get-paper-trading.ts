import { z } from "zod";
import { registerTool } from "@/server/ai/tools/registry";
import { getPaperTradingSnapshot } from "@/server/intelligence/paper-trading/service";

const schema = z.object({});

/**
 * Read-only. Surfaces already-computed, already-persisted PAPER/SIMULATION
 * results -- never decides anything, never itself capable of sending an
 * order. Its own dedicated `paperTrading: ["read"]` permission (distinct
 * from `marketIntelligence: ["read"]`, Sprint 16 Phase 28) keeps this
 * capability independently grantable/revocable from the rest of market
 * intelligence, matching the spec's own suggested RBAC boundary. Like
 * `get_market_intelligence`, this deliberately does NOT write an
 * `AuditLog` entry on every call -- pure read, no state change.
 */
registerTool({
  name: "get_paper_trading",
  description:
    "Get this organization's PAPER/SIMULATION-ONLY trading results: the virtual paper account (starting/current/peak " +
    "equity, used and available margin, unrealized/realized P&L, total fees, total funding, drawdown), every " +
    "currently open simulated position (symbol, LONG/SHORT, leverage, entry/current price, stop-loss, take-profit, " +
    "simulated liquidation price, unrealized P&L), and recently closed positions (exit price, realized P&L, fees, " +
    "funding, why it closed). Every position was opened by a deterministic Sprint 15 Strategy Candidate against " +
    "real Binance public market data -- NEVER a prediction of profit, NEVER investment advice. No real Binance " +
    "account, credential, balance, or order exists anywhere in this pipeline: nothing here was or can be sent to " +
    "a real exchange.",
  schema,
  requiredPermission: { paperTrading: ["read"] },
  domain: "market",
  mutationCategory: "read_only",
  async handler(_input, ctx) {
    return getPaperTradingSnapshot(ctx.organizationId);
  },
});
