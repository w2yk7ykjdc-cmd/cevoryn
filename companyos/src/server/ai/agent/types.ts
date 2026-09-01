import type { Prisma } from "@prisma/client";

export type AgentRunWithSteps = Prisma.AgentRunGetPayload<{
  include: { steps: true; approvals: true };
}>;

export class AgentRunNotFoundError extends Error {
  constructor(agentRunId: string) {
    super(`Agent run "${agentRunId}" not found`);
    this.name = "AgentRunNotFoundError";
  }
}

export class AgentRunNotResumableError extends Error {
  constructor(agentRunId: string, status: string) {
    super(`Agent run "${agentRunId}" is not waiting for approval (status: ${status})`);
    this.name = "AgentRunNotResumableError";
  }
}

export class AgentRunOrphanedUserError extends Error {
  constructor(agentRunId: string) {
    super(`Agent run "${agentRunId}" cannot be resumed — the user who started it no longer has an account.`);
    this.name = "AgentRunOrphanedUserError";
  }
}

export class ApprovalNotResolvedError extends Error {
  constructor(approvalId: string) {
    super(`Approval "${approvalId}" is still pending a decision`);
    this.name = "ApprovalNotResolvedError";
  }
}
