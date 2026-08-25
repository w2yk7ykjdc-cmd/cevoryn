import { afterAll, describe, expect, it } from "vitest";
import { auth } from "@/server/auth/auth";
import { exportAuditLogsCsv, recordAuditLog } from "@/server/audit/audit-log";
import { GET as exportGet } from "@/app/api/audit-log/export/route";
import { prisma } from "@/server/db/client";
import { addMemberDirect, authHeaders, closeTestConnections, createOrgForUser, signUpUser } from "./helpers";

function exportRequest(token: string, query = ""): Request {
  return new Request(`http://localhost/api/audit-log/export${query}`, { headers: authHeaders(token) });
}

describe("audit log export", () => {
  afterAll(closeTestConnections);

  it("exportAuditLogsCsv renders a header plus one row per entry, escaping commas and quotes in metadata", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    await recordAuditLog({
      organizationId: organization.id,
      actorId: owner.userId,
      actorType: "user",
      action: "lead.created",
      targetType: "lead",
      targetId: "lead-1",
      metadata: { name: "Acme, Inc.", note: 'has "quotes"' },
    });
    await recordAuditLog({
      organizationId: organization.id,
      actorId: owner.userId,
      actorType: "user",
      action: "task.created",
      targetType: "task",
      targetId: "task-1",
    });

    // `createOrgForUser` itself records an `organization.created` entry, so
    // this asserts the two rows we just wrote are present and well-formed
    // rather than an exact total (which would be fragile to org-lifecycle
    // logging elsewhere).
    const { csv, rowCount } = await exportAuditLogsCsv({ organizationId: organization.id });
    const lines = csv.split("\n");
    expect(lines[0]).toBe("id,createdAt,action,targetType,targetId,actorType,actorId,metadata");
    expect(lines).toHaveLength(rowCount + 1);
    const leadLine = lines.find((line) => line.includes("lead.created"));
    expect(leadLine).toContain('"Acme, Inc."'); // the comma forced the whole metadata field to be quote-wrapped
    expect(leadLine).toContain('""name""'); // every literal `"` inside a quote-wrapped field is doubled, JSON keys included
    expect(leadLine).toContain("quotes");
    expect(lines.some((line) => line.includes("task.created"))).toBe(true);
  });

  it("exportAuditLogsCsv filters by action, targetType, and date range", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);

    await recordAuditLog({
      organizationId: organization.id,
      actorId: owner.userId,
      actorType: "user",
      action: "a.one",
      targetType: "widget",
      targetId: "1",
    });
    await recordAuditLog({
      organizationId: organization.id,
      actorId: owner.userId,
      actorType: "user",
      action: "b.two",
      targetType: "gadget",
      targetId: "2",
    });

    const byAction = await exportAuditLogsCsv({ organizationId: organization.id, action: "a.one" });
    expect(byAction.rowCount).toBe(1);

    const byTargetType = await exportAuditLogsCsv({ organizationId: organization.id, targetType: "gadget" });
    expect(byTargetType.rowCount).toBe(1);

    const future = await exportAuditLogsCsv({
      organizationId: organization.id,
      from: new Date(Date.now() + 60_000),
    });
    expect(future.rowCount).toBe(0);
  });

  it("GET /api/audit-log/export rejects a viewer — they lack the export permission", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    const viewer = await signUpUser();
    await addMemberDirect(organization.id, viewer, "viewer");
    // addMemberDirect adds the membership row directly (bypassing the invite
    // flow), which doesn't set the viewer's active organization the way a
    // real accept-invitation would — set it explicitly so the route resolves
    // an organization and the failure we're testing is the permission check.
    await auth.api.setActiveOrganization({
      headers: authHeaders(viewer.token),
      body: { organizationId: organization.id },
    });

    const response = await exportGet(exportRequest(viewer.token));
    expect(response.status).toBe(403);
  });

  it("GET /api/audit-log/export rejects an unauthenticated request", async () => {
    const response = await exportGet(new Request("http://localhost/api/audit-log/export"));
    expect(response.status).toBe(401);
  });

  it("GET /api/audit-log/export returns CSV for a permitted owner and records the export itself", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await recordAuditLog({
      organizationId: organization.id,
      actorId: owner.userId,
      actorType: "user",
      action: "lead.created",
      targetType: "lead",
      targetId: "lead-1",
    });

    const response = await exportGet(exportRequest(owner.token, "?action=lead.created"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");

    const body = await response.text();
    expect(body).toContain("lead.created");

    const exportEntry = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: "audit_log.exported" },
      orderBy: { createdAt: "desc" },
    });
    expect(exportEntry?.actorId).toBe(owner.userId);
    expect((exportEntry?.metadata as { rowCount: number } | null)?.rowCount).toBe(1);
  });

  it("GET /api/audit-log/export honors the action query-string filter", async () => {
    const owner = await signUpUser();
    const organization = await createOrgForUser(owner);
    await recordAuditLog({
      organizationId: organization.id,
      actorId: owner.userId,
      actorType: "user",
      action: "keep.me",
      targetType: "test",
      targetId: "1",
    });
    await recordAuditLog({
      organizationId: organization.id,
      actorId: owner.userId,
      actorType: "user",
      action: "drop.me",
      targetType: "test",
      targetId: "2",
    });

    const response = await exportGet(exportRequest(owner.token, "?action=keep.me"));
    const body = await response.text();
    expect(body).toContain("keep.me");
    expect(body).not.toContain("drop.me");
  });
});
