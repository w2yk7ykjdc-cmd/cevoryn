import type { OutcomeType } from "@prisma/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { applyEvaluation, createPendingOutcomeIfMissing, findDueOutcomes, markInsufficientEvidence } from "@/server/intelligence/outcome/service";

export const RULE_NAME = "paper_trade_result";
export const RULE_VERSION = "v1";

/**
 * Fallback `Outcome.confidence` for a trade that predates this sprint's
 * `candidateScore`/`candidateConfidence` snapshot columns (so has no real
 * strategy confidence to report). For every trade that DOES carry a
 * snapshot, the outcome's confidence is the STRATEGY CANDIDATE's own
 * predicted confidence at entry (`trade.candidateConfidence`), never this
 * constant -- Sprint 17 Phase 8 exists specifically to measure "when the
 * strategy said confidence 90, how often was it actually right," which is
 * only answerable if `Outcome.confidence` carries the strategy's own
 * predicted confidence, not a fixed system value. Every evaluation this
 * rule produces still reads only deterministic database state -- no LLM,
 * no guessing (Phase 2's own explicit mandate).
 */
const SYSTEM_CONFIDENCE = 90;

/**
 * Return-on-margin thresholds for classifying a closed `PaperTrade`
 * (Sprint 17 Phase 2). Deliberately NOT keyed off `closeReason` alone —
 * "a stop-loss close is not automatically 'strategy failed', a
 * take-profit close is not automatically 'strategy quality proof'"
 * (Phase 2's own explicit instruction) — every close reason is measured by
 * its actual realized `returnPct` (return on margin, matching
 * `PaperTrade.returnPct`'s own Sprint 16 definition), never assumed from
 * the reason it closed. `LIQUIDATED` is the one deliberate exception: a
 * liquidation is, by construction, always a real and severe loss, so it is
 * classified `failure` directly and additionally flagged
 * `wasLiquidated: true` in evidence so it can always be reported
 * separately (Phase 2's "liquidation durumunu ayrı ve açık şekilde
 * raporla").
 */
const SUCCESS_RETURN_THRESHOLD = 0.01;
const FAILURE_RETURN_THRESHOLD = -0.01;
/** |returnPct| below this is "effectively flat" -- used only for the INVALIDATED -> expired case below. */
const NEUTRAL_BAND = 0.01;

export type PaperTradeResultRunResult = {
  discovered: number;
  evaluated: number;
  insufficientEvidence: number;
};

/**
 * Bridges a closed Sprint 16 `PaperTrade` into the existing Sprint 11
 * Outcome/Learning infrastructure (Sprint 17 Phase 1) — reuses
 * `createPendingOutcomeIfMissing`/`findDueOutcomes`/`applyEvaluation`/
 * `markInsufficientEvidence` verbatim, the exact same generic
 * `relatedEntityType`/`relatedEntityId` soft-reference shape
 * `opportunity-state-progression.ts` already established. No new Outcome
 * schema, no new job, no new queue: this rule is simply added to
 * `evaluate-outcomes.ts`'s existing `rules` array, which already runs
 * hourly.
 *
 * Unlike the CRM rules, a paper trade's result is fully known the INSTANT
 * it closes (`PaperTrade.netPnl`/`.returnPct` are already final at close)
 * -- there is no waiting period to observe. So `observationDueAt` is set
 * to `closedAt` itself: the pending row is immediately due, and discovery
 * + evaluation effectively happen in the same pass. This directly
 * implements Phase 1's own "Open position = pending outcome (no Outcome
 * row exists at all while OPEN). Closed position = evaluatable outcome" --
 * a trade's outcome is never judged before it closes, and is judged
 * exactly once, deterministically, the moment it does.
 */
export async function runPaperTradeResult(organizationId: string): Promise<PaperTradeResultRunResult> {
  const discovered = await discoverPending(organizationId);
  const { evaluated, insufficientEvidence } = await evaluateDue(organizationId);
  return { discovered, evaluated, insufficientEvidence };
}

async function discoverPending(organizationId: string): Promise<number> {
  const scoped = getTenantScopedClient(organizationId);
  const trades = await scoped.paperTrade.findMany({
    select: { id: true, closedAt: true, strategySignalId: true, symbol: true },
  });

  let discovered = 0;
  for (const trade of trades) {
    const result = await createPendingOutcomeIfMissing({
      organizationId,
      relatedEntityType: "PaperTrade",
      relatedEntityId: trade.id,
      ruleName: RULE_NAME,
      ruleVersion: RULE_VERSION,
      // Soft-references the originating Sprint 15 strategy-candidate
      // CompanySignal, when known -- purely informational, never re-read
      // live (see `PaperPosition.candidateScore`'s own doc comment).
      signalId: trade.strategySignalId ?? undefined,
      observationDueAt: trade.closedAt,
      evidence: { symbol: trade.symbol },
    });
    if (result.created) discovered += 1;
  }
  return discovered;
}

