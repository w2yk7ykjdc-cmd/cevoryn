import type { OpportunityStatus } from "@prisma/client";

export type { OpportunityStatus };

export type ListOpportunitiesInput = {
  organizationId: string;
  status?: OpportunityStatus;
  limit?: number;
  cursor?: string;
};
