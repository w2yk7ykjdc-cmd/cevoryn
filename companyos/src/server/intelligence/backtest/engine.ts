import { computeMarketMetrics } from "@/server/intelligence/signals/market-metrics";
import { classifyMarketRegime } from "@/server/intelligence/signals/rules/market-regime";
import {
  computeMarketConfidence,
  computeOpportunityScore,
  evaluateMarketOpportunityEligibility,
  evaluateMarketRiskConditions,
} from "@/server/intelligence/market-intelligence/scoring";
import type { MarketMetricsSnapshotPayload } from "@/server/intelligence/market-intelligence/types";
import { selectStrategy } from "@/server/intelligence/strategy/scoring";
import type { StrategyCandidate, StrategyInput } from "@/server/intelligence/strategy/types";
import { evaluatePositionUpdate, type OpenPositionState } from "@/server/intelligence/paper-trading/evaluate";
import { decideEntry } from "@/server/intelligence/paper-trading/entry";
import { computeFee } from "@/server/intelligence/paper-trading/pnl";
import { DEFAULT_STARTING_EQUITY } from "@/server/intelligence/paper-trading/constants";
import type { PaperAccountView } from "@/server/intelligence/paper-trading/account";
import { buildMarketDecision, type DecisionContext } from "@/server/intelligence/market-decision/service";
import { BENCHMARK_SYMBOL } from "@/server/market-data/types";
import { computeReplayStepTimes, createHistoricalMarketDataClient, type AsOfCursor } from "@/server/intelligence/backtest/historical-data";
import { DAILY_INTERVAL, MAX_DECISION_TRACE_ENTRIES, SHORT_INTERVAL, WARMUP_DAILY_CANDLES, WARMUP_SHORT_CANDLES } from "@/server/intelligence/backtest/constants";
import type {
  BacktestAccountState,
  BacktestAccountView,
  BacktestConfig,
  BacktestDecisionTraceEntry,
  BacktestOpenPosition,
  BacktestRunResult,
  BacktestTrade,
  HistoricalDataset,
} from "@/server/intelligence/backtest/types";

const round2 = (v: number): number => Math.round(v * 100) / 100;

function toAccountView(account: BacktestAccountState): BacktestAccountView {
  return {
    ...account,
    availableMargin: account.currentEquity - account.usedMargin,
    drawdownPct: account.peakEquity > 0 ? (account.peakEquity - account.currentEquity) / account.peakEquity : 0,
  };
}

function recomputeAccountAggregates(account: BacktestAccountState, openPositions: Map<string, BacktestOpenPosition>): void {
  const open = [...openPositions.values()];
  account.unrealizedPnl = round2(open.reduce((sum, p) => sum + p.unrealizedPnl, 0));
  account.usedMargin = round2(open.reduce((sum, p) => sum + p.initialMargin, 0));
  account.currentEquity = account.startingEquity + account.realizedPnl + account.unrealizedPnl;
  account.peakEquity = Math.max(account.peakEquity, account.currentEquity);
}

/**
 * Computes this step's `MarketMetricsSnapshotPayload` for one symbol, or
 * `null` if this symbol's real historical candle history is insufficient at
 * this point in the replay (still warming up, or a genuine data gap) --
 * reuses `computeMarketMetrics` verbatim (Sprint 14), never a re-derived
 * copy. `client.getCandles` is answered by the historical client's own
 * `asOf` cursor (`historical-data.ts`), so this can NEVER see a candle
 * later than the current step regardless of what the full dataset contains
 * (Phase 3/21's structural no-look-ahead guarantee).
 */
async function computeStepMetrics(
  client: ReturnType<typeof createHistoricalMarketDataClient>,
  symbol: string,
  benchmarkDailyPercentChange: number,
): Promise<MarketMetricsSnapshotPayload | null> {
  try {
    const [dailyCandles, shortCandles] = await Promise.all([
      client.getCandles(symbol, DAILY_INTERVAL, WARMUP_DAILY_CANDLES),
      client.getCandles(symbol, SHORT_INTERVAL, WARMUP_SHORT_CANDLES),
    ]);
    const metrics = computeMarketMetrics(symbol, dailyCandles, shortCandles);
    if (!metrics) return null;
    const relativeStrength = symbol === BENCHMARK_SYMBOL ? 0 : round2(metrics.dailyPercentChange - benchmarkDailyPercentChange);
    return { ...metrics, relativeStrength };
  } catch {
    // Missing/insufficient historical data for this symbol at this step --
    // the same "no signal, never a guess" isolation `ingestMarketData`
    // already applies per-symbol; never aborts the whole run.
    return null;
  }
}

