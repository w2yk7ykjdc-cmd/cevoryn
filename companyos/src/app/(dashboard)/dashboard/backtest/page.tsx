import { requirePermission } from "@/server/auth/session";
import { loadHistoricalDataset } from "@/server/intelligence/backtest/historical-binance-fetcher";
import { runBacktest, BACKTEST_DISCLAIMER, type BacktestReport } from "@/server/intelligence/backtest/service";
import { listBacktestRuns } from "@/server/intelligence/backtest/run-service";
import { compareBacktestRuns, getMostRecentBacktestComparisons } from "@/server/intelligence/backtest/comparison";
import { MAX_RUN_SYMBOLS, MAX_RUN_WINDOW_DAYS, MIN_RUN_WINDOW_DAYS } from "@/server/intelligence/backtest/constants";
import { BENCHMARK_SYMBOL } from "@/server/market-data/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createBacktestRunAction } from "@/app/(dashboard)/dashboard/backtest/actions";

/** A small, fixed, documented default window/universe -- this first version of the page is not yet configurable via a form (see the Sprint 20 final report's own honest PARTIAL note on Phase 15). */
const DEFAULT_BACKTEST_SYMBOLS = [BENCHMARK_SYMBOL, "ETHUSDT"];
const DEFAULT_BACKTEST_WINDOW_DAYS = 10;

function closeReasonBadgeVariant(reason: string): "default" | "secondary" | "destructive" {
  if (reason === "LIQUIDATED" || reason === "STOPPED") return "destructive";
  if (reason === "TAKE_PROFIT") return "default";
  return "secondary";
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "FAILED") return "destructive";
  if (status === "COMPLETED") return "default";
  return "secondary";
}

/**
 * Sprint 20's own dashboard surface: runs one deterministic historical
 * replay against real Binance public candle data, then renders the result.
 * Every heading and every numeric section on this page is prefixed or
 * accompanied by the same explicit BACKTEST / HISTORICAL SIMULATION / NOT
 * REAL TRADING labeling `BACKTEST_DISCLAIMER` defines (Phase 15's own
 * explicit requirement) -- nothing rendered here is a live position, a
 * real order, or a claim about future performance.
 */
