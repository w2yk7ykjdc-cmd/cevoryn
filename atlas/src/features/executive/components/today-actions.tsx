"use client";

import { Check, Mail, Calendar, ListTodo, Bell, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { sendAnalyticsEvent } from "@/lib/analytics";

import type { ActionItem } from "../types";

interface TodayActionsProps {
  actions: ActionItem[];
}

const TYPE_CONFIG: Record<string, { icon: typeof Mail; label: string }> = {
  EMAIL_DRAFT: { icon: Mail, label: "Email Draft" },
  TASK: { icon: ListTodo, label: "Task" },
  CALENDAR_PROPOSAL: { icon: Calendar, label: "Meeting" },
  FOLLOW_UP: { icon: Bell, label: "Follow-up" },
};

export function TodayActions({ actions: initialActions }: TodayActionsProps) {
  const [actions, setActions] = useState(initialActions);

  if (actions.length === 0) return null;

  function handleDismiss(id: string) {
    setActions((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <section aria-label="Prepared actions">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Prepared Actions
      </h2>
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
  const config = TYPE_CONFIG[action.type] ?? { icon: ListTodo, label: action.type };
  const Icon = config.icon;

  function handleApprove() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/brain/actions/${action.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "APPROVED" }),
        });
        if (res.ok) {
          sendAnalyticsEvent("recommended_action_approved", { type: action.type });
          toast.success("Action approved");
          onDismiss();
        } else {
          toast.error("Failed to approve action");
        }
      } catch (_error) {
        toast.error("Something went wrong");
      }
    });
  }

  function handleReject() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/brain/actions/${action.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "DISMISSED" }),
        });
        if (res.ok) {
          sendAnalyticsEvent("recommended_action_rejected", { type: action.type });
          onDismiss();
        }
      } catch (_error) {
        // Silent dismiss
        onDismiss();
      }
    });
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">
              {config.label}
            </p>
            <p className="text-sm font-medium">{action.title}</p>
            {action.description && (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                {action.description}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={isPending}
            className="h-8 text-xs"
          >
            <Check className="h-3.5 w-3.5" />
            Approve
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
