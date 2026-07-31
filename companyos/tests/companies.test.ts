import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import {
  createCompany,
  getCompany,
  listCompanies,
  softDeleteCompany,
  updateCompany,
} from "@/server/companies/service";
import { CompanyNotFoundError } from "@/server/companies/types";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

describe("companies", () => {
  afterAll(closeTestConnections);

  async function setup() {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    return { owner, organization };
  }

  it("creates a company scoped to the organization and records an audit log entry", async () => {
    const { owner, organization } = await setup();

    const company = await createCompany({
      organizationId: organization.id,
      actorId: owner.userId,
      name: "Acme Inc",
      industry: "Manufacturing",
    });

    expect(company.organizationId).toBe(organization.id);
    expect(company.name).toBe("Acme Inc");

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "company.created", targetId: company.id },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorId).toBe(owner.userId);
  });

  it("does not leak companies across organizations", async () => {
    const a = await setup();
    const b = await setup();

    await createCompany({ organizationId: a.organization.id, actorId: a.owner.userId, name: "Org A Co" });
    await createCompany({ organizationId: b.organization.id, actorId: b.owner.userId, name: "Org B Co" });

    const { companies } = await listCompanies({ organizationId: a.organization.id });
    expect(companies).toHaveLength(1);
    expect(companies[0]?.name).toBe("Org A Co");
  });

  it("filters by name, case-insensitively", async () => {
    const { owner, organization } = await setup();
    await createCompany({ organizationId: organization.id, actorId: owner.userId, name: "Northwind Traders" });
    await createCompany({ organizationId: organization.id, actorId: owner.userId, name: "Contoso Ltd" });

    const { companies } = await listCompanies({ organizationId: organization.id, query: "north" });
    expect(companies).toHaveLength(1);
    expect(companies[0]?.name).toBe("Northwind Traders");
  });

  it("updates a company and records an audit log entry", async () => {
    const { owner, organization } = await setup();
    const company = await createCompany({ organizationId: organization.id, actorId: owner.userId, name: "Old Name" });

    const updated = await updateCompany({
      organizationId: organization.id,
      actorId: owner.userId,
      companyId: company.id,
      data: { name: "New Name", industry: "Retail" },
    });

    expect(updated.name).toBe("New Name");
    expect(updated.industry).toBe("Retail");

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "company.updated", targetId: company.id },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("refuses to update a company belonging to a different organization", async () => {
    const a = await setup();
    const b = await setup();
    const company = await createCompany({ organizationId: a.organization.id, actorId: a.owner.userId, name: "A Co" });

    await expect(
      updateCompany({
        organizationId: b.organization.id,
        actorId: b.owner.userId,
        companyId: company.id,
        data: { name: "Hijacked" },
      }),
    ).rejects.toThrow(CompanyNotFoundError);
  });

  it("soft-deletes a company: hidden from reads, audit logged, row still present", async () => {
    const { owner, organization } = await setup();
    const company = await createCompany({ organizationId: organization.id, actorId: owner.userId, name: "To Delete" });

    await softDeleteCompany(organization.id, company.id, owner.userId);

    const fetched = await getCompany(organization.id, company.id);
    expect(fetched).toBeNull();

    const { companies } = await listCompanies({ organizationId: organization.id });
    expect(companies.find((c) => c.id === company.id)).toBeUndefined();

    const raw = await prisma.company.findUnique({ where: { id: company.id } });
    expect(raw?.deletedAt).not.toBeNull();

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "company.deleted", targetId: company.id },
    });
    expect(auditEntry).not.toBeNull();
  });
});
