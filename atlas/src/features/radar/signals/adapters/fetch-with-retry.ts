import "server-only";

import { isSafePublicUrl } from "./url-safety";

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export class UnsafeUrlError extends Error {
  constructor(url: string) {
    super(`Refusing to fetch a non-public or unsafe URL: ${url}`);
    this.name = "UnsafeUrlError";
  }
}

export interface RetryFetchOptions {
  timeoutMs: number;
  maxAttempts?: number;
  /** Base delay for exponential backoff between retries, in ms. */
  backoffMs?: number;
  headers?: Record<string, string>;
}

/**
 * fetch() with: (1) an SSRF guard (see url-safety.ts) checked before every
 * attempt - including retries, in case a caller ever reuses this across a
 * redirect chain, (2) `redirect: "error"` so a redirect to an internal URL
 * is refused rather than silently followed, (3) bounded retry with
 * exponential backoff, but only for transient failures (network errors,
 * 429/5xx) - a 4xx like an invalid token or unknown board is a real
 * client error and must not be retried.
 */
export async function fetchWithRetry(
  url: string,
  options: RetryFetchOptions
): Promise<Response | null> {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 500;

  if (!isSafePublicUrl(url)) {
    throw new UnsafeUrlError(url);
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: options.headers,
        redirect: "error",
      });

      if (response.ok) return response;
      if (
        !RETRYABLE_STATUS_CODES.has(response.status) ||
        attempt === maxAttempts
      ) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, backoffMs * 2 ** (attempt - 1))
    );
  }

  console.warn(
    `[cevoryn:radar] fetchWithRetry exhausted ${maxAttempts} attempts for an adapter request: ${
      lastError instanceof Error ? lastError.message : "unknown error"
    }`
  );
  return null;
}
