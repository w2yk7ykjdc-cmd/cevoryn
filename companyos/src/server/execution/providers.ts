import type { BinanceCredentials } from "@/server/execution/credentials";
import { createBinanceExecutionAdapter } from "@/server/execution/binance-adapter";
import type { ExecutionGateway } from "@/server/execution/types";

/**
 * Sprint 27: the explicit, honest registry of which execution providers
 * this codebase can ACTUALLY submit a real order through. This is NOT a
 * new execution system -- `ExecutionGateway` (Sprint 22) and
 * `MarketDataClient` (Sprint 13/14) were already provider-agnostic
 * interfaces before this sprint; this module only makes the "which
 * concrete provider backs a given credential" question explicit and
 * type-checked, replacing a previous, implicit hardcoding to Binance
 * everywhere a gateway was constructed.
 *
 * `SUPPORTED_EXECUTION_PROVIDERS` lists ONLY providers with a real,
 * working `ExecutionGateway` implementation -- adding a name here without
 * a real adapter behind it would be exactly the "gerçek desteklenmeyen
 * capability'leri uydurma" (never fabricate an unsupported capability)
 * the spec explicitly forbids. Today that is Binance alone; a future
 * sprint that ships a second real exchange integration adds both a new
 * adapter AND a new entry here in the same change, never one without the
 * other.
 */
export const SUPPORTED_EXECUTION_PROVIDERS = ["binance"] as const;

export type SupportedExecutionProvider = (typeof SUPPORTED_EXECUTION_PROVIDERS)[number];

/** The provider every existing Sprint 22-26 call site implicitly meant -- the default whenever a caller doesn't specify one, so every pre-Sprint-27 behavior is unchanged. */
export const DEFAULT_EXECUTION_PROVIDER: SupportedExecutionProvider = "binance";

export function isSupportedExecutionProvider(provider: string): provider is SupportedExecutionProvider {
  return (SUPPORTED_EXECUTION_PROVIDERS as readonly string[]).includes(provider);
}

export class UnsupportedExecutionProviderError extends Error {
  constructor(provider: string) {
    super(`"${provider}" is not a supported execution provider -- only ${SUPPORTED_EXECUTION_PROVIDERS.join(", ")} has a real, working adapter in this codebase`);
    this.name = "UnsupportedExecutionProviderError";
  }
}

/**
 * Builds the real `ExecutionGateway` for `provider` from already-resolved
 * credentials. Throws `UnsupportedExecutionProviderError` for anything
 * this codebase cannot actually execute against -- never silently falls
 * back to Binance, never pretends an unimplemented provider is ready.
 * `credentials`'s shape (`{ apiKey, apiSecret }`) happens to be generic
 * enough for most exchange APIs, but this function does not assume a
 * future provider would reuse it as-is -- adding a real second provider
 * is expected to widen this function's own parameter type, not stretch
 * `BinanceCredentials` to mean something it doesn't.
 */
export function createExecutionGatewayForProvider(provider: string, credentials: BinanceCredentials): ExecutionGateway {
  if (provider === "binance") return createBinanceExecutionAdapter(credentials);
  throw new UnsupportedExecutionProviderError(provider);
}
