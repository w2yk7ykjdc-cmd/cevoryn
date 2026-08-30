import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { createCompany } from "@/server/companies/service";
import { createContact } from "@/server/contacts/service";
import { createPipelineStage, listPipelineStages } from "@/server/leads/pipeline";
import {
  addLeadActivity,
  changeLeadStage,
  createLead,
  getLead,
  listLeads,
  softDeleteLead,
  updateLead,
} from "@/server/leads/service";
import {
  LeadCompanyReferenceError,
  LeadContactReferenceError,
  LeadNotFoundError,
  LeadOwnerReferenceError,
  PipelineStageNotFoundError,
} from "@/server/leads/types";
import { addMemberDirect, closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

describe("leads", () => {
  afterAll(closeTestConnections);

  async function setup() {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    return { owner, organization };
  }

  it("seeds a default, ordered pipeline for every new organization", async () => {
    const { organization } = await setup();
    const stages = await listPipelineStages(organization.id);

    expect(stages.map((s) => s.name)).toEqual([
      "New",
      "Contacted",
      "Qualified",
      "Proposal",
      "Won",
      "Lost",
    ]);
    expect(stages.find((s) => s.name === "Won")?.isWon).toBe(true);
    expect(stages.find((s) => s.name === "Lost")?.isLost).toBe(true);
  });

  it("creates a lead in the first stage by default, with an opening timeline entry and audit log", async () => {
    const { owner, organization } = await setup();

    const lead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Big Deal",
      value: 50000,
      probability: 20,
      source: "referral",
    });

    const stages = await listPipelineStages(organization.id);
    expect(lead.stageId).toBe(stages[0]!.id);
    expect(Number(lead.value)).toBe(50000);
    expect(lead.probability).toBe(20);
    expect(lead.ownerId).toBe(owner.userId); // defaults to creator

    const activity = await prisma.leadActivity.findFirst({
      where: { leadId: lead.id, type: "stage_changed" },
    });
    expect(activity).not.toBeNull();

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "lead.created", targetId: lead.id },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("clamps probability to 0-100", async () => {
    const { owner, organization } = await setup();
    const lead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Clamped",
      probability: 150,
    });
    expect(lead.probability).toBe(100);
  });

  it("rejects a stage, company, or contact that belongs to a different organization", async () => {
    const a = await setup();
    const b = await setup();
    const bStages = await listPipelineStages(b.organization.id);
    const bCompany = await createCompany({ organizationId: b.organization.id, actorId: b.owner.userId, name: "B Co" });
    const bContact = await createContact({
      organizationId: b.organization.id,
      actorId: b.owner.userId,
      firstName: "B",
      lastName: "Contact",
    });

    await expect(
      createLead({ organizationId: a.organization.id, actorId: a.owner.userId, title: "X", stageId: bStages[0]!.id }),
    ).rejects.toThrow(PipelineStageNotFoundError);

    await expect(
      createLead({ organizationId: a.organization.id, actorId: a.owner.userId, title: "X", companyId: bCompany.id }),
    ).rejects.toThrow(LeadCompanyReferenceError);

    await expect(
      createLead({ organizationId: a.organization.id, actorId: a.owner.userId, title: "X", contactId: bContact.id }),
    ).rejects.toThrow(LeadContactReferenceError);

    await expect(
      createLead({ organizationId: a.organization.id, actorId: a.owner.userId, title: "X", ownerId: b.owner.userId }),
    ).rejects.toThrow(LeadOwnerReferenceError);
  });

  it("reassigns a lead's owner to another member of the same organization", async () => {
    const { owner, organization } = await setup();
    const otherMember = await signUpUser();
    await addMemberDirect(organization.id, otherMember, "member");

    const lead = await createLead({ organizationId: organization.id, actorId: owner.userId, title: "Handoff" });
    expect(lead.ownerId).toBe(owner.userId);

    const updated = await updateLead({
      organizationId: organization.id,
      actorId: owner.userId,
      leadId: lead.id,
      data: { ownerId: otherMember.userId },
    });
    expect(updated.ownerId).toBe(otherMember.userId);
  });

  it("rejects reassigning a lead's owner to a user who isn't a member of the organization", async () => {
    const { owner, organization } = await setup();
    const outsider = await signUpUser();
    const lead = await createLead({ organizationId: organization.id, actorId: owner.userId, title: "No handoff" });

    await expect(
      updateLead({
        organizationId: organization.id,
        actorId: owner.userId,
        leadId: lead.id,
        data: { ownerId: outsider.userId },
      }),
    ).rejects.toThrow(LeadOwnerReferenceError);
  });

  it("moves a lead through stages, closing it when it reaches Won", async () => {
    const { owner, organization } = await setup();
    const lead = await createLead({ organizationId: organization.id, actorId: owner.userId, title: "Pipeline Test" });
    const stages = await listPipelineStages(organization.id);
    const wonStage = stages.find((s) => s.name === "Won")!;

    const updated = await changeLeadStage(organization.id, owner.userId, lead.id, wonStage.id);
    expect(updated.stageId).toBe(wonStage.id);
    expect(updated.closedAt).not.toBeNull();

    const activities = await prisma.leadActivity.findMany({ where: { leadId: lead.id, type: "stage_changed" } });
    expect(activities).toHaveLength(2); // creation + this move

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "lead.stage_changed", targetId: lead.id },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("updates lead fields and records an audit log entry", async () => {
    const { owner, organization } = await setup();
    const lead = await createLead({ organizationId: organization.id, actorId: owner.userId, title: "Before" });

    const updated = await updateLead({
      organizationId: organization.id,
      actorId: owner.userId,
      leadId: lead.id,
      data: { title: "After", value: 1000 },
    });
    expect(updated.title).toBe("After");
    expect(Number(updated.value)).toBe(1000);
  });

  it("appends a manual activity entry to the timeline", async () => {
    const { owner, organization } = await setup();
    const lead = await createLead({ organizationId: organization.id, actorId: owner.userId, title: "Notes" });

    await addLeadActivity({
      organizationId: organization.id,
      leadId: lead.id,
      type: "call",
      body: "Discovery call, positive signal.",
      actorId: owner.userId,
    });

    const full = await getLead(organization.id, lead.id);
    const callActivity = full?.activities.find((a) => a.type === "call");
    expect(callActivity?.body).toBe("Discovery call, positive signal.");
  });

  it("refuses to add an activity to a lead in a different organization", async () => {
    const a = await setup();
    const b = await setup();
    const lead = await createLead({ organizationId: a.organization.id, actorId: a.owner.userId, title: "A Lead" });

    await expect(
      addLeadActivity({ organizationId: b.organization.id, leadId: lead.id, type: "note", body: "Nope" }),
    ).rejects.toThrow(LeadNotFoundError);
  });

  it("does not leak leads across organizations and supports stage filtering", async () => {
    const a = await setup();
    const b = await setup();
    const aStages = await listPipelineStages(a.organization.id);
    await createLead({ organizationId: a.organization.id, actorId: a.owner.userId, title: "A1", stageId: aStages[0]!.id });
    await createLead({ organizationId: a.organization.id, actorId: a.owner.userId, title: "A2", stageId: aStages[1]!.id });
    await createLead({ organizationId: b.organization.id, actorId: b.owner.userId, title: "B1" });

    const { leads: allA } = await listLeads({ organizationId: a.organization.id });
    expect(allA).toHaveLength(2);

    const { leads: filtered } = await listLeads({ organizationId: a.organization.id, stageId: aStages[0]!.id });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe("A1");
  });

  it("soft-deletes a lead: hidden from reads, audit logged", async () => {
    const { owner, organization } = await setup();
    const lead = await createLead({ organizationId: organization.id, actorId: owner.userId, title: "Delete me" });

    await softDeleteLead(organization.id, lead.id, owner.userId);

    expect(await getLead(organization.id, lead.id)).toBeNull();
    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "lead.deleted", targetId: lead.id },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("lets an organization add a custom pipeline stage at the end of the order", async () => {
    const { owner, organization } = await setup();
    const stage = await createPipelineStage(organization.id, owner.userId, "Negotiation");

    const stages = await listPipelineStages(organization.id);
    expect(stages[stages.length - 1]?.id).toBe(stage.id);
    expect(stage.order).toBe(6);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "pipeline_stage.created", targetId: stage.id },
    });
    expect(auditEntry).not.toBeNull();
  });
});
