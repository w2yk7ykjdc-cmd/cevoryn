"use client";

import { Building2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { OrganizationMembershipOption } from "@/types";

interface OrganizationSwitcherProps {
  activeOrganizationId: string;
  memberships: OrganizationMembershipOption[];
}

export function OrganizationSwitcher({
  activeOrganizationId,
  memberships,
}: OrganizationSwitcherProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  if (memberships.length <= 1) return null;

  async function switchOrganization(organizationId: string) {
    if (organizationId === activeOrganizationId || isPending) return;

    setIsPending(true);
    try {
      const response = await fetch("/api/organizations/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          payload?.error?.message ?? "Organization could not be switched"
        );
      }

      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Organization could not be switched"
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="relative flex items-center gap-2">
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <Building2 className="h-4 w-4 text-muted-foreground" />
      )}
      <select
        value={activeOrganizationId}
        onChange={(event) => void switchOrganization(event.target.value)}
        disabled={isPending}
        aria-label="Active organization"
        className="h-9 max-w-40 rounded-md border border-input bg-background px-2 text-sm font-medium outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {memberships.map((membership) => (
          <option
            key={membership.organizationId}
            value={membership.organizationId}
          >
            {membership.organizationName} · {membership.role}
          </option>
        ))}
      </select>
    </div>
  );
}
