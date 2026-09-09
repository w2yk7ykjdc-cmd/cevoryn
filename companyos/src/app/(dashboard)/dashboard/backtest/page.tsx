import { requirePermission } from "@/server/auth/session";
import { loadHistoricalDataset } from "@/server/intelligence/backtest/historical-binance-fetcher";
import { runBacktest, BACKTEST_DISCLAIMER, type BacktestReport } from "@/server/intelligence/backtest/service";
import { BENCHMARK_SYMBOL } from "@/server/market-data/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** A small, fixed, documented default window/universe -- this first version of the page is not yet configurable via a form (see the Sprint 20 final report's own honest PARTIAL note on Phase 15). */
const DEFAULT_BACKTEST_SYMBOLS = [BENCHMARK_SYMBOL, "ETHUSDT"];
const DEFAULT_BACKTEST_WINDOW_DAYS = 10;

function closeReasonBadgeVariant(reason: string): "default" | "secondary" | "destructive" {
  if (reason === "LIQUIDATED" || reason === "STOPPED") return "destructive";
  if (reason === "TAKE_PROFIT") return "default";
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Historical Backtest</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{BACKTEST_DISCLAIMER}</p>
      </div>

      <Card className="border-dashed">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Replaying {DEFAULT_BACKTEST_SYMBOLS.join(", ")} over the last {DEFAULT_BACKTEST_WINDOW_DAYS} days of real historical market data
          against an isolated, in-memory paper account. Symbol/date selection is not yet configurable from this page.
        </CardContent>
      </Card>

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
