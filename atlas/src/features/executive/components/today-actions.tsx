"use client";

import {
  Bell,
  Calendar,
  Check,
  Loader2,
  Mail,
  ListTodo,
  Sparkles,
  X,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  fetchActionDetails,
  launchApprovedAction,
} from "@/features/brain/actions/action-handoff";
import { sendAnalyticsEvent } from "@/lib/analytics";

import type { ActionItem } from "../types";

interface TodayActionsProps {
  actions: ActionItem[];
}

const TYPE_CONFIG: Record<
  string,
  { icon: typeof Mail; label: string; approveLabel: string }
> = {
  EMAIL_DRAFT: { icon: Mail, label: "Email ready", approveLabel: "Approve draft" },
  TASK: { icon: ListTodo, label: "Task ready", approveLabel: "Copy task details" },
  CALENDAR_PROPOSAL: {
    icon: Calendar,
    label: "Meeting ready",
    approveLabel: "Approve meeting",
  },
  FOLLOW_UP: { icon: Bell, label: "Follow-up ready", approveLabel: "Copy follow-up details" },
};

export function TodayActions({ actions: initialActions }: TodayActionsProps) {
  const [actions, setActions] = useState(initialActions);

  if (actions.length === 0) return null;

  function handleDismiss(id: string) {
    setActions((prev) => prev.filter((action) => action.id !== id));
  }

  return (
    <section aria-label="Actions ready for approval">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Ready to execute
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            CEVORYN prepared these next steps. You stay in control.
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {actions.length} ready
        </Badge>
      </div>

      <div className="space-y-2">
        {actions.map((action) => (
          <ActionCard
            key={action.id}
            action={action}
            onDismiss={() => handleDismiss(action.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ActionCard({
  action,
  onDismiss,
}: {
  action: ActionItem;
  onDismiss: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const config = TYPE_CONFIG[action.type] ?? {
    icon: ListTodo,
    label: "Action ready",
    approveLabel: "Copy details",
  };
  const Icon = config.icon;
  const confidence = Math.round(action.confidence * 100);

  function handleApprove() {
    startTransition(async () => {
      try {
        const content = await fetchActionDetails(action.id);

        const response = await fetch(`/api/brain/actions/${action.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "APPROVED" }),
        });

        if (!response.ok) {
          toast.error("CEVORYN could not approve this action. Please try again.");
          return;
        }

        sendAnalyticsEvent("recommended_action_approved", {
          id: action.id,
          type: action.type,
        });

        try {
          const message = await launchApprovedAction(action, content);
          toast.success(message);
        } catch (handoffError) {
          console.error(
            "Approved action handoff error:",
            handoffError instanceof Error ? handoffError.message : "unknown"
          );
          toast.warning("Approved, but the next app could not be opened. Open Intelligence to continue manually.");
        }

        onDismiss();
      } catch (_error) {
        toast.error("CEVORYN could not approve this action. Please try again.");
      }
    });
  }

  function handleReject() {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/brain/actions/${action.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "DISMISSED" }),
        });

        if (!response.ok) {
          toast.error("CEVORYN could not dismiss this action. Please try again.");
          return;
        }

        sendAnalyticsEvent("recommended_action_rejected", {
          id: action.id,
          type: action.type,
        });
        toast.success("Action dismissed");
        onDismiss();
      } catch (_error) {
        toast.error("CEVORYN could not dismiss this action. Please try again.");
      }
    });
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-primary">{config.label}</span>
              <span className="text-[11px] text-muted-foreground">
                {confidence}% confidence
              </span>
            </div>
            <p className="text-sm font-semibold leading-snug">{action.title}</p>
            {action.description && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {action.description}
              </p>
            )}
            {action.reasoning && (
              <div className="mt-3 flex items-start gap-2 rounded-md bg-muted/50 p-2.5">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {action.reasoning}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={isPending}
            className="h-8 text-xs"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {config.approveLabel}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleReject}
            disabled={isPending}
            className="h-8 text-xs text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
