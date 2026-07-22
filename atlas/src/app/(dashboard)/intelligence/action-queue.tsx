"use client";

import { Check, Eye, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  async function loadDetails(id: string) {
    if (details[id]) return;
    setLoadingId(id);
    try {
      const response = await fetch(`/api/brain/actions/${id}`);
      if (handleUnauthorized(response)) return;
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Action details could not be loaded");
      setDetails((current) => ({ ...current, [id]: payload?.data?.content ?? null }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action details could not be loaded");
    } finally {
      setLoadingId(null);
    }
  }

  async function updateStatus(id: string, status: "APPROVED" | "DISMISSED") {
    setUpdatingId(id);
    try {
      const response = await fetch(`/api/brain/actions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (handleUnauthorized(response)) return;
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Action update failed");
      toast.success(status === "APPROVED" ? "Action approved" : "Action dismissed");
      router.refresh();
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
                    What Atlas will prepare
                  </p>
                  {preview.map((item) => (
                    <div key={item.label} className="grid gap-1 sm:grid-cols-[110px_1fr]">
                      <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
                      <p className="whitespace-pre-wrap break-words text-sm">{item.value}</p>
                    </div>
                  ))}
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
                <Button size="sm" disabled={updatingId !== null} onClick={() => updateStatus(action.id, "APPROVED")}>
                  {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Approve
                </Button>
                <Button size="sm" variant="outline" disabled={updatingId !== null} onClick={() => updateStatus(action.id, "DISMISSED")}>
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

function getActionPreview(type: string, value: unknown): Array<{ label: string; value: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const content = value as Record<string, unknown>;
  const fields: Record<string, Array<[string, string]>> = {
    EMAIL_DRAFT: [["To", "to"], ["Subject", "subject"], ["Message", "body"]],
    TASK: [["Task", "title"], ["Details", "description"], ["Due date", "dueDate"]],
    CALENDAR_PROPOSAL: [["Meeting", "title"], ["Details", "description"], ["Duration", "duration"], ["Suggested date", "suggestedDate"]],
    FOLLOW_UP: [["With", "with"], ["Topic", "topic"], ["Suggested date", "suggestedDate"]],
  };
  return (fields[type] ?? Object.keys(content).map((key) => [formatLabel(key), key] as [string, string]))
    .map(([label, key]) => ({ label, value: formatValue(content[key]) }))
    .filter((item) => item.value.length > 0);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  return "";
}

function formatLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}
