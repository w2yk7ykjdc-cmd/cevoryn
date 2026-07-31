"use client";

import { Check, Loader2, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { handleUnauthorized } from "@/lib/client-auth";

interface DecisionQueueItem {
  id: string;
  status: string;
  priorityScore: number;
  problemStatement: string;
  recommendedDecision: string;
}

export function DecisionQueue({
  decisions,
}: {
  decisions: DecisionQueueItem[];
}) {
  const t = useTranslations("intelligence.decisionQueue");
  const router = useRouter();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});

  async function updateDecision(
    id: string,
    status: "ACCEPTED" | "REJECTED" | "IGNORED" | "COMPLETED",
    outcome?: string
  ) {
    setUpdatingId(id);
    try {
      const response = await fetch(`/api/brain/decisions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...(outcome ? { outcome } : {}) }),
      });

      if (handleUnauthorized(response)) return;

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? t("updateFailed"));
      }

      toast.success(
        status === "COMPLETED"
          ? t("outcomeRecorded")
          : status === "ACCEPTED"
            ? t("accepted")
            : status === "REJECTED"
              ? t("rejected")
              : t("ignored")
      );

      if (status === "COMPLETED") {
        setOutcomes((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      }

      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("updateFailed"));
    } finally {
      setUpdatingId(null);
    }
  }

  if (decisions.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t("noDecisions")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {decisions.map((decision) => {
        const isUpdating = updatingId === decision.id;
        const isProposed = decision.status === "PROPOSED";
        const canComplete =
          decision.status === "ACCEPTED" || decision.status === "EXECUTED";
        const outcome = outcomes[decision.id] ?? "";

        return (
          <Card key={decision.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">
                    {decision.problemStatement}
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("priority", {
                      score: decision.priorityScore.toFixed(1),
                    })}
                  </p>
                </div>
                <Badge variant="secondary">
                  {decision.status.split("_").join(" ")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {decision.recommendedDecision ? (
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("recommendation")}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed">
                    {decision.recommendedDecision}
                  </p>
                </div>
              ) : null}

              {isProposed ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={updatingId !== null}
                    onClick={() => updateDecision(decision.id, "ACCEPTED")}
                  >
                    {isUpdating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    {t("accept")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={updatingId !== null}
                    onClick={() => updateDecision(decision.id, "REJECTED")}
                  >
                    <X className="h-4 w-4" />
                    {t("reject")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={updatingId !== null}
                    onClick={() => updateDecision(decision.id, "IGNORED")}
                  >
                    {t("ignore")}
                  </Button>
                </div>
              ) : null}

              {canComplete ? (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("recordOutcome")}
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={outcome}
                      onChange={(event) =>
                        setOutcomes((current) => ({
                          ...current,
                          [decision.id]: event.target.value,
                        }))
                      }
                      placeholder={t("outcomePlaceholder")}
                      maxLength={1000}
                    />
                    <Button
                      size="sm"
                      disabled={!outcome.trim() || updatingId !== null}
                      onClick={() =>
                        updateDecision(decision.id, "COMPLETED", outcome.trim())
                      }
                    >
                      {isUpdating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      {t("complete")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
