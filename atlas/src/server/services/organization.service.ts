import { Prisma } from "@prisma/client";
import "server-only";

import { prisma } from "@/lib/prisma";

// =============================================================================
// Slug Generation
// =============================================================================

const MAX_SLUG_RETRIES = 5;

function generateBaseSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

async function generateUniqueSlug(name: string): Promise<string> {
  const base = generateBaseSlug(name);
  if (!base) return `org-${Date.now()}`;

  // Try base slug first, then append random suffix on collision
  for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    const existing = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  // Fallback: timestamp-based slug
  return `${base}-${Date.now()}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

// =============================================================================
// CRUD
// =============================================================================

/**
 * Create an organization and its first OWNER member atomically.
 * Uses a Prisma transaction to ensure both records succeed or neither does.
 */
export async function createOrganization(params: {
  name: string;
  createdByUserId: string;
  displayName: string;
}) {
  const slug = await generateUniqueSlug(params.name);

  return prisma.$transaction(async (tx) => {
    // Serializes concurrent onboarding submissions for the same user (a
    // double-click, a client retry after a slow response, two open tabs).
    // Without this, two transactions can both pass the "doesn't already
    // belong to an org" check below before either commits - Member's only
    // unique constraint is (userId, organizationId), and each concurrent
    // attempt creates a *different* organizationId, so the DB itself
    // never rejects the second insert. A dedicated namespace keeps this
    // from colliding with other advisory-lock users that hash the raw
    // user id (e.g. entitlement.service.ts's member-capacity lock).
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`create-organization:${params.createdByUserId}`}, 0)
      ) IS NULL AS lock_acquired
    `);

    // Double-check the user doesn't already own an organization
    const existingMembership = await tx.member.findFirst({
      where: { userId: params.createdByUserId },
      select: { id: true },
    });

    if (existingMembership) {
      throw new Error("User already belongs to an organization");
    }

    const organization = await tx.organization.create({
      data: {
        name: params.name,
        slug,
        members: {
          create: {
            userId: params.createdByUserId,
            role: "OWNER",
            displayName: params.displayName,
          },
        },
      },
      include: {
        members: true,
      },
    });

    return organization;
  });
}

export async function getOrganizationById(id: string) {
  return prisma.organization.findUnique({
    where: { id },
    include: {
      _count: { select: { members: true } },
    },
  });
}

export async function getOrganizationBySlug(slug: string) {
  return prisma.organization.findUnique({
    where: { slug },
    include: {
      _count: { select: { members: true } },
    },
  });
}

export async function getOrganizationMembers(organizationId: string) {
  return prisma.member.findMany({
    where: { organizationId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
}

export async function updateOrganization(
  id: string,
  data: { name?: string; logoUrl?: string | null }
) {
  return prisma.organization.update({
    where: { id },
    data,
  });
}
