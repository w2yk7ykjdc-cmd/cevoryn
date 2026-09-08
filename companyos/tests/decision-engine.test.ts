import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { createLead } from "@/server/leads/service";
import { listPipelineStages } from "@/server/leads/pipeline";
import { scanCompanySignals } from "@/server/intelligence/signals/scanner";
import { generateOpportunitiesForOrganization } from "@/server/intelligence/opportunity/service";
import { applyWebhookEvent, getSubscriptionForOrg } from "@/server/billing/subscription";
import { recordSignal } from "@/server/intelligence/signals/service";
import { generateRisksForOrganization } from "@/server/intelligence/risk/service";
import { generateDecisionForOrganization, getDecisionForOrganization } from "@/server/intelligence/decision/service";
import { computeCompanyIntelligence } from "@/server/intelligence/compute";
import {
  pickTopPriorityItem,
  type RiskCandidate,
  type OpportunityCandidate,
} from "@/server/intelligence/decision/rules/top-priority-item";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

function riskCandidate(overrides: Partial<RiskCandidate> = {}): RiskCandidate {
  return {
    kind: "risk",
    id: "risk-1",
    title: "Subscription at risk",
    explanation: "explanation",
    severity: "high",
    potentialLoss: 100,
    detectedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function opportunityCandidate(overrides: Partial<OpportunityCandidate> = {}): OpportunityCandidate {
  return {
    kind: "opportunity",
    id: "opp-1",
    title: "Stalled lead",
    explanation: "explanation",
    urgency: "high",
    potentialImpact: 100,
    detectedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("pickTopPriorityItem (pure, deterministic ranking)", () => {
  it("returns null for no candidates", () => {
    expect(pickTopPriorityItem([])).toBeNull();
  });

  it("picks the only candidate when there's exactly one", () => {
    const candidate = riskCandidate();
    const picked = pickTopPriorityItem([candidate]);
    expect(picked?.sourceType).toBe("risk");
    expect(picked?.sourceId).toBe("risk-1");
    expect(picked?.rationale).toContain("only open item");
  });

  it("picks the candidate with higher severity-weighted dollar exposure", () => {
    const lowExposure = riskCandidate({ id: "risk-low", severity: "low", potentialLoss: 100 }); // weight 1 * 100 = 100
    const highExposure = opportunityCandidate({ id: "opp-high", urgency: "high", potentialImpact: 100 }); // weight 3 * 100 = 300
    const picked = pickTopPriorityItem([lowExposure, highExposure]);
    expect(picked?.sourceId).toBe("opp-high");
  });

  it("prefers a Risk over an Opportunity when their exposure scores tie", () => {
    const risk = riskCandidate({ id: "tied-risk", severity: "high", potentialLoss: 100 }); // 3 * 100 = 300
    const opportunity = opportunityCandidate({ id: "tied-opp", urgency: "high", potentialImpact: 100 }); // 3 * 100 = 300
    const picked = pickTopPriorityItem([opportunity, risk]);
    expect(picked?.sourceType).toBe("risk");
    expect(picked?.sourceId).toBe("tied-risk");
  });

  it("breaks a same-kind, same-score tie by picking the most stale (oldest detectedAt)", () => {
    const older = riskCandidate({ id: "older-risk", detectedAt: new Date("2025-01-01") });
    const newer = riskCandidate({ id: "newer-risk", detectedAt: new Date("2026-01-01") });
    const picked = pickTopPriorityItem([newer, older]);
    expect(picked?.sourceId).toBe("older-risk");
  });

  it("includes the runner-up's score in the rationale when more than one candidate exists", () => {
    const winner = riskCandidate({ id: "winner", severity: "critical", potentialLoss: 1000 });
    const runnerUp = opportunityCandidate({ id: "runner-up", urgency: "low", potentialImpact: 100 });
    const picked = pickTopPriorityItem([winner, runnerUp]);
    expect(picked?.evidence.runnerUpScore).toBe(100);
    expect(picked?.rationale).toMatch(/\$4,000/); // 4 (critical weight) * 1000
  });
});

async function backdateLead(leadId: string, daysAgo: number): Promise<void> {
  const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  await prisma.lead.update({ where: { id: leadId }, data: { createdAt: when } });
  await prisma.leadActivity.updateMany({ where: { leadId }, data: { createdAt: when } });
}

/** Creates one active, high-value stalled-lead Opportunity for the org via the real Sprint 6 pipeline. */
async function createOpenOpportunity(organizationId: string, actorId: string) {
  const stages = await listPipelineStages(organizationId);
  const openStage = stages.find((s) => !s.isWon && !s.isLost)!;
  const lead = await createLead({ organizationId, actorId, title: "Stalled deal", value: 9000, stageId: openStage.id });
  await createLead({ organizationId, actorId, title: "Filler", value: 0, stageId: openStage.id });
  await backdateLead(lead.id, 9);
  await scanCompanySignals();
  await generateOpportunitiesForOrganization(organizationId);
  return lead;
}

/** Creates one open, at-risk-subscription Risk for the org via the real Sprint 7 pipeline. */
async function createOpenRisk(organizationId: string) {
  const customerId = `cus_${organizationId}`;
  const stripeSubscriptionId = `sub_${organizationId}`;
  await applyWebhookEvent({
    id: `evt_checkout_${organizationId}`,
    type: "checkout.session.completed",
    data: { object: { client_reference_id: organizationId, customer: customerId, subscription: stripeSubscriptionId } },
  });
  const subscription = await getSubscriptionForOrg(organizationId);
  await recordSignal({
    organizationId,
    type: "billing.subscription_updated",
    sourceType: "domain_event",
    sourceId: subscription.id,
    severity: "high",
    confidence: 100,
    ruleName: "billing.subscription_updated",
    ruleVersion: "v1",
    relatedEntityType: "Subscription",
    relatedEntityId: subscription.id,
    payload: { organizationId, subscriptionId: subscription.id, status: "past_due" },
  });
  await generateRisksForOrganization(organizationId);
  return subscription;
}

describe("Decision Engine V1: generateDecisionForOrganization / getDecisionForOrganization", () => {
  afterAll(closeTestConnections);

  it("computes no Decision when there are no open Risks or active Opportunities", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const result = await generateDecisionForOrganization(organization.id);
    expect(result.decided).toBe(false);
    expect(await getDecisionForOrganization(organization.id)).toBeNull();
  });

  it("surfaces the single open Risk as the Decision when it's the only candidate", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createOpenRisk(organization.id);

    const result = await generateDecisionForOrganization(organization.id);
    expect(result.decided).toBe(true);

    const decision = await getDecisionForOrganization(organization.id);
    expect(decision).not.toBeNull();
    expect(decision?.sourceType).toBe("risk");
    expect(decision?.ruleName).toBe("top_priority_item");
  });

  it("surfaces the single active Opportunity as the Decision when it's the only candidate", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createOpenOpportunity(organization.id, owner.userId);

    const result = await generateDecisionForOrganization(organization.id);
    expect(result.decided).toBe(true);

    const decision = await getDecisionForOrganization(organization.id);
    expect(decision?.sourceType).toBe("opportunity");
  });

  it("re-running generation upserts the same Decision row in place, never duplicating it", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createOpenRisk(organization.id);

    await generateDecisionForOrganization(organization.id);
    const first = await getDecisionForOrganization(organization.id);
    await generateDecisionForOrganization(organization.id);
    const second = await getDecisionForOrganization(organization.id);

    expect(second?.id).toBe(first?.id);
    const all = await prisma.decision.findMany({ where: { organizationId: organization.id } });
    expect(all).toHaveLength(1);
  });

  it("deletes the Decision once the winning Risk resolves and no other candidate remains", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const subscription = await createOpenRisk(organization.id);
    await generateDecisionForOrganization(organization.id);
    expect(await getDecisionForOrganization(organization.id)).not.toBeNull();

    // The subscription recovers -> the Risk auto-resolves -> no candidates remain.
    await recordSignal({
      organizationId: organization.id,
      type: "billing.subscription_updated",
      sourceType: "domain_event",
      sourceId: subscription.id,
      severity: "low",
      confidence: 100,
      ruleName: "billing.subscription_updated",
      ruleVersion: "v1",
      relatedEntityType: "Subscription",
      relatedEntityId: subscription.id,
      payload: { organizationId: organization.id, subscriptionId: subscription.id, status: "active" },
    });
    await generateRisksForOrganization(organization.id);

    const result = await generateDecisionForOrganization(organization.id);
    expect(result.decided).toBe(false);
    expect(await getDecisionForOrganization(organization.id)).toBeNull();
    expect(await prisma.decision.count({ where: { organizationId: organization.id } })).toBe(0);
  });

  it("only computes and reads decisions scoped to their own organization", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    await createOpenRisk(orgA.id);

    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await createOpenRisk(orgB.id);

    await generateDecisionForOrganization(orgA.id);

    expect(await getDecisionForOrganization(orgA.id)).not.toBeNull();
    expect(await getDecisionForOrganization(orgB.id)).toBeNull(); // orgB's risk exists, but was never generated for orgB
  });

  it("computeCompanyIntelligence computes decisions for every organization after refreshing opportunities and risks", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createOpenRisk(organization.id);

    const result = await computeCompanyIntelligence();
    expect(result.decisionsComputed).toBeGreaterThanOrEqual(1);

    const decision = await getDecisionForOrganization(organization.id);
    expect(decision).not.toBeNull();
  });
});
