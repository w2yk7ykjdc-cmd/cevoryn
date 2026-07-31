"use client";

import { Check, Eye, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchActionDetails,
  getActionPreview,
  launchApprovedAction,
} from "@/features/brain/actions/action-handoff";
import { handleUnauthorized } from "@/lib/client-auth";

interface ActionQueueItem {
  id: string;
  title: string;
  description: string;
  type: string;
  confidence: number;
  reasoning: string;
}

export function ActionQueue({ actions }: { actions: ActionQueueItem[] }) {
  const router = useRouter();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, unknown>>({});

  async function fetchDetails(id: string): Promise<unknown> {
    if (details[id]) return details[id];

    const content = await fetchActionDetails(id);
    setDetails((current) => ({ ...current, [id]: content }));
    return content;
  }

  async function loadDetails(id: string) {
    if (details[id]) return;
    setLoadingId(id);
    try {
      await fetchDetails(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action details could not be loaded");
    } finally {
      setLoadingId(null);
    }
  }

  async function updateStatus(action: ActionQueueItem, status: "APPROVED" | "DISMISSED") {
    setUpdatingId(action.id);
    try {
      const content = status === "APPROVED" ? await fetchDetails(action.id) : null;

      const response = await fetch(`/api/brain/actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (handleUnauthorized(response)) return;

      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Action update failed");

      if (status === "DISMISSED") {
        toast.success("Action dismissed");
        router.refresh();
        return;
      }

      router.refresh();
      try {
        const message = await launchApprovedAction(action, content);
        toast.success(message);
      } catch (handoffError) {
        console.error(
          "Approved action handoff error:",
          handoffError instanceof Error ? handoffError.message : "unknown"
        );
        toast.warning("Action approved, but the next app could not be opened. Use the reviewed details to continue manually.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update action");
    } finally {
      setUpdatingId(null);
    }
  }

  if (actions.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No prepared actions are waiting for review.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {actions.map((action) => {
        const preview = getActionPreview(action.type, details[action.id]);
        const isUpdating = updatingId === action.id;
        const isLoading = loadingId === action.id;
        const hasReviewed = Object.prototype.hasOwnProperty.call(details, action.id);

        return (
          <Card key={action.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{action.title}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {action.type.split("_").join(" ")} · {Math.round(action.confidence * 100)}% confidence
                  </p>
                </div>
                <Badge variant="secondary">PENDING</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-relaxed">{action.description}</p>

              {preview.length > 0 ? (
                <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    What CEVORYN will prepare
                  </p>
                  {preview.map((item) => (
                    <div key={item.label} className="grid gap-1 sm:grid-cols-[110px_1fr]">
                      <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
                      <p className="whitespace-pre-wrap break-words text-sm">{item.value}</p>
                    </div>
                  ))}
                </div>
              ) : hasReviewed ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-muted-foreground">
                  No structured execution details were provided. CEVORYN will use the action title and description.
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isLoading || updatingId !== null}
                  onClick={() => loadDetails(action.id)}
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  Review details
                </Button>
              )}

              {action.reasoning ? <p className="text-xs text-muted-foreground">{action.reasoning}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!hasReviewed || updatingId !== null}
                  onClick={() => updateStatus(action, "APPROVED")}
                >
                  {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Approve & continue
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={updatingId !== null}
                  onClick={() => updateStatus(action, "DISMISSED")}
                >
                  <X className="h-4 w-4" />
                  Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

