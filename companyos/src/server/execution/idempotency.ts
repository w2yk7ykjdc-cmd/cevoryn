import { createHash } from "node:crypto";

/**
 * Sprint 22 Phase 6: a deterministic `clientOrderId` -- the SAME
 * `(organizationId, symbol, strategyType, decisionTimestamp)` tuple always
 * produces the SAME id, so re-evaluating and re-submitting the identical
 * decision (a retried job, a duplicated event delivery, a process restart
 * mid-submission -- Phase 11's own explicit scenarios) can never create a
 * second real order: `execution/service.ts#submitDecision` looks up this
 * id in `LiveOrder` BEFORE calling the gateway, and the gateway's own
 * `submitOrder` is itself required to be idempotent on it too (defense in
 * depth, see `types.ts#OrderWriteCapability`'s own doc comment).
 *
 * `decisionTimestamp` is `MarketDecision.proposedOrder.decisionTimestamp`
 * (Sprint 19, ISO string, unique per decision-generation pass) -- NOT
 * `Date.now()` at submission time, which would make two submission
 * attempts for the exact same decision produce two different ids and
 * defeat the entire point of this function.
 *
 * A plain SHA-256 hex digest, truncated to 32 characters -- well inside
 * Binance's own `newClientOrderId` length limit (36 chars), and long
 * enough that a collision between two genuinely different decisions is not
 * a practical concern.
 */
export function buildClientOrderId(params: {
  organizationId: string;
  symbol: string;
  strategyType: string;
  decisionTimestamp: string;
}): string {
  const { organizationId, symbol, strategyType, decisionTimestamp } = params;
  const raw = `${organizationId}:${symbol}:${strategyType}:${decisionTimestamp}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}
