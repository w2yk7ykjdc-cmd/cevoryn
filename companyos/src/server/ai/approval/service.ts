import type { AgentApproval, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { auth } from "@/server/auth/auth";
import { getTool } from "@/server/ai/tools/registry";
import { recordAuditLog } from "@/server/audit/audit-log";

export class ApprovalNotFoundError extends Error {
  constructor(approvalId: string) {
    super(`Approval "${approvalId}" not found`);
    this.name = "ApprovalNotFoundError";
  }
}

export class ApprovalAlreadyDecidedError extends Error {
  constructor(approvalId: string) {
    super(`Approval "${approvalId}" has already been decided`);
    this.name = "ApprovalAlreadyDecidedError";
  }
}

export class ApprovalPermissionError extends Error {
  constructor(toolName: string) {
    super(`Missing permission to decide an approval for tool "${toolName}"`);
    this.name = "ApprovalPermissionError";
  }
}

export type RequestApprovalInput = {
  organizationId: string;
  agentRunId: string;
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
};

/** Opens a pending approval for one risky step. Called by the agent executor when it reaches a gated tool. */
export async function requestApproval(
  input: RequestApprovalInput,
  tx?: Prisma.TransactionClient,
): Promise<AgentApproval> {
  const client = tx ?? prisma;
  return client.agentApproval.create({
    data: {
      organizationId: input.organizationId,
      agentRunId: input.agentRunId,
      toolName: input.toolName,
      input: input.input as Prisma.InputJsonValue,
      reason: input.reason,
      status: "pending",
    },
  });
}

export type DecideApprovalInput = {
  approvalId: string;
  organizationId: string;
  decidedById: string;
  decision: "approved" | "rejected";
  decisionNote?: string;
  requestHeaders: Headers;
};

/**
 * Approves or rejects a pending approval. The decider must hold the
 * *underlying tool's own* `requiredPermission` — there is no separate
 * "approver" RBAC resource; approving a `create_task` step requires
 * `task:create`, the same permission the Tool Engine would check if the
 * step ran without a gate. This reuses Sprint 0's RBAC check exactly and
 * adds no new permission surface.
 */
export async function decideApproval(input: DecideApprovalInput): Promise<AgentApproval> {
  const approval = await prisma.agentApproval.findFirst({
    where: { id: input.approvalId, organizationId: input.organizationId },
  });
  if (!approval) {
    throw new ApprovalNotFoundError(input.approvalId);
  }
  if (approval.status !== "pending") {
    throw new ApprovalAlreadyDecidedError(input.approvalId);
  }

  const tool = getTool(approval.toolName);
  if (tool?.requiredPermission) {
    const permitted = await auth.api.hasPermission({
      headers: input.requestHeaders,
      body: {
        organizationId: input.organizationId,
        permissions: tool.requiredPermission as Record<string, string[]>,
      },
    });
    if (!permitted.success) {
      throw new ApprovalPermissionError(approval.toolName);
    }
  }

  const updated = await prisma.agentApproval.update({
    where: { id: approval.id },
    data: {
      status: input.decision,
      decidedById: input.decidedById,
      decidedAt: new Date(),
      decisionNote: input.decisionNote ?? null,
    },
  });

  await recordAuditLog({
    organizationId: input.organizationId,
    actorId: input.decidedById,
    actorType: "user",
    action: input.decision === "approved" ? "agent.approval_approved" : "agent.approval_rejected",
    targetType: "agent_approval",
    targetId: approval.id,
    metadata: { toolName: approval.toolName, agentRunId: approval.agentRunId },
  });

  return updated;
}

export async function listPendingApprovals(organizationId: string): Promise<AgentApproval[]> {
  return prisma.agentApproval.findMany({
    where: { organizationId, status: "pending" },
    orderBy: { createdAt: "asc" },
  });
}

export async function getApproval(
  approvalId: string,
  organizationId: string,
): Promise<AgentApproval | null> {
  return prisma.agentApproval.findFirst({ where: { id: approvalId, organizationId } });
}
