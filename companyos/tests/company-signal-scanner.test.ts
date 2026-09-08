import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import { createLead } from "@/server/leads/service";
import { listPipelineStages } from "@/server/leads/pipeline";
import { scanCompanySignals } from "@/server/intelligence/signals/scanner";
import * as signalsService from "@/server/intelligence/signals/service";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

async function backdateLeadActivity(leadId: string, daysAgo: number): Promise<void> {
  const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  await prisma.leadActivity.updateMany({ where: { leadId }, data: { createdAt: when } });
}

describe("company signal scanner: high_value_stalled_lead", () => {
  afterAll(closeTestConnections);
  afterEach(() => vi.restoreAllMocks());

  it("flags a stalled, above-median-value open lead and skips a stalled-but-below-median or recently-active one", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const stages = await listPipelineStages(organization.id);
    const openStage = stages.find((s) => !s.isWon && !s.isLost);
    if (!openStage) throw new Error("fixture setup: no open stage seeded");

    // Sorted values [1000, 1000, 9000, 9000] -> median = (1000+9000)/2 = 5000.
    // `highValueStaleLead` (9000) is strictly above it; `lowValueStaleLead`
    // (1000) is strictly below it; `highValueFreshLead` (9000) is above the
    // median too but excluded on staleness alone, keeping each assertion
    // below tied to exactly one dimension.
    const lowValueStaleLead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Small stalled deal",
      value: 1000,
      stageId: openStage.id,
    });
    const lowValueFreshFillerLead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Small fresh filler deal",
      value: 1000,
      stageId: openStage.id,
    });
    const highValueStaleLead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Big stalled deal",
      value: 9000,
      stageId: openStage.id,
    });
    const highValueFreshLead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Big fresh deal",
      value: 9000,
      stageId: openStage.id,
    });

    await backdateLeadActivity(lowValueStaleLead.id, 9);
    await backdateLeadActivity(highValueStaleLead.id, 9);
    await backdateLeadActivity(highValueFreshLead.id, 2);
    await backdateLeadActivity(lowValueFreshFillerLead.id, 2);

    await scanCompanySignals();

    const eligible = await prisma.companySignal.findFirst({
      where: { organizationId: organization.id, ruleName: "high_value_stalled_lead", relatedEntityId: highValueStaleLead.id },
    });
    expect(eligible).not.toBeNull();
    expect(eligible?.severity).toBe("medium"); // 9 days: stale but not > 14
    expect(eligible?.confidence).toBe(90); // has real activity history

    const belowMedian = await prisma.companySignal.findFirst({
      where: { organizationId: organization.id, ruleName: "high_value_stalled_lead", relatedEntityId: lowValueStaleLead.id },
    });
    expect(belowMedian).toBeNull();

    const notStale = await prisma.companySignal.findFirst({
      where: { organizationId: organization.id, ruleName: "high_value_stalled_lead", relatedEntityId: highValueFreshLead.id },
    });
    expect(notStale).toBeNull();
  });

  it("never flags a won or lost lead, regardless of staleness or value", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const stages = await listPipelineStages(organization.id);
    const wonStage = stages.find((s) => s.isWon);
    const lostStage = stages.find((s) => s.isLost);
    if (!wonStage || !lostStage) throw new Error("fixture setup: won/lost stage missing");

    const wonLead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Won deal",
      value: 9000,
      stageId: wonStage.id,
    });
    const lostLead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Lost deal",
      value: 9000,
      stageId: lostStage.id,
    });
    await backdateLeadActivity(wonLead.id, 30);
    await backdateLeadActivity(lostLead.id, 30);

    await scanCompanySignals();

    const wonSignal = await prisma.companySignal.findFirst({
      where: { organizationId: organization.id, ruleName: "high_value_stalled_lead", relatedEntityId: wonLead.id },
    });
    const lostSignal = await prisma.companySignal.findFirst({
      where: { organizationId: organization.id, ruleName: "high_value_stalled_lead", relatedEntityId: lostLead.id },
    });
    expect(wonSignal).toBeNull();
    expect(lostSignal).toBeNull();
  });

  it("re-running the scanner over an already-flagged lead upserts the same signal, not a duplicate", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const stages = await listPipelineStages(organization.id);
    const openStage = stages.find((s) => !s.isWon && !s.isLost);
    if (!openStage) throw new Error("fixture setup: no open stage seeded");

    const lead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Persistently stalled deal",
      value: 9000,
      stageId: openStage.id,
    });
    // A second, cheap open lead so the median (of [0, 9000] = 4500) still puts this one above it.
    await createLead({ organizationId: organization.id, actorId: owner.userId, title: "Filler", value: 0, stageId: openStage.id });
    await backdateLeadActivity(lead.id, 9);

    await scanCompanySignals();
    await scanCompanySignals();

    const signals = await prisma.companySignal.findMany({
      where: { organizationId: organization.id, ruleName: "high_value_stalled_lead", relatedEntityId: lead.id },
    });
    expect(signals).toHaveLength(1);
  });

  it("one organization's scan failure does not stop the rest of the batch", async () => {
    const failingOwner = await signUpUser();
    const failingOrg = await createOrgForUser(failingOwner);
    const failingStages = await listPipelineStages(failingOrg.id);
    const failingOpenStage = failingStages.find((s) => !s.isWon && !s.isLost)!;
    const failingLead = await createLead({
      organizationId: failingOrg.id,
      actorId: failingOwner.userId,
      title: "Deal in the organization whose scan will fail",
      value: 9000,
      stageId: failingOpenStage.id,
    });
    // Filler so `failingLead`'s value is strictly above this org's median
    // (a lone lead's value always equals its own median).
    await createLead({ organizationId: failingOrg.id, actorId: failingOwner.userId, title: "Filler", value: 0, stageId: failingOpenStage.id });
    await backdateLeadActivity(failingLead.id, 9);

    const healthyOwner = await signUpUser();
    const healthyOrg = await createOrgForUser(healthyOwner);
    const healthyStages = await listPipelineStages(healthyOrg.id);
    const healthyOpenStage = healthyStages.find((s) => !s.isWon && !s.isLost)!;
    const healthyLead = await createLead({
      organizationId: healthyOrg.id,
      actorId: healthyOwner.userId,
      title: "Deal in a healthy organization",
      value: 9000,
      stageId: healthyOpenStage.id,
    });
    await createLead({ organizationId: healthyOrg.id, actorId: healthyOwner.userId, title: "Filler", value: 0, stageId: healthyOpenStage.id });
    await backdateLeadActivity(healthyLead.id, 9);

    // Deliberately inject one failure, scoped to `failingOrg`, to prove the
    // scan's per-organization try/catch keeps going for the rest of the
    // batch — a real per-organization Prisma failure isn't practical to
    // construct deterministically (every FK/constraint in this schema is
    // enforced), so this targeted spy simulates it instead.
    const originalRecordSignal = signalsService.recordSignal;
    vi.spyOn(signalsService, "recordSignal").mockImplementation(async (input) => {
      if (input.organizationId === failingOrg.id) {
        throw new Error("simulated failure for this organization");
      }
      return originalRecordSignal(input);
    });

    await scanCompanySignals();

    const failingSignal = await prisma.companySignal.findFirst({
      where: { organizationId: failingOrg.id, ruleName: "high_value_stalled_lead", relatedEntityId: failingLead.id },
    });
    expect(failingSignal).toBeNull(); // this organization's write failed, as simulated

    const healthySignal = await prisma.companySignal.findFirst({
      where: { organizationId: healthyOrg.id, ruleName: "high_value_stalled_lead", relatedEntityId: healthyLead.id },
    });
    expect(healthySignal).not.toBeNull(); // the rest of the batch still completed
  });
});
