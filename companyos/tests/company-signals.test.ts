import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { getTenantScopedClient, CrossTenantAccessError } from "@/server/db/tenant";
import { createBullConnection } from "@/server/redis/client";
import { QUEUE_NAME } from "@/server/jobs/queue";
import { recordSignal } from "@/server/intelligence/signals/service";
import { recordCompanySignalProcessor } from "@/server/jobs/processors/record-company-signal";
import { registerIntelligenceSubscribers } from "@/server/intelligence/signals/subscriber";
import { createCompany } from "@/server/companies/service";
import { createLead } from "@/server/leads/service";
import { changeLeadStage } from "@/server/leads/service";
import { listPipelineStages } from "@/server/leads/pipeline";
import { closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

/** Polls until `predicate` returns a truthy value or the timeout elapses. */
async function waitFor<T>(predicate: () => Promise<T | undefined>, timeoutMs = 3000, intervalMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await predicate();
    if (result) return result;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("company signals: ledger foundation", () => {
  let inspectorQueue: Queue;

  beforeAll(() => {
    registerIntelligenceSubscribers();
    inspectorQueue = new Queue(QUEUE_NAME, { connection: createBullConnection() });
  });

  afterAll(async () => {
    await inspectorQueue.close();
    await closeTestConnections();
  });

  it("tenant isolation: a signal recorded for org A is invisible via org B's tenant-scoped client", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);

    await recordSignal({
      organizationId: orgA.id,
      type: "test.signal",
      sourceType: "scanner",
      sourceId: "fixture-1",
      severity: "low",
      confidence: 100,
      ruleName: "test_rule",
      ruleVersion: "v1",
    });

    const fromOrgB = await getTenantScopedClient(orgB.id).companySignal.findMany({});
    expect(fromOrgB).toHaveLength(0);

    const fromOrgA = await getTenantScopedClient(orgA.id).companySignal.findMany({});
    expect(fromOrgA).toHaveLength(1);
  });

  it("cross-tenant access mismatch throws CrossTenantAccessError", async () => {
    const ownerA = await signUpUser();
    const orgA = await createOrgForUser(ownerA);
    const ownerB = await signUpUser();
    const orgB = await createOrgForUser(ownerB);

    await expect(
      getTenantScopedClient(orgA.id).companySignal.findFirst({ where: { organizationId: orgB.id } }),
    ).rejects.toBeInstanceOf(CrossTenantAccessError);
  });

  it("recordCompanySignalProcessor rejects a malformed payload and records no signal", async () => {
    await expect(
      recordCompanySignalProcessor({
        eventName: "company.created",
        // @ts-expect-error deliberately malformed to exercise the runtime guard
        payload: { companyId: "c1", name: "Acme" },
      }),
    ).rejects.toThrow(/malformed payload/i);
  });

  it("event -> signal propagation: creating a company publishes company.created, which reaches CompanySignal via the real queue", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const company = await createCompany({ organizationId: organization.id, actorId: owner.userId, name: "Acme Inc" });

    const job = await waitFor(async () => {
      const waiting = await inspectorQueue.getJobs(["waiting", "active", "completed", "delayed"]);
      return waiting.find(
        (j) => j.name === "record-company-signal" && j.data.eventName === "company.created" && j.data.payload.companyId === company.id,
      );
    });
    expect(job?.data.payload.organizationId).toBe(organization.id);

    await recordCompanySignalProcessor(job!.data);
    await job!.remove();

    const signal = await prisma.companySignal.findFirst({
      where: { organizationId: organization.id, ruleName: "company.created", sourceId: company.id },
    });
    expect(signal).not.toBeNull();
    expect(signal?.relatedEntityType).toBe("Company");
    expect(signal?.confidence).toBe(100);
  });

  it("event -> signal propagation: lead.stage_changed reaches CompanySignal via the real queue", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const stages = await listPipelineStages(organization.id);
    const wonStage = stages.find((s) => s.isWon);
    if (!wonStage) throw new Error("fixture setup: no won stage seeded");

    const lead = await createLead({
      organizationId: organization.id,
      actorId: owner.userId,
      title: "Acme deal",
      value: 5000,
    });
    await changeLeadStage(organization.id, owner.userId, lead.id, wonStage.id);

    const job = await waitFor(async () => {
      const jobs = await inspectorQueue.getJobs(["waiting", "active", "completed", "delayed"]);
      return jobs.find((j) => j.name === "record-company-signal" && j.data.eventName === "lead.stage_changed" && j.data.payload.leadId === lead.id);
    });
    expect(job?.data.payload.isWon).toBe(true);

    await recordCompanySignalProcessor(job!.data);
    await job!.remove();

    const signal = await prisma.companySignal.findFirst({
      where: { organizationId: organization.id, ruleName: "lead.stage_changed", relatedEntityId: lead.id },
    });
    expect(signal).not.toBeNull();
    expect(signal?.severity).toBe("low"); // won, not lost -> low severity
  });

  it("duplicate event delivery upserts the same signal instead of creating a second row", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const company = await createCompany({ organizationId: organization.id, actorId: owner.userId, name: "Acme Inc" });

    const payload = {
      eventName: "company.created" as const,
      payload: { organizationId: organization.id, companyId: company.id, name: company.name, createdById: owner.userId },
    };

    await recordCompanySignalProcessor(payload);
    await recordCompanySignalProcessor(payload); // redelivery of the exact same event

    const signals = await prisma.companySignal.findMany({
      where: { organizationId: organization.id, ruleName: "company.created", sourceId: company.id },
    });
    expect(signals).toHaveLength(1);
  });

  it("recordSignal reports created then updated across two calls with the same idempotency key", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const first = await recordSignal({
      organizationId: organization.id,
      type: "test.signal",
      sourceType: "scanner",
      sourceId: "fixture-2",
      severity: "low",
      confidence: 100,
      ruleName: "test_rule",
      ruleVersion: "v1",
    });
    expect(first.outcome).toBe("created");

    const second = await recordSignal({
      organizationId: organization.id,
      type: "test.signal",
      sourceType: "scanner",
      sourceId: "fixture-2",
      severity: "high",
      confidence: 80,
      ruleName: "test_rule",
      ruleVersion: "v1",
    });
    expect(second.outcome).toBe("updated");
    expect(second.signal.id).toBe(first.signal.id);
    expect(second.signal.severity).toBe("high");
  });

  it("recording a signal does not write an AuditLog entry", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    const before = await prisma.auditLog.count({ where: { organizationId: organization.id } });
    await recordSignal({
      organizationId: organization.id,
      type: "test.signal",
      sourceType: "scanner",
      sourceId: "fixture-3",
      severity: "low",
      confidence: 100,
      ruleName: "test_rule",
      ruleVersion: "v1",
    });
    const after = await prisma.auditLog.count({ where: { organizationId: organization.id } });

    expect(after).toBe(before);
  });
});
