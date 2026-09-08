import type { RiskStatus } from "@prisma/client";

export type { RiskStatus };

export type ListRisksInput = {
  organizationId: string;
  status?: RiskStatus;
  limit?: number;
  cursor?: string;
};
