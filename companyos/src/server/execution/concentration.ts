import type { SymbolExposure } from "@/server/execution/portfolio-risk";

/**
 * Sprint 24 Phase 6: portfolio concentration is REAL and computable from
 * already-open `PaperPosition` notional -- no fabrication needed.
 * Cross-symbol CORRELATION is a genuinely different question (how do two
 * symbols' PRICES move together over time) that this codebase's schema
 * cannot honestly answer: no historical price time series is persisted
 * anywhere for a live/paper symbol (`MarketMetricsSnapshot`-equivalent
 * data is latest-only; Sprint 20/21's backtest candle data is loaded
 * on-demand and never persisted -- confirmed by direct audit of
 * `backtest/run-service.ts`'s own doc comment: "the real historical
 * candle data itself is never persisted"). Reporting a fabricated
 * correlation number here would be exactly the "fake precision" the
 * spec's own Phase 6 explicitly forbids, so `computeCorrelationRisk`
 * always returns `"insufficient_evidence"`, using the SAME evidence-
 * quality vocabulary `strategy-evaluation/service.ts#evidenceQualityFor`
 * already established, rather than inventing a new one.
 */

export type ConcentrationResult = {
  /** Herfindahl-Hirschman-style concentration index over symbol exposure shares, in [0, 1] -- 1 means all exposure sits in a single symbol, 1/N means N symbols are equally weighted. Standard portfolio-concentration measure, not a novel formula. */
  herfindahlIndex: number;
  /** The single largest symbol's share of total exposure, in [0, 1] -- easier to reason about directly than the Herfindahl index alone. */
  maxSymbolConcentrationPct: number;
  largestSymbol: string | null;
};

export function computePortfolioConcentration(bySymbol: SymbolExposure[]): ConcentrationResult {
  const total = bySymbol.reduce((sum, s) => sum + s.notional, 0);
  if (total <= 0) return { herfindahlIndex: 0, maxSymbolConcentrationPct: 0, largestSymbol: null };

  let herfindahlIndex = 0;
  let maxShare = 0;
  let largestSymbol: string | null = null;
  for (const s of bySymbol) {
    const share = s.notional / total;
    herfindahlIndex += share * share;
    if (share > maxShare) {
      maxShare = share;
      largestSymbol = s.symbol;
    }
  }

  return { herfindahlIndex, maxSymbolConcentrationPct: maxShare, largestSymbol };
}

export type CorrelationRiskResult = { status: "insufficient_evidence"; reason: string };

/**
 * Always returns `insufficient_evidence` in this codebase's current state
 * -- see this file's own top-level doc comment for exactly why (no
 * persisted historical price series to compute a real correlation from).
 * Kept as a real function (not simply omitted) so the gap is explicit,
 * discoverable, and testable, rather than silently absent.
 */
export function computeCorrelationRisk(): CorrelationRiskResult {
  return {
    status: "insufficient_evidence",
    reason: "no persisted historical price time series exists for open symbols in this codebase -- correlation would be fabricated, not computed",
  };
}
