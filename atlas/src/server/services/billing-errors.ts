/**
 * Pure, I/O-free helper for classifying Prisma/Postgres errors from the
 * billing tables. Kept separate from billing.service.ts (which imports
 * "server-only") so this stays importable from plain Node test files.
 *
 * Both checks below were verified against real Prisma error shapes
 * (captured locally by actually dropping the table/column and catching
 * the thrown error), not guessed:
 *
 *   - prisma.subscription.findUnique() when the table is missing:
 *     { code: "P2021", message: "The table `public.subscriptions` does
 *       not exist in the current database." }
 *   - $executeRaw()/$queryRaw() when the table is missing:
 *     { code: "P2010", meta: { code: "42P01", message: 'relation
 *       "subscriptions" does not exist' } }
 *
 * A missing *column* (a real schema-drift bug - e.g. a migration that was
 * never applied) produces P2022 / meta.code "42703" instead, which must
 * NOT match here: an earlier version of this function used a broad
 * substring check ("does not exist in the current database") that
 * matched both cases and silently hid a real column-missing bug behind
 * "billing tables aren't set up yet, default to Starter" - which is
 * exactly what happened in production once (see PR history).
 */
export function isMissingBillingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    code?: string;
    meta?: { code?: string };
  };

  return (
    // Raised by Prisma's generated client (e.g. .findUnique()).
    candidate.code === "P2021" ||
    // Raised by $executeRaw()/$queryRaw() - the real Postgres error code
    // ends up on `meta.code`, not the top-level `code` (which is Prisma's
    // generic "P2010: raw query failed").
    candidate.meta?.code === "42P01"
  );
}
