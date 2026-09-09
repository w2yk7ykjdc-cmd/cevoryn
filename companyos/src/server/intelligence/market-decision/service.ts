import { env } from "@/env";
import { getTenantScopedClient } from "@/server/db/tenant";
import { isKillSwitchEngaged } from "@/server/ai/autonomy/policy-service";
import { METRICS_SNAPSHOT_RULE_NAME, METRICS_SNAPSHOT_RULE_VERSION } from "@/server/intelligence/signals/market-scanner";
import type { MarketMetricsSnapshotPayload, StrategyCandidate } from "@/server/intelligence/strategy/types";
import { getOrCreatePaperAccount, type PaperAccountView } from "@/server/intelligence/paper-trading/account";
import { buildEntryPlan, computeSimulatedLiquidationPrice } from "@/server/intelligence/paper-trading/sizing";
import {
  LIQUIDATION_SAFETY_MARGIN,
  MAX_SIMULTANEOUS_POSITIONS,
  MAX_TOTAL_EXPOSURE_MULTIPLE,
  RISK_PER_TRADE_PCT,
  STALE_DATA_MAX_AGE_MS,
} from "@/server/intelligence/paper-trading/constants";
import { getMarketIntelligenceRanking } from "@/server/intelligence/market-intelligence/service";
import { getStrategyEvaluations } from "@/server/intelligence/strategy-evaluation/service";
import type { StrategyEvaluation } from "@/server/intelligence/strategy-evaluation/types";
import {
  CONFLICTING_HIGH_OPPORTUNITY_SCORE_MIN,
  CONFLICTING_LOW_EVALUATION_SCORE_MAX,
  DECISION_VALIDITY_MS,
  EXECUTION_UNACCEPTABLE_RISK_SEVERITIES,
  MAX_ACCOUNT_DRAWDOWN_PCT_FOR_ENTRY,
} from "@/server/intelligence/market-decision/constants";
import type { EvidenceQuality, MarketDecision, MarketDecisionAction, OrderRejectReason, OrderValidationStatus, ProposedOrder } from "@/server/intelligence/market-decision/types";

type RiskSeverity = "low" | "medium" | "high" | "critical" | "none";

type BaseOrderFields = Omit<ProposedOrder, "validationStatus" | "rejectReason">;

/**
 * Sprint 19 Phase 5's deterministic Order Validation, checked in a fixed
 * order (first failure wins, matching `paper-trading/entry.ts#decideEntry`'s
 * own established style) so the same inputs always produce the same
 * verdict. Every threshold reused here is imported, never redefined:
 * `STALE_DATA_MAX_AGE_MS`/`MAX_TOTAL_EXPOSURE_MULTIPLE`/
 * `MAX_SIMULTANEOUS_POSITIONS`/`LIQUIDATION_SAFETY_MARGIN` all come
 * straight from Sprint 16's own `paper-trading/constants.ts`.
 */
