import "@/server/ai/tools/builtin"; // registers built-in tools as a side effect
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { AIProvider, ChatMessage, ProviderId } from "@/server/ai/providers/types";
import { createPlan } from "@/server/ai/planner/planner";
import { classifyToolRisk } from "@/server/ai/approval/policy";
import { requestApproval } from "@/server/ai/approval/service";
import { executeToolCall } from "@/server/ai/tools/executor";
import { recordAuditLog, publishAuditEvent, type ActorType } from "@/server/audit/audit-log";
import { checkUsageLimit, recordUsage } from "@/server/billing/usage";
import { logger } from "@/server/logger/logger";
import {
  AgentRunNotFoundError,
  AgentRunNotResumableError,
  AgentRunOrphanedUserError,
  ApprovalNotResolvedError,
  type AgentRunWithSteps,
} from "@/server/ai/agent/types";

export type StartAgentRunInput = {
  organizationId: string;
  userId: string;
  conversationId: string;
  goal: string;
  requestHeaders: Headers;
  history?: ChatMessage[];
  provider?: AIProvider;
  providerId?: ProviderId;
  model?: string;
};

/**
 * Analyzes `goal` into a plan (`src/server/ai/planner`) and executes it step
 * by step through the RBAC-checked Tool Engine — the same `executeToolCall`
 * Sprint 0's chat runtime uses, so the model never has a path to the
 * database that bypasses a tool. Execution halts immediately if a step
 * fails, or pauses for a human decision if a step is classified as risky by
 * `src/server/ai/approval/policy`. Call `continueAgentRun` to resume once
 * the blocking approval has been decided.
 */
export async function startAgentRun(input: StartAgentRunInput): Promise<AgentRunWithSteps> {
  await checkUsageLimit(input.organizationId, "agent_run");
  await checkUsageLimit(input.organizationId, "ai_tokens");

  const plan = await createPlan({
    goal: input.goal,
    history: input.history,
    provider: input.provider,
    providerId: input.providerId,
    model: input.model,
  });
  await recordUsage(input.organizationId, "ai_tokens", plan.usage.inputTokens + plan.usage.outputTokens);
  await recordUsage(input.organizationId, "agent_run", 1);

  let auditEntry: { id: string; organizationId: string; action: string } | undefined;
  const created = await prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.create({
      data: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        userId: input.userId,
        goal: input.goal,
        plan: plan.steps as unknown as Prisma.InputJsonValue,
        status: plan.steps.length > 0 ? "running" : "completed",
        resultSummary: plan.steps.length === 0 ? (plan.directAnswer ?? "No action was needed.") : null,
        completedAt: plan.steps.length === 0 ? new Date() : null,
      },
    });

    if (plan.steps.length > 0) {
      await tx.agentStep.createMany({
        data: plan.steps.map((step, index) => ({
          agentRunId: run.id,
          stepIndex: index,
          toolName: step.toolName,
          input: step.input as Prisma.InputJsonValue,
          status: "pending" as const,
        })),
      });
    }

    auditEntry = await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorId: input.userId,
        actorType: "user",
        action: "agent.run_started",
        targetType: "agent_run",
        targetId: run.id,
        metadata: { goal: input.goal, stepCount: plan.steps.length },
      },
      tx,
    );

    return run;
  });

  if (auditEntry) await publishAuditEvent(auditEntry);

  if (created.status === "completed") {
    return loadRun(created.id, input.organizationId);
  }

  return runFromPendingSteps({
    agentRunId: created.id,
    organizationId: input.organizationId,
    userId: input.userId,
    conversationId: input.conversationId,
    requestHeaders: input.requestHeaders,
  });
}

export type ContinueAgentRunInput = {
  agentRunId: string;
  organizationId: string;
  requestHeaders: Headers;
};

/** Resumes a run that is `waiting_approval` once the blocking approval has been decided (approved or rejected). */
export async function continueAgentRun(input: ContinueAgentRunInput): Promise<AgentRunWithSteps> {
  const run = await prisma.agentRun.findFirst({
    where: { id: input.agentRunId, organizationId: input.organizationId },
  });
  if (!run) throw new AgentRunNotFoundError(input.agentRunId);
  if (run.status !== "waiting_approval") {
    throw new AgentRunNotResumableError(input.agentRunId, run.status);
  }

  const blockedStep = await prisma.agentStep.findFirst({
    where: { agentRunId: run.id, status: "pending" },
    orderBy: { stepIndex: "asc" },
    include: { approval: true },
  });
  if (blockedStep?.approval && blockedStep.approval.status === "pending") {
    throw new ApprovalNotResolvedError(blockedStep.approval.id);
  }

  // `userId` is nullable on AgentRun (SetNull if the initiating user's
  // account is later deleted, so the run's history survives) — but
  // `runFromPendingSteps` attributes further tool calls/audit entries to a
  // real user, so a run orphaned this way cannot be resumed.
  if (!run.userId) {
    throw new AgentRunOrphanedUserError(run.id);
  }

  return runFromPendingSteps({
    agentRunId: run.id,
    organizationId: input.organizationId,
    userId: run.userId,
    conversationId: run.conversationId,
    requestHeaders: input.requestHeaders,
  });
}

export async function getAgentRun(agentRunId: string, organizationId: string): Promise<AgentRunWithSteps> {
  return loadRun(agentRunId, organizationId);
}

