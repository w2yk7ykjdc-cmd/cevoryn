"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { createCompany, softDeleteCompany, updateCompany } from "@/server/companies/service";
import type { ActionResult } from "@/app/(dashboard)/dashboard/members/actions";

export async function createCompanyAction(input: {
  name: string;
  domain?: string;
  industry?: string;
  website?: string;
  description?: string;
}): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ company: ["create"] });

  if (!input.name.trim()) {
    return { success: false, error: "Company name is required" };
  }

  try {
    await createCompany({
      organizationId: organization.id,
      actorId: session.user.id,
      name: input.name.trim(),
      domain: input.domain?.trim() || null,
      industry: input.industry?.trim() || null,
      website: input.website?.trim() || null,
      description: input.description?.trim() || null,
    });
    revalidatePath("/dashboard/companies");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create company" };
  }
}

export async function updateCompanyAction(
  companyId: string,
  input: {
    name?: string;
    domain?: string | null;
    industry?: string | null;
    website?: string | null;
    description?: string | null;
  },
): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ company: ["update"] });

  try {
    await updateCompany({
      organizationId: organization.id,
      actorId: session.user.id,
      companyId,
      data: input,
    });
    revalidatePath("/dashboard/companies");
    revalidatePath(`/dashboard/companies/${companyId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update company" };
  }
}

export async function deleteCompanyAction(companyId: string): Promise<ActionResult> {
  const { session, organization } = await requirePermission({ company: ["delete"] });

  try {
    await softDeleteCompany(organization.id, companyId, session.user.id);
    revalidatePath("/dashboard/companies");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to delete company" };
  }
}