async function evaluateDue(organizationId: string): Promise<{ evaluated: number; insufficientEvidence: number }> {
  const scoped = getTenantScopedClient(organizationId);
  const due = await findDueOutcomes(organizationId, RULE_NAME, RULE_VERSION);

  let evaluated = 0;
  let insufficientEvidence = 0;

  for (const outcome of due) {
    const trade = await scoped.paperTrade.findFirst({ where: { id: outcome.relatedEntityId } });
    if (!trade) {
      await markInsufficientEvidence({
        organizationId,
        outcomeId: outcome.id,
        evidence: { reason: "referenced paper trade no longer exists" },
      });
      insufficientEvidence += 1;
      continue;
    }

    const initialMargin = Number(trade.initialMargin);
    const returnPct = Number(trade.returnPct);
    const maxFavorableExcursionPct = initialMargin > 0 ? Number(trade.maxFavorableExcursion) / initialMargin : 0;

    const { outcomeType, classificationReason } = classifyPaperTradeResult({
      closeReason: trade.closeReason,
      returnPct,
      maxFavorableExcursionPct,
    });

    // Expected-vs-observed learning snapshot (Sprint 17 Phase 3) -- only
    // when this trade actually captured a candidateScore at entry time
    // (Sprint 16 positions predating this sprint never did). Both sides
    // stay on the SAME dimensionless [0,100] scale the strategy engine
    // already uses for `score` -- never a fabricated dollar expectation
    // (Phase 3's own explicit "RiskUnit / normalized score gibi boyutsuz
    // değerleri gerçek dolar beklentisi gibi gösterme").
    let expectedValue: number | undefined;
    let observedValue: number | undefined;
    if (trade.candidateScore !== null) {
      expectedValue = trade.candidateScore;
      observedValue = observedPerformanceScore(returnPct);
    }

    await applyEvaluation({
      outcomeId: outcome.id,
      organizationId,
      outcomeType,
      confidence: trade.candidateConfidence ?? SYSTEM_CONFIDENCE,
      evidence: {
        symbol: trade.symbol,
        strategyType: trade.strategyType,
        direction: trade.direction,
        mode: trade.mode,
        leverage: trade.leverage,
        closeReason: trade.closeReason,
        wasLiquidated: trade.closeReason === "LIQUIDATED",
        entryPrice: Number(trade.entryPrice),
        exitPrice: Number(trade.exitPrice),
        netPnl: Number(trade.netPnl),
        returnPct,
        feesPaid: Number(trade.feesPaid),
        fundingPaid: Number(trade.fundingPaid),
        holdingDurationMs: trade.closedAt.getTime() - trade.openedAt.getTime(),
        regime: trade.regime,
        candidateScore: trade.candidateScore,
        candidateConfidence: trade.candidateConfidence,
        classificationReason,
      },
      expectedValue,
      observedValue,
    });
    evaluated += 1;
  }

  return { evaluated, insufficientEvidence };
}

function classifyPaperTradeResult(input: {
  closeReason: string;
  returnPct: number;
  maxFavorableExcursionPct: number;
}): { outcomeType: OutcomeType; classificationReason: string } {
  const { closeReason, returnPct, maxFavorableExcursionPct } = input;

  if (closeReason === "LIQUIDATED") {
    return { outcomeType: "failure", classificationReason: "liquidation is always a real, severe loss by construction" };
  }

  if (closeReason === "INVALIDATED" && Math.abs(returnPct) < NEUTRAL_BAND) {
    return { outcomeType: "expired", classificationReason: "strategy thesis window closed without a meaningful directional resolution" };
  }

  const wasWinningAtSomePoint = maxFavorableExcursionPct >= SUCCESS_RETURN_THRESHOLD;
  if (wasWinningAtSomePoint && returnPct <= FAILURE_RETURN_THRESHOLD) {
    return { outcomeType: "reversed", classificationReason: "position held a meaningful unrealized gain before closing at a loss" };
  }

  if (returnPct >= SUCCESS_RETURN_THRESHOLD) {
    return { outcomeType: "success", classificationReason: "return on margin cleared the success threshold" };
  }

  if (returnPct <= FAILURE_RETURN_THRESHOLD) {
    return { outcomeType: "failure", classificationReason: "return on margin cleared the failure threshold" };
  }

  return { outcomeType: "neutral", classificationReason: "return on margin stayed within the neutral band" };
}

const OBSERVED_SCORE_MIDPOINT = 50;
/** Each 1 percentage point of return-on-margin moves the observed score 5 points, symmetric around the midpoint -- a documented, deterministic, dimensionless mapping, never a dollar figure. */
const OBSERVED_SCORE_RETURN_SCALE = 5;

function observedPerformanceScore(returnPct: number): number {
  const raw = OBSERVED_SCORE_MIDPOINT + returnPct * 100 * OBSERVED_SCORE_RETURN_SCALE;
  return Math.max(0, Math.min(100, Math.round(raw)));
}
