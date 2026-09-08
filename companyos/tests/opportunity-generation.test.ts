import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { createLead } from "@/server/leads/service";
import { listPipelineStages } from "@/server/leads/pipeline";
import { scanCompanySignals } from "@/server/intelligence/signals/scanner";
import { generateOpportunitiesForOrganization, listOpportunities } from "@/server/intelligence/opportunity/service";
import { computeCompanyIntelligence } from "@/server/intelligence/compute";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

async function backdateLeadActivity(leadId: string, daysAgo: number): Promise<void> {
  const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  await prisma.leadActivity.updateMany({ where: { leadId }, data: { createdAt: when } });
}

/** Creates a stalled, above-median-value open lead and runs the scanner so an active `high_value_stalled_lead` CompanySignal exists for it. */
async function createStalledHighValueLead(organizationId: string, actorId: string) {
  const stages = await listPipelineStages(organizationId);
  const openStage = stages.find((s) => !s.isWon && !s.isLost);
  if (!openStage) throw new Error("fixture setup: no open stage seeded");

  const lead = await createLead({ organizationId, actorId, title: "Big stalled deal", value: 9000, stageId: openStage.id });
  // Filler so this lead's value is strictly above the org's median (a lone lead's value always equals its own median).
  await createLead({ organizationId, actorId, title: "Filler", value: 0, stageId: openStage.id });
  await backdateLeadActivity(lead.id, 9);

  await scanCompanySignals();
  return lead;
}

describe("Opportunity generation: high_value_stalled_lead (V1's only rule)", () => {
  afterAll(closeTestConnections);

  it("converts an active high_value_stalled_lead CompanySignal into an Opportunity", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const lead = await createStalledHighValueLead(organization.id, owner.userId);

    const result = await generateOpportunitiesForOrganization(organization.id);
    expect(result.opportunitiesCreated).toBe(1);
    expect(result.opportunitiesUpdated).toBe(0);

    const opportunity = await prisma.opportunity.findFirst({
      where: { organizationId: organization.id, relatedEntityId: lead.id },
    });
    expect(opportunity).not.toBeNull();
    expect(opportunity?.ruleName).toBe("high_value_stalled_lead");
    expect(opportunity?.relatedEntityType).toBe("Lead");
    expect(Number(opportunity?.potentialImpact)).toBe(9000);
    expect(opportunity?.status).toBe("new");
    expect(opportunity?.title).toContain("Big stalled deal");
    expect(opportunity?.explanation).toContain("9,000");
  });

  it("does not create an Opportunity for a lead with no active signal", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const stages = await listPipelineStages(organization.id);
    const openStage = stages.find((s) => !s.isWon && !s.isLost)!;
    await createLead({ organizationId: organization.id, actorId: owner.userId, title: "Healthy deal", value: 1000, stageId: openStage.id });

    const result = await generateOpportunitiesForOrganization(organization.id);
    expect(result.opportunitiesCreated).toBe(0);

    const count = await prisma.opportunity.count({ where: { organizationId: organization.id } });
    expect(count).toBe(0);
  });

  it("re-running generation on an already-flagged signal upserts the same Opportunity, not a duplicate", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createStalledHighValueLead(organization.id, owner.userId);

    await generateOpportunitiesForOrganization(organization.id);
    const second = await generateOpportunitiesForOrganization(organization.id);

    expect(second.opportunitiesCreated).toBe(0);
    expect(second.opportunitiesUpdated).toBe(1);

    const all = await prisma.opportunity.findMany({ where: { organizationId: organization.id } });
    expect(all).toHaveLength(1);
  });

  it("never overwrites a human's triage decision (status) on re-detection", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createStalledHighValueLead(organization.id, owner.userId);

    await generateOpportunitiesForOrganization(organization.id);
    const opportunity = await prisma.opportunity.findFirstOrThrow({ where: { organizationId: organization.id } });

    await prisma.opportunity.update({ where: { id: opportunity.id }, data: { status: "dismissed" } });

    // Re-run the scanner and the generator, simulating the next scheduled pass.
    await scanCompanySignals();
    await generateOpportunitiesForOrganization(organization.id);

    const refreshed = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(refreshed.status).toBe("dismissed");
  });

  it("stops generating once the underlying signal is no longer active", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createStalledHighValueLead(organization.id, owner.userId);

    await generateOpportunitiesForOrganization(organization.id);
    await prisma.companySignal.updateMany({
      where: { organizationId: organization.id, ruleName: "high_value_stalled_lead" },
      data: { status: "resolved" },
    });

    const result = await generateOpportunitiesForOrganization(organization.id);
    expect(result.signalsEvaluated).toBe(0);
    expect(result.opportunitiesCreated).toBe(0);
    expect(result.opportunitiesUpdated).toBe(0);
  });

  it("only generates and lists opportunities scoped to their own organization", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    await createStalledHighValueLead(orgA.id, ownerA.userId);

    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);
    await createStalledHighValueLead(orgB.id, ownerB.userId);

    await generateOpportunitiesForOrganization(orgA.id);

    const { opportunities: opportunitiesA } = await listOpportunities({ organizationId: orgA.id });
    const { opportunities: opportunitiesB } = await listOpportunities({ organizationId: orgB.id });
    expect(opportunitiesA).toHaveLength(1);
    expect(opportunitiesB).toHaveLength(0); // orgB's signal exists, but was never generated for orgB
  });

  it("computeCompanyIntelligence records a health snapshot and generates opportunities for every organization", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await createStalledHighValueLead(organization.id, owner.userId);

    const result = await computeCompanyIntelligence();
    expect(result.organizationsScanned).toBeGreaterThan(0);
    expect(result.opportunitiesCreated).toBeGreaterThanOrEqual(1);

    const snapshot = await prisma.companyHealthSnapshot.findFirst({ where: { organizationId: organization.id } });
    expect(snapshot).not.toBeNull();

    const { opportunities } = await listOpportunities({ organizationId: organization.id });
    expect(opportunities).toHaveLength(1);
  });
});
