import { prisma } from "@/server/db/client";
import { getSubscriptionForOrg } from "@/server/billing/subscription";

export class SeatLimitExceededError extends Error {
  constructor(public readonly seatLimit: number) {
    super(
      `This organization's plan allows ${seatLimit} seat${seatLimit === 1 ? "" : "s"}. ` +
        "Upgrade to invite more members.",
    );
    this.name = "SeatLimitExceededError";
  }
}

/**
 * Throws `SeatLimitExceededError` if the organization is already at (or
 * would exceed) its plan's seat limit. Counts active `Member` rows plus
 * `pending` `Invitation` rows — an accepted invitation becomes a member, so
 * both represent a seat that's spoken for. `seatLimit: null` (Enterprise)
 * means unlimited.
 *
 * This function alone does not close the race where two concurrent invites
 * both read the same under-limit count before either write commits — see
 * `withSeatLimitLock`, which every real call site should use.
 */
export async function assertSeatAvailable(organizationId: string): Promise<void> {
  const subscription = await getSubscriptionForOrg(organizationId);
  const seatLimit = subscription.plan.seatLimit;
  if (seatLimit === null) return;

  const [memberCount, pendingInvitationCount] = await Promise.all([
    prisma.member.count({ where: { organizationId } }),
    prisma.invitation.count({ where: { organizationId, status: "pending" } }),
  ]);

  if (memberCount + pendingInvitationCount >= seatLimit) {
    throw new SeatLimitExceededError(seatLimit);
  }
}

/**
 * Runs `assertSeatAvailable` and then `fn` while holding a
 * transaction-scoped Postgres advisory lock keyed on the organization id,
 * so two concurrent invitations against a plan with exactly one seat left
 * can't both pass the count check before either's write commits — the
 * second call blocks on the lock until the first's transaction ends, by
 * which point its own invitation is already committed and the recount sees
 * it. `fn` (typically `auth.api.createInvitation`) doesn't need to run
 * inside this transaction itself for this to work: the lock alone
 * serializes any concurrent caller trying to acquire it, regardless of
 * which connection actually performs the write.
 */
export async function withSeatLimitLock<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
    await assertSeatAvailable(organizationId);
    return fn();
  });
}