export function validateProposedOrder(input: {
  order: BaseOrderFields;
  decisionTimestampMs: number;
  metrics: MarketMetricsSnapshotPayload;
  riskSeverity: RiskSeverity;
  evidenceQuality: EvidenceQuality;
  opportunityScore: number | null;
  evaluationScore: number | null;
  account: PaperAccountView;
  openPositionCount: number;
  existingOpenNotional: number;
  now: number;
}): { status: OrderValidationStatus; reason: OrderRejectReason | null } {
  const { order, decisionTimestampMs, metrics, riskSeverity, evidenceQuality, opportunityScore, evaluationScore, account, openPositionCount, existingOpenNotional, now } = input;
  const reject = (reason: OrderRejectReason): { status: OrderValidationStatus; reason: OrderRejectReason } => ({ status: "REJECTED", reason });

  if (now - decisionTimestampMs > DECISION_VALIDITY_MS) return reject("expired_decision");

  if (order.entryPrice <= 0) return reject("invalid_price");
  if (order.quantity <= 0) return reject("invalid_quantity");
  const stopOnWrongSide = order.direction === "LONG" ? order.stopLossPrice >= order.entryPrice : order.stopLossPrice <= order.entryPrice;
  if (stopOnWrongSide) return reject("invalid_stop");

  if (now - new Date(metrics.observedAt).getTime() > STALE_DATA_MAX_AGE_MS) return reject("stale_data");

  // Execution-level risk bar is STRICTER than the strategy layer's own
  // (which only vetoes high/critical) -- see `constants.ts`'s own doc
  // comment for why. `critical` specifically contradicts the directional
  // call outright (`conflicting_signal`); `medium`/`high` are elevated but
  // not an outright contradiction (`unacceptable_risk`).
  if (riskSeverity === "critical") return reject("conflicting_signal");
  if (EXECUTION_UNACCEPTABLE_RISK_SEVERITIES.has(riskSeverity)) return reject("unacceptable_risk");

  if (evidenceQuality === "insufficient") return reject("insufficient_evidence");

  // Current evidence says "clearly good" while this strategy type's own
  // measured historical performance says "clearly bad" -- a genuine,
  // measured conflict between two real data sources, never fabricated.
  if (opportunityScore !== null && evaluationScore !== null && opportunityScore >= CONFLICTING_HIGH_OPPORTUNITY_SCORE_MIN && evaluationScore <= CONFLICTING_LOW_EVALUATION_SCORE_MAX) {
    return reject("conflicting_signal");
  }

  if (order.initialMargin > account.availableMargin) return reject("insufficient_margin");

  const totalExposureAfterEntry = existingOpenNotional + order.notional;
  if (totalExposureAfterEntry > account.currentEquity * MAX_TOTAL_EXPOSURE_MULTIPLE) return reject("exposure_limit");
  if (openPositionCount >= MAX_SIMULTANEOUS_POSITIONS) return reject("exposure_limit");

  if (account.drawdownPct * 100 >= MAX_ACCOUNT_DRAWDOWN_PCT_FOR_ENTRY) return reject("drawdown_limit");

  // Defensive re-check of `selectSafeLeverage`'s own invariant (Sprint 16
  // already guarantees this holds for any plan `buildEntryPlan` produces,
  // but Sprint 19's execution-readiness layer verifies it independently
  // rather than merely trusting the upstream guarantee silently).
  if (order.leverage > 1) {
    const liquidationPrice = computeSimulatedLiquidationPrice(order.entryPrice, order.leverage, order.direction);
    const stopDistancePct = Math.abs(order.entryPrice - order.stopLossPrice) / order.entryPrice;
    const liquidationDistancePct = liquidationPrice !== null ? Math.abs(order.entryPrice - liquidationPrice) / order.entryPrice : Infinity;
    if (liquidationDistancePct < stopDistancePct * LIQUIDATION_SAFETY_MARGIN) return reject("liquidation_risk");
  }

  return { status: "VALID", reason: null };
}

export type DecisionContext = {
  candidate: StrategyCandidate;
  metrics: MarketMetricsSnapshotPayload | null;
  riskSeverity: RiskSeverity;
  opportunityScore: number | null;
  evaluation: StrategyEvaluation | null;
  account: PaperAccountView;
  hasExistingPositionForSymbol: boolean;
  openPositionCount: number;
  existingOpenNotional: number;
  killSwitchEngaged: boolean;
  now: number;
};

/**
 * The pure, deterministic core of the Sprint 19 Decision Engine (Phase 1)
 * -- no LLM, no randomness, identical inputs always produce an identical
 * decision. `action` is derived purely from the strategy candidate's own
 * direction plus whether a position is already open; `proposedOrder` is
 * `null` only when there is genuinely no direction to construct an order
 * from (`NO_TRADE`), the kill switch is engaged (Phase 7's own "don't even
 * generate a proposal"), or there is no live market data to price against.
 * For `HOLD` (a directional candidate with an already-open position), the
 * hypothetical order IS still constructed and explicitly marked `REJECTED`
 * with reason `no_trade` -- explaining exactly what would have been
 * proposed and why it wasn't actionable, rather than silently omitting it.
 */
