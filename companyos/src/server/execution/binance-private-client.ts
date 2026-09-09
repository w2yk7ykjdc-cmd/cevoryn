import { createHmac } from "node:crypto";
import { logger } from "@/server/logger/logger";
import { redactForLogging, type BinanceCredentials } from "@/server/execution/credentials";
import { ExecutionAuthError, ExecutionProviderError, ExecutionRateLimitError, ExecutionTimeoutError, ExecutionUnknownResultError } from "@/server/execution/errors";

/**
 * Sprint 22 Phase 3: the PRIVATE (authenticated, signed) Binance REST
 * client -- a completely SEPARATE module from `market-data/binance-client.ts`
 * (which stays exactly as Sprint 13 left it, public-endpoints-only, zero
 * credential surface, unmodified by this sprint). This is the only file in
 * the codebase that constructs a signed Binance request.
 *
 * Signing follows Binance's own documented convention: every parameter
 * (including `timestamp` and `recvWindow`) is serialized into a query
 * string, HMAC-SHA256'd with the API secret, and the resulting hex digest
 * is appended as its own `signature` parameter. The API key travels as the
 * `X-MBX-APIKEY` header, never in the URL or body. Neither the key nor the
 * secret is ever included in a log line -- every log call in this file
 * passes its payload through `redactForLogging` first.
 */

const BASE_URL = "https://api.binance.com";
const REQUEST_TIMEOUT_MS = 10_000;
/** Binance's own documented tolerance window (ms) for how old a request's `timestamp` may be relative to the server's clock -- rejects a stale/replayed request rather than trusting an arbitrarily old signature. */
const DEFAULT_RECV_WINDOW_MS = 5_000;

function sign(queryString: string, apiSecret: string): string {
  return createHmac("sha256", apiSecret).update(queryString).digest("hex");
}

function buildSignedQuery(params: Record<string, string | number>, credentials: BinanceCredentials): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  query.set("timestamp", String(Date.now()));
  query.set("recvWindow", String(DEFAULT_RECV_WINDOW_MS));
  const signature = sign(query.toString(), credentials.apiSecret);
  query.set("signature", signature);
  return query.toString();
}

/**
 * `isWrite` changes ONLY how a timeout/network-interruption is classified
 * (Phase 11): a READ that times out is safe to retry
 * (`ExecutionTimeoutError`); a WRITE that times out has an unknown outcome
 * (`ExecutionUnknownResultError`) and MUST be reconciled, never blindly
 * retried or assumed failed.
 */
async function signedRequest(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number>,
  credentials: BinanceCredentials,
  isWrite: boolean,
): Promise<unknown> {
  const query = buildSignedQuery(params, credentials);
  const url = `${BASE_URL}${path}?${query}`;
  const label = `${method} ${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { method, headers: { "X-MBX-APIKEY": credentials.apiKey }, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      if (isWrite) {
        throw new ExecutionUnknownResultError(`Binance private ${label} timed out -- outcome unknown, reconcile via getOrder before retrying`);
      }
      throw new ExecutionTimeoutError(`Binance private ${label} timed out`);
    }
    if (isWrite) {
      throw new ExecutionUnknownResultError(`Binance private ${label} network error, outcome unknown: ${String(err)}`);
    }
    throw new ExecutionProviderError(`network error calling Binance private ${label}: ${String(err)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429 || response.status === 418) {
    const retryAfterHeader = response.headers.get("retry-after");
    throw new ExecutionRateLimitError(`Binance rate limit hit calling ${label}`, retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined);
  }
  if (response.status === 401 || response.status === 403) {
    throw new ExecutionAuthError(`Binance rejected credentials calling ${label} (status ${response.status})`);
  }
  if (response.status >= 500) {
    if (isWrite) {
      throw new ExecutionUnknownResultError(`Binance returned ${response.status} for ${label} -- outcome unknown, reconcile via getOrder before retrying`);
    }
    throw new ExecutionProviderError(`Binance returned ${response.status} for ${label}`, response.status);
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new ExecutionProviderError(`Binance returned ${response.status} for ${label}: ${bodyText.slice(0, 200)}`, response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new ExecutionProviderError(`Binance ${label} response was not valid JSON`);
  }
}

export async function binancePrivateGet(path: string, params: Record<string, string | number>, credentials: BinanceCredentials): Promise<unknown> {
  logger.debug({ path, params: redactForLogging(params) }, "binance private GET");
  return signedRequest("GET", path, params, credentials, false);
}

export async function binancePrivatePost(path: string, params: Record<string, string | number>, credentials: BinanceCredentials): Promise<unknown> {
  logger.debug({ path, params: redactForLogging(params) }, "binance private POST (write)");
  return signedRequest("POST", path, params, credentials, true);
}

export async function binancePrivateDelete(path: string, params: Record<string, string | number>, credentials: BinanceCredentials): Promise<unknown> {
  logger.debug({ path, params: redactForLogging(params) }, "binance private DELETE (write)");
  return signedRequest("DELETE", path, params, credentials, true);
}
