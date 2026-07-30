import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { CrossTenantAccessError, getTenantScopedClient } from "@/server/db/tenant";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

describe("tenant isolation", () => {
  afterAll(closeTestConnections);

  async function twoOrgsWithAuditLogs() {
    const [ownerA, ownerB] = await Promise.all([signUpUser(), signUpUser()]);
    const [orgA, orgB] = await Promise.all([
      createOrgForUser(ownerA),
      createOrgForUser(ownerB),
    ]);

    await prisma.auditLog.create({
      data: {
        organizationId: orgA.id,
        actorId: ownerA.userId,
        actorType: "user",
        action: "test.marker",
        targetType: "organization",
        targetId: orgA.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: orgB.id,
        actorId: ownerB.userId,
        actorType: "user",
        action: "test.marker",
        targetType: "organization",
        targetId: orgB.id,
      },
    });

    return { orgA, orgB, ownerA, ownerB };
  }

  it("a query with no where clause still only returns the scoped tenant's rows", async () => {
    const { orgA, orgB } = await twoOrgsWithAuditLogs();
    const scopedToA = getTenantScopedClient(orgA.id);

    const rows = await scopedToA.auditLog.findMany({ where: { action: "test.marker" } });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === orgA.id)).toBe(true);
    expect(rows.some((r) => r.organizationId === orgB.id)).toBe(false);
  });

  it("throws instead of silently returning another tenant's row by id", async () => {
    const { orgA, orgB } = await twoOrgsWithAuditLogs();
    const scopedToA = getTenantScopedClient(orgA.id);

    const orgBRow = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: orgB.id, action: "test.marker" },
    });

    await expect(
      scopedToA.auditLog.findFirst({ where: { id: orgBRow.id } }),
    ).resolves.toBeNull(); // scoped query adds organizationId: orgA.id, so it just finds nothing

    await expect(
      scopedToA.auditLog.findFirst({
        where: { id: orgBRow.id, organizationId: orgB.id },
      }),
    ).rejects.toThrow(CrossTenantAccessError);
  });

  it("throws on attempting to create a row for a different tenant", async () => {
    const { orgA, orgB, ownerA } = await twoOrgsWithAuditLogs();
    const scopedToA = getTenantScopedClient(orgA.id);

    await expect(
      scopedToA.auditLog.create({
        data: {
          organizationId: orgB.id,
          actorId: ownerA.userId,
          actorType: "user",
          action: "test.cross_tenant_write",
          targetType: "organization",
          targetId: orgB.id,
        },
      }),
    ).rejects.toThrow(CrossTenantAccessError);
  });

  it("auto-injects organizationId on create when the caller omits it", async () => {
    const { orgA, ownerA } = await twoOrgsWithAuditLogs();
    const scopedToA = getTenantScopedClient(orgA.id);

    // The extension injects organizationId at runtime, but the generated
    // Prisma types don't know that — the static type still requires it, so
    // this data object is deliberately untyped.
    const dataWithoutOrganizationId = {
      actorId: ownerA.userId,
      actorType: "user",
      action: "test.auto_scoped",
      targetType: "organization",
      targetId: orgA.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const created = await scopedToA.auditLog.create({ data: dataWithoutOrganizationId });

    expect(created.organizationId).toBe(orgA.id);
  });
});
