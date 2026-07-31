import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { recordAuditLog, publishAuditEvent } from "@/server/audit/audit-log";
import { CompanyNotFoundError } from "@/server/companies/types";
import type {
  CreateCompanyInput,
  ListCompaniesInput,
  UpdateCompanyInput,
} from "@/server/companies/types";

export async function createCompany(input: CreateCompanyInput) {
  const { company, auditEntry } = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        organizationId: input.organizationId,
        createdById: input.actorId,
        name: input.name,
        domain: input.domain ?? null,
        industry: input.industry ?? null,
        website: input.website ?? null,
        description: input.description ?? null,
      },
    });

    const auditEntry = await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        actorType: "user",
        action: "company.created",
        targetType: "company",
        targetId: company.id,
        metadata: { name: company.name },
      },
      tx,
    );

    return { company, auditEntry };
  });

  await publishAuditEvent(auditEntry);
  return company;
}

export async function updateCompany(input: UpdateCompanyInput) {
  const { company, auditEntry } = await prisma.$transaction(async (tx) => {
    const existing = await tx.company.findFirst({
      where: { id: input.companyId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!existing) {
      throw new CompanyNotFoundError(input.companyId);
    }

    const company = await tx.company.update({
      where: { id: existing.id },
      data: input.data,
    });

    const auditEntry = await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        actorType: "user",
        action: "company.updated",
        targetType: "company",
        targetId: company.id,
        metadata: { changes: input.data },
      },
      tx,
    );

    return { company, auditEntry };
  });

  await publishAuditEvent(auditEntry);
  return company;
}

export async function softDeleteCompany(
  organizationId: string,
  companyId: string,
  actorId: string,
) {
  const { auditEntry } = await prisma.$transaction(async (tx) => {
    const existing = await tx.company.findFirst({
      where: { id: companyId, organizationId, deletedAt: null },
    });
    if (!existing) {
      throw new CompanyNotFoundError(companyId);
    }

    await tx.company.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    const auditEntry = await recordAuditLog(
      {
        organizationId,
        actorId,
        actorType: "user",
        action: "company.deleted",
        targetType: "company",
        targetId: companyId,
        metadata: { name: existing.name },
      },
      tx,
    );

    return { auditEntry };
  });

  await publishAuditEvent(auditEntry);
}

export async function getCompany(organizationId: string, companyId: string) {
  const scoped = getTenantScopedClient(organizationId);
  return scoped.company.findFirst({
    where: { id: companyId, deletedAt: null },
    include: {
      _count: { select: { contacts: true, leads: true, tasks: true } },
    },
  });
}

export async function listCompanies(input: ListCompaniesInput) {
  const scoped = getTenantScopedClient(input.organizationId);
  const limit = Math.min(input.limit ?? 50, 200);

  const companies = await scoped.company.findMany({
    where: {
      deletedAt: null,
      name: input.query ? { contains: input.query, mode: "insensitive" } : undefined,
    },
    include: {
      _count: { select: { contacts: true, leads: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = companies.length > limit;
  const page = hasMore ? companies.slice(0, limit) : companies;

  return { companies: page, nextCursor: hasMore ? page[page.length - 1]?.id : null };
}
