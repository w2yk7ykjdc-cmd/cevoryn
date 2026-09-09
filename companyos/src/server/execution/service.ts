import { getTenantScopedClient } from "@/server/db/tenant";
import { logger } from "@/server/logger/logger";
import type { MarketDecision } from "@/server/intelligence/market-decision/types";
import { buildClientOrderId } from "@/server/execution/idempotency";
import { validateForLiveExecution } from "@/server/execution/validation";
import { recordExecutionAudit } from "@/server/execution/audit";
import { ExecutionUnknownResultError } from "@/server/execution/errors";
import type { RiskLimitCheckInput } from "@/server/execution/risk-limits";
import type { RiskPolicyLimits } from "@/server/execution/risk-policy";
import type { ExecutionGateway, ExecutionOrder, OrderIntent } from "@/server/execution/types";

/**
 * Sprint 22 Phase 6/9/11/12: the single shared entry point EVERY order
 * submission -- paper or live -- goes through. This is the "Decision ->
 * Validation -> Order Plan -> Risk" pipeline Phase 12 requires be shared;
 * the ONLY thing that differs between paper and live is which
 * `ExecutionGateway` is passed in (`createPaperExecutionAdapter(...)` vs
 * `createBinanceExecutionAdapter()`).
 *
 * Persisted lifecycle tracking (`LiveOrder`, idempotency) applies ONLY to
 * `gateway.mode === "LIVE"` -- paper's own existing duplicate-prevention
 * (`decideEntry`'s `already_open` check, Sprint 16) already covers paper,
 * and giving paper a second, parallel `LiveOrder` row per trade would be
 * exactly the "duplicate copy of paper state" every prior sprint's own
 * discipline has avoided.
 */

export type SubmitDecisionResult =
  | { status: "NO_EXECUTION"; reason: string }
  | { status: "SUBMITTED"; order: ExecutionOrder }
  | { status: "PENDING_RECONCILIATION"; clientOrderId: string };

function toIntent(decision: MarketDecision, clientOrderId: string): OrderIntent {
  const order = decision.proposedOrder!;
  return {
    clientOrderId,
    symbol: order.symbol,
    side: order.direction === "LONG" ? "BUY" : "SELL",
    type: "MARKET",
    quantity: order.quantity,
    price: order.entryPrice,
    strategyType: decision.strategyType,
    stopLossPrice: order.stopLossPrice,
    takeProfitPrice: order.takeProfitPrice,
    leverage: order.leverage,
  };
}

/**
 * The full pipeline for ONE decision: idempotency check -> validation
 * (Phase 7, which itself includes Phase 8's risk limits and Phase 9's kill
 * switch) -> submit -> persist -> audit. Every step's outcome is recorded
 * to the immutable audit trail (Phase 14) regardless of whether the
 * overall result is a success, a clean rejection, or an unknown-outcome
 * failure.
 *
 * Deliberately never called from any AI tool or AI-reachable code path
 * (Phase 15) -- see `tests/sprint-22-live-execution.test.ts` Group AC for
 * the direct test that no registered `RegisteredTool` can reach this
 * function.
 */
