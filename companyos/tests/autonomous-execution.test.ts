import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { resolveAutonomyDecision } from "@/server/ai/autonomy/resolve";
import { addAllowlistEntry, engageKillSwitch, updatePolicy } from "@/server/ai/autonomy/policy-service";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders } from "./helpers";

describe("L4/L5 autonomous execution: allowlisting, limits, and the kill switch", () => {
  afterAll(closeTestConnections);

  it("an L4-allowlisted tool executes without ever creating an AgentApproval", async () => {
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
      toolName: "autonomous_tool",
      minLevelRequired: "L4",
      addedById: owner.userId,
      requestHeaders: headers,
    });

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "autonomous_tool",
      domain: "crm",
      mutationCategory: "mutating_gated",
      blastRadius: "additive",
      autonomyEligible: true,
      input: {},
      triggeredBy: "interactive_chat",
    });

    expect(decision.outcome).toBe("executed");

    const approvals = await prisma.agentApproval.count({ where: { organizationId: organization.id } });
    expect(approvals).toBe(0);
    const runs = await prisma.agentRun.count({ where: { organizationId: organization.id } });
    expect(runs).toBe(0);
  });

  it("the daily action limit correctly blocks the N+1th attempt, falling back to approval", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L4",
      dailyActionLimit: 2,
      dailyRiskLimit: 1000,
      perActionRiskLimit: 1000,
      changedById: owner.userId,
      requestHeaders: headers,
    });
    await addAllowlistEntry({
      organizationId: organization.id,
      domain: "crm",
      toolName: "capped_action_tool",
      minLevelRequired: "L4",
      addedById: owner.userId,
      requestHeaders: headers,
    });

    const decisionInput = {
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "capped_action_tool",
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
    expect(second.outcome).toBe("executed");

    const third = await resolveAutonomyDecision(decisionInput);
    expect(third.outcome).toBe("requires_approval");
    const thirdLog = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: third.logId } });
    expect(thirdLog.outcome).toBe("blocked_limit");

    // The limit is never silently swallowed -- it always falls through to a real approval queue.
    const executedCount = await prisma.autonomousActionLog.count({
      where: { organizationId: organization.id, outcome: "executed" },
    });
    expect(executedCount).toBe(2);
  });

  it("the daily risk budget blocks an action that would exceed it, even under the action-count limit", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L4",
      dailyActionLimit: 10,
      dailyRiskLimit: 100,
      perActionRiskLimit: 1000,
      changedById: owner.userId,
      requestHeaders: headers,
    });
    await addAllowlistEntry({
      organizationId: organization.id,
      domain: "crm",
      toolName: "risky_action_tool",
      minLevelRequired: "L4",
      addedById: owner.userId,
      requestHeaders: headers,
    });

    const first = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "risky_action_tool",
      domain: "crm",
      mutationCategory: "mutating_gated",
      blastRadius: "additive",
      autonomyEligible: true,
      input: {},
      actionRiskValue: 60,
      triggeredBy: "interactive_chat",
    });
    expect(first.outcome).toBe("executed");

    // 60 + 60 = 120 > 100 daily risk budget -- blocked, though the action count limit (10) is nowhere near reached.
    const second = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "risky_action_tool",
      domain: "crm",
      mutationCategory: "mutating_gated",
      blastRadius: "additive",
      autonomyEligible: true,
      input: {},
      actionRiskValue: 60,
      triggeredBy: "interactive_chat",
    });
    expect(second.outcome).toBe("requires_approval");
    const secondLog = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: second.logId } });
    expect(secondLog.outcome).toBe("blocked_limit");
  });

  it("a single action exceeding the per-action risk limit is blocked even as the very first action of the day", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L4",
      dailyActionLimit: 10,
      dailyRiskLimit: 1000,
      perActionRiskLimit: 50,
      changedById: owner.userId,
      requestHeaders: headers,
    });
    await addAllowlistEntry({
      organizationId: organization.id,
      domain: "crm",
      toolName: "single_risky_tool",
      minLevelRequired: "L4",
      addedById: owner.userId,
      requestHeaders: headers,
    });

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "single_risky_tool",
      domain: "crm",
      mutationCategory: "mutating_gated",
      blastRadius: "additive",
      autonomyEligible: true,
      input: {},
      actionRiskValue: 500,
      triggeredBy: "interactive_chat",
    });
    expect(decision.outcome).toBe("requires_approval");
    const log = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: decision.logId } });
    expect(log.outcome).toBe("blocked_limit");
  });

  it("the kill switch takes effect immediately, mid-sequence, with no caching of the prior policy read", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L4",
      dailyActionLimit: 10,
      dailyRiskLimit: 1000,
      perActionRiskLimit: 1000,
      changedById: owner.userId,
      requestHeaders: headers,
    });
    await addAllowlistEntry({
      organizationId: organization.id,
      domain: "crm",
      toolName: "kill_switch_tool",
      minLevelRequired: "L4",
      addedById: owner.userId,
      requestHeaders: headers,
    });

    const decisionInput = {
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "kill_switch_tool",
      domain: "crm",
      mutationCategory: "mutating_gated" as const,
      blastRadius: "additive" as const,
      autonomyEligible: true,
      input: {},
      triggeredBy: "interactive_chat" as const,
    };

    const beforeKillSwitch = await resolveAutonomyDecision(decisionInput);
    expect(beforeKillSwitch.outcome).toBe("executed");

    await engageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: owner.userId, requestHeaders: headers });

    const afterKillSwitch = await resolveAutonomyDecision(decisionInput);
    expect(afterKillSwitch.outcome).toBe("blocked");
    const log = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: afterKillSwitch.logId } });
    expect(log.outcome).toBe("blocked_kill_switch");

    // No approval was queued for the kill-switch-blocked call -- a hard refusal, not a fallback.
    const approvals = await prisma.agentApproval.count({ where: { organizationId: organization.id } });
    expect(approvals).toBe(0);
  });

  it("the market domain can never reach L4/L5 execution regardless of what its policy is configured to", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    await updatePolicy({
      organizationId: organization.id,
      domain: "market",
      level: "L5",
      dailyActionLimit: 100,
      dailyRiskLimit: 1_000_000,
      perActionRiskLimit: 1_000_000,
      changedById: owner.userId,
      requestHeaders: headers,
    });
    await addAllowlistEntry({
      organizationId: organization.id,
      domain: "market",
      toolName: "hypothetical_market_tool",
      minLevelRequired: "L4",
      addedById: owner.userId,
      requestHeaders: headers,
    });

    const decision = await resolveAutonomyDecision({
      organizationId: organization.id,
      actorId: owner.userId,
      toolName: "hypothetical_market_tool",
      domain: "market",
      mutationCategory: "mutating_gated",
      blastRadius: "additive",
      autonomyEligible: true,
      input: {},
      triggeredBy: "interactive_chat",
    });

    // Clamped to the hardcoded market ceiling (L2): additive mutating_gated
    // reaches the approval queue at L2, never unattended execution.
    expect(decision.outcome).toBe("requires_approval");
    const log = await prisma.autonomousActionLog.findUniqueOrThrow({ where: { id: decision.logId } });
    expect(log.level).toBe("L2");
  });
});
