"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import {
  addLeadActivity,
  changeLeadStage,
  createLead,
  softDeleteLead,
  updateLead,
} from "@/server/leads/service";
import { createPipelineStage } from "@/server/leads/pipeline";
import type { ActionResult } from "@/app/(dashboard)/dashboard/members/actions";

export async function createLeadAction(input: {
  title: string;
  stageId?: string;
  companyId?: string;
  contactId?: string;
  value?: number;
  probability?: number;
  source?: string;
}): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ lead: ["create"] });

  if (!input.title.trim()) {
    return { success: false, error: "Lead title is required" };
  }

  try {
    await createLead({
      organizationId: organization.id,
      actorId: session.user.id,
      title: input.title.trim(),
      stageId: input.stageId,
      companyId: input.companyId || null,
      contactId: input.contactId || null,
      value: input.value,
      probability: input.probability,
      source: input.source?.trim() || null,
    });
    revalidatePath("/dashboard/leads");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create lead" };
  }
}

export async function updateLeadAction(
  leadId: string,
  input: {
    title?: string;
    companyId?: string | null;
    contactId?: string | null;
    value?: number;
    probability?: number;
    source?: string | null;
  },
): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ lead: ["update"] });

  try {
    await updateLead({ organizationId: organization.id, actorId: session.user.id, leadId, data: input });
    revalidatePath("/dashboard/leads");
    revalidatePath(`/dashboard/leads/${leadId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update lead" };
  }
}

export async function changeLeadStageAction(leadId: string, stageId: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ lead: ["update"] });

  try {
    await changeLeadStage(organization.id, session.user.id, leadId, stageId);
    revalidatePath("/dashboard/leads");
    revalidatePath(`/dashboard/leads/${leadId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to change stage" };
  }
}

export async function deleteLeadAction(leadId: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ lead: ["delete"] });

  try {
    await softDeleteLead(organization.id, leadId, session.user.id);
    revalidatePath("/dashboard/leads");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to delete lead" };
  }
}

export async function addLeadNoteAction(leadId: string, body: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ lead: ["update"] });

  if (!body.trim()) {
    return { success: false, error: "Note cannot be empty" };
  }

  try {
    await addLeadActivity({
      organizationId: organization.id,
      leadId,
      type: "note",
      body: body.trim(),
      actorId: session.user.id,
    });
    revalidatePath(`/dashboard/leads/${leadId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to add note" };
  }
}

export async function createPipelineStageAction(name: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ lead: ["update"] });

  try {
    await createPipelineStage(organization.id, session.user.id, name);
    revalidatePath("/dashboard/leads");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create stage" };
  }
}
