import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * Central RBAC statement table for CompanyOS. Extends Better Auth's default
 * organization statements (organization/member/invitation/team/ac) with
 * app-specific resources. Every resource/action pair listed here is a
 * permission that can be checked with `auth.api.hasPermission(...)` on the
 * server, or granted to an org-scoped custom role via dynamic access control.
 */
export const statement = {
  ...defaultStatements,
  billing: ["view", "manage"],
  apiKey: ["create", "read", "revoke"],
  auditLog: ["read", "export"],
  aiConversation: ["create", "read", "delete"],
  aiTool: ["execute"],
  company: ["create", "read", "update", "delete"],
  contact: ["create", "read", "update", "delete"],
  lead: ["create", "read", "update", "delete"],
  task: ["create", "read", "update", "delete"],
  companyHealth: ["read"],
  opportunity: ["read", "update"],
  risk: ["read"],
  decision: ["read"],
  autonomyPolicy: ["read", "manage", "kill_switch"],
  outcome: ["read", "confirm"],
  marketIntelligence: ["read"],
  paperTrading: ["read"],
  backtest: ["read", "run"],
  executionCredential: ["manage", "read", "revoke"],
  riskPolicy: ["manage", "read"],
  executionAutonomy: ["manage", "read"],
} as const;

export const accessControl = createAccessControl(statement);

/** Full control. Every organization gets exactly one owner at creation time. */
export const ownerRole = accessControl.newRole({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
  billing: ["view", "manage"],
  apiKey: ["create", "read", "revoke"],
  auditLog: ["read", "export"],
  aiConversation: ["create", "read", "delete"],
  aiTool: ["execute"],
  company: ["create", "read", "update", "delete"],
  contact: ["create", "read", "update", "delete"],
  lead: ["create", "read", "update", "delete"],
  task: ["create", "read", "update", "delete"],
  companyHealth: ["read"],
  opportunity: ["read", "update"],
  risk: ["read"],
  decision: ["read"],
  autonomyPolicy: ["read", "manage", "kill_switch"],
  outcome: ["read", "confirm"],
  marketIntelligence: ["read"],
  paperTrading: ["read"],
  backtest: ["read", "run"],
  executionCredential: ["manage", "read", "revoke"],
  riskPolicy: ["manage", "read"],
  executionAutonomy: ["manage", "read"],
});

/** Runs day-to-day operations: manages people and settings, not billing. */
export const adminRole = accessControl.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
  billing: ["view"],
  apiKey: ["create", "read", "revoke"],
  auditLog: ["read", "export"],
  aiConversation: ["create", "read", "delete"],
  aiTool: ["execute"],
  company: ["create", "read", "update", "delete"],
  contact: ["create", "read", "update", "delete"],
  lead: ["create", "read", "update", "delete"],
  task: ["create", "read", "update", "delete"],
  companyHealth: ["read"],
  opportunity: ["read", "update"],
  risk: ["read"],
  decision: ["read"],
  autonomyPolicy: ["read", "kill_switch"],
  outcome: ["read", "confirm"],
  marketIntelligence: ["read"],
  paperTrading: ["read"],
  backtest: ["read", "run"],
  executionCredential: ["read"],
  riskPolicy: ["read"],
  executionAutonomy: ["read"],
});

/** Standard seat: full use of the product, no org administration. */
export const memberRole = accessControl.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
  billing: [],
  apiKey: [],
  auditLog: [],
  aiConversation: ["create", "read", "delete"],
  aiTool: ["execute"],
  company: ["create", "read", "update", "delete"],
  contact: ["create", "read", "update", "delete"],
  lead: ["create", "read", "update", "delete"],
  task: ["create", "read", "update", "delete"],
  companyHealth: ["read"],
  opportunity: ["read", "update"],
  risk: ["read"],
  decision: ["read"],
  autonomyPolicy: [],
  outcome: ["read", "confirm"],
  marketIntelligence: ["read"],
  paperTrading: ["read"],
  backtest: ["read", "run"],
  executionCredential: [],
  riskPolicy: ["read"],
  executionAutonomy: ["read"],
});

/** Read-only seat: can look around, cannot create or mutate anything. */
export const viewerRole = accessControl.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
  billing: [],
  apiKey: [],
  auditLog: ["read"],
  aiConversation: ["read"],
  aiTool: [],
  company: ["read"],
  contact: ["read"],
  lead: ["read"],
  task: ["read"],
  companyHealth: ["read"],
  opportunity: ["read"],
  risk: ["read"],
  decision: ["read"],
  autonomyPolicy: [],
  outcome: ["read"],
  marketIntelligence: ["read"],
  paperTrading: ["read"],
  backtest: ["read"],
  executionCredential: [],
  riskPolicy: ["read"],
});

export const roles = {
  owner: ownerRole,
  admin: adminRole,
  member: memberRole,
  viewer: viewerRole,
};

export type OrganizationRoleName = keyof typeof roles;
