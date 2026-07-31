export type CreateCompanyInput = {
  organizationId: string;
  actorId: string;
  name: string;
  domain?: string | null;
  industry?: string | null;
  website?: string | null;
  description?: string | null;
};

export type UpdateCompanyInput = {
  organizationId: string;
  actorId: string;
  companyId: string;
  data: {
    name?: string;
    domain?: string | null;
    industry?: string | null;
    website?: string | null;
    description?: string | null;
  };
};

export type ListCompaniesInput = {
  organizationId: string;
  query?: string;
  cursor?: string;
  limit?: number;
};

export class CompanyNotFoundError extends Error {
  constructor(companyId: string) {
    super(`Company "${companyId}" was not found in this organization`);
    this.name = "CompanyNotFoundError";
  }
}
