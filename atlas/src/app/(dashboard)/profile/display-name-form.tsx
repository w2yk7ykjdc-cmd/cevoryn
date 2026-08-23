"use client";

import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { handleUnauthorized } from "@/lib/client-auth";

interface DisplayNameFormProps {
  initialName: string;
}

export function DisplayNameForm({ initialName }: DisplayNameFormProps) {
  const t = useTranslations("profile");
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    const normalized = name.trim();
    if (normalized.length < 1 || normalized.length > 80) {
      setFieldError(t("nameInvalidLength"));
      return;
    }
    setFieldError(null);

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
          setFieldError(data?.error?.message ?? t("updateFailed"));
          return;
        }

        setName(data.data.displayName);
        setSavedName(data.data.displayName);
        toast.success(t("updated"));
        router.refresh();
      } catch (_error) {
        setFieldError(t("updateFailed"));
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (fieldError) setFieldError(null);
          }}
          maxLength={80}
          disabled={isPending}
          aria-label={t("nameLabel")}
          aria-invalid={fieldError ? true : undefined}
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
          {t("save")}
        </Button>
      </div>
      {fieldError ? (
        <p role="alert" className="text-xs text-destructive">
          {fieldError}
        </p>
      ) : null}
    </div>
  );
}
