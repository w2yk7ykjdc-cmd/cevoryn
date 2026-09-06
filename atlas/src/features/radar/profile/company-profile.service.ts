import "server-only";

import { recordAuditEvent } from "@/features/enterprise/audit/audit.service";
import { prisma } from "@/lib/prisma";

import type { UpsertCompanyProfileInput } from "./schemas";

export async function getCompanyProfile(organizationId: string) {
  return prisma.companyProfile.findUnique({ where: { organizationId } });
}

/**
 * Structured, user-declared context distinct from Memory (which stays the
 * emergent/learned context extracted from chat). One row per organization -
 * always an upsert, never a partial patch, so the profile is fully
 * replaced by whatever the settings form submits.
 */
export async function upsertCompanyProfile(
  organizationId: string,
  input: UpsertCompanyProfileInput,
  actorUserId: string
) {
  const profile = await prisma.companyProfile.upsert({
    where: { organizationId },
    create: { organizationId, ...input },
    update: { ...input },
  });

  await recordAuditEvent({
    organizationId,
    actorType: "USER",
    actorId: actorUserId,
    action: "company_profile.updated",
    resourceType: "company_profile",
    resourceId: profile.id,
  });

  return profile;
}

/** True once the org has declared at least a description or one product/service. */
export function isProfileMeaningfullyComplete(
  profile: {
    description: string;
    products: string[];
    services: string[];
  } | null
): boolean {
  if (!profile) return false;
  return (
    profile.description.trim().length > 0 ||
    profile.products.length > 0 ||
    profile.services.length > 0
  );
}
