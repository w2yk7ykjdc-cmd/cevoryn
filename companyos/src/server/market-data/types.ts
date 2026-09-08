/**
 * One OHLCV candle. `open`/`high`/`low`/`close`/`volume` are kept as the
 * ORIGINAL decimal strings the exchange returned (Binance's own klines
 * response already serializes them as strings, e.g. "43521.23000000") --
 * never lossy-converted to `number` for storage, only for the threshold
 * arithmetic a signal rule needs at read time.
 */
export type Candle = {
  openTime: Date;
  closeTime: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

/**
 * Sprint 13 fixed this to a 2-symbol union. Sprint 14's explicit mandate is
 * dynamic universe discovery ("sembol listesini hardcode etme") — a real
 * exchange symbol is now a plain, runtime-validated string (validated
 * against `exchangeInfo`'s own response in `universe.ts`, not a TS literal
 * union). `tests/sprint-13-market-intelligence.test.ts`'s own test D was
 * updated in this same sprint to reflect this -- see that file's comment.
 */
export type Symbol = string;

/** The "daily" (24h context) window -- unchanged from Sprint 13, still momentum's own window. */
export const DAILY_INTERVAL = "1h";
export const DAILY_WINDOW = 25;

/** The last N candles of the same daily fetch double as the "medium" window -- no extra API call. */
export const MEDIUM_WINDOW = 12;

/** A genuinely different resolution, needs its own fetch: recent, immediate price action (~2h). */
export const SHORT_INTERVAL = "15m";
export const SHORT_WINDOW = 8;

/**
 * How many symbols this sprint actually processes per run, chosen by
 * liquidity (24h quote volume) rather than an arbitrary/hardcoded list --
 * see `universe.ts`. Bounded so the system "tarar ama binlerce satır
 * dökmez" (scans broadly but never dumps thousands of rows): each symbol
 * costs 2 candle fetches, so 30 symbols is ~60 requests/hour, comfortably
 * inside Binance's public rate limits alongside the 2 universe-discovery
 * calls.
 */
export const UNIVERSE_SIZE = 30;

/** The reference asset every symbol's relative strength is measured against -- the standard crypto-market convention. */
export const BENCHMARK_SYMBOL = "BTCUSDT";

export class MarketDataAuthError extends Error {
  constructor(message = "Market data request was rejected as unauthorized") {
    super(message);
    this.name = "MarketDataAuthError";
  }
}

export class MarketDataRateLimitError extends Error {
  constructor(
    message = "Market data provider rate limit exceeded",
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "MarketDataRateLimitError";
  }
}

export class MarketDataTimeoutError extends Error {
  constructor(message = "Market data request timed out") {
    super(message);
    this.name = "MarketDataTimeoutError";
  }
}

export class MarketDataMalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataMalformedResponseError";
  }
}

export class MarketDataProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MarketDataProviderError";
  }
}

/** One row of Binance's `exchangeInfo` symbol list -- only the fields this module actually reads. */
export type ExchangeSymbolInfo = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
};

/** One row of Binance's bulk `ticker/24hr` response -- only the fields this module actually reads. */
export type Ticker24hr = {
  symbol: string;
  quoteVolume: string;
};

/**
 * The capabilities this sprint needs, deliberately this narrow: reading
 * public candles, public exchange metadata, and public 24h ticker
 * statistics. No account/order/withdrawal method exists on this interface
 * at all -- not disabled, not stubbed, genuinely absent, so there is
 * nothing here for a future sprint to "just enable."
 */
export interface MarketDataClient {
  getCandles(symbol: Symbol, interval: string, limit: number): Promise<Candle[]>;
  getExchangeInfo(): Promise<ExchangeSymbolInfo[]>;
  getTicker24hr(): Promise<Ticker24hr[]>;
}
