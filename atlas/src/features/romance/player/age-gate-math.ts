/**
 * Pure age-verification plausibility check - no Prisma, no server-only.
 * Split out so the "malformed verification state" case (brief's explicit
 * test requirement) is unit-testable without a database.
 */

const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/**
 * A verification timestamp in the future (beyond ordinary clock skew) is
 * impossible under normal operation and is treated as malformed/
 * untrusted rather than as proof of verification - defense against a
 * corrupted or tampered value ever being read as "verified".
 */
export function isPlausibleVerificationTimestamp(
  ageVerifiedAt: Date | null,
  now: Date = new Date()
): boolean {
  if (ageVerifiedAt === null) return false;
  return ageVerifiedAt.getTime() <= now.getTime() + CLOCK_SKEW_TOLERANCE_MS;
}