export function buildMarketDecision(ctx: DecisionContext): MarketDecision {
  const { candidate, metrics, riskSeverity, opportunityScore, evaluation, account, hasExistingPositionForSymbol, openPositionCount, existingOpenNotional, killSwitchEngaged, now } = ctx;

  const evidenceQuality: EvidenceQuality = evaluation && evaluation.status === "evaluated" ? evaluation.evidenceQuality : "insufficient";
  const evaluationScore = evaluation && evaluation.status === "evaluated" ? evaluation.evaluationScore : null;

  const reasons: string[] = [
    `Strategy: ${candidate.strategyType} (score ${candidate.score}, confidence ${candidate.confidence})`,
  ];
  if (candidate.marketRegime) reasons.push(`Market regime: ${candidate.marketRegime}`);
  reasons.push(
    evaluationScore !== null
      ? `Historical evidence quality: ${evidenceQuality} (evaluation score ${evaluationScore}/100)`
      : `Historical evidence quality: ${evidenceQuality} (no strategy evaluation yet)`,
  );
  if (riskSeverity !== "none") reasons.push(`Co-occurring market risk severity: ${riskSeverity}`);

  let action: MarketDecisionAction;
  let orderDirection: "LONG" | "SHORT" | null = null;
  if (candidate.strategyType === "NO_TRADE" || candidate.direction === null) {
    action = "NO_TRADE";
    reasons.push(
      candidate.noTradeReason
        ? `NO_TRADE reason: ${candidate.noTradeReason}`
        : "Non-directional strategy (RANGE_MEAN_REVERSION) -- no BUY/SELL call is made; direction is never fabricated.",
    );
  } else {
    orderDirection = candidate.direction === "up" ? "LONG" : "SHORT";
    if (hasExistingPositionForSymbol) {
      action = "HOLD";
      reasons.push("An open paper position already exists for this symbol -- holding, not re-entering.");
    } else {
      action = orderDirection === "LONG" ? "BUY" : "SELL";
    }
  }

  if (killSwitchEngaged) reasons.push("Kill switch engaged -- no execution proposal generated (read/evaluation only).");

  const base: Omit<MarketDecision, "proposedOrder"> = {
    symbol: candidate.symbol,
    action,
    strategyType: candidate.strategyType,
    strategyScore: candidate.score,
    strategyConfidence: candidate.confidence,
    evaluationScore,
    evidenceQuality,
    regime: candidate.marketRegime,
    riskSeverity,
    reasons,
    killSwitchEngaged,
  };

  if (orderDirection === null || killSwitchEngaged || !metrics) {
    if (!metrics && orderDirection !== null && !killSwitchEngaged) {
      reasons.push("No current market data available for this symbol -- no order can be priced.");
    }
    return { ...base, proposedOrder: null };
  }

  const plan = buildEntryPlan({
    direction: orderDirection,
    entryPrice: metrics.lastClose,
    volatilityPct: metrics.volatilityPct,
    confidence: candidate.confidence,
    equity: account.currentEquity,
  });

  const decisionTimestampMs = now;
  const orderBase: BaseOrderFields = {
    symbol: candidate.symbol,
    direction: plan.direction,
    mode: plan.mode,
    entryPrice: plan.entryPrice,
    quantity: plan.quantity,
    notional: plan.notional,
    initialMargin: plan.initialMargin,
    leverage: plan.leverage,
    stopLossPrice: plan.stopLossPrice,
    takeProfitPrice: plan.takeProfitPrice,
    liquidationPrice: plan.liquidationPrice,
    risk: account.currentEquity * RISK_PER_TRADE_PCT,
    reason: candidate.thesis,
    confidence: candidate.confidence,
    decisionTimestamp: new Date(decisionTimestampMs).toISOString(),
    expiresAt: new Date(decisionTimestampMs + DECISION_VALIDITY_MS).toISOString(),
  };

  const validation =
    action === "HOLD"
      ? { status: "REJECTED" as const, reason: "no_trade" as const }
      : validateProposedOrder({
          order: orderBase,
          decisionTimestampMs,
          metrics,
          riskSeverity,
          evidenceQuality,
          opportunityScore,
          evaluationScore,
          account,
          openPositionCount,
          existingOpenNotional,
          now,
        });

  reasons.push(validation.status === "VALID" ? "Proposed order passed all deterministic risk/evidence checks." : `Proposed order rejected: ${validation.reason}`);

  const proposedOrder: ProposedOrder = { ...orderBase, validationStatus: validation.status, rejectReason: validation.reason };
  return { ...base, proposedOrder };
}

