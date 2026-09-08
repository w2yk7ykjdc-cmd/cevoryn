/**
 * One OHLCV candle. `open`/`high`/`low`/`close`/`volume` are kept as the
 * ORIGINAL decimal strings the exchange returned (Binance's own klines
 * response already serializes them as strings, e.g. "43521.23000000") --
 * never lossy-converted to `number` for storage, only for the threshold
 * arithmetic a signal rule needs at read time (see
 * `market-price-momentum.ts`). Nothing in this module persists a candle to
 * the database (see Sprint 13's README section for why).
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

export type SupportedSymbol = "BTCUSDT" | "ETHUSDT";

/** Fixed, small, explicit -- deliberately not dynamic/configurable in Sprint 13. */
export const SUPPORTED_SYMBOLS: readonly SupportedSymbol[] = ["BTCUSDT", "ETHUSDT"];

export const CANDLE_INTERVAL = "1h";

/** Exactly the window `market-price-momentum.ts`'s rule needs (24 candles back + the current one). */
export const CANDLE_WINDOW = 25;

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

/**
 * The one capability this sprint needs, deliberately this narrow: reading
 * public candle data. No account/balance/order method exists on this
 * interface at all -- not disabled, not stubbed, genuinely absent, so
 * there is nothing here for a future sprint to "just enable."
 */
export interface MarketDataClient {
  getCandles(symbol: SupportedSymbol, interval: string, limit: number): Promise<Candle[]>;
}
