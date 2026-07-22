"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { handleUnauthorized } from "@/lib/client-auth";

const CONFIRMATION = "DELETE TEST DATA";

export function TestDataCleanup() {
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
        throw new Error(payload?.error?.message ?? "Test data cleanup failed");
      }

      const actions = Number(payload?.data?.actions ?? 0);
      const insights = Number(payload?.data?.insights ?? 0);
      toast.success(`Removed ${insights} test insight${insights === 1 ? "" : "s"} and ${actions} test action${actions === 1 ? "" : "s"}.`);
      setConfirmation("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Test data cleanup failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Removes only insights and prepared actions whose title starts with <strong>[TEST]</strong>, <strong>TEST:</strong>, or <strong>TEST </strong>. Company data is not touched.
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
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        Remove labeled test data
      </Button>
    </div>
  );
}
