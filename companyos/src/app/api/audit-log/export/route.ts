import { NextResponse } from "next/server";
import { auth } from "@/server/auth/auth";
import { exportAuditLogsCsv, recordAuditLog } from "@/server/audit/audit-log";

export const dynamic = "force-dynamic";

/**
 * GET /api/audit-log/export — downloads the org's audit log (optionally
 * filtered) as CSV. Gated by the `auditLog:["export"]` permission, which has
 * existed in the RBAC statement table since Sprint 0 but had no route behind
 * it until now. The export itself is recorded as an audit entry — knowing
 * who pulled a copy of the compliance record is part of the record.
 *
 * Reads `request.headers` directly (rather than the `requirePermission`
 * helper's `next/headers`-based session lookup) so this handler — like
 * `/api/ai/chat` — can be exercised in tests by calling the exported `GET`
 * with a hand-built `Request`, without needing a real Next.js request scope.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }
  const permitted = await auth.api.hasPermission({
    headers: request.headers,
    body: { organizationId, permissions: { auditLog: ["export"] } },
  });
  if (!permitted.success) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action") || undefined;
  const targetType = url.searchParams.get("targetType") || undefined;
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;

  const { csv, rowCount } = await exportAuditLogsCsv({ organizationId, action, targetType, from, to });

  await recordAuditLog({
    organizationId,
    actorId: session.user.id,
    actorType: "user",
    action: "audit_log.exported",
    targetType: "organization",
    targetId: organizationId,
    metadata: { action: action ?? null, targetType: targetType ?? null, rowCount },
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${organizationId}.csv"`,
    },
  });
}
