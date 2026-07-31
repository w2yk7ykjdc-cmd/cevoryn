"use client";

import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { handleUnauthorized } from "@/lib/client-auth";

interface DisplayNameFormProps {
  initialName: string;
}

export function DisplayNameForm({ initialName }: DisplayNameFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [isPending, startTransition] = useTransition();

  function save() {
    const normalized = name.trim();
    if (normalized.length < 1 || normalized.length > 80) {
      toast.error("Name must be between 1 and 80 characters");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/settings/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: normalized }),
        });

        if (handleUnauthorized(response)) return;

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          toast.error(data?.error?.message ?? "Failed to update name");
          return;
        }

        setName(data.data.displayName);
        setSavedName(data.data.displayName);
        toast.success("Name updated");
        router.refresh();
      } catch (_error) {
        toast.error("Failed to update name");
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
        aria-label="Your name"
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
