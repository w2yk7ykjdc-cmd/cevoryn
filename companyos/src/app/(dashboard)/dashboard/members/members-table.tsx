"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updateMemberRoleAction, removeMemberAction } from "@/app/(dashboard)/dashboard/members/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const ROLES = ["viewer", "member", "admin", "owner"];

type Member = { id: string; role: string; name: string; email: string };
type Invitation = { id: string; email: string; role: string };

export function MembersTable({
  members,
  invitations,
  currentMemberId,
}: {
  members: Member[];
  invitations: Invitation[];
  currentMemberId: string;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleRoleChange(memberId: string, role: string) {
    setPendingId(memberId);
    const result = await updateMemberRoleAction(memberId, role);
    setPendingId(null);
    if (!result.success) toast.error(result.error);
    else toast.success("Role updated");
  }

  async function handleRemove(memberId: string) {
    setPendingId(memberId);
    const result = await removeMemberAction(memberId);
    setPendingId(null);
    if (!result.success) toast.error(result.error);
    else toast.success("Member removed");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {members.length} member{members.length === 1 ? "" : "s"}
          {invitations.length > 0 ? ` · ${invitations.length} pending` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.name}</TableCell>
                <TableCell className="text-muted-foreground">{m.email}</TableCell>
                <TableCell>
                  <Select
                    value={m.role}
                    onValueChange={(role) => handleRoleChange(m.id, role)}
                    disabled={pendingId === m.id || m.id === currentMemberId}
                  >
                    <SelectTrigger className="w-32 capitalize">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r} className="capitalize">
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right">
                  {m.id !== currentMemberId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pendingId === m.id}
                      onClick={() => handleRemove(m.id)}
                    >
                      Remove
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {invitations.map((invite) => (
              <TableRow key={invite.id}>
                <TableCell className="text-muted-foreground italic">Invited</TableCell>
                <TableCell className="text-muted-foreground">{invite.email}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {invite.role} · pending
                  </Badge>
                </TableCell>
                <TableCell />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
