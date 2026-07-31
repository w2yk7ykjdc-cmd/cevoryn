"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import {
  addNote,
  addTagToContact,
  createContact,
  removeTagFromContact,
  softDeleteContact,
  updateContact,
} from "@/server/contacts/service";
import type { ActionResult } from "@/app/(dashboard)/dashboard/members/actions";

export async function createContactAction(input: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  title?: string;
  companyId?: string;
}): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ contact: ["create"] });

  if (!input.firstName.trim() || !input.lastName.trim()) {
    return { success: false, error: "First and last name are required" };
  }

  try {
    await createContact({
      organizationId: organization.id,
      actorId: session.user.id,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      title: input.title?.trim() || null,
      companyId: input.companyId || null,
    });
    revalidatePath("/dashboard/contacts");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create contact" };
  }
}

export async function updateContactAction(
  contactId: string,
  input: {
    firstName?: string;
    lastName?: string;
    email?: string | null;
    phone?: string | null;
    title?: string | null;
    companyId?: string | null;
  },
): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ contact: ["update"] });

  try {
    await updateContact({
      organizationId: organization.id,
      actorId: session.user.id,
      contactId,
      data: input,
    });
    revalidatePath("/dashboard/contacts");
    revalidatePath(`/dashboard/contacts/${contactId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update contact" };
  }
}

export async function deleteContactAction(contactId: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ contact: ["delete"] });

  try {
    await softDeleteContact(organization.id, contactId, session.user.id);
    revalidatePath("/dashboard/contacts");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to delete contact" };
  }
}

export async function addTagAction(contactId: string, tagName: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ contact: ["update"] });

  try {
    await addTagToContact(organization.id, session.user.id, contactId, tagName);
    revalidatePath(`/dashboard/contacts/${contactId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to add tag" };
  }
}

export async function removeTagAction(contactId: string, tagId: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ contact: ["update"] });

  try {
    await removeTagFromContact(organization.id, session.user.id, contactId, tagId);
    revalidatePath(`/dashboard/contacts/${contactId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to remove tag" };
  }
}

export async function addNoteAction(contactId: string, body: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ contact: ["update"] });

  if (!body.trim()) {
    return { success: false, error: "Note cannot be empty" };
  }

  try {
    await addNote(organization.id, session.user.id, contactId, body);
    revalidatePath(`/dashboard/contacts/${contactId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to add note" };
  }
}
