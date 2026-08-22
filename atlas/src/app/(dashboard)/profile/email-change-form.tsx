"use client";

import { Loader2, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { handleUnauthorized } from "@/lib/client-auth";

interface EmailChangeFormProps {
  initialEmail: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailChangeForm({ initialEmail }: EmailChangeFormProps) {
  const t = useTranslations("profile");
  const [email, setEmail] = useState(initialEmail);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      toast.error(t("emailInvalid"));
      return;
    }
    if (normalized === initialEmail.toLowerCase()) {
      toast.error(t("emailUnchanged"));
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/settings/email", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: normalized }),
        });

        if (handleUnauthorized(response)) return;

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (data?.error?.code === "EMAIL_IN_USE") {
            toast.error(t("emailInUse"));
          } else {
            toast.error(data?.error?.message ?? t("emailUpdateFailed"));
          }
          return;
        }

        setPendingEmail(normalized);
        toast.success(t("emailConfirmationSent", { email: normalized }));
      } catch (_error) {
        toast.error(t("emailUpdateFailed"));
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={isPending}
          aria-label={t("emailLabel")}
        />
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={
            isPending ||
            email.trim().toLowerCase() === initialEmail.toLowerCase()
          }
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {t("save")}
        </Button>
      </div>
      {pendingEmail ? (
        <p className="text-xs text-muted-foreground">
          {t("emailConfirmationSent", { email: pendingEmail })}
        </p>
      ) : null}
    </div>
  );
}
