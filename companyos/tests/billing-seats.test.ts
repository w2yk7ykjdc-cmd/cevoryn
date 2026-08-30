import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { auth } from "@/server/auth/auth";
import { assertSeatAvailable, SeatLimitExceededError, withSeatLimitLock } from "@/server/billing/seats";
import { getSubscriptionForOrg } from "@/server/billing/subscription";
import { getPlanByTier } from "@/server/billing/plans";
import {
  addMemberDirect,
  authHeaders,
  closeTestConnections,
  createOrgForUser,
  signUpUser,
  uniqueEmail,
} from "./helpers";

describe("billing: seat enforcement", () => {
  afterAll(closeTestConnections);

  it("assertSeatAvailable passes while under the free plan's 3-seat limit", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    // The owner already occupies 1 of 3 seats.
    await expect(assertSeatAvailable(organization.id)).resolves.toBeUndefined();
  });

  it("assertSeatAvailable throws once active members reach the plan's seat limit", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    // Owner + 2 more members = 3, exactly the free plan's limit.
    for (let i = 0; i < 2; i += 1) {
      const member = await signUpUser();
      await addMemberDirect(organization.id, member, "member");
    }

    await expect(assertSeatAvailable(organization.id)).rejects.toThrow(SeatLimitExceededError);
  });

  it("assertSeatAvailable counts pending invitations toward the limit, not just active members", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    // 0 extra active members, 3 pending invitations against a 3-seat plan — should already be full.
    for (let i = 0; i < 2; i += 1) {
      await auth.api.createInvitation({
        headers,
        body: { email: uniqueEmail("pending"), role: "member", organizationId: organization.id },
      });
    }
    // Owner (1 seat) + 2 pending invitations = 3 seats spoken for.
    await expect(assertSeatAvailable(organization.id)).rejects.toThrow(SeatLimitExceededError);
  });

  it("assertSeatAvailable never blocks an Enterprise plan (seatLimit: null)", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);
    const enterprisePlan = await getPlanByTier("enterprise");
    await prisma.subscription.update({ where: { id: subscription.id }, data: { planId: enterprisePlan.id } });

    for (let i = 0; i < 10; i += 1) {
      const member = await signUpUser();
      await addMemberDirect(organization.id, member, "member");
    }

    await expect(assertSeatAvailable(organization.id)).resolves.toBeUndefined();
  });

  it("a downgrade to a lower seat limit does not remove existing members, but blocks new invitations", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await getSubscriptionForOrg(organization.id);
    const enterprisePlan = await getPlanByTier("enterprise");
    await prisma.subscription.update({ where: { id: subscription.id }, data: { planId: enterprisePlan.id } });

    // 5 members total — fine on Enterprise (unlimited), over the free plan's 3-seat limit.
    for (let i = 0; i < 4; i += 1) {
      const member = await signUpUser();
      await addMemberDirect(organization.id, member, "member");
    }
    const beforeCount = await prisma.member.count({ where: { organizationId: organization.id } });
    expect(beforeCount).toBe(5);

    // Simulates applyWebhookEvent(customer.subscription.deleted): downgraded straight to free.
    const freePlan = await getPlanByTier("free");
    await prisma.subscription.update({ where: { id: subscription.id }, data: { planId: freePlan.id, status: "canceled" } });

    const afterCount = await prisma.member.count({ where: { organizationId: organization.id } });
    expect(afterCount).toBe(5); // no members were removed by the downgrade

    await expect(assertSeatAvailable(organization.id)).rejects.toThrow(SeatLimitExceededError);
  });

  it("withSeatLimitLock prevents two concurrent invitations from both exceeding a 1-seat-remaining limit", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    // Owner (1 seat) + 1 more member = 2 of 3 seats — exactly 1 left.
    const member = await signUpUser();
    await addMemberDirect(organization.id, member, "member");

    const results = await Promise.allSettled([
      withSeatLimitLock(organization.id, () =>
        auth.api.createInvitation({
          headers,
          body: { email: uniqueEmail("race-a"), role: "member", organizationId: organization.id },
        }),
      ),
      withSeatLimitLock(organization.id, () =>
        auth.api.createInvitation({
          headers,
          body: { email: uniqueEmail("race-b"), role: "member", organizationId: organization.id },
        }),
      ),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(SeatLimitExceededError);

    const pendingInvitations = await prisma.invitation.count({
      where: { organizationId: organization.id, status: "pending" },
    });
    expect(pendingInvitations).toBe(1);
  });
});
