"use client";

import { Check, Loader2, X } from "lucide-react";
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
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Action update failed");
      }

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
        const isUpdating = updatingId === action.id;
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
              {action.reasoning ? (
                <p className="text-xs text-muted-foreground">{action.reasoning}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={updatingId !== null}
                  onClick={() => updateStatus(action.id, "APPROVED")}
                >
                  {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={updatingId !== null}
                  onClick={() => updateStatus(action.id, "DISMISSED")}
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
