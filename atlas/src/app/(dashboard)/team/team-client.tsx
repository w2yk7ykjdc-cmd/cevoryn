"use client";

import { Check, Clock, Copy, Loader2, Mail, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

interface Member {
  id: string;
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  acceptPath?: string;
}

interface TeamClientProps {
  orgName: string;
  currentUserId: string;
  canInvite: boolean;
  members: Member[];
  pendingInvites: PendingInvite[];
}

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  OWNER: "default",
  ADMIN: "secondary",
  MEMBER: "outline",
};

export function TeamClient({
  orgName,
  currentUserId,
  canInvite,
  members,
  pendingInvites: initialInvites,
}: TeamClientProps) {
  const [invites, setInvites] = useState(initialInvites);
  const [email, setEmail] = useState("");
  const [isPending, startTransition] = useTransition();
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  function handleInvite() {
    if (!email.trim()) return;

    startTransition(async () => {
      try {
        const res = await fetch("/api/team/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          toast.error(data?.error?.message ?? "Failed to send invite");
          return;
        }

        const data = await res.json();
        setInvites((prev) => [data.data, ...prev]);
        setEmail("");
        toast.success(`Invite sent to ${email.trim()}`);
      } catch (_error) {
        toast.error("Something went wrong");
      }
    });
  }

  async function copyInviteLink(invite: PendingInvite) {
    try {
      let acceptPath = invite.acceptPath;

      if (!acceptPath) {
        const res = await fetch(`/api/team/invite/${invite.id}`);
        const data = await res.json().catch(() => null);

        if (!res.ok || !data?.data?.acceptPath) {
          toast.error(data?.error?.message ?? "Invite link could not be loaded");
          return;
        }

        acceptPath = data.data.acceptPath;
        setInvites((prev) =>
          prev.map((item) =>
            item.id === invite.id ? { ...item, acceptPath } : item
          )
        );
      }

      const inviteUrl = `${window.location.origin}${acceptPath}`;
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedInviteId(invite.id);
      toast.success("Invite link copied");
    } catch (_error) {
      toast.error("Invite link could not be copied");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">
          {members.length} member{members.length === 1 ? "" : "s"} in {orgName}
        </p>
      </div>

      {canInvite && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4" />
              Invite a team member
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="colleague@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleInvite();
                }}
                disabled={isPending}
                className="flex-1"
              />
              <Button
                onClick={handleInvite}
                disabled={isPending || !email.trim()}
                size="sm"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                Invite
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {invites.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Pending Invites
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {invites.map((invite, i) => (
              <div
                key={invite.id}
                className={`flex items-center justify-between gap-2 px-4 py-3 ${
                  i < invites.length - 1 ? "border-b" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{invite.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Expires{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                    }).format(new Date(invite.expiresAt))}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyInviteLink(invite)}
                  >
                    {copiedInviteId === invite.id ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    Copy link
                  </Button>
                  <Badge variant="outline" className="text-[10px]">
                    {invite.role}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Separator />

      <Card>
        <CardContent className="p-0">
          {members.map((member, i) => (
            <div
              key={member.id}
              className={`flex items-center gap-3 px-4 py-3 ${
                i < members.length - 1 ? "border-b" : ""
              }`}
            >
              <Avatar className="h-9 w-9">
                <AvatarFallback className="text-xs">
                  {member.displayName
                    .split(" ")
                    .map((n: string) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.displayName}
                  {member.userId === currentUserId && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      (you)
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Joined{" "}
                  {new Intl.DateTimeFormat("en-US", {
                    month: "short",
                    year: "numeric",
                  }).format(new Date(member.joinedAt))}
                </p>
              </div>
              <Badge
                variant={ROLE_VARIANT[member.role] ?? "outline"}
                className="text-[10px]"
              >
                {member.role}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
