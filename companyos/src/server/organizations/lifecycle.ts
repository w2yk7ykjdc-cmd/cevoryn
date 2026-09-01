import { prisma } from "@/server/db/client";
import { getSubscriptionForOrg } from "@/server/billing/subscription";
import { getPaymentProvider } from "@/server/billing/provider/registry";
import type { PaymentProvider } from "@/server/billing/provider/types";
import { publishEvent } from "@/server/events/event-bus";
import { logger } from "@/server/logger/logger";

export class OrganizationNotFoundError extends Error {
  constructor(organizationId: string) {
    super(`Organization "${organizationId}" not found`);
    this.name = "OrganizationNotFoundError";
  }
}

export class OrganizationDeletionConfirmationError extends Error {
  constructor() {
    super("Type the workspace slug exactly to confirm deletion.");
    this.name = "OrganizationDeletionConfirmationError";
  }
}

export class SoleOrganizationOwnerError extends Error {
  constructor(organizationName: string) {
    super(
      `You're the sole owner of "${organizationName}". Promote another member to owner, or delete the workspace, before deleting your account.`,
    );
    this.name = "SoleOrganizationOwnerError";
  }
}

/**
 * Immediately cancels the organization's live Stripe subscription ahead of
 * deletion. Unlike `cancelSubscriptionForOrg` (the self-service
 * cancel-at-period-end flow), this cancels right away — there's no "period
 * end" left to honor once the organization and its billing relationship
 * both cease to exist. A no-op (no Stripe call at all) for an organization
 * that has never held a paid, Stripe-backed subscription, so deleting a
 * free-tier workspace never touches Stripe.
 */
export async function cancelLiveSubscriptionForDeletion(
  organizationId: string,
  provider?: PaymentProvider,
): Promise<void> {
  const subscription = await getSubscriptionForOrg(organizationId);
  if (!subscription.stripeSubscriptionId) return;

  await (provider ?? getPaymentProvider()).cancelSubscription(subscription.stripeSubscriptionId);
}

export type DeleteOrganizationInput = {
  organizationId: string;
  actorId: string;
  confirmationSlug: string;
};

/**
 * The sole supported path for permanently deleting an organization and all
 * of its tenant data. Better Auth's own organization-deletion endpoint is
 * disabled (`disableOrganizationDeletion: true` in `auth.ts`) specifically
 * so this function is the only entry point: callers must already hold
 * `organization:delete` (enforced by the caller — see
 * `deleteOrganizationAction`), and must type the organization's slug back
 * exactly, so neither a client-side mistake nor a scripted call without
 * deliberate confirmation can destroy a tenant.
 *
 * Any live Stripe subscription is cancelled first; if that fails, nothing
 * is deleted — an organization must never be destroyed while Stripe keeps
 * billing a customer with no application record left to reconcile it.
 * Deletion itself is a single `organization` row delete: every tenant-scoped
 * model cascades from `Organization` at the database level (see
 * prisma/schema.prisma), so this one statement removes 100% of the
 * tenant's data.
 */
export async function deleteOrganization(input: DeleteOrganizationInput, provider?: PaymentProvider): Promise<void> {
  const organization = await prisma.organization.findUnique({ where: { id: input.organizationId } });
  if (!organization) throw new OrganizationNotFoundError(input.organizationId);

  if (input.confirmationSlug !== organization.slug) {
    throw new OrganizationDeletionConfirmationError();
  }

  // Throws (and aborts here, before anything is deleted) if Stripe
  // cancellation fails — see the doc comment above.
  await cancelLiveSubscriptionForDeletion(input.organizationId, provider);

  await prisma.organization.delete({ where: { id: input.organizationId } });

  logger.warn(
    { organizationId: organization.id, slug: organization.slug, actorId: input.actorId },
    "organization permanently deleted",
  );

  // Best-effort durable compliance record — deliberately *not* awaited into
  // the failure path of this function: the organization is already gone by
  // this point, so a hiccup writing the secondary record shouldn't make the
  // deletion itself look like it failed to the caller.
  try {
    await publishEvent("organization.deleted", {
      deletedOrganizationId: organization.id,
      name: organization.name,
      slug: organization.slug,
      deletedByUserId: input.actorId,
    });
  } catch (err) {
    logger.error({ err, organizationId: organization.id }, "failed to record organization.deleted compliance event");
  }
}

/**
 * Blocks deleting a user's account while they are the sole owner of any
 * organization — i.e. no other member of that organization also holds the
 * "owner" role. Better Auth allows the current owner to promote another
 * member to owner via `updateMemberRole` (both then hold "owner"
 * simultaneously — see `crud-members.mjs`), so "promote a co-owner, then
 * delete your account" is the supported ownership-transfer path; deleting
 * the organization itself (see `deleteOrganization` above) is the other.
 */
export async function assertSafeToDeleteAccount(userId: string): Promise<void> {
  const memberships = await prisma.member.findMany({
    where: { userId },
    include: { organization: true },
  });

  const ownedOrgs = memberships.filter((membership) => membership.role.split(",").includes("owner"));

  for (const membership of ownedOrgs) {
    const orgMembers = await prisma.member.findMany({
      where: { organizationId: membership.organizationId },
    });
    const otherOwners = orgMembers.filter(
      (member) => member.userId !== userId && member.role.split(",").includes("owner"),
    );
    if (otherOwners.length === 0) {
      throw new SoleOrganizationOwnerError(membership.organization.name);
    }
  }
}