export async function submitDecision(params: {
  organizationId: string;
  decision: MarketDecision;
  gateway: ExecutionGateway;
  riskContext: Omit<RiskLimitCheckInput, "orderNotional" | "leverage">;
  liveExecutionEnabled?: boolean;
  /** Injectable for tests -- see `validation.ts#validateForLiveExecution`'s own identical seam and doc comment. */
  hasLiveCredentials?: (organizationId: string) => boolean | Promise<boolean>;
  /**
   * Sprint 25: purely additive pass-through to `validateForLiveExecution`'s
   * own identically-named, identically-defaulted parameters -- forwarding
   * this organization's REAL current drawdown/risk policy (as the
   * autonomous orchestrator does) so the portfolio-drawdown/emergency-stop
   * breakers evaluate against real data. Every Sprint 22/23/24 call site
   * that never passes these keeps the exact original defaults (`0` /
   * `getOrganizationRiskPolicy(organizationId)`), so behavior is
   * byte-for-byte unchanged for every existing caller.
   */
  currentDrawdownPct?: number;
  riskPolicy?: RiskPolicyLimits;
}): Promise<SubmitDecisionResult> {
  const { organizationId, decision, gateway, riskContext, liveExecutionEnabled, hasLiveCredentials, currentDrawdownPct, riskPolicy } = params;

  if (!decision.proposedOrder) {
    return { status: "NO_EXECUTION", reason: "no_proposed_order" };
  }

  const clientOrderId = buildClientOrderId({
    organizationId,
    symbol: decision.symbol,
    strategyType: decision.strategyType,
    decisionTimestamp: decision.proposedOrder.decisionTimestamp,
  });

  const scoped = gateway.mode === "LIVE" ? getTenantScopedClient(organizationId) : null;

  if (scoped) {
    const existing = await scoped.liveOrder.findUnique({ where: { organizationId_clientOrderId: { organizationId, clientOrderId } } });
    if (existing) {
      // Phase 6/11: NEVER resubmit for an already-known clientOrderId --
      // whether it's a clean duplicate (already terminal) or an unresolved
      // unknown-result case (still SUBMITTING), the safe action is always
      // "do nothing new," never "try again."
      if (existing.status === "SUBMITTING" || existing.status === "CANCEL_REQUESTED") {
        return { status: "PENDING_RECONCILIATION", clientOrderId };
      }
      return { status: "NO_EXECUTION", reason: "duplicate_client_order_id" };
    }

    await scoped.liveOrder.create({
      data: {
        organizationId,
        clientOrderId,
        symbol: decision.proposedOrder.symbol,
        side: decision.proposedOrder.direction === "LONG" ? "BUY" : "SELL",
        type: "MARKET",
        quantity: decision.proposedOrder.quantity,
        price: decision.proposedOrder.entryPrice,
        status: "INTENT",
        strategyType: decision.strategyType,
        decisionSymbol: decision.symbol,
      },
    });
    await recordExecutionAudit({ organizationId, action: "execution.intent_created", clientOrderId, symbol: decision.proposedOrder.symbol, strategyType: decision.strategyType });
  }

  if (scoped) await scoped.liveOrder.update({ where: { organizationId_clientOrderId: { organizationId, clientOrderId } }, data: { status: "VALIDATING" } });

  const validation = await validateForLiveExecution({ organizationId, decision, gateway, riskContext, liveExecutionEnabled, hasLiveCredentials, currentDrawdownPct, riskPolicy });
  if (validation.status === "NO_EXECUTION") {
    if (scoped) {
      await scoped.liveOrder.update({
        where: { organizationId_clientOrderId: { organizationId, clientOrderId } },
        data: { status: "REJECTED", rejectionReason: validation.reason },
      });
    }
    await recordExecutionAudit({ organizationId, action: "execution.validation_rejected", clientOrderId, symbol: decision.proposedOrder.symbol, rejectionReason: validation.reason });
    return { status: "NO_EXECUTION", reason: validation.reason };
  }
  await recordExecutionAudit({ organizationId, action: "execution.validation_passed", clientOrderId, symbol: decision.proposedOrder.symbol, validationResult: "VALID" });

  if (scoped) await scoped.liveOrder.update({ where: { organizationId_clientOrderId: { organizationId, clientOrderId } }, data: { status: "SUBMITTING" } });

  const intent = toIntent(decision, clientOrderId);

  try {
    const order = await gateway.submitOrder(intent);
    if (scoped) {
      await scoped.liveOrder.update({
        where: { organizationId_clientOrderId: { organizationId, clientOrderId } },
        data: {
          status: order.status,
          providerOrderId: order.providerOrderId,
          submittedAt: new Date(),
          // Sprint 24 Phase 7: persist the REAL fill state the gateway
          // already returned at submission time (a MARKET order is often
          // filled immediately) -- previously discarded entirely.
          filledQuantity: order.filledQuantity,
          averageFillPrice: order.averageFillPrice,
          filledAt: order.status === "FILLED" ? new Date() : null,
        },
      });
    }
    await recordExecutionAudit({
      organizationId,
      action: "execution.order_submitted",
      clientOrderId,
      symbol: decision.proposedOrder.symbol,
      providerOrderId: order.providerOrderId,
      executionResult: order.status,
    });
    return { status: "SUBMITTED", order };
  } catch (err) {
    if (err instanceof ExecutionUnknownResultError) {
      // Row is left at SUBMITTING -- the next call for this SAME
      // clientOrderId hits the `PENDING_RECONCILIATION` branch above,
      // never a second `gateway.submitOrder` call.
      logger.error({ organizationId, clientOrderId, err }, "execution: unknown submission result, requires reconciliation before any further action");
      await recordExecutionAudit({ organizationId, action: "execution.order_failed", clientOrderId, symbol: decision.proposedOrder.symbol, rejectionReason: "unknown_result_pending_reconciliation" });
      return { status: "PENDING_RECONCILIATION", clientOrderId };
    }

    const message = err instanceof Error ? err.message : String(err);
    if (scoped) {
      await scoped.liveOrder.update({
        where: { organizationId_clientOrderId: { organizationId, clientOrderId } },
        data: { status: "FAILED", rejectionReason: message },
      });
    }
    await recordExecutionAudit({ organizationId, action: "execution.order_failed", clientOrderId, symbol: decision.proposedOrder.symbol, rejectionReason: message });
    return { status: "NO_EXECUTION", reason: "provider_error" };
  }
}