export async function listAgentRuns(organizationId: string, conversationId?: string) {
  return prisma.agentRun.findMany({
    where: { organizationId, conversationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

type RunCtx = {
  agentRunId: string;
  organizationId: string;
  userId: string;
  conversationId: string;
  requestHeaders: Headers;
};

/**
 * The shared run loop: executes every `pending` step in order, starting
 * wherever a fresh run or a resumed one left off. Returns as soon as the
 * run reaches a terminal or paused state — `completed`, `failed`, or
 * `waiting_approval` — never partially applying more than one halting
 * condition per call.
 */
async function runFromPendingSteps(ctx: RunCtx): Promise<AgentRunWithSteps> {
  await prisma.agentRun.update({ where: { id: ctx.agentRunId }, data: { status: "running" } });

  const steps = await prisma.agentStep.findMany({
    where: { agentRunId: ctx.agentRunId, status: "pending" },
    orderBy: { stepIndex: "asc" },
    include: { approval: true },
  });

  for (const step of steps) {
    const risk = classifyToolRisk(step.toolName);

    if (risk === "requires_approval") {
      if (!step.approval) {
        const approval = await requestApproval({
          organizationId: ctx.organizationId,
          agentRunId: ctx.agentRunId,
          toolName: step.toolName,
          input: step.input as Record<string, unknown>,
          reason: `"${step.toolName}" is classified as a risky action and requires approval before it runs.`,
        });
        await prisma.agentStep.update({ where: { id: step.id }, data: { approvalId: approval.id } });
        await prisma.agentRun.update({ where: { id: ctx.agentRunId }, data: { status: "waiting_approval" } });
        return loadRun(ctx.agentRunId, ctx.organizationId);
      }

      if (step.approval.status === "pending") {
        await prisma.agentRun.update({ where: { id: ctx.agentRunId }, data: { status: "waiting_approval" } });
        return loadRun(ctx.agentRunId, ctx.organizationId);
      }

      if (step.approval.status === "rejected") {
        await prisma.agentStep.update({
          where: { id: step.id },
          data: { status: "skipped", errorMessage: "Rejected by approver.", completedAt: new Date() },
        });
        await recordAgentAudit(ctx, "ai", "agent.step_skipped", "agent_step", step.id, {
          toolName: step.toolName,
          reason: "rejected",
        });
        continue;
      }
      // status === "approved" falls through to execution below.
    }

    await prisma.agentStep.update({ where: { id: step.id }, data: { status: "running", startedAt: new Date() } });

    const result = await executeToolCall(
      { id: step.id, name: step.toolName, arguments: step.input as Record<string, unknown> },
      { organizationId: ctx.organizationId, userId: ctx.userId, conversationId: ctx.conversationId },
      ctx.requestHeaders,
    );

    if (result.status === "success") {
      await prisma.agentStep.update({
        where: { id: step.id },
        data: { status: "succeeded", output: result.output as Prisma.InputJsonValue, completedAt: new Date() },
      });
      await recordAgentAudit(ctx, "ai", "agent.step_succeeded", "agent_step", step.id, { toolName: step.toolName });
      continue;
    }

    // A failed tool call halts the entire run — no further steps run once
    // one has failed, so a partially-applied multi-step action never leaves
    // the tenant's data in a silently inconsistent state.
    await prisma.agentStep.update({
      where: { id: step.id },
      data: { status: "failed", errorMessage: result.error, completedAt: new Date() },
    });
    await recordAgentAudit(ctx, "ai", "agent.step_failed", "agent_step", step.id, {
      toolName: step.toolName,
      error: result.error,
    });

    const failedRun = await prisma.agentRun.update({
      where: { id: ctx.agentRunId },
      data: {
        status: "failed",
        errorMessage: `Step "${step.toolName}" failed: ${result.error}`,
        completedAt: new Date(),
      },
    });
    await recordAgentAudit(ctx, "ai", "agent.run_failed", "agent_run", ctx.agentRunId, {
      errorMessage: failedRun.errorMessage,
    });
    logger.warn(
      { agentRunId: ctx.agentRunId, toolName: step.toolName, error: result.error },
      "agent run halted after tool failure",
    );
    return loadRun(ctx.agentRunId, ctx.organizationId);
  }

  const resultSummary = await summarizeRun(ctx.agentRunId);
  const completedRun = await prisma.agentRun.update({
    where: { id: ctx.agentRunId },
    data: { status: "completed", resultSummary, completedAt: new Date() },
  });
  await recordAgentAudit(ctx, "ai", "agent.run_completed", "agent_run", completedRun.id, { resultSummary });
  return loadRun(completedRun.id, ctx.organizationId);
}

async function summarizeRun(agentRunId: string): Promise<string> {
  const steps = await prisma.agentStep.findMany({ where: { agentRunId } });
  const succeeded = steps.filter((s) => s.status === "succeeded").length;
  const skipped = steps.filter((s) => s.status === "skipped").length;
  const total = steps.length;
  return `Completed ${succeeded}/${total} step(s)${skipped > 0 ? `, ${skipped} skipped after rejection` : ""}.`;
}

async function loadRun(agentRunId: string, organizationId: string): Promise<AgentRunWithSteps> {
  const run = await prisma.agentRun.findFirst({
    where: { id: agentRunId, organizationId },
    include: { steps: { orderBy: { stepIndex: "asc" } }, approvals: { orderBy: { createdAt: "asc" } } },
  });
  if (!run) throw new AgentRunNotFoundError(agentRunId);
  return run;
}

async function recordAgentAudit(
  ctx: RunCtx,
  actorType: ActorType,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    actorType,
    action,
    targetType,
    targetId,
    metadata: metadata as Prisma.InputJsonValue,
  });
}
