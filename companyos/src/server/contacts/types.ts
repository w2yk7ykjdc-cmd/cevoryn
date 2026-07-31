export type CreateContactInput = {
  organizationId: string;
  actorId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  companyId?: string | null;
};

export type UpdateContactInput = {
  organizationId: string;
  actorId: string;
  contactId: string;
  data: {
    firstName?: string;
    lastName?: string;
    email?: string | null;
    phone?: string | null;
    title?: string | null;
    companyId?: string | null;
  };
};

export type ListContactsInput = {
  organizationId: string;
  query?: string;
  companyId?: string;
  tagId?: string;
  cursor?: string;
  limit?: number;
};

export class ContactNotFoundError extends Error {
  constructor(contactId: string) {
    super(`Contact "${contactId}" was not found in this organization`);
    this.name = "ContactNotFoundError";
  }
}
