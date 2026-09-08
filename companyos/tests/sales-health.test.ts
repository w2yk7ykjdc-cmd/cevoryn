import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { createLead } from "@/server/leads/service";
import { listPipelineStages } from "@/server/leads/pipeline";
import {
  SALES_HEALTH_RULE_VERSION,
  computeSalesHealthEvidence,
  computeSalesHealthScore,
  type SalesHealthEvidence,
} from "@/server/intelligence/health/sales-health";
import { getLatestHealthSnapshot, recordHealthSnapshot } from "@/server/intelligence/health/service";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

/**
 * `analyzeLead()` takes the *later* of `Lead.createdAt` and its most recent
 * activity when computing "last activity" (a lead's own creation always
 * counts as activity) — so backdating only the activity has no effect
 * unless the lead's own `createdAt` is pushed back too. Both are set to the
 * same timestamp here to simulate "created N days ago, no activity since."
 */
async function backdateLead(leadId: string, daysAgo: number): Promise<void> {
  const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  await prisma.lead.update({ where: { id: leadId }, data: { createdAt: when } });
  await prisma.leadActivity.updateMany({ where: { leadId }, data: { createdAt: when } });
}

function baseEvidence(overrides: Partial<SalesHealthEvidence> = {}): SalesHealthEvidence {
  return {
    totalOpenLeads: 0,
    highRiskLeadCount: 0,
    mediumRiskLeadCount: 0,
    lowRiskLeadCount: 0,
    overdueTaskCount: 0,
    averageDaysSinceLastActivity: 0,
    ...overrides,
  };
}

describe("computeSalesHealthScore (pure, deterministic)", () => {
  it("scores an organization with no open leads a clean 100", () => {
    expect(computeSalesHealthScore(baseEvidence())).toBe(100);
  });

  it("scores 100 when every open lead is low risk", () => {
    const evidence = baseEvidence({ totalOpenLeads: 5, lowRiskLeadCount: 5 });
    expect(computeSalesHealthScore(evidence)).toBe(100);
  });

  it("penalizes high-risk leads more heavily than medium-risk ones", () => {
    const allHigh = baseEvidence({ totalOpenLeads: 4, highRiskLeadCount: 4 });
    const allMedium = baseEvidence({ totalOpenLeads: 4, mediumRiskLeadCount: 4 });
    const highScore = computeSalesHealthScore(allHigh);
    const mediumScore = computeSalesHealthScore(allMedium);

    expect(highScore).toBe(30); // 100 - (1.0 * 70)
    expect(mediumScore).toBe(70); // 100 - (1.0 * 30)
    expect(highScore).toBeLessThan(mediumScore);
  });

  it("weights a mixed portfolio proportionally to each risk tier's share", () => {
    const evidence = baseEvidence({
      totalOpenLeads: 4,
      highRiskLeadCount: 1,
      mediumRiskLeadCount: 1,
      lowRiskLeadCount: 2,
    });
    // 100 - (0.25 * 70) - (0.25 * 30) = 100 - 17.5 - 7.5 = 75
    expect(computeSalesHealthScore(evidence)).toBe(75);
  });

  it("never returns a score below 0 or above 100", () => {
    const worst = baseEvidence({ totalOpenLeads: 10, highRiskLeadCount: 10 });
    const best = baseEvidence({ totalOpenLeads: 10, lowRiskLeadCount: 10 });
    expect(computeSalesHealthScore(worst)).toBeGreaterThanOrEqual(0);
    expect(computeSalesHealthScore(best)).toBeLessThanOrEqual(100);
  });
});

describe("computeSalesHealthEvidence (reuses analyzeLead per open lead)", () => {
  afterAll(closeTestConnections);

  it("aggregates analyzeLead's per-lead risk classification across an organization's open leads", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const stages = await listPipelineStages(organization.id);
    const openStage = stages.find((s) => !s.isWon && !s.isLost);
    if (!openStage) throw new Error("fixture setup: no open stage seeded");

    // Left alone deliberately: its creation activity stays recent, so it should count as low risk.
    await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Fresh lead",
      value: 1000,
      stageId: openStage.id,
    });
    const agingLead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Aging lead",
      value: 1000,
      stageId: openStage.id,
    });
    const staleLead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Stale lead",
      value: 1000,
      stageId: openStage.id,
    });
    await backdateLead(agingLead.id, 5); // 3 < 5 <= 7 -> medium risk
    await backdateLead(staleLead.id, 9); // > 7 -> high risk

    const evidence = await computeSalesHealthEvidence(organization.id);

    expect(evidence.totalOpenLeads).toBe(3);
    expect(evidence.highRiskLeadCount).toBe(1);
    expect(evidence.mediumRiskLeadCount).toBe(1);
    expect(evidence.lowRiskLeadCount).toBe(1);
  });

  it("excludes won and lost leads from the evidence entirely", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const stages = await listPipelineStages(organization.id);
    const wonStage = stages.find((s) => s.isWon);
    if (!wonStage) throw new Error("fixture setup: no won stage seeded");

    await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Won deal",
      value: 5000,
      stageId: wonStage.id,
    });

    const evidence = await computeSalesHealthEvidence(organization.id);
    expect(evidence.totalOpenLeads).toBe(0);
  });

  it("only sees leads belonging to its own organization", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const stagesA = await listPipelineStages(orgA.id);
    const openStageA = stagesA.find((s) => !s.isWon && !s.isLost)!;
    await createLead({ organizationId: orgA.id, actorId: ownerA.userId, title: "A's lead", value: 1000, stageId: openStageA.id });

    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);

    const evidenceB = await computeSalesHealthEvidence(orgB.id);
    expect(evidenceB.totalOpenLeads).toBe(0);
  });
});

describe("recordHealthSnapshot / getLatestHealthSnapshot", () => {
  afterAll(closeTestConnections);

  it("persists a new CompanyHealthSnapshot row scoped to the organization", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const snapshot = await recordHealthSnapshot(organization.id);

    expect(snapshot.organizationId).toBe(organization.id);
    expect(snapshot.salesHealthScore).toBe(100); // no open leads yet
    expect(snapshot.ruleVersion).toBe(SALES_HEALTH_RULE_VERSION);

    const latest = await getLatestHealthSnapshot(organization.id);
    expect(latest?.id).toBe(snapshot.id);
  });

  it("is an append-only time series: recording twice creates two rows, not one upserted row", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const first = await recordHealthSnapshot(organization.id);
    const second = await recordHealthSnapshot(organization.id);

    expect(first.id).not.toBe(second.id);
    const all = await prisma.companyHealthSnapshot.findMany({ where: { organizationId: organization.id } });
    expect(all).toHaveLength(2);

    const latest = await getLatestHealthSnapshot(organization.id);
    expect(latest?.id).toBe(second.id);
  });

  it("getLatestHealthSnapshot returns null for an organization with no snapshots yet", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    expect(await getLatestHealthSnapshot(organization.id)).toBeNull();
  });
});
