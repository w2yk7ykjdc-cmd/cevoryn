"use client";

import { Loader2, Save } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { handleUnauthorized } from "@/lib/client-auth";

interface OrganizationNameFormProps {
  initialName: string;
}

export function OrganizationNameForm({ initialName }: OrganizationNameFormProps) {
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [isPending, startTransition] = useTransition();

  function save() {
    const normalized = name.trim();
    if (normalized.length < 2 || normalized.length > 80) {
      toast.error("Organization name must be between 2 and 80 characters");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/settings/organization", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: normalized }),
        });

        if (handleUnauthorized(response)) return;

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          toast.error(data?.error?.message ?? "Failed to update organization");
          return;
        }

        setName(data.data.name);
        setSavedName(data.data.name);
        toast.success("Organization updated");
      } catch (_error) {
        toast.error("Failed to update organization");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={80}
        disabled={isPending}
        aria-label="Organization name"
      />
      <Button
        type="button"
        size="sm"
        onClick={save}
        disabled={isPending || name.trim() === savedName}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        Save
      </Button>
    </div>
  );
}
