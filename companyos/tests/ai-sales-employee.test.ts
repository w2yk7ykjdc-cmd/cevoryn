import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin"; // registers get_lead, analyze_lead, search_leads, create_task, record_lead_activity
import { executeToolCall } from "@/server/ai/tools/executor";
import { decideApproval } from "@/server/ai/approval/service";
import { continueAgentRun } from "@/server/ai/agent/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { createLead } from "@/server/leads/service";
import { prisma } from "@/server/db/client";
import {
  addMemberDirect,
  authHeaders,
  closeTestConnections,
  createOrgForUser,
  signUpUser,
} from "./helpers";

describe("AI Sales Employee tools", () => {
  afterAll(closeTestConnections);

  async function setup() {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const lead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "AI Test Lead",
      value: 25000,
      probability: 40,
    });
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
    return { owner, organization, lead, conversation };
  }

  /**
   * `create_task` is `mutating_gated`, so at the organization's default
   * autonomy level (L2) a direct `executeToolCall` for it now returns
   * `pending_approval` (Sprint 9) rather than executing immediately — it's
   * implicitly wrapped in a one-step `AgentRun`. This approves and resumes
   * it, returning the completed step so tests can assert on its output.
   */
  async function approveAndResume(
    pending: Extract<Awaited<ReturnType<typeof executeToolCall>>, { status: "pending_approval" }>,
    organizationId: string,
    decidedById: string,
    requestHeaders: Headers,
  ) {
    await decideApproval({
      approvalId: pending.approvalId,
      organizationId,
      decidedById,
      decision: "approved",
      requestHeaders,
    });
    const resumedRun = await continueAgentRun({ agentRunId: pending.agentRunId, organizationId, requestHeaders });
    return resumedRun.steps.find((s) => s.approvalId === pending.approvalId)!;
  }

  it("get_lead returns the lead and audit-logs the AI's read", async () => {
    const { owner, organization, lead, conversation } = await setup();

    const result = await executeToolCall(
      { id: "c1", name: "get_lead", arguments: { leadId: lead.id } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      const output = result.output as { found: boolean; title: string };
      expect(output.found).toBe(true);
      expect(output.title).toBe("AI Test Lead");
    }

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "lead.ai_viewed", targetId: lead.id },
    });
    expect(auditEntry?.actorType).toBe("ai");
    expect(auditEntry?.actorId).toBe(owner.userId);
  });

  it("get_lead cannot be used by someone outside the organization — RBAC enforced even for the AI", async () => {
    const { organization, lead, conversation } = await setup();
    // Every default role (including viewer) has lead:read, so there's no
    // in-org role to demonstrate a *graceful* denial with. A non-member is
    // the real boundary: Better Auth's hasPermission throws for them
    // (see tests/rbac.test.ts), and the tool call must not silently
    // succeed or swallow that into a false "success".
    const outsider = await signUpUser();

    await expect(
      executeToolCall(
        { id: "c2", name: "get_lead", arguments: { leadId: lead.id } },
        { organizationId: organization.id, userId: outsider.userId, conversationId: conversation.id },
        authHeaders(outsider.token),
      ),
    ).rejects.toThrow();
  });

  it("analyze_lead returns a deterministic risk analysis and audit-logs it", async () => {
    const { owner, organization, lead, conversation } = await setup();

    const result = await executeToolCall(
      { id: "c3", name: "analyze_lead", arguments: { leadId: lead.id } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      const output = result.output as { found: boolean; riskLevel: string; suggestedNextAction: string };
      expect(output.found).toBe(true);
      expect(["low", "medium", "high"]).toContain(output.riskLevel);
      expect(output.suggestedNextAction.length).toBeGreaterThan(0);
    }

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "lead.ai_analyzed", targetId: lead.id },
    });
    expect(auditEntry?.actorType).toBe("ai");
  });

  it("search_leads finds the lead by title and audit-logs the search", async () => {
    const { owner, organization, conversation } = await setup();

    const result = await executeToolCall(
      { id: "c4", name: "search_leads", arguments: { query: "AI Test" } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      const output = result.output as { results: { title: string }[] };
      expect(output.results.some((r) => r.title === "AI Test Lead")).toBe(true);
    }

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "lead.ai_searched" },
    });
    expect(auditEntry?.actorType).toBe("ai");
  });

  it("create_task creates a task linked to the lead, assigned to the caller, audited as ai", async () => {
    const { owner, organization, lead, conversation } = await setup();
    const headers = authHeaders(owner.token);

    const result = await executeToolCall(
      {
        id: "c5",
        name: "create_task",
        arguments: { title: "Follow up on AI Test Lead", leadId: lead.id, priority: "high" },
      },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      headers,
    );

    expect(result.status).toBe("pending_approval");
    if (result.status !== "pending_approval") throw new Error("unreachable");

    const step = await approveAndResume(result, organization.id, owner.userId, headers);
    expect(step.status).toBe("succeeded");
    const output = step.output as { created: boolean; taskId: string };
    expect(output.created).toBe(true);
    const taskId = output.taskId;

    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.assigneeId).toBe(owner.userId);
    expect(task.leadId).toBe(lead.id);
    expect(task.priority).toBe("high");

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "task.created", targetId: taskId },
    });
    expect(auditEntry?.actorType).toBe("ai");

    const leadActivity = await prisma.leadActivity.findFirst({
      where: { leadId: lead.id, type: "task_created" },
    });
    expect(leadActivity).not.toBeNull();
  });

  it("create_task is denied for a viewer, who has no task:create permission", async () => {
    const { organization, lead, conversation } = await setup();
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");

    const result = await executeToolCall(
      { id: "c6", name: "create_task", arguments: { title: "Nope", leadId: lead.id } },
      { organizationId: organization.id, userId: viewer.userId, conversationId: conversation.id },
      authHeaders(viewer.token),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toMatch(/permission/i);
    }
    const tasksForOrg = await prisma.task.findMany({ where: { organizationId: organization.id } });
    expect(tasksForOrg).toHaveLength(0);
  });

  it("record_lead_activity appends to the timeline and audit-logs the write", async () => {
    const { owner, organization, lead, conversation } = await setup();

    const result = await executeToolCall(
      {
        id: "c7",
        name: "record_lead_activity",
        arguments: { leadId: lead.id, type: "ai_analysis", body: "This lead looks healthy." },
      },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );

    expect(result.status).toBe("success");

    const activity = await prisma.leadActivity.findFirst({
      where: { leadId: lead.id, type: "ai_analysis" },
    });
    expect(activity?.body).toBe("This lead looks healthy.");
    expect(activity?.actorId).toBeNull(); // authored by the AI, not the human

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "lead.ai_activity_recorded", targetId: lead.id },
    });
    expect(auditEntry?.actorType).toBe("ai");
    expect(auditEntry?.actorId).toBe(owner.userId);
  });

  it("the full chain — analyze, then act — leaves a complete audit trail", async () => {
    const { owner, organization, lead, conversation } = await setup();
    const ctx = { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id };
    const headers = authHeaders(owner.token);

    const analysis = await executeToolCall(
      { id: "d1", name: "analyze_lead", arguments: { leadId: lead.id } },
      ctx,
      headers,
    );
    expect(analysis.status).toBe("success");

    const taskResult = await executeToolCall(
      { id: "d2", name: "create_task", arguments: { title: "Act on analysis", leadId: lead.id } },
      ctx,
      headers,
    );
    expect(taskResult.status).toBe("pending_approval");
    if (taskResult.status !== "pending_approval") throw new Error("unreachable");
    const taskStep = await approveAndResume(taskResult, organization.id, owner.userId, headers);
    expect(taskStep.status).toBe("succeeded");

    const activityResult = await executeToolCall(
      {
        id: "d3",
        name: "record_lead_activity",
        arguments: { leadId: lead.id, type: "ai_analysis", body: "Analyzed and created a follow-up task." },
      },
      ctx,
      headers,
    );
    expect(activityResult.status).toBe("success");

    const auditActions = await prisma.auditLog.findMany({
      where: { organizationId: organization.id, targetId: lead.id, actorType: "ai" },
      select: { action: true },
    });
    const actions = auditActions.map((a) => a.action);
    expect(actions).toContain("lead.ai_analyzed");
    expect(actions).toContain("lead.ai_activity_recorded");

    const taskAudit = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "task.created", actorType: "ai" },
    });
    expect(taskAudit).not.toBeNull();

    const invocations = await prisma.toolInvocation.findMany({
      where: { conversationId: conversation.id },
    });
    expect(invocations.every((inv) => inv.status === "success")).toBe(true);
    expect(invocations.map((inv) => inv.toolName)).toEqual(
      expect.arrayContaining(["analyze_lead", "create_task", "record_lead_activity"]),
    );
  });

  it("a regular member (not just the owner) can use the AI tools on leads in their org", async () => {
    const { organization, lead, conversation } = await setup();
    const member = await signUpUser();
    await addMemberDirect(organization.id, member, "member");

    const result = await executeToolCall(
      { id: "e1", name: "get_lead", arguments: { leadId: lead.id } },
      { organizationId: organization.id, userId: member.userId, conversationId: conversation.id },
      authHeaders(member.token),
    );

    expect(result.status).toBe("success");
  });
});