/**
 * The async data-gathering shell (Phase 1): reads only what Sprints 13-18
 * already persisted -- the current strategy candidates, the ranked
 * opportunity/risk context (`getMarketIntelligenceRanking`, reused rather
 * than re-querying `Opportunity`/`Risk` a second time), fresh market
 * metrics, the paper account, currently-open positions, per-strategy-type
 * evaluations (`getStrategyEvaluations`), and the kill switch -- then
 * builds one deterministic `MarketDecision` per strategy candidate via the
 * pure `buildMarketDecision` above. Never calls Binance, never calls an
 * LLM, never writes anything.
 */
export async function generateMarketDecisions(organizationId: string, now: Date = new Date()): Promise<MarketDecision[]> {
  const scoped = getTenantScopedClient(organizationId);

  const [snapshot, metricsSignals, account, openPositions, evaluations, orgKillSwitchEngaged] = await Promise.all([
    getMarketIntelligenceRanking(organizationId),
    scoped.companySignal.findMany({
      where: { ruleName: METRICS_SNAPSHOT_RULE_NAME, ruleVersion: METRICS_SNAPSHOT_RULE_VERSION, status: "active" },
      select: { relatedEntityId: true, payload: true },
    }),
    getOrCreatePaperAccount(organizationId),
    scoped.paperPosition.findMany({ where: { status: "OPEN" }, select: { symbol: true, notional: true } }),
    getStrategyEvaluations(organizationId),
    isKillSwitchEngaged(organizationId, "market"),
  ]);

  const killSwitchEngaged = orgKillSwitchEngaged || env.MARKET_EXECUTION_KILL_SWITCH;

  const metricsBySymbol = new Map<string, MarketMetricsSnapshotPayload>();
  for (const s of metricsSignals) {
    if (!s.relatedEntityId) continue;
    metricsBySymbol.set(s.relatedEntityId, s.payload as unknown as MarketMetricsSnapshotPayload);
  }

  const rankedBySymbol = new Map(snapshot.ranked.map((r) => [r.symbol, r]));
  const evaluationByStrategyType = new Map(evaluations.map((e) => [e.strategyType, e]));
  const openSymbols = new Set(openPositions.map((p) => p.symbol));
  const openPositionCount = openPositions.length;
  const existingOpenNotional = openPositions.reduce((sum, p) => sum + Number(p.notional), 0);

  return snapshot.strategies.map((candidate) => {
    const ranked = rankedBySymbol.get(candidate.symbol);
    return buildMarketDecision({
      candidate,
      metrics: metricsBySymbol.get(candidate.symbol) ?? null,
      riskSeverity: ranked?.riskSeverity ?? "none",
      opportunityScore: ranked?.opportunityScore ?? null,
      evaluation: evaluationByStrategyType.get(candidate.strategyType) ?? null,
      account,
      hasExistingPositionForSymbol: openSymbols.has(candidate.symbol),
      openPositionCount,
      existingOpenNotional,
      killSwitchEngaged,
      now: now.getTime(),
    });
  });
}
