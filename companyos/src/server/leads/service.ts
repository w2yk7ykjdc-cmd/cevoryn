import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient } from "@/server/db/tenant";
import { recordAuditLog, publishAuditEvent } from "@/server/audit/audit-log";
import { publishEvent } from "@/server/events/event-bus";
import {
  LeadCompanyReferenceError,
  LeadContactReferenceError,
  LeadNotFoundError,
  LeadOwnerReferenceError,
  PipelineStageNotFoundError,
} from "@/server/leads/types";
import type {
  AddLeadActivityInput,
  CreateLeadInput,
  ListLeadsInput,
  UpdateLeadInput,
} from "@/server/leads/types";

function clampProbability(value: number | undefined): number {
  if (value === undefined) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

async function loadStage(tx: Prisma.TransactionClient, organizationId: string, stageId: string) {
  const stage = await tx.pipelineStage.findFirst({ where: { id: stageId, organizationId } });
  if (!stage) {
    throw new PipelineStageNotFoundError(stageId);
  }
  return stage;
}

async function assertReferencesBelongToOrg(
  tx: Prisma.TransactionClient,
  organizationId: string,
  refs: { companyId?: string | null; contactId?: string | null; ownerId?: string | null },
) {
  if (refs.companyId) {
    const company = await tx.company.findFirst({
      where: { id: refs.companyId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!company) {
      throw new LeadCompanyReferenceError(refs.companyId);
    }
  }
  if (refs.contactId) {
    const contact = await tx.contact.findFirst({
      where: { id: refs.contactId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!contact) {
      throw new LeadContactReferenceError(refs.contactId);
    }
  }
  if (refs.ownerId) {
    const member = await tx.member.findFirst({
      where: { organizationId, userId: refs.ownerId },
      select: { id: true },
    });
    if (!member) {
      throw new LeadOwnerReferenceError(refs.ownerId);
    }
  }
}

export async function createLead(input: CreateLeadInput) {
  const { lead, auditEntry } = await prisma.$transaction(async (tx) => {
    await assertReferencesBelongToOrg(tx, input.organizationId, input);

    const stage = input.stageId
      ? await loadStage(tx, input.organizationId, input.stageId)
      : await tx.pipelineStage.findFirstOrThrow({
          where: { organizationId: input.organizationId },
          orderBy: { order: "asc" },
        });

    const lead = await tx.lead.create({
      data: {
        organizationId: input.organizationId,
        createdById: input.actorId,
        title: input.title,
        stageId: stage.id,
        companyId: input.companyId ?? null,
        contactId: input.contactId ?? null,
        value: input.value ?? 0,
        probability: clampProbability(input.probability),
        source: input.source ?? null,
        ownerId: input.ownerId ?? input.actorId,
      },
    });

    await tx.leadActivity.create({
      data: {
        organizationId: input.organizationId,
        leadId: lead.id,
        type: "stage_changed",
        body: `Lead created in stage "${stage.name}"`,
        metadata: { previousStageId: null, newStageId: stage.id, newStageName: stage.name },
        actorId: input.actorId,
      },
    });

    const auditEntry = await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        actorType: "user",
        action: "lead.created",
        targetType: "lead",
        targetId: lead.id,
        metadata: { title: lead.title, stageId: stage.id },
      },
      tx,
    );

    return { lead, auditEntry };
  });

  await publishAuditEvent(auditEntry);
  await publishEvent(
    "lead.created",
    {
      organizationId: input.organizationId,
      leadId: lead.id,
      stageId: lead.stageId,
      value: Number(lead.value),
      createdById: input.actorId,
    },
    { organizationId: input.organizationId },
  );
  return lead;
}

export async function updateLead(input: UpdateLeadInput) {
  const { lead, auditEntry } = await prisma.$transaction(async (tx) => {
    const existing = await tx.lead.findFirst({
      where: { id: input.leadId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!existing) {
      throw new LeadNotFoundError(input.leadId);
    }
    await assertReferencesBelongToOrg(tx, input.organizationId, input.data);

    const lead = await tx.lead.update({
      where: { id: existing.id },
      data: {
        ...input.data,
        probability:
          input.data.probability !== undefined ? clampProbability(input.data.probability) : undefined,
      },
    });

    const auditEntry = await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorId: input.actorId,
        actorType: "user",
        action: "lead.updated",
        targetType: "lead",
        targetId: lead.id,
        metadata: { changes: input.data },
      },
      tx,
    );

    return { lead, auditEntry };
  });

  await publishAuditEvent(auditEntry);
  return lead;
}

export async function changeLeadStage(
  organizationId: string,
  actorId: string,
  leadId: string,
  newStageId: string,
) {
  const { lead, auditEntry, activityId, previousStageId, newStage } = await prisma.$transaction(async (tx) => {
    const existing = await tx.lead.findFirst({
      where: { id: leadId, organizationId, deletedAt: null },
      include: { stage: true },
    });
    if (!existing) {
      throw new LeadNotFoundError(leadId);
    }

    const newStage = await loadStage(tx, organizationId, newStageId);

    const lead = await tx.lead.update({
      where: { id: leadId },
      data: {
        stageId: newStage.id,
        closedAt: newStage.isWon || newStage.isLost ? new Date() : null,
      },
    });

    const activity = await tx.leadActivity.create({
      data: {
        organizationId,
        leadId,
        type: "stage_changed",
        body: `Stage changed from "${existing.stage.name}" to "${newStage.name}"`,
        metadata: {
          previousStageId: existing.stage.id,
          previousStageName: existing.stage.name,
          newStageId: newStage.id,
          newStageName: newStage.name,
        },
        actorId,
      },
    });

    const auditEntry = await recordAuditLog(
      {
        organizationId,
        actorId,
        actorType: "user",
        action: "lead.stage_changed",
        targetType: "lead",
        targetId: leadId,
        metadata: { previousStageId: existing.stage.id, newStageId: newStage.id },
      },
      tx,
    );

    return { lead, auditEntry, activityId: activity.id, previousStageId: existing.stage.id, newStage };
  });

  await publishAuditEvent(auditEntry);
  await publishEvent(
    "lead.stage_changed",
    {
      organizationId,
      leadId,
      activityId,
      previousStageId,
      newStageId: newStage.id,
      isWon: newStage.isWon,
      isLost: newStage.isLost,
    },
    { organizationId },
  );
  return lead;
}

export async function softDeleteLead(organizationId: string, leadId: string, actorId: string) {
  const { auditEntry } = await prisma.$transaction(async (tx) => {
    const existing = await tx.lead.findFirst({
      where: { id: leadId, organizationId, deletedAt: null },
    });
    if (!existing) {
      throw new LeadNotFoundError(leadId);
    }

    await tx.lead.update({ where: { id: leadId }, data: { deletedAt: new Date() } });

    const auditEntry = await recordAuditLog(
      {
        organizationId,
        actorId,
        actorType: "user",
        action: "lead.deleted",
        targetType: "lead",
        targetId: leadId,
        metadata: { title: existing.title },
      },
      tx,
    );

    return { auditEntry };
  });

  await publishAuditEvent(auditEntry);
}

/**
 * Appends an entry to a lead's activity timeline. Shared by manual user
 * actions (logging a call, a meeting, a note) and the AI Sales Employee's
 * `record_lead_activity` tool (ai_note / ai_analysis types) — every write
 * path funnels through here so the timeline is always complete.
 */
export async function addLeadActivity(input: AddLeadActivityInput) {
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, organizationId: input.organizationId, deletedAt: null },
  });
  if (!lead) {
    throw new LeadNotFoundError(input.leadId);
  }

  return prisma.leadActivity.create({
    data: {
      organizationId: input.organizationId,
      leadId: input.leadId,
      type: input.type,
      body: input.body ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      actorId: input.actorId ?? null,
    },
  });
}

export async function getLead(organizationId: string, leadId: string) {
  const scoped = getTenantScopedClient(organizationId);
  return scoped.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    include: {
      stage: true,
      company: true,
      contact: true,
      owner: { select: { id: true, name: true, email: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 50, include: { actor: { select: { name: true } } } },
      tasks: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
}

export async function listLeads(input: ListLeadsInput) {
  const scoped = getTenantScopedClient(input.organizationId);
  const limit = Math.min(input.limit ?? 50, 200);

  const leads = await scoped.lead.findMany({
    where: {
      deletedAt: null,
      stageId: input.stageId,
      companyId: input.companyId,
      ownerId: input.ownerId,
      title: input.query ? { contains: input.query, mode: "insensitive" } : undefined,
    },
    include: {
      stage: true,
      company: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = leads.length > limit;
  const page = hasMore ? leads.slice(0, limit) : leads;

  return { leads: page, nextCursor: hasMore ? page[page.length - 1]?.id : null };
}
