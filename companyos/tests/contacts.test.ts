import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { createCompany } from "@/server/companies/service";
import {
  addNote,
  addTagToContact,
  createContact,
  getContact,
  listContacts,
  removeTagFromContact,
  softDeleteContact,
  updateContact,
  CompanyReferenceError,
} from "@/server/contacts/service";
import { ContactNotFoundError } from "@/server/contacts/types";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

describe("contacts", () => {
  afterAll(closeTestConnections);

  async function setup() {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    return { owner, organization };
  }

  it("creates a contact linked to a company and records an audit log entry", async () => {
    const { owner, organization } = await setup();
    const company = await createCompany({ organizationId: organization.id, actorId: owner.userId, name: "Acme" });

    const contact = await createContact({
      organizationId: organization.id,
      actorId: owner.userId,
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      companyId: company.id,
    });

    expect(contact.companyId).toBe(company.id);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "contact.created", targetId: contact.id },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("rejects a companyId that doesn't belong to the organization", async () => {
    const a = await setup();
    const b = await setup();
    const companyInB = await createCompany({ organizationId: b.organization.id, actorId: b.owner.userId, name: "B Co" });

    await expect(
      createContact({
        organizationId: a.organization.id,
        actorId: a.owner.userId,
        firstName: "Cross",
        lastName: "Tenant",
        companyId: companyInB.id,
      }),
    ).rejects.toThrow(CompanyReferenceError);
  });

  it("does not leak contacts across organizations", async () => {
    const a = await setup();
    const b = await setup();
    await createContact({ organizationId: a.organization.id, actorId: a.owner.userId, firstName: "A", lastName: "One" });
    await createContact({ organizationId: b.organization.id, actorId: b.owner.userId, firstName: "B", lastName: "Two" });

    const { contacts } = await listContacts({ organizationId: a.organization.id });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.firstName).toBe("A");
  });

  it("updates a contact and refuses cross-tenant updates", async () => {
    const { owner, organization } = await setup();
    const contact = await createContact({
      organizationId: organization.id,
      actorId: owner.userId,
      firstName: "First",
      lastName: "Last",
    });

    const updated = await updateContact({
      organizationId: organization.id,
      actorId: owner.userId,
      contactId: contact.id,
      data: { title: "VP Sales" },
    });
    expect(updated.title).toBe("VP Sales");

    const b = await setup();
    await expect(
      updateContact({
        organizationId: b.organization.id,
        actorId: b.owner.userId,
        contactId: contact.id,
        data: { title: "Hijacked" },
      }),
    ).rejects.toThrow(ContactNotFoundError);
  });

  it("adds and removes tags idempotently", async () => {
    const { owner, organization } = await setup();
    const contact = await createContact({
      organizationId: organization.id,
      actorId: owner.userId,
      firstName: "Tag",
      lastName: "Test",
    });

    await addTagToContact(organization.id, owner.userId, contact.id, "VIP");
    await addTagToContact(organization.id, owner.userId, contact.id, "vip"); // same tag, different case

    const withTags = await getContact(organization.id, contact.id);
    expect(withTags?.tags).toHaveLength(1);
    expect(withTags?.tags[0]?.tag.name).toBe("vip");

    const tagId = withTags!.tags[0]!.tag.id;
    await removeTagFromContact(organization.id, owner.userId, contact.id, tagId);

    const withoutTags = await getContact(organization.id, contact.id);
    expect(withoutTags?.tags).toHaveLength(0);
  });

  it("adds a note and records an audit log entry", async () => {
    const { owner, organization } = await setup();
    const contact = await createContact({
      organizationId: organization.id,
      actorId: owner.userId,
      firstName: "Note",
      lastName: "Test",
    });

    const note = await addNote(organization.id, owner.userId, contact.id, "Called, left voicemail.");
    expect(note.body).toBe("Called, left voicemail.");

    const withNotes = await getContact(organization.id, contact.id);
    expect(withNotes?.notes).toHaveLength(1);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "contact.note_added", targetId: contact.id },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("soft-deletes a contact: hidden from reads, audit logged", async () => {
    const { owner, organization } = await setup();
    const contact = await createContact({
      organizationId: organization.id,
      actorId: owner.userId,
      firstName: "Delete",
      lastName: "Me",
    });

    await softDeleteContact(organization.id, contact.id, owner.userId);

    expect(await getContact(organization.id, contact.id)).toBeNull();
    const { contacts } = await listContacts({ organizationId: organization.id });
    expect(contacts).toHaveLength(0);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "contact.deleted", targetId: contact.id },
    });
    expect(auditEntry).not.toBeNull();
  });
});
