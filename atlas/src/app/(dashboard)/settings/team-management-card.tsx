"use client";

import { Loader2, Mail, UserPlus, Users } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { handleUnauthorized } from "@/lib/client-auth";

type MemberRole = "OWNER" | "ADMIN" | "MEMBER";

type TeamMember = {
  id: string;
  displayName: string;
  role: MemberRole;
};

type PendingInvite = {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
};

interface TeamManagementCardProps {
  members: TeamMember[];
  initialInvites: PendingInvite[];
  canInvite: boolean;
  canInviteAdmins: boolean;
}

export function TeamManagementCard({
  members,
  initialInvites,
  canInvite,
  canInviteAdmins,
}: TeamManagementCardProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<MemberRole, "OWNER">>("MEMBER");
  const [invites, setInvites] = useState(initialInvites);
  const [isPending, startTransition] = useTransition();

  function sendInvite() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error("Enter an email address");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/team/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: normalizedEmail, role }),
        });

        if (handleUnauthorized(response)) return;

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          toast.error(payload?.error?.message ?? "Failed to send invite");
          return;
        }

        const invite = payload.data as {
          id: string;
          email: string;
          role: Exclude<MemberRole, "OWNER">;
          expiresAt: string;
          emailSent: boolean;
        };

        setInvites((current) => [invite, ...current]);
        setEmail("");
        toast.success(
          invite.emailSent
            ? "Invitation sent"
            : "Invitation created, but the email could not be sent"
        );
      } catch (_error) {
        toast.error("Failed to send invite");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Team
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {canInvite ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Invite a teammate</p>
              <p className="text-xs text-muted-foreground">
                Invitations expire after 7 days.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isPending}
                aria-label="Teammate email"
              />
              <select
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as Exclude<MemberRole, "OWNER">)
                }
                disabled={isPending}
                aria-label="Teammate role"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="MEMBER">Member</option>
                {canInviteAdmins ? <option value="ADMIN">Admin</option> : null}
              </select>
              <Button type="button" onClick={sendInvite} disabled={isPending}>
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                Invite
              </Button>
            </div>
          </div>
        ) : null}

        {canInvite ? <Separator /> : null}

        <div className="space-y-3">
          <p className="text-sm font-medium">Members ({members.length})</p>
          <div className="space-y-2">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <span className="min-w-0 truncate text-sm font-medium">
                  {member.displayName}
                </span>
                <Badge variant="secondary" className="ml-3 text-xs">
                  {member.role}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {invites.length > 0 ? (
          <>
            <Separator />
            <div className="space-y-3">
              <p className="text-sm font-medium">Pending invitations</p>
              <div className="space-y-2">
                {invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{invite.email}</p>
                        <p className="text-xs text-muted-foreground">
                          Expires{" "}
                          {new Intl.DateTimeFormat("en-US", {
                            dateStyle: "medium",
                          }).format(new Date(invite.expiresAt))}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {invite.role}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
