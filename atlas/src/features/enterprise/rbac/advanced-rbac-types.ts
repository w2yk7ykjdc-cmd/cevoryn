/**
 * Advanced RBAC foundation (Phase 2, section 16): org -> team -> role ->
 * permission -> resource.
 *
 * Status: types only, additive alongside src/lib/rbac.ts - NOT a
 * replacement. The existing flat OWNER/ADMIN/MEMBER organization-level RBAC
 * (src/lib/rbac.ts) keeps working exactly as-is for every current check
 * (`hasPermission(membership.role, "radar:manage")` etc.) and is untouched.
 * This module only names the shape a future *resource-scoped* layer would
 * take - e.g. "can this user manage Radar entities, but only within Team
 * X" - without CEVORYN today having a Team concept, a resource-ownership
 * model, or anywhere that constructs a ResourceGrant. Building that now
 * would be exactly the "fake production implementation" the spec forbids;
 * this exists so a real Team/resource-scoping feature has a contract that
 * composes with the existing role check rather than forking it.
 */

import type { Permission } from "@/lib/rbac";
import type { MemberRole } from "@/types";

export interface Team {
  id: string;
  organizationId: string;
  name: string;
}

export interface TeamMembership {
  teamId: string;
  userId: string;
  /** Team-scoped role - independent of the user's organization-level MemberRole. */
  role: MemberRole;
}

/** A resource a permission grant can be scoped to, e.g. one specific ExternalEntity or Opportunity. */
export interface ResourceRef {
  resourceType: string;
  resourceId: string;
}

/**
 * A grant narrower than the organization-level role check: this user (or
 * everyone on this team) has this permission, but only for this resource
 * (or, if `resource` is omitted, every resource of `resourceType` owned by
 * this team). Evaluating one of these should always be an *additional*
 * check layered on top of `hasPermission()` succeeding first, never a
 * replacement for it - a ResourceGrant can narrow access, never widen it
 * beyond what the org-level role already allows.
 */
export interface ResourceGrant {
  id: string;
  organizationId: string;
  teamId: string | null;
  userId: string | null;
  permission: Permission;
  resourceType: string;
  resource: ResourceRef | null;
}
