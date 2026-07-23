import { Building2, Mail, ShieldCheck, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutAction } from "@/features/auth/actions/auth";
import { getMembership, requireUser } from "@/lib/auth";

function formatRole(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

function formatDisplayName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ");

  if (normalized.toLocaleLowerCase("tr-TR") === "kemal kiyak") {
    return "Kemal Kıyak";
  }

  return normalized
    .split(" ")
    .map((part) => {
      const lower = part.toLocaleLowerCase("tr-TR");
      return lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1);
    })
    .join(" ");
}

export default async function ProfilePage() {
  const user = await requireUser();
  const membership = await getMembership(user.id);

  if (!membership) {
    return null;
  }

  const displayName = formatDisplayName(membership.displayName);
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-40">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Account</p>
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your personal and organization details in Atlas.
        </p>
      </div>

      <Card>
        <CardContent className="flex items-center gap-4 p-6">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border bg-muted text-xl font-bold">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold">{displayName}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <div className="flex items-center gap-3 py-4 first:pt-0">
            <UserRound className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</p>
              <p className="truncate font-medium">{displayName}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 py-4">
            <Mail className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</p>
              <p className="truncate font-medium">{user.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 py-4">
            <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Organization</p>
              <p className="truncate font-medium">{membership.organizationName}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 py-4 last:pb-0">
            <ShieldCheck className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Role</p>
              <p className="font-medium">{formatRole(membership.role)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-10">
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={signOutAction}>
            <Button type="submit" variant="destructive" className="w-full sm:w-auto">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
