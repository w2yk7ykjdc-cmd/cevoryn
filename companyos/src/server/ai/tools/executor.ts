import type { Prisma } from "@prisma/client";
import type { ToolCall } from "@/server/ai/providers/types";
import type { ToolContext, ToolExecutionResult } from "@/server/ai/tools/types";
import { getTool } from "@/server/ai/tools/registry";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db/client";
import { publishEvent } from "@/server/events/event-bus";
import { logger } from "@/server/logger/logger";
import { resolveAutonomyDecision } from "@/server/ai/autonomy/resolve";
import { requestApproval } from "@/server/ai/approval/service";

/**
 * Executes a single tool call requested by a model, enforcing (in order):
 * 1. The tool exists.
 * 2. The caller's organization membership holds `requiredPermission`, if any.
 * 3. For any non-`read_only` tool, `resolveAutonomyDecision` — this is the
 *    single, central autonomy enforcement point in the platform (Sprint 9):
 *    both the interactive chat path (`ai/runtime/runtime.ts`) and the agent
 *    run path (`ai/agent/executor.ts`) funnel every tool call through this
 *    same function, so a mutating tool can never bypass approval/policy
 *    enforcement by going through one caller instead of the other.
 * 4. The arguments the model produced validate against the tool's Zod schema.
 *
 * Every invocation that actually runs the handler — success or failure —
 * is persisted to `ToolInvocation` and published as `ai.tool.invoked`. A
 * call blocked or queued by the autonomy gate never reaches the handler,
 * so it never produces a `ToolInvocation` row or an `ai.tool.invoked`
 * event either — `AutonomousActionLog` (written synchronously inside
 * `resolveAutonomyDecision` itself) is its audit trail instead.
 */
export async function executeToolCall(
  call: ToolCall,
  ctx: ToolContext,
  requestHeaders: Headers,
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  const tool = getTool(call.name);

  if (!tool) {
    return finalize(ctx, call, { status: "error", error: `Unknown tool "${call.name}"`, durationMs: Date.now() - startedAt });
  }

  if (tool.requiredPermission) {
    const permitted = await auth.api.hasPermission({
      headers: requestHeaders,
      body: {
        organizationId: ctx.organizationId,
        permissions: tool.requiredPermission as Record<string, string[]>,
      },
    });
    if (!permitted.success) {
      return finalize(ctx, call, {
        status: "error",
        error: `Missing permission to execute tool "${call.name}"`,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  if (tool.mutationCategory !== "read_only" && !ctx.preApprovedApprovalId) {
    const decision = await resolveAutonomyDecision({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      toolName: call.name,
      domain: tool.domain,
      mutationCategory: tool.mutationCategory,
      blastRadius: tool.blastRadius,
      autonomyEligible: tool.autonomyEligible,
      actionRiskValue: tool.actionRiskValue,
      input: call.arguments,
      triggeredBy: ctx.triggeredBy ?? "interactive_chat",
    });

    if (decision.outcome === "requires_approval") {
      const { approvalId, agentRunId } = await openApprovalForCall(ctx, call, tool.domain ?? "crm");
      return { status: "pending_approval", approvalId, agentRunId, durationMs: Date.now() - startedAt };
    }

    if (decision.outcome !== "executed") {
      return { status: "error", error: decision.reason, durationMs: Date.now() - startedAt };
    }
    // outcome === "executed" -> fall through to schema validation + handler below.
  }

  const parsed = tool.schema.safeParse(call.arguments);
  if (!parsed.success) {
    return finalize(ctx, call, {
      status: "error",
      error: `Invalid arguments: ${parsed.error.message}`,
      durationMs: Date.now() - startedAt,
    });
  }

  try {
    const output = await tool.handler(parsed.data, ctx);
    return finalize(ctx, call, { status: "success", output, durationMs: Date.now() - startedAt });
  } catch (err) {
    logger.error({ err, tool: call.name, ctx }, "tool handler threw");
    return finalize(ctx, call, {
      status: "error",
      error: err instanceof Error ? err.message : "Tool execution failed",
      durationMs: Date.now() - startedAt,
    });
  }
}

/**
 * Opens an `AgentApproval` for a call the autonomy gate just queued.
 * If `ctx` already identifies an existing `AgentRun`/`AgentStep` (a call
 * made from `ai/agent/executor.ts`'s own step loop), the approval is
 * attached to THAT run/step rather than a new one — this only fires when
 * the agent executor's own pre-check disagreed with `resolveAutonomyDecision`
 * and let a call through that this gate still wants to block, since the
 * pre-check normally already pauses the run before `executeToolCall` is
 * ever reached. Otherwise (an interactive-chat-triggered call, which has
 * no `AgentRun` at all) this implicitly wraps the single call in a minimal
 * one-step `AgentRun` — reusing the exact same `AgentRun`/`AgentStep`/
 * `AgentApproval` infrastructure `startAgentRun` uses, rather than a
 * second, parallel approval mechanism.
 */
async function openApprovalForCall(
  ctx: ToolContext,
  call: ToolCall,
  domain: string,
): Promise<{ approvalId: string; agentRunId: string }> {
  const reason = `"${call.name}" is classified as requiring approval (domain: "${domain}") before it runs.`;

  if (ctx.agentRunId && ctx.agentStepId) {
    const approval = await requestApproval({
      organizationId: ctx.organizationId,
      agentRunId: ctx.agentRunId,
      toolName: call.name,
      input: call.arguments,
      reason,
    });
    await prisma.agentStep.update({ where: { id: ctx.agentStepId }, data: { approvalId: approval.id } });
    await prisma.agentRun.update({ where: { id: ctx.agentRunId }, data: { status: "waiting_approval" } });
    return { approvalId: approval.id, agentRunId: ctx.agentRunId };
  }

  const { run, step } = await prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.create({
      data: {
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
        goal: `Chat-initiated tool call: ${call.name}`,
        plan: [{ toolName: call.name, input: call.arguments }] as unknown as Prisma.InputJsonValue,
        status: "waiting_approval",
      },
    });
    const step = await tx.agentStep.create({
      data: {
        agentRunId: run.id,
        stepIndex: 0,
        toolName: call.name,
        input: call.arguments as Prisma.InputJsonValue,
        status: "pending",
      },
    });
    return { run, step };
  });

  const approval = await requestApproval({
    organizationId: ctx.organizationId,
    agentRunId: run.id,
    toolName: call.name,
    input: call.arguments,
    reason,
  });
  await prisma.agentStep.update({ where: { id: step.id }, data: { approvalId: approval.id } });

  return { approvalId: approval.id, agentRunId: run.id };
}

async function finalize(
  ctx: ToolContext,
  call: ToolCall,
  result: Extract<ToolExecutionResult, { status: "success" | "error" }>,
): Promise<ToolExecutionResult> {
  await prisma.toolInvocation.create({
    data: {
      conversationId: ctx.conversationId,
      toolName: call.name,
      input: call.arguments as Prisma.InputJsonValue,
      output: result.status === "success" ? (result.output as Prisma.InputJsonValue) : undefined,
      status: result.status,
      errorMessage: result.status === "error" ? result.error : null,
      durationMs: result.durationMs,
    },
  });

  await publishEvent(
    "ai.tool.invoked",
    {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      toolName: call.name,
      status: result.status,
      durationMs: result.durationMs,
    },
    { organizationId: ctx.organizationId },
  );

  return result;
}
