import { afterAll, describe, expect, it } from "vitest";
import "@/server/ai/tools/builtin";
import { prisma } from "@/server/db/client";
import { CrossTenantAccessError } from "@/server/db/tenant";
import { executeToolCall } from "@/server/ai/tools/executor";
import { getTool } from "@/server/ai/tools/registry";
import { createConversation } from "@/server/ai/runtime/conversations";
import {
  applyEvaluation,
  confirmOutcome,
  createPendingOutcomeIfMissing,
  findDueOutcomes,
  listOutcomes,
  markInsufficientEvidence,
} from "@/server/intelligence/outcome/service";
import { OutcomeNotFoundError, OutcomePermissionError } from "@/server/intelligence/outcome/types";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders, addMemberDirect } from "./helpers";

const PAST = new Date(Date.now() - 60_000);
const FUTURE = new Date(Date.now() + 60_000);

describe("Outcome service: tenant isolation, idempotency, rule versioning", () => {
  afterAll(closeTestConnections);

  it("A/B: an organization only ever sees its own outcomes, and a cross-tenant query throws", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);

    await createPendingOutcomeIfMissing({
      organizationId: orgA.id,
      relatedEntityType: "Opportunity",
      relatedEntityId: "opp-a",
      ruleName: "opportunity_state_progression",
      ruleVersion: "v1",
      observationDueAt: PAST,
    });
    await createPendingOutcomeIfMissing({
      organizationId: orgB.id,
      relatedEntityType: "Opportunity",
      relatedEntityId: "opp-b",
      ruleName: "opportunity_state_progression",
      ruleVersion: "v1",
      observationDueAt: PAST,
    });

    const { outcomes: outcomesA } = await listOutcomes({ organizationId: orgA.id });
    const { outcomes: outcomesB } = await listOutcomes({ organizationId: orgB.id });
    expect(outcomesA).toHaveLength(1);
    expect(outcomesA[0]?.relatedEntityId).toBe("opp-a");
    expect(outcomesB).toHaveLength(1);
    expect(outcomesB[0]?.relatedEntityId).toBe("opp-b");

    // A explicit cross-tenant organizationId mismatch in a where clause fails closed.
    const { getTenantScopedClient } = await import("@/server/db/tenant");
    const scopedA = getTenantScopedClient(orgA.id);
    await expect(scopedA.outcome.findFirst({ where: { organizationId: orgB.id } })).rejects.toThrow(CrossTenantAccessError);
  });

  it("E: creating a pending outcome for an already-tracked subject is a no-op, not a duplicate", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const first = await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "Risk",
      relatedEntityId: "risk-1",
      ruleName: "risk_resolution",
      ruleVersion: "v1",
      observationDueAt: FUTURE,
    });
    const second = await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "Risk",
      relatedEntityId: "risk-1",
      ruleName: "risk_resolution",
      ruleVersion: "v1",
      observationDueAt: FUTURE,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const count = await prisma.outcome.count({ where: { organizationId: organization.id } });
    expect(count).toBe(1);
  });

  it("C: an outcome can be linked to a Decision (soft reference) -- ready for a future decision-linked rule", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const decision = await prisma.decision.create({
      data: {
        organizationId: organization.id,
        ruleName: "top_priority_item",
        ruleVersion: "v1",
        recommendation: "fixture",
        rationale: "fixture",
        sourceType: "risk",
        sourceId: "risk-fixture",
        priorityScore: 100,
      },
    });

    await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "Risk",
      relatedEntityId: "risk-fixture",
      ruleName: "risk_resolution",
      ruleVersion: "v1",
      decisionId: decision.id,
      observationDueAt: PAST,
    });

    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: "risk-fixture" } });
    expect(outcome.decisionId).toBe(decision.id);
  });

  it("J: two different rule versions for the same subject never collide", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "Risk",
      relatedEntityId: "risk-2",
      ruleName: "risk_resolution",
      ruleVersion: "v1",
      observationDueAt: FUTURE,
    });
    await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "Risk",
      relatedEntityId: "risk-2",
      ruleName: "risk_resolution",
      ruleVersion: "v2",
      observationDueAt: FUTURE,
    });

    const count = await prisma.outcome.count({ where: { organizationId: organization.id, relatedEntityId: "risk-2" } });
    expect(count).toBe(2);
  });
});

