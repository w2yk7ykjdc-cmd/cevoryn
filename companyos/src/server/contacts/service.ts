import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { recordAuditLog, publishAuditEvent } from "@/server/audit/audit-log";
import { ContactNotFoundError } from "@/server/contacts/types";
import type {
  CreateContactInput,
  ListContactsInput,
  UpdateContactInput,
} from "@/server/contacts/types";

export class CompanyReferenceError extends Error {
  constructor(companyId: string) {
    super(`Company "${companyId}" was not found in this organization`);
    this.name = "CompanyReferenceError";
  }
}

async function assertCompanyBelongsToOrg(
  tx: Prisma.TransactionClient,
  organizationId: string,
  companyId: string,
) {
  const company = await tx.company.findFirst({
    where: { id: companyId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!company) {
    throw new CompanyReferenceError(companyId);
  }
}

export async function createContact(input: CreateContactInput) {
  const { contact, auditEntry } = await prisma.$transaction(async (tx) => {
    if (input.companyId) {
      await assertCompanyBelongsToOrg(tx, input.organizationId, input.companyId);
    }

    const contact = await tx.contact.create({
      data: {
        organizationId: input.organizationId,
        createdById: input.actorId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        title: input.title ?? null,
        companyId: input.companyId ?? null,
      },
    });

    const auditEntry = await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        actorType: "user",
        action: "contact.created",
        targetType: "contact",
        targetId: contact.id,
        metadata: { firstName: contact.firstName, lastName: contact.lastName },
      },
      tx,
    );

    return { contact, auditEntry };
  });

  await publishAuditEvent(auditEntry);
  return contact;
}

export async function updateContact(input: UpdateContactInput) {
  const { contact, auditEntry } = await prisma.$transaction(async (tx) => {
    const existing = await tx.contact.findFirst({
      where: { id: input.contactId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!existing) {
      throw new ContactNotFoundError(input.contactId);
    }
    if (input.data.companyId) {
      await assertCompanyBelongsToOrg(tx, input.organizationId, input.data.companyId);
    }

    const contact = await tx.contact.update({
      where: { id: existing.id },
      data: input.data,
    });

    const auditEntry = await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        actorType: "user",
        action: "contact.updated",
        targetType: "contact",
        targetId: contact.id,
        metadata: { changes: input.data },
      },
      tx,
    );

    return { contact, auditEntry };
  });

  await publishAuditEvent(auditEntry);
  return contact;
}

export async function softDeleteContact(
  organizationId: string,
  contactId: string,
  actorId: string,
) {
  const { auditEntry } = await prisma.$transaction(async (tx) => {
    const existing = await tx.contact.findFirst({
      where: { id: contactId, organizationId, deletedAt: null },
    });
    if (!existing) {
      throw new ContactNotFoundError(contactId);
    }

    await tx.contact.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });

    const auditEntry = await recordAuditLog(
      {
        organizationId,
        actorId,
        actorType: "user",
        action: "contact.deleted",
        targetType: "contact",
        targetId: contactId,
        metadata: { firstName: existing.firstName, lastName: existing.lastName },
      },
      tx,
    );

    return { auditEntry };
  });

  await publishAuditEvent(auditEntry);
}

export async function getContact(organizationId: string, contactId: string) {
  const scoped = getTenantScopedClient(organizationId);
  return scoped.contact.findFirst({
    where: { id: contactId, deletedAt: null },
    include: {
      company: true,
      tags: { include: { tag: true } },
      notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
    },
  });
}

export async function listContacts(input: ListContactsInput) {
  const scoped = getTenantScopedClient(input.organizationId);
  const limit = Math.min(input.limit ?? 50, 200);

  const contacts = await scoped.contact.findMany({
    where: {
      deletedAt: null,
      companyId: input.companyId,
      tags: input.tagId ? { some: { tagId: input.tagId } } : undefined,
      OR: input.query
        ? [
            { firstName: { contains: input.query, mode: "insensitive" } },
            { lastName: { contains: input.query, mode: "insensitive" } },
            { email: { contains: input.query, mode: "insensitive" } },
          ]
        : undefined,
    },
    include: {
      company: { select: { id: true, name: true } },
      tags: { include: { tag: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = contacts.length > limit;
  const page = hasMore ? contacts.slice(0, limit) : contacts;

  return { contacts: page, nextCursor: hasMore ? page[page.length - 1]?.id : null };
}

// ── Tags ────────────────────────────────────────────────────────────────

export async function listTags(organizationId: string) {
  const scoped = getTenantScopedClient(organizationId);
  return scoped.tag.findMany({ orderBy: { name: "asc" } });
}

export async function addTagToContact(
  organizationId: string,
  actorId: string,
  contactId: string,
  tagName: string,
) {
  const normalized = tagName.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Tag name cannot be empty");
  }

  const { auditEntry } = await prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findFirst({
      where: { id: contactId, organizationId, deletedAt: null },
    });
    if (!contact) {
      throw new ContactNotFoundError(contactId);
    }

    const tag = await tx.tag.upsert({
      where: { organizationId_name: { organizationId, name: normalized } },
      create: { organizationId, name: normalized },
      update: {},
    });

    await tx.contactTag.upsert({
      where: { contactId_tagId: { contactId, tagId: tag.id } },
      create: { contactId, tagId: tag.id },
      update: {},
    });

    const auditEntry = await recordAuditLog(
      {
        organizationId,
        actorId,
        actorType: "user",
        action: "contact.tag_added",
        targetType: "contact",
        targetId: contactId,
        metadata: { tag: normalized },
      },
      tx,
    );

    return { auditEntry };
  });

  await publishAuditEvent(auditEntry);
}

export async function removeTagFromContact(
  organizationId: string,
  actorId: string,
  contactId: string,
  tagId: string,
) {
  const { auditEntry } = await prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findFirst({
      where: { id: contactId, organizationId, deletedAt: null },
    });
    if (!contact) {
      throw new ContactNotFoundError(contactId);
    }

    await tx.contactTag.deleteMany({ where: { contactId, tagId } });

    const auditEntry = await recordAuditLog(
      {
        organizationId,
        actorId,
        actorType: "user",
        action: "contact.tag_removed",
        targetType: "contact",
        targetId: contactId,
        metadata: { tagId },
      },
      tx,
    );

    return { auditEntry };
  });

  await publishAuditEvent(auditEntry);
}

// ── Notes ───────────────────────────────────────────────────────────────

export async function addNote(
  organizationId: string,
  actorId: string,
  contactId: string,
  body: string,
) {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error("Note body cannot be empty");
  }

  const { note, auditEntry } = await prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findFirst({
      where: { id: contactId, organizationId, deletedAt: null },
    });
    if (!contact) {
      throw new ContactNotFoundError(contactId);
    }

    const note = await tx.contactNote.create({
      data: { contactId, authorId: actorId, body: trimmed },
    });

    const auditEntry = await recordAuditLog(
      {
        organizationId,
        actorId,
        actorType: "user",
        action: "contact.note_added",
        targetType: "contact",
        targetId: contactId,
        metadata: { noteId: note.id },
      },
      tx,
    );

    return { note, auditEntry };
  });

  await publishAuditEvent(auditEntry);
  return note;
}