function buildStrategyInputAndCandidate(
  metrics: MarketMetricsSnapshotPayload,
  regime: string | null,
  stepMs: number,
): { candidate: StrategyCandidate; riskSeverity: "low" | "medium" | "high" | "critical" | "none"; opportunityScore: number | null } {
  const riskEvaluation = evaluateMarketRiskConditions(metrics);
  const eligible = evaluateMarketOpportunityEligibility(metrics);

  let opportunity: StrategyInput["opportunity"] = null;
  let opportunityScore: number | null = null;
  if (eligible) {
    const scoreResult = computeOpportunityScore(metrics, riskEvaluation !== null);
    const confidence = computeMarketConfidence(metrics);
    opportunity = { id: `backtest:opportunity:${metrics.symbol}:${stepMs}`, score: scoreResult.score, confidence };
    opportunityScore = scoreResult.score;
  }

  const risk: StrategyInput["risk"] = riskEvaluation
    ? { id: `backtest:risk:${metrics.symbol}:${stepMs}`, severity: riskEvaluation.severity, conditions: riskEvaluation.conditions }
    : null;

  const input: StrategyInput = { metrics, regime, opportunity, risk };
  const candidate = selectStrategy(input, stepMs);
  return { candidate, riskSeverity: risk?.severity ?? "none", opportunityScore };
}

/**
 * Sprint 20's core replay engine (Phases 2-9): walks every real historical
 * step in strict chronological order, and at each step, reuses the EXACT
 * SAME deterministic functions the live pipeline uses --
 * `computeMarketMetrics` (Sprint 14) -> `classifyMarketRegime` (Sprint 14)
 * -> `evaluateMarketOpportunityEligibility`/`computeOpportunityScore`/
 * `computeMarketConfidence`/`evaluateMarketRiskConditions` (Sprint 14) ->
 * `selectStrategy` (Sprint 15) -> `decideEntry`/`buildEntryPlan`
 * (Sprint 16) -> `evaluatePositionUpdate`/pnl formulas (Sprint 16) --
 * against an ISOLATED, in-memory account/position state that never
 * touches the real `PaperAccount`/`PaperPosition`/`PaperTrade` tables or
 * the real `CompanySignal`/`Opportunity`/`Risk` tables (Phase 8/17/20).
 *
 * Two DIFFERENT, DELIBERATELY SEPARATE decision layers run side by side at
 * every step, mirroring how they actually relate in production (confirmed
 * by direct audit): `decideEntry` (`paper-trading/entry.ts`) is the SAME
 * function `evaluatePaperTradingForOrganization` itself calls to actually
 * open a live paper position -- it has no evidence-quality/evaluation-score
 * gate at all, so this is what actually opens/sizes every simulated
 * backtest position (Phase 8). `buildMarketDecision`/`validateProposedOrder`
 * (Sprint 19) is a SEPARATE, STRICTER, read-only "real execution
 * readiness" preview layer that in production is likewise NEVER wired into
 * the real paper-trading entry path (it only powers the Sprint 19 AI
 * tool/UI surface) -- reused here purely to populate `decisionTrace`
 * (Phase 7's own "execution-readiness output" requirement) alongside every
 * step's real entry decision, never to gate it. A decisionTrace entry can
 * therefore legitimately show `REJECTED`/`insufficient_evidence` in the
 * SAME step a real backtest trade opens -- that is not a bug, it is an
 * honest, side-by-side view of two functions that already have that exact
 * relationship in the real, live system.
 *
 * Deliberately NOT reused: the 5 standalone alert signal rules
 * (`market_price_momentum`/`market_trend`/`market_volume_anomaly`/
 * `market_volatility`/`market_relative_strength`). Direct audit of
 * `strategy/scoring.ts` and `market-decision/service.ts` confirms neither
 * ever reads those rule outputs -- they only ever consume `MarketMetrics`
 * fields, `regime`, `opportunity`, and `risk` directly. Those 5 rules exist
 * in production purely to write standalone, human-facing `CompanySignal`
 * alert rows; they have zero influence on any strategy/decision/execution
 * outcome, so replaying them here would add cost and complexity without
 * changing a single simulated trade -- never a shortcut that skips
 * something that actually matters.
 *
 * Also deliberately NOT reused: any live `StrategyEvaluation` (Sprint 18).
 * `DecisionContext.evaluation` is always `null` (evidence quality
 * `"insufficient"`) in a backtest decision -- reading the organization's
 * REAL, current evaluation (built from real paper trades that may postdate
 * the historical window being replayed) into a historical decision would
 * itself be a subtle form of look-ahead: it would let today's hindsight
 * silently influence what the system "decided" in the past. A future
 * sprint could compute a backtest-internal, walk-forward-safe evaluation
 * from ONLY the trades this same backtest has already closed by this
 * step -- deliberately left as documented future work rather than
 * approximated here.
 *
 * The kill switch (`killSwitchEngaged`) is always `false` in a backtest
 * decision context -- a backtest is inherently hypothetical ("what would
 * have happened") and never reflects or is gated by the real
 * organization's live kill switch state, exactly as Phase 18 requires
 * ("autonomy artışı yok" -- a backtest run must never itself be, or be
 * gated by, a live autonomy/execution control).
 */
