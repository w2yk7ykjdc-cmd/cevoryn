import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { createLead } from "@/server/leads/service";
import { createConversation } from "@/server/ai/runtime/conversations";
import { startAgentRun, continueAgentRun } from "@/server/ai/agent/executor";
import { decideApproval, ApprovalPermissionError } from "@/server/ai/approval/service";
import {
  addMemberDirect,
  authHeaders,
  closeTestConnections,
  createOrgForUser,
  signUpUser,
} from "./helpers";
import { createFakeProvider, planResult } from "./fake-provider";

describe("agent executor", () => {
  afterAll(closeTestConnections);

  async function setup() {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const lead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Agent Test Lead",
      value: 50_000,
      probability: 50,
    });
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
    return { owner, organization, lead, conversation };
  }

  it("runs a multi-step plan end to end through the real Tool Engine and completes", async () => {
    const { owner, organization, lead, conversation } = await setup();
    const provider = createFakeProvider(() =>
      planResult([
        { toolName: "get_lead", input: { leadId: lead.id }, rationale: "Look up the lead." },
        {
          toolName: "record_lead_activity",
          input: { leadId: lead.id, type: "ai_note", body: "Checked in via the agent." },
          rationale: "Leave a note for the team.",
        },
      ]),
    );

    const run = await startAgentRun({
      organizationId: organization.id,
      userId: owner.userId,
      conversationId: conversation.id,
      goal: "Check on the lead and leave a note",
      requestHeaders: authHeaders(owner.token),
      provider,
      model: "gpt-4o",
    });

    expect(run.status).toBe("completed");
    expect(run.steps).toHaveLength(2);
    expect(run.steps.every((s) => s.status === "succeeded")).toBe(true);
    expect(run.resultSummary).toBe("Completed 2/2 step(s).");

    const invocations = await prisma.toolInvocation.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });
    expect(invocations.map((i) => i.toolName)).toEqual(["get_lead", "record_lead_activity"]);
    expect(invocations.every((i) => i.status === "success")).toBe(true);

    const auditActions = (
      await prisma.auditLog.findMany({ where: { organizationId: organization.id, targetType: "agent_run" } })
    ).map((a) => a.action);
    expect(auditActions).toEqual(expect.arrayContaining(["agent.run_started", "agent.run_completed"]));

    const stepAuditActions = (
      await prisma.auditLog.findMany({ where: { organizationId: organization.id, targetType: "agent_step" } })
    ).map((a) => a.action);
    expect(stepAuditActions.filter((a) => a === "agent.step_succeeded")).toHaveLength(2);
  });

  it("halts immediately when a step's tool call fails, leaving later steps untouched", async () => {
    const { organization, lead } = await setup();
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");

    // get_lead succeeds for a viewer (lead:read), but record_lead_activity
    // requires lead:update, which viewer does not hold — a genuine RBAC
    // denial from the Tool Engine, not a contrived failure.
    const provider = createFakeProvider(() =>
      planResult([
        { toolName: "get_lead", input: { leadId: lead.id }, rationale: "Look up the lead." },
        {
          toolName: "record_lead_activity",
          input: { leadId: lead.id, type: "ai_note", body: "Should not be reached successfully." },
          rationale: "Leave a note.",
        },
        { toolName: "analyze_lead", input: { leadId: lead.id }, rationale: "Never reached." },
      ]),
    );

    const run = await startAgentRun({
      organizationId: organization.id,
      userId: viewer.userId,
      conversationId: await createConversation({ organizationId: organization.id, userId: viewer.userId }).then(
        (c) => c.id,
      ),
      goal: "Look up the lead, note it, then analyze it",
      requestHeaders: authHeaders(viewer.token),
      provider,
      model: "gpt-4o",
    });

    expect(run.status).toBe("failed");
    expect(run.errorMessage).toMatch(/record_lead_activity/);
    expect(run.steps[0]?.status).toBe("succeeded");
    expect(run.steps[1]?.status).toBe("failed");
    expect(run.steps[1]?.errorMessage).toMatch(/permission/i);
    expect(run.steps[2]?.status).toBe("pending"); // never touched once the run halted
  });

  it("pauses a risky step for approval and resumes once approved, actually performing the action", async () => {
    const { owner, organization, lead, conversation } = await setup();
    const provider = createFakeProvider(() =>
      planResult([
        {
          toolName: "create_task",
          input: { title: "Follow up with the lead", leadId: lead.id, priority: "high" },
          rationale: "Act on the lead.",
        },
      ]),
    );

    const run = await startAgentRun({
      organizationId: organization.id,
      userId: owner.userId,
      conversationId: conversation.id,
      goal: "Create a follow-up task for the lead",
      requestHeaders: authHeaders(owner.token),
      provider,
      model: "gpt-4o",
    });

    expect(run.status).toBe("waiting_approval");
    expect(run.steps[0]?.status).toBe("pending");
    expect(run.approvals).toHaveLength(1);
    expect(run.approvals[0]?.status).toBe("pending");
    expect(run.approvals[0]?.toolName).toBe("create_task");

    const tasksBefore = await prisma.task.findMany({ where: { organizationId: organization.id } });
    expect(tasksBefore).toHaveLength(0);

    await decideApproval({
      approvalId: run.approvals[0]!.id,
      organizationId: organization.id,
      decidedById: owner.userId,
      decision: "approved",
      requestHeaders: authHeaders(owner.token),
    });

    const resumed = await continueAgentRun({
      agentRunId: run.id,
      organizationId: organization.id,
      requestHeaders: authHeaders(owner.token),
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.steps[0]?.status).toBe("succeeded");

    const tasksAfter = await prisma.task.findMany({ where: { organizationId: organization.id } });
    expect(tasksAfter).toHaveLength(1);
    expect(tasksAfter[0]?.leadId).toBe(lead.id);
  });

  it("continues past a rejected step instead of halting the whole run", async () => {
    const { owner, organization, lead, conversation } = await setup();
    const provider = createFakeProvider(() =>
      planResult([
        { toolName: "create_task", input: { title: "Risky task", leadId: lead.id }, rationale: "Act." },
        {
          toolName: "record_lead_activity",
          input: { leadId: lead.id, type: "ai_note", body: "Still worth noting." },
          rationale: "Leave a note regardless.",
        },
      ]),
    );

    const run = await startAgentRun({
      organizationId: organization.id,
      userId: owner.userId,
      conversationId: conversation.id,
      goal: "Create a task and leave a note",
      requestHeaders: authHeaders(owner.token),
      provider,
      model: "gpt-4o",
    });

    expect(run.status).toBe("waiting_approval");

    await decideApproval({
      approvalId: run.approvals[0]!.id,
      organizationId: organization.id,
      decidedById: owner.userId,
      decision: "rejected",
      decisionNote: "Not needed right now.",
      requestHeaders: authHeaders(owner.token),
    });

    const resumed = await continueAgentRun({
      agentRunId: run.id,
      organizationId: organization.id,
      requestHeaders: authHeaders(owner.token),
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.steps[0]?.status).toBe("skipped");
    expect(resumed.steps[0]?.errorMessage).toMatch(/rejected/i);
    expect(resumed.steps[1]?.status).toBe("succeeded");

    const tasks = await prisma.task.findMany({ where: { organizationId: organization.id } });
    expect(tasks).toHaveLength(0);

    const activity = await prisma.leadActivity.findFirst({
      where: { leadId: lead.id, body: "Still worth noting." },
    });
    expect(activity).not.toBeNull();
  });

  it("preserves RBAC on the approval decision itself — a viewer cannot approve a create_task step", async () => {
    const { owner, organization, lead, conversation } = await setup();
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");

    const provider = createFakeProvider(() =>
      planResult([{ toolName: "create_task", input: { title: "Gate check", leadId: lead.id }, rationale: "Act." }]),
    );

    const run = await startAgentRun({
      organizationId: organization.id,
      userId: owner.userId,
      conversationId: conversation.id,
      goal: "Create a follow-up task",
      requestHeaders: authHeaders(owner.token),
      provider,
      model: "gpt-4o",
    });

    expect(run.status).toBe("waiting_approval");

    await expect(
      decideApproval({
        approvalId: run.approvals[0]!.id,
        organizationId: organization.id,
        decidedById: viewer.userId,
        decision: "approved",
        requestHeaders: authHeaders(viewer.token),
      }),
    ).rejects.toThrow(ApprovalPermissionError);

    const stillPending = await prisma.agentApproval.findUniqueOrThrow({ where: { id: run.approvals[0]!.id } });
    expect(stillPending.status).toBe("pending");
  });
});
