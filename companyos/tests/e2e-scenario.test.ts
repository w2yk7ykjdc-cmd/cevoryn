import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { createCompany } from "@/server/companies/service";
import { createContact } from "@/server/contacts/service";
import { createLead } from "@/server/leads/service";
import { createConversation } from "@/server/ai/runtime/conversations";
import { executeToolCall } from "@/server/ai/tools/executor";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders } from "./helpers";

/**
 * End-to-end verification of the Sprint 1 acceptance scenario:
 *
 *   company created -> contact added -> lead created -> AI Sales Employee
 *   analyzes the lead -> creates an appropriate task -> every step is in
 *   the audit log.
 *
 * The AI step is driven directly through `executeToolCall` (the same entry
 * point the AI Runtime's tool-calling loop uses) rather than through a real
 * LLM call, so this test is deterministic and runs in CI without an AI
 * provider key. A real chat-driven run of the same scenario is documented
 * in README.md under "Verifying the AI Sales Employee end to end".
 */
describe("Sprint 1 acceptance scenario", () => {
  afterAll(closeTestConnections);

  it("runs the full company -> contact -> lead -> AI analysis -> task -> audit log chain", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    // 1. A company is created.
    const company = await createCompany({
      organizationId: organization.id,
      actorId: owner.userId,
      name: "Globex Corporation",
      industry: "Manufacturing",
    });

    // 2. A contact is added, linked to that company.
    const contact = await createContact({
      organizationId: organization.id,
      actorId: owner.userId,
      firstName: "Hank",
      lastName: "Scorpio",
      email: "hank@globex.example",
      title: "CEO",
      companyId: company.id,
    });

    // 3. A lead is created, linked to both.
    const lead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Globex — annual platform contract",
      companyId: company.id,
      contactId: contact.id,
      value: 120_000,
      probability: 35,
      source: "outbound",
    });

    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
    const toolCtx = { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id };
    const headers = authHeaders(owner.token);

    // 4. The AI Sales Employee analyzes the lead — through the Tool Engine
    //    only, permission-checked, never touching the database directly.
    const analysisResult = await executeToolCall(
      { id: "call-analyze", name: "analyze_lead", arguments: { leadId: lead.id } },
      toolCtx,
      headers,
    );
    expect(analysisResult.status).toBe("success");
    if (analysisResult.status !== "success") throw new Error("unreachable");
    const analysis = analysisResult.output as {
      riskLevel: string;
      suggestedNextAction: string;
      summary: string;
    };
    expect(analysis.suggestedNextAction.length).toBeGreaterThan(0);

    // 5. The AI creates a follow-up task on the lead, informed by the
    //    analysis it just ran.
    const taskResult = await executeToolCall(
      {
        id: "call-create-task",
        name: "create_task",
        arguments: {
          title: `Follow up: ${analysis.suggestedNextAction}`.slice(0, 200),
          description: analysis.summary,
          priority: analysis.riskLevel === "high" ? "high" : "medium",
          leadId: lead.id,
        },
      },
      toolCtx,
      headers,
    );
    expect(taskResult.status).toBe("success");
    if (taskResult.status !== "success") throw new Error("unreachable");
    const { taskId } = taskResult.output as { taskId: string };

    // 6. The AI records its analysis on the lead's timeline so the team
    //    can see it without re-asking.
    const activityResult = await executeToolCall(
      {
        id: "call-record-activity",
        name: "record_lead_activity",
        arguments: { leadId: lead.id, type: "ai_analysis", body: analysis.summary },
      },
      toolCtx,
      headers,
    );
    expect(activityResult.status).toBe("success");

    // ── Verify the CRM data is wired together correctly ──────────────────
    const finalTask = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(finalTask.leadId).toBe(lead.id);
    expect(finalTask.organizationId).toBe(organization.id);

    const timeline = await prisma.leadActivity.findMany({
      where: { leadId: lead.id },
      orderBy: { createdAt: "asc" },
    });
    expect(timeline.map((a) => a.type)).toEqual(
      expect.arrayContaining(["stage_changed", "task_created", "ai_analysis"]),
    );

    // ── Verify every step landed in the audit log ────────────────────────
    const auditLog = await prisma.auditLog.findMany({
      where: { organizationId: organization.id },
      orderBy: { createdAt: "asc" },
    });
    const actions = auditLog.map((entry) => entry.action);

    expect(actions).toEqual(
      expect.arrayContaining([
        "organization.created",
        "company.created",
        "contact.created",
        "lead.created",
        "lead.ai_analyzed",
        "task.created",
        "lead.ai_activity_recorded",
      ]),
    );

    // The AI's own actions are attributed to the AI, not silently merged
    // into the human user's actions — this is what makes the trail useful
    // for compliance review.
    const aiEntries = auditLog.filter((entry) => entry.actorType === "ai");
    expect(aiEntries.length).toBeGreaterThanOrEqual(3); // analyzed, task created, activity recorded
    expect(aiEntries.every((entry) => entry.actorId === owner.userId)).toBe(true);
    expect(aiEntries.every((entry) => entry.organizationId === organization.id)).toBe(true);

    // The company/contact/lead audit entries are attributed to the human.
    const humanEntries = auditLog.filter((entry) =>
      ["company.created", "contact.created", "lead.created"].includes(entry.action),
    );
    expect(humanEntries.every((entry) => entry.actorType === "user" && entry.actorId === owner.userId)).toBe(
      true,
    );

    // Every AI tool call is also independently logged in ToolInvocation —
    // the Tool Engine's own record, separate from the audit log.
    const invocations = await prisma.toolInvocation.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });
    expect(invocations.map((i) => i.toolName)).toEqual([
      "analyze_lead",
      "create_task",
      "record_lead_activity",
    ]);
    expect(invocations.every((i) => i.status === "success")).toBe(true);
  });
});
