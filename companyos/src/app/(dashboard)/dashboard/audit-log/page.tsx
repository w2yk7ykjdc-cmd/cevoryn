import { requirePermission } from "@/server/auth/session";
import { listAuditLogs } from "@/server/audit/audit-log";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default async function AuditLogPage() {
  const { organization } = await requirePermission({ auditLog: ["read"] });
  const { entries } = await listAuditLogs({ organizationId: organization.id, limit: 100 });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          An immutable record of every state-changing action in this workspace.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No activity yet.
                  </TableCell>
                </TableRow>
              )}
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <Badge variant="outline">{entry.action}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.targetType}:{entry.targetId.slice(0, 8)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.actorType}
                    {entry.actorId ? ` · ${entry.actorId.slice(0, 8)}` : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.createdAt.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
