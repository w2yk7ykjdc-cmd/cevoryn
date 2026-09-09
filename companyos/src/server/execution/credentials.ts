import { env } from "@/env";

/**
 * Sprint 22 Phase 3/4: the ONLY module allowed to read
 * `env.BINANCE_API_KEY`/`env.BINANCE_API_SECRET` outside
 * `binance-private-client.ts` itself. Every other module in this codebase
 * -- including every AI tool, every UI page, every log statement -- goes
 * through `hasLiveCredentials()`/`redactSecret()` here, never `env.BINANCE_*`
 * directly, so there is exactly one place credential handling can be
 * audited and exactly one place a future secret-manager integration would
 * need to change.
 *
 * Storage: environment variables ONLY (`env.ts`, validated at process
 * boot). There is deliberately NO database table, NO Prisma model, NO API
 * route, and NO UI form anywhere in this codebase that can read, write, or
 * display a raw credential value -- "Plaintext credential persistence YOK"
 * (Phase 4) is satisfied by there being no persistence path at all, not by
 * an encryption layer around one. A future sprint that needs true
 * per-organization live credentials (this sprint's own live execution is
 * single-deployment-wide, matching `MARKET_EXECUTION_KILL_SWITCH`'s own
 * existing precedent) would introduce a real secret-manager client here --
 * this module's own narrow surface (`hasLiveCredentials`/`getCredentials`)
 * is exactly the seam that swap would happen behind, with zero other files
 * needing to change.
 */

export type BinanceCredentials = {
  apiKey: string;
  apiSecret: string;
};

/** Never returns partial credentials -- either both key and secret are present, or this reports `false` and every caller must treat live execution as entirely unavailable. */
export function hasLiveCredentials(): boolean {
  return Boolean(env.BINANCE_API_KEY) && Boolean(env.BINANCE_API_SECRET);
}

/**
 * Throws rather than returning `undefined` fields -- every caller of this
 * function is about to sign a real request, so a missing credential must
 * fail loudly and immediately, never proceed with an empty string.
 */
export function getCredentials(): BinanceCredentials {
  if (!hasLiveCredentials()) {
    throw new Error("Live execution credentials are not configured (BINANCE_API_KEY / BINANCE_API_SECRET)");
  }
  return { apiKey: env.BINANCE_API_KEY!, apiSecret: env.BINANCE_API_SECRET! };
}

/**
 * Masks a secret-shaped string for safe logging/display -- keeps only the
 * first and last 2 characters (enough for a human to recognize "this is
 * the same key I configured" without reconstructing it), replacing
 * everything else with a fixed-length run of `*`. Never returns a
 * variable-length mask that could leak the real length of a very short
 * secret; the mask length is always the same regardless of input length
 * (bounded at 8 stars) specifically so log output never leaks the
 * credential's actual length either.
 */
const MASK = "********";
export function redactSecret(value: string): string {
  if (value.length <= 4) return MASK;
  return `${value.slice(0, 2)}${MASK}${value.slice(-2)}`;
}

/**
 * Deep-redacts any object before it is logged (Phase 3's own "logs'a
 * yazma ASLA" requirement) -- walks the object recursively and replaces
 * the VALUE of any key whose name looks credential-shaped
 * (case-insensitive match against `SECRET_KEY_PATTERN`) with
 * `redactSecret`'s masked form. Applied at every logging call site in this
 * module (`binance-private-client.ts`, `binance-adapter.ts`) rather than
 * trusted to each call site's own discipline -- one shared function, one
 * place to get it right.
 */
const SECRET_KEY_PATTERN = /api[-_]?key|api[-_]?secret|secret|signature|password|token/i;

export function redactForLogging<T>(value: T): T {
  // A bare string is never redacted by its own content -- only by the KEY
  // that owns it, checked in the object branch below. Redacting arbitrary
  // strings by content would mangle ordinary, non-secret log text.
  if (Array.isArray(value)) {
    return value.map((v) => redactForLogging(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key) && typeof val === "string") {
        out[key] = redactSecret(val);
      } else {
        out[key] = redactForLogging(val);
      }
    }
    return out as T;
  }
  return value;
}
