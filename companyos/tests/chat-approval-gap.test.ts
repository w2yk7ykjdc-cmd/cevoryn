import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { executeToolCall } from "@/server/ai/tools/executor";
import { resolveAutonomyDecision } from "@/server/ai/autonomy/resolve";
import { createConversation } from "@/server/ai/runtime/conversations";
import { decideApproval } from "@/server/ai/approval/service";
import { continueAgentRun } from "@/server/ai/agent/executor";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders } from "./helpers";

/**
 * Sprint 9 closes a specific pre-existing gap: `runConversationTurn` and
 * `streamConversationTurn` (`ai/runtime/runtime.ts`) used to call
 * `executeToolCall` directly with no `classifyToolRisk`/`requestApproval`
 * involvement at all, so a `requires_approval`-classified tool executed
 * immediately via chat while correctly pausing via the agent-run path
 * (`ai/agent/executor.ts`). The fix moved enforcement inside
 * `executeToolCall` itself — the one function both callers already funnel
 * through — rather than duplicating a check in each caller. These tests
 * exercise `executeToolCall` with the exact `ToolContext` shape each real
 * caller constructs: `runtime.ts` passes only
 * `{organizationId, userId, conversationId}` (no `agentRunId`/`agentStepId`,
 * default `triggeredBy`), which is what "the chat path" means below.
 */
describe("Chat-approval gap: chat and agent-run paths reach identical autonomy decisions", () => {
  afterAll(closeTestConnections);

  it("a gated tool invoked with the chat path's exact ctx shape now pauses for approval, not executes immediately", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });

    // This is exactly the ctx shape runConversationTurn/streamConversationTurn
    // build in ai/runtime/runtime.ts -- no agentRunId/agentStepId, no
    // triggeredBy override.
    const result = await executeToolCall(
      { id: "gap-1", name: "create_task", arguments: { title: "Should not run immediately" } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );

    expect(result.status).toBe("pending_approval");
    if (result.status !== "pending_approval") throw new Error("unreachable");

    // Before Sprint 9 this would have created a Task synchronously. It must not have.
    const tasks = await prisma.task.findMany({ where: { organizationId: organization.id } });
    expect(tasks).toHaveLength(0);

    // A real AgentApproval now genuinely blocks it, exactly like the agent-run path would.
    const approval = await prisma.agentApproval.findUniqueOrThrow({ where: { id: result.approvalId } });
    expect(approval.status).toBe("pending");
    expect(approval.toolName).toBe("create_task");
  });

  it("resolveAutonomyDecision reaches the identical outcome for the same tool/org/policy state regardless of triggeredBy", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const chatDecision = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "create_task",
      domain: "crm",
      mutationCategory: "mutating_gated",
      blastRadius: "additive",
      autonomyEligible: false,
      input: {},
      triggeredBy: "interactive_chat",
    });
    const agentRunDecision = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "create_task",
      domain: "crm",
      mutationCategory: "mutating_gated",
      blastRadius: "additive",
      autonomyEligible: false,
      input: {},
      triggeredBy: "agent_run",
    });

    expect(chatDecision.outcome).toBe(agentRunDecision.outcome);
    expect(chatDecision.outcome).toBe("requires_approval");

    // triggeredBy is still recorded distinctly on each AutonomousActionLog row -- it
    // changes the audit trail, never the enforcement decision itself.
    const chatLog = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: chatDecision.logId } });
    const agentRunLog = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: agentRunDecision.logId } });
    expect(chatLog.triggeredBy).toBe("interactive_chat");
    expect(agentRunLog.triggeredBy).toBe("agent_run");
    expect(chatLog.outcome).toBe(agentRunLog.outcome);
  });

  it("a chat-initiated gated call approves and resumes through the exact same AgentApproval/AgentRun machinery the agent-run path uses", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
    const headers = authHeaders(owner.token);

    const pending = await executeToolCall(
      { id: "gap-2", name: "create_task", arguments: { title: "Approve me via chat's implicit run" } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      headers,
    );
    expect(pending.status).toBe("pending_approval");
    if (pending.status !== "pending_approval") throw new Error("unreachable");

    // The chat call implicitly created a real, one-step AgentRun -- the same
    // model startAgentRun uses, not a parallel mechanism.
    const implicitRun = await prisma.agentRun.findUniqueOrThrow({ where: { id: pending.agentRunId } });
    expect(implicitRun.status).toBe("waiting_approval");
    expect(implicitRun.goal).toMatch(/create_task/);

    await decideApproval({
      approvalId: pending.approvalId,
      organizationId: organization.id,
      decidedById: owner.userId,
      decision: "approved",
      requestHeaders: headers,
    });

    const resumed = await continueAgentRun({
      agentRunId: pending.agentRunId,
      organizationId: organization.id,
      requestHeaders: headers,
    });
    expect(resumed.status).toBe("completed");
    expect(resumed.steps[0]?.status).toBe("succeeded");

    const tasks = await prisma.task.findMany({ where: { organizationId: organization.id } });
    expect(tasks).toHaveLength(1);
  });

  it("an auto_append tool still executes immediately via the chat path at the default L2 -- the gap fix does not over-block", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });

    const result = await executeToolCall(
      { id: "gap-3", name: "record_lead_activity", arguments: { leadId: "does-not-exist", type: "ai_note", body: "hi" } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );

    expect(result.status).toBe("success");
  });
});
