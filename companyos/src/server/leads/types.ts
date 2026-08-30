import type { LeadActivityType } from "@prisma/client";

export type CreateLeadInput = {
  organizationId: string;
  actorId: string;
  title: string;
  stageId?: string;
  companyId?: string | null;
  contactId?: string | null;
  value?: number;
  probability?: number;
  source?: string | null;
  ownerId?: string | null;
};

export type UpdateLeadInput = {
  organizationId: string;
  actorId: string;
  leadId: string;
  data: {
    title?: string;
    companyId?: string | null;
    contactId?: string | null;
    value?: number;
    probability?: number;
    source?: string | null;
    ownerId?: string | null;
  };
};

export type ListLeadsInput = {
  organizationId: string;
  stageId?: string;
  companyId?: string;
  ownerId?: string;
  query?: string;
  cursor?: string;
  limit?: number;
};

export type AddLeadActivityInput = {
  organizationId: string;
  leadId: string;
  type: LeadActivityType;
  body?: string | null;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
};

export class LeadCompanyReferenceError extends Error {
  constructor(companyId: string) {
    super(`Company "${companyId}" was not found in this organization`);
    this.name = "LeadCompanyReferenceError";
  }
}

export class LeadContactReferenceError extends Error {
  constructor(contactId: string) {
    super(`Contact "${contactId}" was not found in this organization`);
    this.name = "LeadContactReferenceError";
  }
}

export class LeadOwnerReferenceError extends Error {
  constructor(ownerId: string) {
    super(`User "${ownerId}" is not a member of this organization`);
    this.name = "LeadOwnerReferenceError";
  }
}

export class LeadNotFoundError extends Error {
  constructor(leadId: string) {
    super(`Lead "${leadId}" was not found in this organization`);
    this.name = "LeadNotFoundError";
  }
}

export class PipelineStageNotFoundError extends Error {
  constructor(stageId: string) {
    super(`Pipeline stage "${stageId}" was not found in this organization`);
    this.name = "PipelineStageNotFoundError";
  }
}
