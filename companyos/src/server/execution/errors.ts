/**
 * Sprint 22's own error taxonomy for the LIVE execution path -- deliberately
 * separate from `market-data/types.ts`'s `MarketData*Error` classes (public,
 * read-only, no write-safety concerns) because execution has a category
 * those never needed: an outcome that is genuinely UNKNOWN (Phase 11) --
 * a write request (submit/cancel) that failed to return a clean response
 * but may have already been processed by the provider. Every failure-
 * handling code path in this module must be able to tell "definitely did
 * not happen" (safe to retry) apart from "might have happened" (must
 * reconcile before doing anything else) -- collapsing the two into one
 * generic error class would make that impossible.
 */

export class ExecutionAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionAuthError";
  }
}

export class ExecutionRateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ExecutionRateLimitError";
  }
}

export class ExecutionProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ExecutionProviderError";
  }
}

/** A READ request timed out or failed at the network layer -- nothing was written, always safe to retry. */
export class ExecutionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionTimeoutError";
  }
}

/**
 * A WRITE request (submit/cancel) timed out, was network-interrupted, or
 * received a 5xx AFTER the request left this process -- the provider may
 * or may not have processed it. NEVER treat this the same as a clean
 * rejection: the caller (`execution/service.ts`) MUST reconcile (look the
 * order up by `clientOrderId`) before concluding anything, and MUST NEVER
 * automatically resubmit without first doing that lookup (Phase 11's own
 * explicit "UNKNOWN sonucu otomatik olarak FAILED kabul etme. Önce
 * reconciliation/order-status lookup.").
 */
export class ExecutionUnknownResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionUnknownResultError";
  }
}
