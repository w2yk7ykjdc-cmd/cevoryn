import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { engageKillSwitch, getOrCreatePolicy, updatePolicy } from "@/server/ai/autonomy/policy-service";
import { closeTestConnections, createOrgForUser, signUpUser, authHeaders } from "./helpers";

describe("AutonomyPolicyVersion: immutable, monotonic history", () => {
  afterAll(closeTestConnections);

  it("the lazy default creates version #1, attributed to a system actor", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const policy = await getOrCreatePolicy(organization.id, "crm");

    const versions = await prisma.autonomyPolicyVersion.findMany({
      where: { organizationId: organization.id, domain: "crm" },
      orderBy: { versionNumber: "asc" },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0]?.versionNumber).toBe(1);
    expect(versions[0]?.changedById).toBe("system");
    expect(versions[0]?.level).toBe(policy.level);
  });

  it("every subsequent update appends one new version, never mutating a prior one", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    await getOrCreatePolicy(organization.id, "crm"); // version 1 (lazy default)
    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L3",
      dailyActionLimit: 0,
      dailyRiskLimit: 0,
      perActionRiskLimit: 0,
      changedById: owner.userId,
      requestHeaders: headers,
    }); // version 2
    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L4",
      dailyActionLimit: 5,
      dailyRiskLimit: 500,
      perActionRiskLimit: 100,
      changedById: owner.userId,
      requestHeaders: headers,
    }); // version 3

    const versions = await prisma.autonomyPolicyVersion.findMany({
      where: { organizationId: organization.id, domain: "crm" },
      orderBy: { versionNumber: "asc" },
    });
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
    expect(versions[0]?.level).toBe("L2");
    expect(versions[1]?.level).toBe("L3");
    expect(versions[2]?.level).toBe("L4");

    // Earlier versions are untouched -- this is a real, immutable history, not a mutated single row.
    expect(versions[0]?.dailyActionLimit).toBe(0);
    expect(versions[2]?.dailyActionLimit).toBe(5);
  });

  it("kill switch toggles are also versioned, distinct from a full policy edit", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    await getOrCreatePolicy(organization.id, "crm");
    await engageKillSwitch({ organizationId: organization.id, domain: "crm", actorId: owner.userId, requestHeaders: headers });

    const versions = await prisma.autonomyPolicyVersion.findMany({
      where: { organizationId: organization.id, domain: "crm" },
      orderBy: { versionNumber: "asc" },
    });
    expect(versions).toHaveLength(2);
    expect(versions[1]?.killSwitchEngaged).toBe(true);
    expect(versions[1]?.changedById).toBe(owner.userId);
  });

  it("versioning is independent per domain — crm and market never share a version sequence", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const headers = authHeaders(owner.token);

    await getOrCreatePolicy(organization.id, "crm"); // crm v1
    await getOrCreatePolicy(organization.id, "market"); // market v1
    await updatePolicy({
      organizationId: organization.id,
      domain: "crm",
      level: "L3",
      dailyActionLimit: 0,
      dailyRiskLimit: 0,
      perActionRiskLimit: 0,
      changedById: owner.userId,
      requestHeaders: headers,
    }); // crm v2

    const crmVersions = await prisma.autonomyPolicyVersion.findMany({ where: { organizationId: organization.id, domain: "crm" } });
    const marketVersions = await prisma.autonomyPolicyVersion.findMany({ where: { organizationId: organization.id, domain: "market" } });
    expect(crmVersions.map((v) => v.versionNumber).sort()).toEqual([1, 2]);
    expect(marketVersions.map((v) => v.versionNumber)).toEqual([1]);
  });

  it("versioning is independent per organization — two orgs never share a sequence", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);

    await getOrCreatePolicy(orgA.id, "crm");
    await getOrCreatePolicy(orgA.id, "crm"); // idempotent second read -- must not create version 2
    await getOrCreatePolicy(orgB.id, "crm");

    const versionsA = await prisma.autonomyPolicyVersion.findMany({ where: { organizationId: orgA.id, domain: "crm" } });
    const versionsB = await prisma.autonomyPolicyVersion.findMany({ where: { organizationId: orgB.id, domain: "crm" } });
    expect(versionsA).toHaveLength(1);
    expect(versionsB).toHaveLength(1);
  });

  it("concurrent lazy-default reads for the same org+domain never create two version-1 rows", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    // Fire several concurrent first-reads for the same org+domain -- the advisory
    // lock inside getOrCreatePolicy must serialize them to a single created row.
    await Promise.all(
      Array.from({ length: 5 }, () => getOrCreatePolicy(organization.id, "crm")),
    );

    const policies = await prisma.autonomyPolicy.findMany({ where: { organizationId: organization.id, domain: "crm" } });
    expect(policies).toHaveLength(1);

    const versions = await prisma.autonomyPolicyVersion.findMany({ where: { organizationId: organization.id, domain: "crm" } });
    expect(versions).toHaveLength(1);
    expect(versions[0]?.versionNumber).toBe(1);
  });
});
