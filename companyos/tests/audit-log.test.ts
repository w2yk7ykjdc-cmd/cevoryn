import { afterAll, describe, expect, it } from "vitest";
import { listAuditLogs, recordAuditLog } from "@/server/audit/audit-log";
import { prisma } from "@/server/db/client";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

describe("audit log", () => {
  afterAll(closeTestConnections);

  it("persists an immutable entry and publishes it on the event bus", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const entry = await recordAuditLog({
      organizationId: organization.id,
      actorId: owner.userId,
      actorType: "user",
      action: "member.invited",
      targetType: "invitation",
      targetId: "inv_test_1",
      metadata: { email: "invitee@example.com", role: "member" },
    });

    expect(entry.organizationId).toBe(organization.id);
    expect(entry.metadata).toEqual({ email: "invitee@example.com", role: "member" });

    const event = await prisma.domainEvent.findFirst({
      where: { type: "audit_log.recorded", organizationId: organization.id },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
    expect((event?.payload as { auditLogId: string }).auditLogId).toBe(entry.id);
  });

  it("filters by action and paginates in descending order by cursor", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    for (const action of ["a.first", "a.second", "b.other", "a.third"]) {
      await recordAuditLog({
        organizationId: organization.id,
        actorId: owner.userId,
        actorType: "user",
        action,
        targetType: "test",
        targetId: "target",
      });
    }

    const onlyA = await listAuditLogs({ organizationId: organization.id, action: "a.first" });
    expect(onlyA.entries).toHaveLength(1);
    expect(onlyA.entries[0]?.action).toBe("a.first");

    const firstPage = await listAuditLogs({ organizationId: organization.id, limit: 2 });
    expect(firstPage.entries).toHaveLength(2);
    // Most recent first: a.third then b.other.
    expect(firstPage.entries.map((e) => e.action)).toEqual(["a.third", "b.other"]);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await listAuditLogs({
      organizationId: organization.id,
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.entries).toHaveLength(2);
    expect(secondPage.entries.map((e) => e.action)).toEqual(["a.second", "a.first"]);
  });

  it("scopes results to the requested organization only", async () => {
    const [ownerA, ownerB] = await Promise.all([signUpUser(), signUpUser()]);
    const [orgA, orgB] = await Promise.all([createOrgForUser(ownerA), createOrgForUser(ownerB)]);

    await recordAuditLog({
      organizationId: orgA.id,
      actorId: ownerA.userId,
      actorType: "user",
      action: "scope.test",
      targetType: "test",
      targetId: "target",
    });
    await recordAuditLog({
      organizationId: orgB.id,
      actorId: ownerB.userId,
      actorType: "user",
      action: "scope.test",
      targetType: "test",
      targetId: "target",
    });

    const { entries } = await listAuditLogs({ organizationId: orgA.id, action: "scope.test" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.organizationId).toBe(orgA.id);
  });
});
