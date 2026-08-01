"use client";

import {
  Check,
  Clock,
  Copy,
  Loader2,
  Mail,
  RefreshCw,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { handleUnauthorized } from "@/lib/client-auth";

interface Member {
  id: string;
  userId: string;
  displayName: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
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
  currentUserRole: "OWNER" | "ADMIN" | "MEMBER";
  canInvite: boolean;
  canRemoveMembers: boolean;
  canUpdateRoles: boolean;
  members: Member[];
  pendingInvites: PendingInvite[];
}

const ROLE_VARIANT: Record<
  Member["role"],
  "default" | "secondary" | "outline"
> = {
  OWNER: "default",
  ADMIN: "secondary",
  MEMBER: "outline",
};

export function TeamClient({
  orgName,
  currentUserId,
  currentUserRole,
  canInvite,
  canRemoveMembers,
  canUpdateRoles,
  members: initialMembers,
  pendingInvites: initialInvites,
}: TeamClientProps) {
  const t = useTranslations("team");
  const locale = useLocale();
  const [members, setMembers] = useState(initialMembers);
  const [invites, setInvites] = useState(initialInvites);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [isPending, startTransition] = useTransition();
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(
    null
  );
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(
    null
  );

  function removeStaleInvite(inviteId: string) {
    setInvites((prev) => prev.filter((item) => item.id !== inviteId));
  }

  function handleInvite() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) return;

    startTransition(async () => {
      try {
        const res = await fetch("/api/team/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: normalizedEmail, role: inviteRole }),
        });

        if (handleUnauthorized(res)) return;

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          if (res.status === 429) {
            const retryAfter = Number(res.headers.get("Retry-After"));
            const minutes = Number.isFinite(retryAfter)
              ? Math.max(1, Math.ceil(retryAfter / 60))
              : 60;
            toast.error(t("toasts.tooManyAttempts", { minutes }));
            return;
          }

          toast.error(data?.error?.message ?? t("toasts.inviteFailed"));
          return;
        }

        setInvites((prev) => [data.data, ...prev]);
        setEmail("");
        setInviteRole("MEMBER");

        if (data.data.emailSent === false) {
          if (data.data.emailStatus === "NOT_CONFIGURED") {
            toast.success(t("toasts.inviteCreatedCopyLink"));
          } else {
            toast.warning(t("toasts.inviteCreatedEmailFailed"));
          }
        } else {
          toast.success(
            t("toasts.inviteCreatedFor", { email: normalizedEmail })
          );
        }
      } catch (_error) {
        toast.error(t("toasts.somethingWentWrong"));
      }
    });
  }

  async function updateMemberRole(member: Member, role: "ADMIN" | "MEMBER") {
    setBusyMemberId(member.id);
    try {
      const res = await fetch(`/api/team/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });

      if (handleUnauthorized(res)) return;

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error?.message ?? t("toasts.roleUpdateFailed"));
        return;
      }

      setMembers((prev) =>
        prev.map((item) =>
          item.id === member.id ? { ...item, role: data.data.role } : item
        )
      );
      toast.success(t("toasts.roleUpdated"));
    } catch (_error) {
      toast.error(t("toasts.roleUpdateFailed"));
    } finally {
      setBusyMemberId(null);
    }
  }

  async function removeMember(member: Member) {
    setConfirmingRemoveId(null);
    setBusyMemberId(member.id);
    try {
      const res = await fetch(`/api/team/members/${member.id}`, {
        method: "DELETE",
      });

      if (handleUnauthorized(res)) return;

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error?.message ?? t("toasts.removeFailed"));
        return;
      }

      setMembers((prev) => prev.filter((item) => item.id !== member.id));
      toast.success(t("toasts.removed"));
    } catch (_error) {
      toast.error(t("toasts.removeFailed"));
    } finally {
      setBusyMemberId(null);
    }
  }

  async function copyInviteLink(invite: PendingInvite) {
    try {
      let acceptPath = invite.acceptPath;

      if (!acceptPath) {
        const res = await fetch(`/api/team/invite/${invite.id}`);
        if (handleUnauthorized(res)) return;
        const data = await res.json().catch(() => null);

        if (!res.ok || !data?.data?.acceptPath) {
          if (res.status === 404) removeStaleInvite(invite.id);
          toast.error(data?.error?.message ?? t("toasts.inviteLinkLoadFailed"));
          return;
        }

        acceptPath = data.data.acceptPath;
        setInvites((prev) =>
          prev.map((item) =>
            item.id === invite.id ? { ...item, acceptPath } : item
          )
        );
      }

      await navigator.clipboard.writeText(
        `${window.location.origin}${acceptPath}`
      );
      setCopiedInviteId(invite.id);
      toast.success(t("toasts.inviteLinkCopied"));
    } catch (_error) {
      toast.error(t("toasts.inviteLinkCopyFailed"));
    }
  }

  async function renewInvite(invite: PendingInvite) {
    setBusyInviteId(invite.id);
    try {
      const res = await fetch(`/api/team/invite/${invite.id}`, {
        method: "PATCH",
      });

      if (handleUnauthorized(res)) return;

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 404) removeStaleInvite(invite.id);
        toast.error(data?.error?.message ?? t("toasts.renewFailed"));
        return;
      }

      setInvites((prev) =>
        prev.map((item) =>
          item.id === invite.id
            ? {
                ...item,
                expiresAt: data.data.expiresAt,
                acceptPath: data.data.acceptPath,
              }
            : item
        )
      );

      if (data.data.emailSent === false) {
        toast.warning(t("toasts.renewedEmailFailed"));
      } else {
        toast.success(t("toasts.renewedAndEmailed"));
      }
    } catch (_error) {
      toast.error(t("toasts.renewFailed"));
    } finally {
      setBusyInviteId(null);
    }
  }

  async function cancelInvite(invite: PendingInvite) {
    setConfirmingCancelId(null);
    setBusyInviteId(invite.id);
    try {
      const res = await fetch(`/api/team/invite/${invite.id}`, {
        method: "DELETE",
      });

      if (handleUnauthorized(res)) return;

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 404) removeStaleInvite(invite.id);
        toast.error(data?.error?.message ?? t("toasts.cancelFailed"));
        return;
      }

      removeStaleInvite(invite.id);
      toast.success(t("toasts.cancelled"));
    } catch (_error) {
      toast.error(t("toasts.cancelFailed"));
    } finally {
      setBusyInviteId(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("memberCount", { count: members.length, orgName })}
        </p>
      </div>

      {canInvite && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4" /> {t("inviteCard.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                placeholder={t("inviteCard.emailPlaceholder")}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleInvite()}
                disabled={isPending}
                className="flex-1"
              />
              {currentUserRole === "OWNER" && (
                <select
                  aria-label={t("inviteCard.roleLabel")}
                  className="h-9 rounded-md border bg-background px-3 text-sm sm:w-32"
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(event.target.value as "ADMIN" | "MEMBER")
                  }
                  disabled={isPending}
                >
                  <option value="MEMBER">MEMBER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              )}
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
                {t("inviteCard.inviteButton")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {invites.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-muted-foreground" />{" "}
              {t("pendingInvites")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {invites.map((invite, index) =>
              confirmingCancelId === invite.id ? (
                <div
                  key={invite.id}
                  className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${index < invites.length - 1 ? "border-b" : ""}`}
                >
                  <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                    {t("toasts.cancelConfirm", { email: invite.email })}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busyInviteId === invite.id}
                      onClick={() => cancelInvite(invite)}
                    >
                      {busyInviteId === invite.id && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {t("actions.confirmCancelInvite")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyInviteId === invite.id}
                      onClick={() => setConfirmingCancelId(null)}
                    >
                      {t("actions.dismiss")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  key={invite.id}
                  className={`flex items-center justify-between gap-2 px-4 py-3 ${index < invites.length - 1 ? "border-b" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{invite.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("expires", {
                        date: new Intl.DateTimeFormat(locale, {
                          month: "short",
                          day: "numeric",
                        }).format(new Date(invite.expiresAt)),
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyInviteLink(invite)}
                      disabled={busyInviteId === invite.id}
                    >
                      {copiedInviteId === invite.id ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span className="hidden sm:inline">{t("copyLink")}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("renewInviteAria", {
                        email: invite.email,
                      })}
                      disabled={busyInviteId === invite.id}
                      onClick={() => renewInvite(invite)}
                    >
                      {busyInviteId === invite.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                    <Badge variant="outline" className="text-[10px]">
                      {invite.role}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("cancelInviteAria", {
                        email: invite.email,
                      })}
                      disabled={busyInviteId === invite.id}
                      onClick={() => setConfirmingCancelId(invite.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )
            )}
          </CardContent>
        </Card>
      )}

      <Separator />

      <Card>
        <CardContent className="p-0">
          {members.map((member, index) => {
            const isSelf = member.userId === currentUserId;
            const canEditRole =
              canUpdateRoles && !isSelf && member.role !== "OWNER";
            const canRemove =
              canRemoveMembers &&
              !isSelf &&
              member.role !== "OWNER" &&
              (currentUserRole === "OWNER" || member.role === "MEMBER");

            if (confirmingRemoveId === member.id) {
              return (
                <div
                  key={member.id}
                  className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${index < members.length - 1 ? "border-b" : ""}`}
                >
                  <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                    {t("toasts.removeConfirm", {
                      name: member.displayName,
                      orgName,
                    })}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busyMemberId === member.id}
                      onClick={() => removeMember(member)}
                    >
                      {busyMemberId === member.id && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {t("actions.confirmRemove")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyMemberId === member.id}
                      onClick={() => setConfirmingRemoveId(null)}
                    >
                      {t("actions.dismiss")}
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={member.id}
                className={`flex items-center gap-3 px-4 py-3 ${index < members.length - 1 ? "border-b" : ""}`}
              >
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="text-xs">
                    {member.displayName
                      .split(" ")
                      .map((name) => name[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.displayName}
                    {isSelf && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {t("you")}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("joined", {
                      date: new Intl.DateTimeFormat(locale, {
                        month: "short",
                        year: "numeric",
                      }).format(new Date(member.joinedAt)),
                    })}
                  </p>
                </div>
                {canEditRole ? (
                  <select
                    aria-label={t("roleAria", { name: member.displayName })}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    value={member.role}
                    disabled={busyMemberId === member.id}
                    onChange={(event) =>
                      updateMemberRole(
                        member,
                        event.target.value as "ADMIN" | "MEMBER"
                      )
                    }
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="MEMBER">MEMBER</option>
                  </select>
                ) : (
                  <Badge
                    variant={ROLE_VARIANT[member.role]}
                    className="text-[10px]"
                  >
                    {member.role}
                  </Badge>
                )}
                {canRemove && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("removeAria", { name: member.displayName })}
                    disabled={busyMemberId === member.id}
                    onClick={() => setConfirmingRemoveId(member.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
