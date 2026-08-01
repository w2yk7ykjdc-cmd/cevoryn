"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { handleUnauthorized } from "@/lib/client-auth";

const CONFIRMATION = "DELETE TEST DATA";

export function TestDataCleanup() {
  const t = useTranslations("settings.testData");
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function cleanup() {
    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/test-data", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      if (handleUnauthorized(response)) return;

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? t("cleanupFailed"));
      }

      const actions = Number(payload?.data?.actions ?? 0);
      const insights = Number(payload?.data?.insights ?? 0);
      toast.success(t("removedToast", { actions, insights }));
      setConfirmation("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("cleanupFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t.rich("description", { b: (chunks) => <strong>{chunks}</strong> })}
      </p>
      <Input
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        placeholder={CONFIRMATION}
        autoCapitalize="characters"
      />
      <Button
        type="button"
        variant="destructive"
        disabled={submitting || confirmation !== CONFIRMATION}
        onClick={cleanup}
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
        {t("removeButton")}
      </Button>
    </div>
  );
}