export async function runReplay(config: BacktestConfig): Promise<BacktestRunResult> {
  const { organizationId, dataset } = config;
  const symbols = [...new Set(config.symbols)];
  const startingEquity = config.startingEquity ?? DEFAULT_STARTING_EQUITY;

  if (!dataset[BENCHMARK_SYMBOL]) {
    throw new Error(`backtest requires historical candle data for the benchmark symbol (${BENCHMARK_SYMBOL}) even if it is not itself being traded`);
  }
  for (const symbol of symbols) {
    if (!dataset[symbol]) throw new Error(`backtest requires historical candle data for requested symbol ${symbol}`);
  }

  const stepTimes = computeReplayStepTimes(dataset, symbols);
  const cursor: AsOfCursor = { asOfMs: 0 };
  const client = createHistoricalMarketDataClient(dataset, cursor);

  const account: BacktestAccountState = {
    startingEquity,
    currentEquity: startingEquity,
    peakEquity: startingEquity,
    usedMargin: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    totalFees: 0,
    totalFunding: 0,
  };
  const openPositions = new Map<string, BacktestOpenPosition>();
  const closedTrades: BacktestTrade[] = [];
  const decisionTrace: BacktestDecisionTraceEntry[] = [];
  let decisionTraceTruncated = false;

  let stepsProcessed = 0;
  let firstStepTime: number | null = null;
  let lastStepTime: number | null = null;

  for (const stepMs of stepTimes) {
    // Advance the as-of cursor FIRST -- every candle fetch below this line,
    // for the rest of this iteration, can see data up to and including
    // `stepMs` and NOTHING later (Phase 3/21's structural guarantee lives
    // in `historical-data.ts#sliceCandlesAsOf`, enforced through this
    // single mutable pointer every `client.getCandles` call reads).
    cursor.asOfMs = stepMs;
    const stepDate = new Date(stepMs);

    const benchmarkMetrics = await computeStepMetrics(client, BENCHMARK_SYMBOL, 0);
    const regime = benchmarkMetrics ? classifyMarketRegime(benchmarkMetrics).regime : null;
    const benchmarkDailyPercentChange = benchmarkMetrics?.dailyPercentChange ?? 0;

    const metricsBySymbol = new Map<string, MarketMetricsSnapshotPayload>();
    if (benchmarkMetrics) metricsBySymbol.set(BENCHMARK_SYMBOL, benchmarkMetrics);
    for (const symbol of symbols) {
      if (metricsBySymbol.has(symbol)) continue;
      const metrics = await computeStepMetrics(client, symbol, benchmarkDailyPercentChange);
      if (metrics) metricsBySymbol.set(symbol, metrics);
    }

    if (metricsBySymbol.size === 0) continue; // still warming up (Phase 4) -- not a processed step

    stepsProcessed += 1;
    firstStepTime ??= stepMs;
    lastStepTime = stepMs;

    const candidatesBySymbol = new Map<string, StrategyCandidate>();
    const riskSeverityBySymbol = new Map<string, "low" | "medium" | "high" | "critical" | "none">();
    const opportunityScoreBySymbol = new Map<string, number | null>();
    for (const symbol of symbols) {
      const metrics = metricsBySymbol.get(symbol);
      if (!metrics) continue;
      const { candidate, riskSeverity, opportunityScore } = buildStrategyInputAndCandidate(metrics, regime, stepMs);
      candidatesBySymbol.set(symbol, candidate);
      riskSeverityBySymbol.set(symbol, riskSeverity);
      opportunityScoreBySymbol.set(symbol, opportunityScore);
    }

    // 1) Update/close every currently-open position FIRST (mirrors
    // `paper-trading/evaluate.ts`'s own ordering), using this step's fresh
    // metrics where available.
    for (const [symbol, position] of [...openPositions.entries()]) {
      const metrics = metricsBySymbol.get(symbol);
      if (!metrics) continue; // no fresh data this step -- left exactly as-is, never guessed

      const candidate = candidatesBySymbol.get(symbol);
      const thesisInvalidated = !candidate || candidate.strategyType === "NO_TRADE";

      const state: OpenPositionState = {
        direction: position.direction,
        mode: position.mode,
        entryPrice: position.entryPrice,
        quantity: position.quantity,
        stopLossPrice: position.stopLossPrice,
        takeProfitPrice: position.takeProfitPrice,
        liquidationPrice: position.liquidationPrice,
        feesPaidSoFar: position.feesPaidSoFar,
        fundingPaidSoFar: position.fundingPaidSoFar,
        maxFavorableExcursion: position.maxFavorableExcursion,
        maxAdverseExcursion: position.maxAdverseExcursion,
        lastFundingAt: position.lastFundingAt,
      };
      const update = evaluatePositionUpdate(state, metrics.lastClose, stepDate, thesisInvalidated);

      // Funding is tracked as a per-step DELTA (`fundingChargeThisRun`), so
      // the running account total is never re-derived from a cumulative
      // figure that could double-count an earlier step's charge. Kept as a
      // raw, unrounded float across every step (rounding is applied only
      // once, for display, in `finalAccount`/`metrics.ts`) so many small
      // per-step accumulations never compound intermediate rounding error.
      account.totalFunding = account.totalFunding + update.fundingChargeThisRun;

      if (!update.closeStatus) {
        position.fundingPaidSoFar = update.fundingPaidTotal;
        position.unrealizedPnl = update.netPnl;
        position.maxFavorableExcursion = update.maxFavorableExcursion;
        position.maxAdverseExcursion = update.maxAdverseExcursion;
        position.lastFundingAt = stepDate;
        continue;
      }

      const exitFee = update.feesPaidTotal - position.feesPaidSoFar;
      account.totalFees = account.totalFees + exitFee;
      account.realizedPnl = account.realizedPnl + update.netPnl;

      closedTrades.push({
        symbol,
        direction: position.direction,
        mode: position.mode,
        strategyType: position.strategyType,
        regime: position.regime,
        candidateScore: position.candidateScore,
        candidateConfidence: position.candidateConfidence,
        leverage: position.leverage,
        entryPrice: position.entryPrice,
        exitPrice: update.currentPrice,
        quantity: position.quantity,
        notional: position.notional,
        initialMargin: position.initialMargin,
        grossPnl: update.grossPnl,
        feesPaid: update.feesPaidTotal,
        fundingPaid: update.fundingPaidTotal,
        netPnl: update.netPnl,
        returnPct: position.initialMargin > 0 ? update.netPnl / position.initialMargin : 0,
        maxFavorableExcursion: update.maxFavorableExcursion,
        maxAdverseExcursion: update.maxAdverseExcursion,
        closeReason: update.closeStatus,
        openedAt: position.openedAt.toISOString(),
        closedAt: stepDate.toISOString(),
      });
      openPositions.delete(symbol);
    }

    // 2) Recompute account aggregates from the now-current open-position set.
    recomputeAccountAggregates(account, openPositions);

    // 3) Attempt entry for every candidate this step, using an in-memory
    // "live" account view plus running notional/margin/count counters
    // updated incrementally as positions open within this same step --
    // mirrors `paper-trading/generate.ts`'s own `runningNotional`/
    // `runningUsedMargin`/`runningPositionCount` pattern exactly.
    let runningNotional = [...openPositions.values()].reduce((sum, p) => sum + p.notional, 0);
    let runningUsedMargin = account.usedMargin;
    let runningPositionCount = openPositions.size;

    for (const symbol of symbols) {
      const candidate = candidatesBySymbol.get(symbol);
      const metrics = metricsBySymbol.get(symbol);
      if (!candidate || !metrics) continue;

      const liveAccount = toAccountView({ ...account, usedMargin: runningUsedMargin });

      const decisionCtx: DecisionContext = {
        candidate,
        metrics,
        riskSeverity: riskSeverityBySymbol.get(symbol) ?? "none",
        opportunityScore: opportunityScoreBySymbol.get(symbol) ?? null,
        evaluation: null,
        account: { id: "backtest", ...liveAccount },
        hasExistingPositionForSymbol: openPositions.has(symbol),
        openPositionCount: runningPositionCount,
        existingOpenNotional: runningNotional,
        killSwitchEngaged: false,
        now: stepMs,
      };
      const decision = buildMarketDecision(decisionCtx);

      if (decisionTrace.length < MAX_DECISION_TRACE_ENTRIES) {
        decisionTrace.push({ stepIndex: stepsProcessed - 1, stepTime: stepDate.toISOString(), symbol, decision });
      } else {
        decisionTraceTruncated = true;
      }

      // Sprint 16's OWN real entry gate -- the identical function
      // `evaluatePaperTradingForOrganization` calls in production to
      // actually open a paper position. This is what decides and sizes
      // every simulated backtest trade (Phase 8); `decision` above is
      // recorded purely as this step's execution-readiness trace (Phase 7)
      // and never itself opens a position -- see this file's own top-level
      // doc comment for why the two are deliberately kept separate.
      const accountForEntry: PaperAccountView = { id: "backtest", ...liveAccount, usedMargin: runningUsedMargin, availableMargin: liveAccount.currentEquity - runningUsedMargin };
      const entryDecision = decideEntry({
        candidate,
        metrics,
        account: accountForEntry,
        hasExistingPositionForSymbol: openPositions.has(symbol),
        openPositionCount: runningPositionCount,
        existingOpenNotional: runningNotional,
        now: stepMs,
      });

      if (entryDecision.opened) {
        const plan = entryDecision.plan!;
        const entryFee = computeFee(plan.notional);
        const initialUnrealizedPnl = -entryFee;
        openPositions.set(symbol, {
          symbol,
          direction: plan.direction,
          mode: plan.mode,
          strategyType: candidate.strategyType,
          regime: candidate.marketRegime,
          candidateScore: candidate.score,
          candidateConfidence: candidate.confidence,
          leverage: plan.leverage,
          entryPrice: plan.entryPrice,
          quantity: plan.quantity,
          notional: plan.notional,
          initialMargin: plan.initialMargin,
          stopLossPrice: plan.stopLossPrice,
          takeProfitPrice: plan.takeProfitPrice,
          liquidationPrice: plan.liquidationPrice,
          feesPaidSoFar: entryFee,
          fundingPaidSoFar: 0,
          unrealizedPnl: initialUnrealizedPnl,
          maxFavorableExcursion: initialUnrealizedPnl,
          maxAdverseExcursion: initialUnrealizedPnl,
          lastFundingAt: stepDate,
          openedAt: stepDate,
        });
        account.totalFees = account.totalFees + entryFee;
        runningNotional += plan.notional;
        runningUsedMargin += plan.initialMargin;
        runningPositionCount += 1;
      }
    }

    // Final aggregate refresh for this step, now including any positions opened above.
    recomputeAccountAggregates(account, openPositions);
  }

  return {
    organizationId,
    symbols,
    stepsProcessed,
    firstStepTime: firstStepTime !== null ? new Date(firstStepTime).toISOString() : null,
    lastStepTime: lastStepTime !== null ? new Date(lastStepTime).toISOString() : null,
    finalAccount: toAccountView(account),
    closedTrades,
    openPositionsAtEnd: [...openPositions.values()],
    decisionTrace,
    decisionTraceTruncated,
  };
}

export type { HistoricalDataset };
