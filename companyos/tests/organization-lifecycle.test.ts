import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { auth } from "@/server/auth/auth";
import {
  assertSafeToDeleteAccount,
  cancelLiveSubscriptionForDeletion,
  deleteOrganization,
  OrganizationDeletionConfirmationError,
  SoleOrganizationOwnerError,
} from "@/server/organizations/lifecycle";
import { getSubscriptionForOrg } from "@/server/billing/subscription";
import { getPlanByTier } from "@/server/billing/plans";
import { PaymentProviderError } from "@/server/billing/provider/types";
import {
  addMemberDirect,
  authHeaders,
  closeTestConnections,
  createOrgForUser,
  signUpUser,
} from "./helpers";
import { createFakePaymentProvider } from "./fake-payment-provider";

describe("organization lifecycle: deletion safety", () => {
  afterAll(closeTestConnections);

  // ── cancelLiveSubscriptionForDeletion ────────────────────────────────

  it("cancelLiveSubscriptionForDeletion is a no-op (no Stripe call) for a free org with no Stripe subscription", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    let called = false;
    const provider = createFakePaymentProvider({
      cancelSubscription: async () => {
        called = true;
      },
    });

    await cancelLiveSubscriptionForDeletion(organization.id, provider);
    expect(called).toBe(false);
  });

  it("cancelLiveSubscriptionForDeletion calls the provider when the org has a live Stripe subscription", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { stripeSubscriptionId: `sub_${organization.id}`, stripeCustomerId: `cus_${organization.id}` },
    });

    let cancelledId: string | undefined;
    const provider = createFakePaymentProvider({
      cancelSubscription: async (stripeSubscriptionId: string) => {
        cancelledId = stripeSubscriptionId;
      },
    });

    await cancelLiveSubscriptionForDeletion(organization.id, provider);
    expect(cancelledId).toBe(`sub_${organization.id}`);
  });

  // ── deleteOrganization ───────────────────────────────────────────────

  it("deleteOrganization refuses without the exact slug confirmation, and deletes nothing", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    await expect(
      deleteOrganization(
        { organizationId: organization.id, actorId: owner.userId, confirmationSlug: "wrong-slug" },
        createFakePaymentProvider(),
      ),
    ).rejects.toBeInstanceOf(OrganizationDeletionConfirmationError);

    const stillThere = await prisma.organization.findUnique({ where: { id: organization.id } });
    expect(stillThere).not.toBeNull();
  });

  it("deleteOrganization aborts (deletes nothing) when Stripe cancellation fails", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { stripeSubscriptionId: `sub_${organization.id}`, stripeCustomerId: `cus_${organization.id}` },
    });

    const failingProvider = createFakePaymentProvider({
      cancelSubscription: async () => {
        throw new PaymentProviderError("Stripe is down");
      },
    });

    await expect(
      deleteOrganization(
        { organizationId: organization.id, actorId: owner.userId, confirmationSlug: organization.slug },
        failingProvider,
      ),
    ).rejects.toThrow(/stripe is down/i);

    const stillThere = await prisma.organization.findUnique({ where: { id: organization.id } });
    expect(stillThere).not.toBeNull();
    const subscriptionStillThere = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    expect(subscriptionStillThere).not.toBeNull();
  });

  it("deleteOrganization never calls Stripe for a free-tier org, and wipes all tenant data on success", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const member = await signUpUser();
    await addMemberDirect(organization.id, member, "member");

    let stripeCalled = false;
    const provider = createFakePaymentProvider({
      cancelSubscription: async () => {
        stripeCalled = true;
      },
    });

    // Seed a bit of tenant data so we can prove it's actually gone.
    const company = await prisma.company.create({
      data: { organizationId: organization.id, name: "Acme", createdById: owner.userId },
    });
    const subscription = await getSubscriptionForOrg(organization.id);

    await deleteOrganization(
      { organizationId: organization.id, actorId: owner.userId, confirmationSlug: organization.slug },
      provider,
    );

    expect(stripeCalled).toBe(false);
    expect(await prisma.organization.findUnique({ where: { id: organization.id } })).toBeNull();
    expect(await prisma.company.findUnique({ where: { id: company.id } })).toBeNull();
    expect(await prisma.member.findMany({ where: { organizationId: organization.id } })).toHaveLength(0);
    expect(await prisma.subscription.findUnique({ where: { id: subscription.id } })).toBeNull();
    // The two users themselves are untouched — only their org membership/data is gone.
    expect(await prisma.user.findUnique({ where: { id: owner.userId } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: member.userId } })).not.toBeNull();
  });

  it("deleteOrganization cancels a live Stripe subscription before deleting a paid org", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { stripeSubscriptionId: `sub_${organization.id}`, stripeCustomerId: `cus_${organization.id}` },
    });

    let cancelledId: string | undefined;
    const provider = createFakePaymentProvider({
      cancelSubscription: async (id: string) => {
        cancelledId = id;
      },
    });

    await deleteOrganization(
      { organizationId: organization.id, actorId: owner.userId, confirmationSlug: organization.slug },
      provider,
    );

    expect(cancelledId).toBe(`sub_${organization.id}`);
    expect(await prisma.organization.findUnique({ where: { id: organization.id } })).toBeNull();
  });

  it("deleteOrganization writes a durable compliance record that survives the organization it describes", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    await deleteOrganization(
      { organizationId: organization.id, actorId: owner.userId, confirmationSlug: organization.slug },
      createFakePaymentProvider(),
    );

    const record = await prisma.domainEvent.findFirst({
      where: {
        type: "organization.deleted",
        payload: { path: ["deletedOrganizationId"], equals: organization.id },
      },
    });
    expect(record).not.toBeNull();
    // Not FK-linked to the (now-deleted) organization — it survives independently.
    expect(record?.organizationId).toBeNull();
  });

  // ── assertSafeToDeleteAccount ────────────────────────────────────────

  it("assertSafeToDeleteAccount blocks the sole owner of an organization", async () => {
    const owner = await signUpUser();
    await createOrgForUser(owner);

    await expect(assertSafeToDeleteAccount(owner.userId)).rejects.toBeInstanceOf(SoleOrganizationOwnerError);
  });

  it("assertSafeToDeleteAccount allows a non-owner member to be deleted", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const member = await signUpUser();
    await addMemberDirect(organization.id, member, "member");

    await expect(assertSafeToDeleteAccount(member.userId)).resolves.toBeUndefined();
  });

  it("assertSafeToDeleteAccount allows the original owner once another member is promoted to owner (ownership transfer)", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const member = await signUpUser();
    await addMemberDirect(organization.id, member, "member");

    const memberRow = await prisma.member.findFirstOrThrow({
      where: { organizationId: organization.id, userId: member.userId },
    });
    await auth.api.updateMemberRole({
      headers: authHeaders(owner.token),
      body: { memberId: memberRow.id, role: "owner", organizationId: organization.id },
    });

    await expect(assertSafeToDeleteAccount(owner.userId)).resolves.toBeUndefined();
  });

  // ── auth.api.deleteUser end-to-end (WP5) ────────────────────────────

  it("auth.api.deleteUser rejects deleting the sole owner's account", async () => {
    const owner = await signUpUser();
    await createOrgForUser(owner);

    await expect(auth.api.deleteUser({ headers: authHeaders(owner.token), body: {} })).rejects.toThrow();
    expect(await prisma.user.findUnique({ where: { id: owner.userId } })).not.toBeNull();
  });

  it("auth.api.deleteUser succeeds for a normal (non-owner) member", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const member = await signUpUser();
    await addMemberDirect(organization.id, member, "member");

    await auth.api.deleteUser({ headers: authHeaders(member.token), body: {} });

    expect(await prisma.user.findUnique({ where: { id: member.userId } })).toBeNull();
    // The organization and the owner's membership are untouched.
    expect(await prisma.organization.findUnique({ where: { id: organization.id } })).not.toBeNull();
  });

  it("auth.api.deleteUser succeeds for the original owner once another member is promoted to owner", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const member = await signUpUser();
    await addMemberDirect(organization.id, member, "member");

    const memberRow = await prisma.member.findFirstOrThrow({
      where: { organizationId: organization.id, userId: member.userId },
    });
    await auth.api.updateMemberRole({
      headers: authHeaders(owner.token),
      body: { memberId: memberRow.id, role: "owner", organizationId: organization.id },
    });

    await auth.api.deleteUser({ headers: authHeaders(owner.token), body: {} });

    expect(await prisma.user.findUnique({ where: { id: owner.userId } })).toBeNull();
    expect(await prisma.organization.findUnique({ where: { id: organization.id } })).not.toBeNull();
  });

  // ── WP2: createdBy/author/user cascade -> SetNull, records survive ──

  it("deleting a user preserves every record they created/authored, nulling only the creator/author/user reference", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const member = await signUpUser();
    await addMemberDirect(organization.id, member, "member");
    // Promote the second member to owner so `owner` isn't a sole owner and
    // can actually be deleted via `prisma.user.delete` below.
    const memberRow = await prisma.member.findFirstOrThrow({
      where: { organizationId: organization.id, userId: member.userId },
    });
    await auth.api.updateMemberRole({
      headers: authHeaders(owner.token),
      body: { memberId: memberRow.id, role: "owner", organizationId: organization.id },
    });

    const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { organizationId: organization.id } });

    const company = await prisma.company.create({
      data: { organizationId: organization.id, name: "Acme", createdById: owner.userId },
    });
    const contact = await prisma.contact.create({
      data: {
        organizationId: organization.id,
        firstName: "Jane",
        lastName: "Doe",
        createdById: owner.userId,
      },
    });
    const note = await prisma.contactNote.create({
      data: { contactId: contact.id, authorId: owner.userId, body: "Called, interested." },
    });
    const lead = await prisma.lead.create({
      data: { organizationId: organization.id, title: "Acme deal", stageId: stage.id, createdById: owner.userId },
    });
    const task = await prisma.task.create({
      data: { organizationId: organization.id, title: "Follow up", createdById: owner.userId },
    });
    const conversation = await prisma.conversation.create({
      data: { organizationId: organization.id, userId: owner.userId, provider: "anthropic", model: "test-model" },
    });
    const agentRun = await prisma.agentRun.create({
      data: {
        organizationId: organization.id,
        conversationId: conversation.id,
        userId: owner.userId,
        goal: "Do something",
        plan: [],
        status: "completed",
      },
    });

    await prisma.user.delete({ where: { id: owner.userId } });

    const [
      companyAfter,
      contactAfter,
      noteAfter,
      leadAfter,
      taskAfter,
      conversationAfter,
      agentRunAfter,
    ] = await Promise.all([
      prisma.company.findUniqueOrThrow({ where: { id: company.id } }),
      prisma.contact.findUniqueOrThrow({ where: { id: contact.id } }),
      prisma.contactNote.findUniqueOrThrow({ where: { id: note.id } }),
      prisma.lead.findUniqueOrThrow({ where: { id: lead.id } }),
      prisma.task.findUniqueOrThrow({ where: { id: task.id } }),
      prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
      prisma.agentRun.findUniqueOrThrow({ where: { id: agentRun.id } }),
    ]);

    expect(companyAfter.createdById).toBeNull();
    expect(contactAfter.createdById).toBeNull();
    expect(noteAfter.authorId).toBeNull();
    expect(leadAfter.createdById).toBeNull();
    expect(taskAfter.createdById).toBeNull();
    expect(conversationAfter.userId).toBeNull();
    expect(agentRunAfter.userId).toBeNull();
  });

  it("a downgrade to free tier is never mistaken for a live subscription needing cancellation", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const proPlan = await getPlanByTier("pro");
    const subscription = await getSubscriptionForOrg(organization.id);
    // Mirrors applySubscriptionDeleted: back on free, stripeSubscriptionId cleared.
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { planId: proPlan.id, status: "canceled", stripeSubscriptionId: null },
    });

    let called = false;
    const provider = createFakePaymentProvider({
      cancelSubscription: async () => {
        called = true;
      },
    });
    await cancelLiveSubscriptionForDeletion(organization.id, provider);
    expect(called).toBe(false);
  });
});
