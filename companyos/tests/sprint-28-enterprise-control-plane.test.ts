import { execSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "@/server/auth/auth";
import { engageKillSwitch, disengageKillSwitch, isKillSwitchEngaged, getOrCreatePolicy } from "@/server/ai/autonomy/policy-service";
import { getExecutionAutonomyStatus } from "@/server/execution/autonomy-gate";
import { getOrganizationRiskPolicy, DEFAULT_RISK_POLICY } from "@/server/execution/risk-policy";
import { listOrganizationCredentialStatuses } from "@/server/execution/org-credentials";
import { listStrategyHealth } from "@/server/intelligence/learning/strategy-health";
import { addMemberDirect, authHeaders, closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

/**
 * Sprint 28: Enterprise Control Plane.
 *
 * Audit finding: an org's autonomy policies (Sprint 9/19), risk policy
 * (Sprint 24), execution credentials (Sprint 23/27), execution autonomy
 * gate (Sprint 25), and strategy health (Sprint 26) were ALL already
 * fully-built, RBAC-gated, audited services -- but the "market" domain's
 * kill switch, and every one of the other four, had ZERO human-facing UI
 * anywhere in the app. This sprint's only backend change is a new settings
 * page + thin server actions wiring those five existing services together
 * (`src/app/(dashboard)/dashboard/settings/trading/`); no schema change, no
 * new formula, no second system. These tests cover the one genuinely new
 * integration point (the market-domain kill switch reused through the same
 * tested `engageKillSwitch`/`disengageKillSwitch` path as the CRM domain)
 * and the RBAC matrix the new page's per-card visibility depends on.
 */

async function can(userToken: string, organizationId: string, permissions: Record<string, string[]>): Promise<boolean> {
  const result = await auth.api.hasPermission({ headers: authHeaders(userToken), body: { organizationId, permissions } });
  return result.success;
}

describe("Sprint 28: Enterprise Control Plane", () => {
  afterAll(closeTestConnections);

  describe("A. market-domain kill switch reuse", () => {
    it("A1: engaging/disengaging the market domain works through the exact same function the CRM domain already uses, independently of it", async () => {
      const owner = await signUpUser();
      const organization = await createOrgForUser(owner);
      const headers = authHeaders(owner.token);

      expect(await isKillSwitchEngaged(organization.id, "market")).toBe(false);
      expect(await isKillSwitchEngaged(organization.id, "crm")).toBe(false);

      const engaged = await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: headers });
      expect(engaged.killSwitchEngaged).toBe(true);

      // Domain isolation: engaging "market" never touches "crm" for the same org.
      expect(await isKillSwitchEngaged(organization.id, "market")).toBe(true);
      expect(await isKillSwitchEngaged(organization.id, "crm")).toBe(false);

      const disengaged = await disengageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: headers });
      expect(disengaged.killSwitchEngaged).toBe(false);
      expect(await isKillSwitchEngaged(organization.id, "market")).toBe(false);
    });

    it("A2: the market kill switch read this page surfaces is the exact same read validateForLiveExecution uses -- engaging it here really would block live execution", async () => {
      const owner = await signUpUser();
      const organization = await createOrgForUser(owner);

      await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: owner.userId, requestHeaders: authHeaders(owner.token) });

      // src/server/execution/validation.ts calls isKillSwitchEngaged(organizationId, "market") directly.
      expect(await isKillSwitchEngaged(organization.id, "market")).toBe(true);
    });

    it("A3: admin can engage but not disengage the market kill switch -- the same asymmetric-trust rule already proven for the CRM domain", async () => {
      const owner = await signUpUser();
      const organization = await createOrgForUser(owner);
      const admin = await signUpUser();
      await addMemberDirect(organization.id, admin, "admin");
      const adminHeaders = authHeaders(admin.token);

      const engaged = await engageKillSwitch({ organizationId: organization.id, domain: "market", actorId: admin.userId, requestHeaders: adminHeaders });
      expect(engaged.killSwitchEngaged).toBe(true);

      await expect(
        disengageKillSwitch({ organizationId: organization.id, domain: "market", actorId: admin.userId, requestHeaders: adminHeaders }),
      ).rejects.toThrow(/permission/i);
    });
  });

  describe("B. RBAC matrix the Trading Controls page's per-card visibility depends on", () => {
    it("B1: owner has full manage/revoke/kill_switch access across every control-plane resource", async () => {
      const owner = await signUpUser();
      const organization = await createOrgForUser(owner);

      expect(await can(owner.token, organization.id, { autonomyPolicy: ["kill_switch", "manage"] })).toBe(true);
      expect(await can(owner.token, organization.id, { executionAutonomy: ["manage"] })).toBe(true);
      expect(await can(owner.token, organization.id, { riskPolicy: ["manage"] })).toBe(true);
      expect(await can(owner.token, organization.id, { executionCredential: ["manage", "revoke"] })).toBe(true);
      expect(await can(owner.token, organization.id, { strategyHealth: ["manage"] })).toBe(true);
    });

    it("B2: admin can read everything and engage the market kill switch, but cannot manage risk policy, credentials, autonomy gate, or strategy health", async () => {
      const owner = await signUpUser();
      const organization = await createOrgForUser(owner);
      const admin = await signUpUser();
      await addMemberDirect(organization.id, admin, "admin");

      expect(await can(admin.token, organization.id, { autonomyPolicy: ["read", "kill_switch"] })).toBe(true);
      expect(await can(admin.token, organization.id, { autonomyPolicy: ["manage"] })).toBe(false);
      expect(await can(admin.token, organization.id, { executionAutonomy: ["read"] })).toBe(true);
      expect(await can(admin.token, organization.id, { executionAutonomy: ["manage"] })).toBe(false);
      expect(await can(admin.token, organization.id, { riskPolicy: ["read"] })).toBe(true);
      expect(await can(admin.token, organization.id, { riskPolicy: ["manage"] })).toBe(false);
      expect(await can(admin.token, organization.id, { executionCredential: ["read"] })).toBe(true);
      expect(await can(admin.token, organization.id, { executionCredential: ["manage", "revoke"] })).toBe(false);
      expect(await can(admin.token, organization.id, { strategyHealth: ["read"] })).toBe(true);
      expect(await can(admin.token, organization.id, { strategyHealth: ["manage"] })).toBe(false);
    });

    it("B3: member can read risk policy and execution autonomy status, but has no access to credentials, the market kill switch, or strategy management", async () => {
      const owner = await signUpUser();
      const organization = await createOrgForUser(owner);
      const member = await signUpUser();
      await addMemberDirect(organization.id, member, "member");

      expect(await can(member.token, organization.id, { riskPolicy: ["read"] })).toBe(true);
      expect(await can(member.token, organization.id, { executionAutonomy: ["read"] })).toBe(true);
      expect(await can(member.token, organization.id, { executionCredential: ["read"] })).toBe(false);
      expect(await can(member.token, organization.id, { autonomyPolicy: ["kill_switch"] })).toBe(false);
      expect(await can(member.token, organization.id, { strategyHealth: ["manage"] })).toBe(false);
    });

    it("B4: viewer can read risk policy only -- no execution autonomy, credential, strategy health, or kill-switch visibility at all", async () => {
      const owner = await signUpUser();
      const organization = await createOrgForUser(owner);
      const viewer = await signUpUser();
      await addMemberDirect(organization.id, viewer, "viewer");

      expect(await can(viewer.token, organization.id, { riskPolicy: ["read"] })).toBe(true);
      expect(await can(viewer.token, organization.id, { executionAutonomy: ["read"] })).toBe(false);
      expect(await can(viewer.token, organization.id, { executionCredential: ["read"] })).toBe(false);
      expect(await can(viewer.token, organization.id, { autonomyPolicy: ["read"] })).toBe(false);
      expect(await can(viewer.token, organization.id, { strategyHealth: ["read"] })).toBe(false);
      expect(await can(viewer.token, organization.id, { riskPolicy: ["manage"] })).toBe(false);
    });
  });

  describe("C. composed read matches what a brand-new organization actually has (page-load data)", () => {
    it("C1: a fresh organization has every control-plane surface at its safe, documented default -- nothing pre-enabled, nothing pre-configured", async () => {
      const owner = await signUpUser();
      const organization = await createOrgForUser(owner);

      const [marketPolicy, executionAutonomy, riskPolicy, credentialStatuses, strategyHealthRows] = await Promise.all([
        getOrCreatePolicy(organization.id, "market"),
        getExecutionAutonomyStatus(organization.id),
        getOrganizationRiskPolicy(organization.id),
        listOrganizationCredentialStatuses(organization.id),
        listStrategyHealth(organization.id),
      ]);

      expect(marketPolicy.killSwitchEngaged).toBe(false);
      expect(executionAutonomy.enabled).toBe(false);
      expect(riskPolicy).toEqual(DEFAULT_RISK_POLICY);
      expect(credentialStatuses).toEqual([]);
      expect(strategyHealthRows).toEqual([]);
    });
  });

  describe("D. AI restriction", () => {
    it("D1: zero diff in src/server/ai/autonomy/ vs main -- Sprint 28 only adds a human-facing settings page and server actions", () => {
      const diff = execSync("git diff --stat origin/main -- src/server/ai/autonomy/", { cwd: process.cwd(), encoding: "utf-8" });
      expect(diff.trim()).toBe("");
    });

    it("D2: no built-in AI tool imports the new Trading Controls server actions", async () => {
      const grep = execSync(
        'grep -rl "settings/trading/actions" src/server/ai/tools/ || true',
        { cwd: process.cwd(), encoding: "utf-8" },
      );
      expect(grep.trim()).toBe("");
    });
  });
});
