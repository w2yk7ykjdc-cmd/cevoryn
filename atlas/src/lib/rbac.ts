import type { MemberRole } from "@/types";

// =============================================================================
// Permission Definitions
// =============================================================================

export const PERMISSIONS = {
  // Organization
  "org:read": "Read organization details",
  "org:update": "Update organization settings",
  "org:delete": "Delete organization",

  // Members
  "members:read": "View members",
  "members:invite": "Invite new members",
  "members:remove": "Remove members",
  "members:update-role": "Change member roles",

  // Dashboard
  "dashboard:read": "View dashboard",

  // Analytics
  "analytics:read": "View product analytics",

  // Settings
  "settings:read": "View settings",
  "settings:update": "Update settings",

  // AI
  "ai:use": "Use AI features",

  // Radar (external company/opportunity intelligence)
  "radar:read": "View Radar entities, events, and opportunities",
  "radar:manage": "Manage watchlist, company profile, and opportunity status",
} as const;

export type Permission = keyof typeof PERMISSIONS;

// =============================================================================
// Role → Permission Mapping
// =============================================================================

const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  OWNER: [
    "org:read",
    "org:update",
    "org:delete",
    "members:read",
    "members:invite",
    "members:remove",
    "members:update-role",
    "dashboard:read",
    "analytics:read",
    "settings:read",
    "settings:update",
    "ai:use",
    "radar:read",
    "radar:manage",
  ],
  ADMIN: [
    "org:read",
    "org:update",
    "members:read",
    "members:invite",
    "members:remove",
    "dashboard:read",
    "analytics:read",
    "settings:read",
    "settings:update",
    "ai:use",
    "radar:read",
    "radar:manage",
  ],
  MEMBER: [
    "org:read",
    "members:read",
    "dashboard:read",
    "settings:read",
    "ai:use",
    "radar:read",
  ],
} as const;

// =============================================================================
// Permission Check Functions
// =============================================================================

/** Check if a role has a specific permission */
export function hasPermission(
  role: MemberRole,
  permission: Permission
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Check if a role has all specified permissions */
export function hasAllPermissions(
  role: MemberRole,
  permissions: Permission[]
): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

/** Check if a role has any of the specified permissions */
export function hasAnyPermission(
  role: MemberRole,
  permissions: Permission[]
): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

/** Get all permissions for a role */
export function getPermissions(role: MemberRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Role hierarchy: OWNER > ADMIN > MEMBER */
const ROLE_HIERARCHY: Record<MemberRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};

/** Check if role A is higher than or equal to role B */
export function isRoleAtLeast(
  role: MemberRole,
  minimumRole: MemberRole
): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minimumRole];
}

/** Check if actor can modify target's role */
export function canModifyMember(
  actorRole: MemberRole,
  targetRole: MemberRole
): boolean {
  // Only higher roles can modify lower roles
  return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[targetRole];
}