describe("Outcome service: evaluation lifecycle", () => {
  afterAll(closeTestConnections);

  it("F: a pending outcome not yet due is never returned by findDueOutcomes", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "Opportunity",
      relatedEntityId: "opp-future",
      ruleName: "opportunity_state_progression",
      ruleVersion: "v1",
      observationDueAt: FUTURE,
    });

    const due = await findDueOutcomes(organization.id, "opportunity_state_progression", "v1");
    expect(due).toHaveLength(0);

    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: "opp-future" } });
    expect(outcome.evaluationStatus).toBe("pending");
    expect(outcome.outcomeType).toBeNull();
  });

  it("G/H/K: a rule can evaluate to success, then be re-evaluated to reversed, preserving the transition in AuditLog", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "Risk",
      relatedEntityId: "risk-flip",
      ruleName: "risk_resolution",
      ruleVersion: "v1",
      observationDueAt: PAST,
    });
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: "risk-flip" } });

    await applyEvaluation({ outcomeId: outcome.id, organizationId: organization.id, outcomeType: "success", confidence: 90 });
    const afterSuccess = await prisma.outcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(afterSuccess.evaluationStatus).toBe("evaluated");
    expect(afterSuccess.outcomeType).toBe("success");
    expect(afterSuccess.source).toBe("system");

    await applyEvaluation({ outcomeId: outcome.id, organizationId: organization.id, outcomeType: "reversed", confidence: 90 });
    const afterReversal = await prisma.outcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(afterReversal.outcomeType).toBe("reversed");

    const auditEntries = await prisma.auditLog.findMany({
      where: { organizationId: organization.id, action: "outcome.evaluated", targetId: outcome.id },
      orderBy: { createdAt: "asc" },
    });
    expect(auditEntries).toHaveLength(2);
    expect((auditEntries[0]?.metadata as { newOutcomeType: string }).newOutcomeType).toBe("success");
    expect((auditEntries[1]?.metadata as { previousOutcomeType: string }).previousOutcomeType).toBe("success");
    expect((auditEntries[1]?.metadata as { newOutcomeType: string }).newOutcomeType).toBe("reversed");
  });

  it("I: insufficient evidence is recorded distinctly from any verdict", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "AutonomousActionLog",
      relatedEntityId: "log-gone",
      ruleName: "stale_advisory_resolution",
      ruleVersion: "v1",
      observationDueAt: PAST,
    });
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: "log-gone" } });

    await markInsufficientEvidence({ organizationId: organization.id, outcomeId: outcome.id });
    const refreshed = await prisma.outcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(refreshed.evaluationStatus).toBe("insufficient_evidence");
    expect(refreshed.outcomeType).toBeNull();
    expect(refreshed.confidence).toBeNull();
  });
});

