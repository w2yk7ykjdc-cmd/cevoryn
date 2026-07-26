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

  async function fetchDetails(id: string): Promise<unknown> {
    if (details[id]) return details[id];

    const response = await fetch(`/api/brain/actions/${id}`);
    if (handleUnauthorized(response)) return null;

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? "Action details could not be loaded");
    }

    const content = payload?.data?.content ?? null;
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
        await launchApprovedAction(action, content);
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

async function launchApprovedAction(action: ActionQueueItem, value: unknown) {
  const content = asRecord(value);

  if (action.type === "EMAIL_DRAFT") {
    const to = text(content.to);
    const subject = text(content.subject) || action.title;
    const body = text(content.body) || action.description;
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    toast.success("Action approved. Email composer opened.");
    return;
  }

  if (action.type === "CALENDAR_PROPOSAL") {
    const title = text(content.title) || action.title;
    const description = text(content.description) || action.description;
    const date = buildCalendarDates(text(content.suggestedDate), text(content.duration));
    const params = new URLSearchParams({ action: "TEMPLATE", text: title, details: description });
    if (date) params.set("dates", date);
    window.location.href = `https://calendar.google.com/calendar/render?${params.toString()}`;
    toast.success("Action approved. Calendar proposal opened.");
    return;
  }

  const note = getActionPreview(action.type, value)
    .map((item) => `${item.label}: ${item.value}`)
    .join("\n");
  const executionNote = note ? `${action.title}\n\n${note}` : `${action.title}\n\n${action.description}`;

  const copied = await copyText(executionNote);
  toast.success(copied ? "Action approved. Execution note copied." : "Action approved. Copy the details from the card.");
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function buildCalendarDates(suggestedDate: string, duration: string): string | null {
  const start = new Date(suggestedDate);
  if (Number.isNaN(start.getTime())) return null;

  const minutes = Number.parseInt(duration, 10);
  const end = new Date(start.getTime() + (Number.isFinite(minutes) ? minutes : 30) * 60_000);
  return `${toCalendarUtc(start)}/${toCalendarUtc(end)}`;
}

function toCalendarUtc(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
