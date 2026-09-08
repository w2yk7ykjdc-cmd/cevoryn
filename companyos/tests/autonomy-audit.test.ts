import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { resolveAutonomyDecision } from "@/server/ai/autonomy/resolve";
import { addAllowlistEntry, disengageKillSwitch, engageKillSwitch, updatePolicy } from "@/server/ai/autonomy/policy-service";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders } from "./helpers";

describe("AutonomousActionLog: every autonomy decision is audited", () => {
  afterAll(closeTestConnections);

  it("writes a log row for an executed (auto_append) decision", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "record_lead_activity",
      domain: "crm",
      mutationCategory: "auto_append",
      blastRadius: undefined,
      autonomyEligible: undefined,
      input: { leadId: "x" },
      triggeredBy: "interactive_chat",
    });

    const log = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: decision.logId } });
    expect(log.outcome).toBe("executed");
    expect(log.organizationId).toBe(organization.id);
    expect(log.domain).toBe("crm");
    expect(log.toolName).toBe("record_lead_activity");
    expect(log.triggeredBy).toBe("interactive_chat");
  });

  it("writes a log row for a requires_approval decision", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const decision = await resolveAutonomyDecision({
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

    const log = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: decision.logId } });
    expect(log.outcome).toBe("requires_approval");
    expect(log.triggeredBy).toBe("agent_run");
  });

  it("writes a log row for every blocked_* variant: policy, kill switch, limit, not-allowlisted", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L0",
      dailyActionLimit: 0,
      dailyRiskLimit: 0,
      perActionRiskLimit: 0,
      changedById: owner.userId,
      requestHeaders: headers,
    });
    const policyBlocked = await resolveAutonomyDecision({
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
    const policyLog = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: policyBlocked.logId } });
    expect(policyLog.outcome).toBe("blocked_policy");

    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L4",
      dailyActionLimit: 5,
      dailyRiskLimit: 1000,
      perActionRiskLimit: 1000,
      changedById: owner.userId,
      requestHeaders: headers,
    });
    await engageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: owner.userId, requestHeaders: headers });
    const killSwitchBlocked = await resolveAutonomyDecision({
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
    const killSwitchLog = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: killSwitchBlocked.logId } });
    expect(killSwitchLog.outcome).toBe("blocked_kill_switch");

    await disengageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: owner.userId, requestHeaders: headers });

    const notAllowlisted = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "never_allowlisted_tool",
      domain: "crm",
      mutationCategory: "mutating_gated",
      blastRadius: "additive",
      autonomyEligible: true,
      input: {},
      triggeredBy: "interactive_chat",
    });
    const notAllowlistedLog = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: notAllowlisted.logId } });
    expect(notAllowlistedLog.outcome).toBe("blocked_not_allowlisted");

    await addAllowlistEntry({
      organizationId: organization.id,
      domain: "crm",
      toolName: "capped_tool",
      minLevelRequired: "L4",
      addedById: owner.userId,
      requestHeaders: headers,
    });
    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L4",
      dailyActionLimit: 0, // inert -- blocks immediately
      dailyRiskLimit: 1000,
      perActionRiskLimit: 1000,
      changedById: owner.userId,
      requestHeaders: headers,
    });
    const limitBlocked = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "capped_tool",
      domain: "crm",
      mutationCategory: "mutating_gated",
      blastRadius: "additive",
      autonomyEligible: true,
      input: {},
      triggeredBy: "interactive_chat",
    });
    const limitLog = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: limitBlocked.logId } });
    expect(limitLog.outcome).toBe("blocked_limit");
  });

  it("blocked and pending_approval tool calls never produce a ToolInvocation row", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });

    const pending = await executeToolCall(
      { id: "audit-1", name: "create_task", arguments: { title: "Never invoked yet" } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );
    expect(pending.status).toBe("pending_approval");

    const invocations = await prisma.toolInvocation.findMany({ where: { conversationId: conversation.id } });
    expect(invocations).toHaveLength(0);
  });

  it("blocked and pending_approval tool calls never publish ai.tool.invoked", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });

    await executeToolCall(
      { id: "audit-2", name: "create_task", arguments: { title: "Also never invoked" } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );

    const events = await prisma.domainEvent.findMany({
      where: { organizationId: organization.id, type: "ai.tool.invoked" },
    });
    expect(events).toHaveLength(0);
  });

  it("a routine L2 auto_append execution publishes ai.tool.invoked but does NOT write an autonomy.action_executed AuditLog entry", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });

    const result = await executeToolCall(
      { id: "audit-3", name: "record_lead_activity", arguments: { leadId: "does-not-exist", type: "ai_note", body: "hi" } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      headers,
    );
    // record_lead_activity is auto_append -> executes automatically at the default L2 (handler runs and
    // returns a graceful {recorded:false} for a nonexistent lead -- still a real "success" tool result).
    expect(result.status).toBe("success");

    const events = await prisma.domainEvent.findMany({
      where: { organizationId: organization.id, type: "ai.tool.invoked" },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);

    const invocations = await prisma.toolInvocation.findMany({ where: { conversationId: conversation.id } });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.toolName).toBe("record_lead_activity");

    // Routine L2 auto_append writes already get their own tool-specific AuditLog entry
    // (e.g. lead.ai_activity_recorded) -- the generic autonomy.action_executed entry is
    // reserved for genuine, unattended L4/L5 allowlisted executions (see next test), so
    // firing it here too would just be redundant noise.
    const genericAuditEntries = await prisma.auditLog.findMany({
      where: { organizationId: organization.id, action: "autonomy.action_executed" },
    });
    expect(genericAuditEntries).toHaveLength(0);
  });

  it("a genuine L4/L5 allowlisted execution writes an autonomy.action_executed AuditLog entry", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L4",
      dailyActionLimit: 5,
      dailyRiskLimit: 1000,
      perActionRiskLimit: 1000,
      changedById: owner.userId,
      requestHeaders: headers,
    });
    await addAllowlistEntry({
      organizationId: organization.id,
      domain: "crm",
      toolName: "hypothetical_autonomous_tool",
      minLevelRequired: "L4",
      addedById: owner.userId,
      requestHeaders: headers,
    });

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "hypothetical_autonomous_tool",
      domain: "crm",
      mutationCategory: "mutating_gated",
      blastRadius: "additive",
      autonomyEligible: true,
      input: {},
      triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("executed");
    if (decision.outcome !== "executed") throw new Error("unreachable");

    const auditEntries = await prisma.auditLog.findMany({
      where: { organizationId: organization.id, action: "autonomy.action_executed" },
    });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]?.actorId).toBe(owner.userId);
    expect(auditEntries[0]?.actorType).toBe("ai");
    expect(auditEntries[0]?.targetId).toBe(decision.logId);
    expect(auditEntries[0]?.metadata).toMatchObject({
      domain: "crm",
      toolName: "hypothetical_autonomous_tool",
      level: "L4",
      allowlistEntryId: decision.allowlistEntryId,
    });
  });
});