describe("Outcome service: human confirmation RBAC", () => {
  afterAll(closeTestConnections);

  it("L/M: owner can confirm an outcome; it is audit-logged with source=human, confidence=100", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "Opportunity",
      relatedEntityId: "opp-confirm",
      ruleName: "opportunity_state_progression",
      ruleVersion: "v1",
      observationDueAt: PAST,
    });
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: "opp-confirm" } });

    await confirmOutcome({
      organizationId: organization.id,
      outcomeId: outcome.id,
      outcomeType: "success",
      confirmedById: owner.userId,
      note: "Talked to the customer, deal closed.",
      requestHeaders: authHeaders(owner.token),
    });

    const refreshed = await prisma.outcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(refreshed.evaluationStatus).toBe("evaluated");
    expect(refreshed.outcomeType).toBe("success");
    expect(refreshed.source).toBe("human");
    expect(refreshed.confidence).toBe(100);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "outcome.confirmed", targetId: outcome.id },
    });
    expect(auditEntry?.actorType).toBe("user");
    expect(auditEntry?.actorId).toBe(owner.userId);
  });

  it("L: a viewer without outcome:confirm cannot confirm an outcome", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");

    await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "Opportunity",
      relatedEntityId: "opp-denied",
      ruleName: "opportunity_state_progression",
      ruleVersion: "v1",
      observationDueAt: PAST,
    });
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: "opp-denied" } });

    await expect(
      confirmOutcome({
        organizationId: organization.id,
        outcomeId: outcome.id,
        outcomeType: "success",
        confirmedById: viewer.userId,
        requestHeaders: authHeaders(viewer.token),
      }),
    ).rejects.toThrow(OutcomePermissionError);

    const unchanged = await prisma.outcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(unchanged.evaluationStatus).toBe("pending");
  });

  it("confirming a nonexistent outcome throws OutcomeNotFoundError", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    await expect(
      confirmOutcome({
        organizationId: organization.id,
        outcomeId: "does-not-exist",
        outcomeType: "success",
        confirmedById: owner.userId,
        requestHeaders: authHeaders(owner.token),
      }),
    ).rejects.toThrow(OutcomeNotFoundError);
  });

  it("a human-confirmed outcome is permanently excluded from automatic re-evaluation", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "Opportunity",
      relatedEntityId: "opp-human-final",
      ruleName: "opportunity_state_progression",
      ruleVersion: "v1",
      observationDueAt: PAST,
    });
    const outcome = await prisma.outcome.findFirstOrThrow({ where: { organizationId: organization.id, relatedEntityId: "opp-human-final" } });

    await confirmOutcome({
      organizationId: organization.id,
      outcomeId: outcome.id,
      outcomeType: "unknown",
      confirmedById: owner.userId,
      requestHeaders: authHeaders(owner.token),
    });

    // Force it back to "pending" evaluationStatus at the DB level to prove findDueOutcomes
    // excludes by `source`, not merely by evaluationStatus already being "evaluated".
    await prisma.outcome.update({ where: { id: outcome.id }, data: { evaluationStatus: "pending", observationDueAt: PAST } });

    const due = await findDueOutcomes(organization.id, "opportunity_state_progression", "v1");
    expect(due.find((o) => o.id === outcome.id)).toBeUndefined();
  });
});

describe("get_outcomes AI tool: read-only, RBAC-gated, cannot confirm anything", () => {
  afterAll(closeTestConnections);

  it("is registered read-only and lets a permitted member read outcome data", async () => {
    const tool = getTool("get_outcomes");
    expect(tool).toBeDefined();
    expect(tool?.mutationCategory).toBe("read_only");
    expect(tool?.requiredPermission).toEqual({ outcome: ["read"] });

    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createPendingOutcomeIfMissing({
      organizationId: organization.id,
      relatedEntityType: "Risk",
      relatedEntityId: "risk-ai-tool",
      ruleName: "risk_resolution",
      ruleVersion: "v1",
      observationDueAt: PAST,
    });

    const conversation = await createConversation({ organizationId: organization.id, userId: owner.userId });
    const result = await executeToolCall(
      { id: "ai-1", name: "get_outcomes", arguments: {} },
      { organizationId: organization.id, userId: owner.userId, conversationId: conversation.id },
      authHeaders(owner.token),
    );
    expect(result.status).toBe("success");
    if (result.status === "success") {
      const output = result.output as { outcomes: { relatedEntityId: string }[] };
      expect(output.outcomes.some((o) => o.relatedEntityId === "risk-ai-tool")).toBe(true);
    }

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "outcome.ai_viewed" },
    });
    expect(auditEntry?.actorType).toBe("ai");
  });

  it("has no mutating counterpart -- confirming an outcome is only ever reachable through confirmOutcome's own RBAC check, never a tool call", () => {
    expect(getTool("confirm_outcome")).toBeUndefined();
  });
});
