import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { executeToolCall } from "@/server/ai/tools/executor";
import { createConversation } from "@/server/ai/runtime/conversations";
import { resolveAutonomyDecision } from "@/server/ai/autonomy/resolve";
import { addAllowlistEntry, engageKillSwitch, getOrCreatePolicy, updatePolicy } from "@/server/ai/autonomy/policy-service";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders } from "./helpers";

describe("resolveAutonomyDecision: the decision matrix", () => {
  afterAll(closeTestConnections);

  it("read-only tools never enter autonomy resolution, even with the kill switch engaged", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    await engageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: owner.userId, requestHeaders: headers });
    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });

    const result = await executeToolCall(
      { id: "c1", name: "search_audit_log", arguments: { limit: 1 } },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      headers,
    );
    expect(result.status).toBe("success");
  });

  it("defaults a new organization to L2, where auto_append tools execute automatically", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const policy = await getOrCreatePolicy(organization.id, "crm");
    expect(policy.level).toBe("L2");
    expect(policy.dailyActionLimit).toBe(0);
    expect(policy.killSwitchEngaged).toBe(false);

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "record_lead_activity",
      domain: "crm",
      mutationCategory: "auto_append",
      blastRadius: undefined,
      autonomyEligible: undefined,
      input: {},
      triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("executed");
  });

  it("mutating_gated + additive requires approval at the default L2", async () => {
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
      triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("requires_approval");
  });

  it("L0 blocks every mutating tool outright, with no approval queued", async () => {
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

    const decision = await resolveAutonomyDecision({
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
    expect(decision.outcome).toBe("blocked");

    const approvalCount = await prisma.agentApproval.count({ where: { organizationId: organization.id } });
    expect(approvalCount).toBe(0);
  });

  it("L1 blocks every mutating tool outright too — reads still work, mutations don't", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L1",
      dailyActionLimit: 0,
      dailyRiskLimit: 0,
      perActionRiskLimit: 0,
      changedById: owner.userId,
      requestHeaders: headers,
    });

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "record_lead_activity",
      domain: "crm",
      mutationCategory: "auto_append",
      blastRadius: undefined,
      autonomyEligible: undefined,
      input: {},
      triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("blocked");
  });

  it("the kill switch overrides even L5, blocking outright and logging blocked_kill_switch", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L5",
      dailyActionLimit: 100,
      dailyRiskLimit: 100000,
      perActionRiskLimit: 100000,
      changedById: owner.userId,
      requestHeaders: headers,
    });
    await engageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: owner.userId, requestHeaders: headers });

    const decision = await resolveAutonomyDecision({
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
    expect(decision.outcome).toBe("blocked");
    if (decision.outcome === "blocked") expect(decision.reason).toMatch(/kill switch/i);

    const log = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: decision.logId } });
    expect(log.outcome).toBe("blocked_kill_switch");
  });

  it("an unclassified tool always requires approval, bypassing level and kill switch entirely", async () => {
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
    await engageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: owner.userId, requestHeaders: headers });

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "some_future_tool_nobody_has_classified_yet",
      domain: "crm",
      mutationCategory: undefined,
      blastRadius: undefined,
      autonomyEligible: undefined,
      input: {},
      triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("requires_approval");
  });

  it("clamps the effective level to the hardcoded, non-DB-overridable domain ceiling", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    // "market" is capped at L2 in code (MAX_AUTONOMY_LEVEL_BY_DOMAIN), regardless of what's configured here.
    await updatePolicy({
      organizationId: organization.id,
      domain: "market",
      level: "L5",
      dailyActionLimit: 100,
      dailyRiskLimit: 100000,
      perActionRiskLimit: 100000,
      changedById: owner.userId,
      requestHeaders: headers,
    });

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "hypothetical_market_tool",
      domain: "market",
      mutationCategory: "mutating_gated",
      blastRadius: "destructive",
      autonomyEligible: true, // even if eligible in code, it can't reach L4/L5 behavior once clamped to L2
      input: {},
      triggeredBy: "interactive_chat",
    });
    // If the clamp did not apply, this (destructive, autonomyEligible, unallowlisted, at real L5)
    // would instead fall through to "requires_approval" via the L4/L5 not-allowlisted path.
    // Clamped to L2, a destructive mutating_gated tool is a hard block instead.
    expect(decision.outcome).toBe("blocked");
    if (decision.outcome === "blocked") expect(decision.reason).toMatch(/L3/);

    const log = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: decision.logId } });
    expect(log.level).toBe("L2");
  });

  it("L2 blocks destructive mutating tools from even reaching the approval queue; L3 allows it", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    const atL2 = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "hypothetical_destructive_tool",
      domain: "crm",
      mutationCategory: "mutating_gated",
      blastRadius: "destructive",
      autonomyEligible: false,
      input: {},
      triggeredBy: "interactive_chat",
    });
    expect(atL2.outcome).toBe("blocked");

    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L3",
      dailyActionLimit: 0,
      dailyRiskLimit: 0,
      perActionRiskLimit: 0,
      changedById: owner.userId,
      requestHeaders: headers,
    });

    const atL3 = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "hypothetical_destructive_tool",
      domain: "crm",
      mutationCategory: "mutating_gated",
      blastRadius: "destructive",
      autonomyEligible: false,
      input: {},
      triggeredBy: "interactive_chat",
    });
    expect(atL3.outcome).toBe("requires_approval");
  });

  it("L4 executes an autonomyEligible, allowlisted tool within its daily limits", async () => {
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
      actionRiskValue: 10,
      triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("executed");
    if (decision.outcome === "executed") expect(decision.allowlistEntryId).not.toBeNull();
  });

  it("L4 falls back to approval (not a hard block) when the tool is eligible but not allowlisted", async () => {
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

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "not_on_any_allowlist",
      domain: "crm",
      mutationCategory: "mutating_gated",
      blastRadius: "additive",
      autonomyEligible: true,
      input: {},
      triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("requires_approval");

    const log = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: decision.logId } });
    expect(log.outcome).toBe("blocked_not_allowlisted");
  });

  it("L4 falls back to approval (not a hard block) once the daily action limit is exhausted", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);
    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L4",
      dailyActionLimit: 1,
      dailyRiskLimit: 1000,
      perActionRiskLimit: 1000,
      changedById: owner.userId,
      requestHeaders: headers,
    });
    await addAllowlistEntry({
      organizationId: organization.id,
      domain: "crm",
      toolName: "limited_tool",
      minLevelRequired: "L4",
      addedById: owner.userId,
      requestHeaders: headers,
    });

    const decisionInput = {
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "limited_tool",
      domain: "crm",
      mutationCategory: "mutating_gated" as const,
      blastRadius: "additive" as const,
      autonomyEligible: true,
      input: {},
      triggeredBy: "interactive_chat" as const,
    };

    const first = await resolveAutonomyDecision(decisionInput);
    expect(first.outcome).toBe("executed");

    const second = await resolveAutonomyDecision(decisionInput);
    expect(second.outcome).toBe("requires_approval");

    const log = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: second.logId } });
    expect(log.outcome).toBe("blocked_limit");
  });

  it("L4 always requires approval for a tool its own developer never marked autonomyEligible, even if allowlisted", async () => {
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
      toolName: "create_task",
      minLevelRequired: "L4",
      addedById: owner.userId,
      requestHeaders: headers,
    });

    // create_task is registered with autonomyEligible: false -- an org can allowlist it, but code never opted it in.
    const decision = await resolveAutonomyDecision({
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
    expect(decision.outcome).toBe("requires_approval");
  });
});
