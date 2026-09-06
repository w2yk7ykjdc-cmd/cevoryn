import crypto from "node:crypto";

/**
 * Pure hashing helper, split out of ingestion.service.ts (which imports
 * "server-only") so this stays importable from plain Node test files.
 * Deterministic sha256 of source+sourceUrl+title - this is what the
 * `(organizationId, hash)` unique constraint on ExternalSignal keys off of
 * to make re-ingestion idempotent.
 */
export function hashSignal(
  source: string,
  sourceUrl: string,
  title: string
): string {
  return crypto
    .createHash("sha256")
    .update(`${source}|${sourceUrl}|${title}`)
    .digest("hex");
}
