import { headers as nextHeaders } from "next/headers";
import Link from "next/link";
import { auth } from "@/server/auth/auth";
import { requirePermission } from "@/server/auth/session";
import { listAuditLogs } from "@/server/audit/audit-log";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SearchParams = Promise<{ action?: string; targetType?: string; from?: string; to?: string }>;

export default async function AuditLogPage({ searchParams }: { searchParams: SearchParams }) {
  const { organization } = await requirePermission({ auditLog: ["read"] });
  const params = await searchParams;

  const [{ entries }, exportPermitted] = await Promise.all([
    listAuditLogs({
      organizationId: organization.id,
      limit: 100,
      action: params.action || undefined,
      targetType: params.targetType || undefined,
      from: params.from ? new Date(params.from) : undefined,
      to: params.to ? new Date(params.to) : undefined,
    }),
    auth.api.hasPermission({
      headers: await nextHeaders(),
      body: { organizationId: organization.id, permissions: { auditLog: ["export"] } },
    }),
  ]);
  const canExport = exportPermitted.success;

  const exportHref = `/api/audit-log/export?${new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString()}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            An immutable record of every state-changing action in this workspace.
          </p>
        </div>
        {canExport && (
          <Button asChild variant="outline" size="sm">
            <a href={exportHref} download>
              Export CSV
            </a>
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <form className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4" method="get">
            <div className="flex flex-col gap-2">
              <Label htmlFor="filter-action">Action</Label>
              <Input id="filter-action" name="action" defaultValue={params.action} placeholder="e.g. lead.created" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="filter-target-type">Target type</Label>
              <Input id="filter-target-type" name="targetType" defaultValue={params.targetType} placeholder="e.g. lead" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="filter-from">From</Label>
              <Input id="filter-from" name="from" type="date" defaultValue={params.from} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="filter-to">To</Label>
              <Input id="filter-to" name="to" type="date" defaultValue={params.to} />
            </div>
            <div className="col-span-2 flex items-end gap-2 sm:col-span-4">
              <Button type="submit" size="sm">
                Apply filters
              </Button>
              {(params.action || params.targetType || params.from || params.to) && (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard/audit-log">Clear</Link>
                </Button>
              )}
            </div>
          </form>

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