export default async function BacktestPage() {
  const { organization } = await requirePermission({ marketIntelligence: ["read"], paperTrading: ["read"] });

  // eslint-disable-next-line react-hooks/purity -- this is an async Server Component, not a render-time hook: reading "now" once per request to pick the backtest's historical window is the intended behavior, not a purity violation.
  const endMs = Date.now();
  const startMs = endMs - DEFAULT_BACKTEST_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // `<form action={...}>` requires a `(formData) => void | Promise<void>`
  // handler -- this thin wrapper discards `createBacktestRunAction`'s own
  // `ActionResult` (there is no client-side error display in this first,
  // non-JS version of the form; a failed launch simply leaves no new row
  // in the "Persisted Runs" list below after the page revalidates).
  async function launchRun(formData: FormData): Promise<void> {
    "use server";
    await createBacktestRunAction(formData);
  }

  let report: BacktestReport | null = null;
  let loadError: string | null = null;
  try {
    const dataset = await loadHistoricalDataset(DEFAULT_BACKTEST_SYMBOLS, startMs, endMs);
    report = await runBacktest({
      organizationId: organization.id,
      symbols: DEFAULT_BACKTEST_SYMBOLS,
      dataset,
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const [runs, mostRecentComparison] = await Promise.all([
    listBacktestRuns(organization.id),
    getMostRecentBacktestComparisons(organization.id),
  ]);
  const completedRunIds = runs.filter((r) => r.status === "COMPLETED").map((r) => r.id);
  const runComparison = completedRunIds.length > 0 ? await compareBacktestRuns(organization.id, completedRunIds) : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Historical Backtest</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{BACKTEST_DISCLAIMER}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Launch a Named Scenario — BACKTEST / SIMULATION</CardTitle>
          <CardDescription>
            Runs in the background (the existing job queue) against real historical market data. Up to {MAX_RUN_SYMBOLS} tradeable
            symbols, {MIN_RUN_WINDOW_DAYS}-{MAX_RUN_WINDOW_DAYS} days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={launchRun} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="label" className="text-xs text-muted-foreground">
                Scenario label
              </label>
              <input id="label" name="label" required maxLength={120} placeholder="e.g. Q1 2024 BTC/ETH uptrend" className="rounded border px-2 py-1 text-sm" />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="symbols" className="text-xs text-muted-foreground">
                Symbols (comma-separated)
              </label>
              <input id="symbols" name="symbols" required defaultValue="ETHUSDT" placeholder="ETHUSDT,SOLUSDT" className="rounded border px-2 py-1 text-sm" />
            </div>
            <div className="flex w-28 flex-col gap-1">
              <label htmlFor="windowDays" className="text-xs text-muted-foreground">
                Window (days)
              </label>
              <input id="windowDays" name="windowDays" type="number" min={MIN_RUN_WINDOW_DAYS} max={MAX_RUN_WINDOW_DAYS} defaultValue={14} className="rounded border px-2 py-1 text-sm" />
            </div>
            <Button type="submit">Launch run</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Persisted Runs</CardTitle>
          <CardDescription>Most recent first. A run&apos;s full report becomes available once its status reaches COMPLETED.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {runs.length === 0 && <div className="text-sm text-muted-foreground">No runs launched yet.</div>}
          {runs.map((run) => (
            <div key={run.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{run.label}</span>
                <Badge variant={statusBadgeVariant(run.status)}>{run.status}</Badge>
                <span className="text-xs text-muted-foreground">
                  {run.config.symbols.join(", ")} · {run.config.windowDays}d
                </span>
              </div>
              {run.errorMessage && <span className="text-xs text-red-600">{run.errorMessage}</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      {runComparison.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Multi-Scenario / Period Comparison — BACKTEST / SIMULATION</CardTitle>
            <CardDescription>Every completed run this organization has launched, side by side. Never blended into one figure.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pr-4">Scenario</th>
                  <th className="pr-4">Trades</th>
                  <th className="pr-4">Win rate</th>
                  <th className="pr-4">Net P&L</th>
                  <th className="pr-4">Quality score</th>
                </tr>
              </thead>
              <tbody>
                {runComparison.map((entry) => (
                  <tr key={entry.id} className="border-t">
                    <td className="pr-4 py-1">{entry.label}</td>
                    <td className="pr-4 py-1">{entry.metrics?.totalTrades ?? "—"}</td>
                    <td className="pr-4 py-1">{entry.metrics?.winRate !== null && entry.metrics?.winRate !== undefined ? `${entry.metrics.winRate}%` : "—"}</td>
                    <td className="pr-4 py-1">{entry.metrics?.totalNetPnl ?? "—"}</td>
                    <td className="pr-4 py-1">{entry.qualityScore?.status === "computed" ? `${entry.qualityScore.score}/100` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {mostRecentComparison.backtestRun && (
        <Card>
          <CardHeader>
            <CardTitle>Backtest vs. Live Paper-Trading — &quot;{mostRecentComparison.backtestRun.label}&quot;</CardTitle>
            <CardDescription>The two sides are never combined into one number — this is a comparison, not a blended score.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {mostRecentComparison.comparisons.length === 0 && <div className="text-sm text-muted-foreground">No strategy types to compare yet.</div>}
            {mostRecentComparison.comparisons.map((cmp) =>
              cmp.status === "compared" ? (
                <div key={cmp.strategyType} className="rounded border p-2">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    {cmp.strategyType}
                    <Badge variant="secondary">backtest: {cmp.backtestEvidenceQuality}</Badge>
                    <Badge variant="secondary">live: {cmp.liveEvidenceQuality ?? "insufficient"}</Badge>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="pr-4">Metric</th>
                        <th className="pr-4">BACKTEST</th>
                        <th className="pr-4">LIVE/PAPER</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cmp.rows.map((row) => (
                        <tr key={row.metric} className="border-t">
                          <td className="pr-4 py-1">{row.metric}</td>
                          <td className="pr-4 py-1">{row.backtestValue ?? "—"}</td>
                          <td className="pr-4 py-1">{row.liveValue ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null,
            )}
          </CardContent>
        </Card>
      )}

      {loadError && (
        <Card>
          <CardHeader>
            <CardTitle>Unable to load historical data</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {report && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Run Summary — BACKTEST / SIMULATION</CardTitle>
              <CardDescription>
                {report.run.stepsProcessed} historical steps replayed
                {report.run.firstStepTime && report.run.lastStepTime ? ` (${report.run.firstStepTime} → ${report.run.lastStepTime})` : ""}.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground">Starting equity (simulated)</div>
                <div className="font-medium">{report.run.finalAccount.startingEquity.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Ending equity (simulated)</div>
                <div className="font-medium">{report.run.finalAccount.currentEquity.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Realized P&L (simulated)</div>
                <div className="font-medium">{report.run.finalAccount.realizedPnl.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Max drawdown</div>
                <div className="font-medium">{(report.run.finalAccount.drawdownPct * 100).toFixed(2)}%</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Outcome Metrics — SIMULATION, not a live track record</CardTitle>
              <CardDescription>
                {report.metrics.totalTrades} simulated closed trades ({report.metrics.winCount} win / {report.metrics.lossCount} loss / {report.metrics.breakEvenCount} flat).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground">Win rate</div>
                <div className="font-medium">{report.metrics.winRate !== null ? `${report.metrics.winRate}%` : "insufficient data"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Profit factor</div>
                <div className="font-medium">{report.metrics.profitFactor ?? "n/a"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Total fees (simulated)</div>
                <div className="font-medium">{report.metrics.totalFeesPaid.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Backtest quality score</div>
                <div className="font-medium">
                  {report.qualityScore.status === "computed" ? `${report.qualityScore.score}/100` : "INSUFFICIENT_EVIDENCE"}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Walk-Forward Split (Phase 12)</CardTitle>
              <CardDescription>A simple, non-optimized chronological in-sample / out-of-sample split -- not a claim of predictive validity.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              {report.walkForward.status === "computed" ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-muted-foreground">In-sample trades</div>
                    <div className="font-medium">{report.walkForward.inSample!.trades.length}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Out-of-sample trades</div>
                    <div className="font-medium">{report.walkForward.outOfSample!.trades.length}</div>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground">Insufficient replayed steps to compute a walk-forward split yet.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Simulated Trades (most recent first)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {report.run.closedTrades.length === 0 && <div className="text-sm text-muted-foreground">No simulated trades closed in this window.</div>}
              {[...report.run.closedTrades]
                .reverse()
                .slice(0, 20)
                .map((trade, i) => (
                  <div key={i} className="flex items-center justify-between rounded border p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{trade.symbol}</span>
                      <Badge variant={trade.direction === "LONG" ? "default" : "secondary"}>{trade.direction}</Badge>
                      <Badge variant={closeReasonBadgeVariant(trade.closeReason)}>{trade.closeReason}</Badge>
                    </div>
                    <div className={trade.netPnl >= 0 ? "text-green-600" : "text-red-600"}>{trade.netPnl.toFixed(2)} (simulated)</div>
                  </div>
                ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
